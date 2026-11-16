jest.mock('../shift4Service');
jest.mock('../../customer/customerService');

import config from '@/config';
import { Hotel } from '@/dtos/Hotel';
import { HotelConfiguration } from '@/dtos/HotelConfiguration';
import { Reservation as ReservationDTO } from '@/dtos/Reservation';
import { BadRequestError } from '@/errors/BadRequestError';
import { PaymentProvider, PmsProvider } from '@/types/enums';
import { CardOnFileType, Shift4ResponseCode } from '@/types/shift4';
import customerService from '../../customer/customerService';
import { shift4DelayedCharge } from '../Shift4AutoChargeExecutor';
import shift4Service from '../shift4Service';

const HOTEL_ID = 'hotel-shift4-auto-charge-1';

function createHotel(overrides: Partial<Hotel> = {}): Hotel {
  return {
    id: HOTEL_ID,
    name: 'Test Hotel',
    pms_provider: PmsProvider.RESNEXUS,
    telegram_check_in_group_id: 'tg-check-in',
    telegram_alerts_group_id: 'tg-alerts',
    assistant_phone_number: '+15551234567',
    business_id: '1001',
    country: 'US',
    created_at: new Date(),
    updated_at: new Date(),
    timezone: 'America/New_York',
    sms_number: '+15551230000',
    internal_phone_number: '+15551234567',
    url: 'https://hotel.test.dextr',
    address: '123 Test St',
    image_url: 's3://test-bucket/hotels/test-hotel.png',
    currency: 'USD',
    payment_provider: PaymentProvider.SHIFT4,
    ...overrides,
  } as Hotel;
}

function createMockReservation(
  overrides: Partial<ReservationDTO> = {},
): ReservationDTO {
  return {
    id: 'res-1',
    booking_id: 'BK500_1',
    hotel_id: HOTEL_ID,
    phone_number: '+15551234567',
    room_id: 101,
    room_type: 'Standard',
    business_id: '1001',
    pms_provider: PmsProvider.RESNEXUS,
    status: 'ACTIVE' as any,
    check_in: new Date('2026-08-01') as any,
    check_out: new Date('2026-08-03') as any,
    num_adults: 2,
    num_children: 0,
    customer: {
      id: 'customer-1',
      first_name: 'John',
      last_name: 'Doe',
      email: 'john@example.com',
      phone_number: '+15559876543',
      address: {
        address_first_line: '123 Test St',
        postal_code: '10001',
        state_or_province: 'NY',
      },
      card_metadata: {
        token: 'card-token-1',
        expiration_month: '12',
        expiration_year: '2030',
      },
    } as any,
    hotel: createHotel(),
    quote: {
      base_rate: 90,
      taxes: 10,
      fees: 0,
      total_amount: 100,
      amountCharged: 0,
    } as any,
    payments: null,
    discount: null,
    channel: null,
    ...overrides,
  } as ReservationDTO;
}

function approvedSaleResponse(transactionId?: string) {
  return {
    result: [
      {
        merchant: { mid: 1, name: 'Test Merchant' },
        server: { name: 'test-server' },
        transaction: {
          authorizationCode: 'AUTH123',
          authSource: 'test',
          hostResponse: {
            reasonCode: '00',
            reasonDescription: 'Approved',
            reattemptPermission: 'N',
          },
          invoice: 'INV123',
          responseCode: Shift4ResponseCode.APPROVED,
          retrievalReference: 'RRN123',
          saleFlag: 'S',
          ...(transactionId && { cardOnFile: { transactionId } }),
        },
        card: {
          present: 'N',
          token: { value: 'card-token-1' },
          type: 'VISA',
          number: '411111******1111',
          expirationDate: 1230,
        },
      },
    ],
  } as any;
}

function declinedSaleResponse() {
  return {
    result: [
      {
        merchant: { mid: 1, name: 'Test Merchant' },
        server: { name: 'test-server' },
        transaction: {
          authorizationCode: '',
          authSource: 'test',
          hostResponse: {
            reasonCode: '05',
            reasonDescription: 'Declined',
            reattemptPermission: 'N',
          },
          invoice: 'INV123',
          responseCode: Shift4ResponseCode.DECLINED,
          retrievalReference: 'RRN123',
          saleFlag: 'S',
        },
        card: {
          present: 'N',
          token: { value: 'card-token-1' },
          type: 'VISA',
          number: '411111******1111',
          expirationDate: 1230,
        },
      },
    ],
  } as any;
}

describe('shift4DelayedCharge', () => {
  const hotelConfig: HotelConfiguration | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    config.HOTEL_SHIFT4_CONFIG = {
      ...config.HOTEL_SHIFT4_CONFIG,
      [HOTEL_ID]: {
        authToken: 'test-auth-token',
        accessToken: 'test-access-token',
      },
    };
  });

  it('uses CardOnFileType.U01 and persists the returned transaction_id when the customer has no prior transaction_id', async () => {
    const reservation = createMockReservation();
    (shift4Service.saleTransaction as jest.Mock).mockResolvedValue(
      approvedSaleResponse('new-transaction-id-1'),
    );

    const result = await shift4DelayedCharge({
      bookingId: 'BK500',
      hotel: createHotel(),
      hotelConfig,
      reservations: [reservation],
      chargeAmount: 100,
      invoiceId: 'INV123',
    });

    expect(result.success).toBe(true);
    expect(shift4Service.saleTransaction).toHaveBeenCalledTimes(1);
    const [saleRequest] = (shift4Service.saleTransaction as jest.Mock).mock
      .calls[0];
    expect(saleRequest.transaction.cardOnFile).toEqual({
      type: CardOnFileType.U01,
    });

    expect(customerService.updateCustomer).toHaveBeenCalledTimes(1);
    expect(customerService.updateCustomer).toHaveBeenCalledWith('customer-1', {
      card_metadata: {
        token: 'card-token-1',
        expiration_month: '12',
        expiration_year: '2030',
        transaction_id: 'new-transaction-id-1',
      },
    });
  });

  it('still reports success when persisting the new transaction_id fails (charge already succeeded at the gateway)', async () => {
    const reservation = createMockReservation();
    (shift4Service.saleTransaction as jest.Mock).mockResolvedValue(
      approvedSaleResponse('new-transaction-id-1'),
    );
    (customerService.updateCustomer as jest.Mock).mockRejectedValue(
      new Error('connection terminated unexpectedly'),
    );

    const result = await shift4DelayedCharge({
      bookingId: 'BK500',
      hotel: createHotel(),
      hotelConfig,
      reservations: [reservation],
      chargeAmount: 100,
      invoiceId: 'INV123',
    });

    expect(result.success).toBe(true);
    expect(customerService.updateCustomer).toHaveBeenCalledTimes(1);
  });

  it('uses CardOnFileType.U02 with the existing transaction_id and does not persist a new one (regression)', async () => {
    const reservation = createMockReservation({
      customer: {
        id: 'customer-1',
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
        phone_number: '+15559876543',
        address: {
          address_first_line: '123 Test St',
          postal_code: '10001',
          state_or_province: 'NY',
        },
        card_metadata: {
          token: 'card-token-1',
          expiration_month: '12',
          expiration_year: '2030',
          transaction_id: 'existing-transaction-id',
        },
      } as any,
    });
    (shift4Service.saleTransaction as jest.Mock).mockResolvedValue(
      approvedSaleResponse('another-new-id'),
    );

    const result = await shift4DelayedCharge({
      bookingId: 'BK500',
      hotel: createHotel(),
      hotelConfig,
      reservations: [reservation],
      chargeAmount: 100,
      invoiceId: 'INV123',
    });

    expect(result.success).toBe(true);
    const [saleRequest] = (shift4Service.saleTransaction as jest.Mock).mock
      .calls[0];
    expect(saleRequest.transaction.cardOnFile).toEqual({
      type: CardOnFileType.U02,
      transactionId: 'existing-transaction-id',
    });

    expect(customerService.updateCustomer).not.toHaveBeenCalled();
  });

  it('throws BadRequestError when the customer has no stored card metadata (regression)', async () => {
    const reservation = createMockReservation({
      customer: {
        id: 'customer-1',
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
        phone_number: '+15559876543',
        card_metadata: null,
      } as any,
    });

    await expect(
      shift4DelayedCharge({
        bookingId: 'BK500',
        hotel: createHotel(),
        hotelConfig,
        reservations: [reservation],
        chargeAmount: 100,
        invoiceId: 'INV123',
      }),
    ).rejects.toThrow(BadRequestError);
    await expect(
      shift4DelayedCharge({
        bookingId: 'BK500',
        hotel: createHotel(),
        hotelConfig,
        reservations: [reservation],
        chargeAmount: 100,
        invoiceId: 'INV123',
      }),
    ).rejects.toThrow(/does not have stored card metadata/);

    expect(shift4Service.saleTransaction).not.toHaveBeenCalled();
  });

  it('does not persist a transaction_id when the sale is declined and there was no prior transaction_id', async () => {
    const reservation = createMockReservation();
    (shift4Service.saleTransaction as jest.Mock).mockResolvedValue(
      declinedSaleResponse(),
    );

    const result = await shift4DelayedCharge({
      bookingId: 'BK500',
      hotel: createHotel(),
      hotelConfig,
      reservations: [reservation],
      chargeAmount: 100,
      invoiceId: 'INV123',
    });

    expect(result.success).toBe(false);
    expect(result.responseCode).toBe(Shift4ResponseCode.DECLINED);
    expect(customerService.updateCustomer).not.toHaveBeenCalled();
  });
});
