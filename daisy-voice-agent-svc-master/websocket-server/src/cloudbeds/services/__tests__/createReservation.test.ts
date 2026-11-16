jest.mock('@/services/hotel/hotelService', () => ({
  hotelService: {
    getHotelById: jest.fn(),
  },
}));

jest.mock('@/services/hotelConfiguration/hotelConfigurationService', () => ({
  hotelConfigurationService: {
    getHotelConfigurationByHotelId: jest.fn(),
    getExternalAuthConfigByHotelId: jest.fn(),
  },
}));

jest.mock('@/utils/httpClient', () => ({
  createHttpClient: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  })),
}));

import { CloudbedsClient } from '@/cloudbeds/client/CloudbedsClient';
import { CloudbedsReservationService } from '@/cloudbeds/services/reservationService';
import config from '@/config';
import { Customer } from '@/dtos/Customer';
import { PaymentStatus } from '@/dtos/enum/PaymentStatus';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { Payment } from '@/dtos/Payment';
import { Quote } from '@/dtos/Quote';
import { Reservation as ReservationDTO } from '@/dtos/Reservation';
import { Hotel } from '@/models/Hotel';
import { CreateReservationParams } from '@/pms/types/IPMSReservationService';
import { hotelService } from '@/services/hotel/hotelService';
import { hotelConfigurationService } from '@/services/hotelConfiguration/hotelConfigurationService';
import { Country, PaymentProvider } from '@/types/enums';
import { encrypt } from '@/utils/encryption';

function buildPayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'payment-uuid-1',
    amount_charged: 100,
    payment_status: PaymentStatus.COMPLETED,
    payment_provider: PaymentProvider.STRIPE,
    currency: 'USD',
    ...overrides,
  };
}

function buildReservation(
  overrides: Partial<ReservationDTO> = {},
): ReservationDTO {
  return {
    id: 'res-uuid-1',
    booking_id: 'BK98765',
    hotel_id: 'hotel-uuid-1',
    business_id: 'prop-123',
    pms_provider: 'cloudbeds',
    room_id: 674377,
    room_type: 'Deluxe Queen',
    status: ReservationStatus.INACTIVE,
    check_in: new Date('2026-10-20'),
    check_out: new Date('2026-10-22'),
    num_adults: 2,
    num_children: 0,
    phone_number: '+15551234567',
    ...overrides,
  } as ReservationDTO;
}

function buildHotel(): Hotel {
  return {
    id: 'hotel-uuid-1',
    name: 'Test Hotel',
    business_id: 'prop-123',
    pms_provider: 'cloudbeds',
    assistant_phone_number: '+15551234567',
    country: Country.US,
    timezone: 'America/New_York',
    telegram_check_in_group_id: 'group-1',
    telegram_alerts_group_id: 'group-2',
    sms_number: '+15551234567',
    internal_phone_number: '+15551234568',
    url: 'https://hotel.test',
    address: '1 Test St',
    image_url: 'https://hotel.test/image.png',
    currency: '$',
    payment_provider: PaymentProvider.NOT_APPLICABLE,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function buildCreateReservationParams(
  overrides: Partial<CreateReservationParams> = {},
): CreateReservationParams {
  return {
    reservation: buildReservation(),
    customer: {
      id: 'cust-uuid-1',
      hotel_id: 'hotel-uuid-1',
      phone_number: '+15551234567',
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
      address: { postal_code: '10001', country: 'US' },
    } as Customer,
    quote: {} as Quote,
    ...overrides,
  };
}

describe('CloudbedsReservationService.createReservation', () => {
  let service: CloudbedsReservationService;
  let client: CloudbedsClient;
  let postReservationSpy: jest.SpyInstance;

  beforeEach(() => {
    client = new CloudbedsClient();
    service = new CloudbedsReservationService(client);

    postReservationSpy = jest.spyOn(client, 'postReservation');
    postReservationSpy.mockResolvedValue({ reservationID: 'CB-RES-999' });

    (hotelService.getHotelById as jest.Mock).mockResolvedValue(buildHotel());
    (
      hotelConfigurationService.getHotelConfigurationByHotelId as jest.Mock
    ).mockResolvedValue(null);
    (
      hotelConfigurationService.getExternalAuthConfigByHotelId as jest.Mock
    ).mockResolvedValue({
      apiToken: encrypt('cbat_test_token'),
      disabledAt: null,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    config.CLOUDBEDS_CARD_TOKEN_ENABLED = false;
  });

  it('sends the reservation booking_id as thirdPartyIdentifier, not a constant', async () => {
    const params = buildCreateReservationParams();

    await service.createReservation(params);

    expect(postReservationSpy).toHaveBeenCalledWith(
      expect.objectContaining({ thirdPartyIdentifier: 'BK98765' }),
      expect.anything(),
    );
  });

  it('sends the hotel_configurations.dextr_pms_source_id as sourceID', async () => {
    (
      hotelConfigurationService.getHotelConfigurationByHotelId as jest.Mock
    ).mockResolvedValue({ dextr_pms_source_id: 'dextr-source-42' });
    const params = buildCreateReservationParams();

    await service.createReservation(params);

    expect(postReservationSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sourceID: 'dextr-source-42' }),
      expect.anything(),
    );
  });

  it('omits sourceID when no hotel configuration source id is set', async () => {
    const params = buildCreateReservationParams();

    await service.createReservation(params);

    const payload = postReservationSpy.mock.calls[0][0];
    expect(payload).not.toHaveProperty('sourceID');
  });

  describe('when CLOUDBEDS_CARD_TOKEN_ENABLED is true', () => {
    beforeEach(() => {
      config.CLOUDBEDS_CARD_TOKEN_ENABLED = true;
    });

    it('sends cardToken and paymentMethod=credit when the customer has a Stripe customer id', async () => {
      const params = buildCreateReservationParams({
        customer: {
          id: 'cust-uuid-1',
          hotel_id: 'hotel-uuid-1',
          phone_number: '+15551234567',
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          address: { postal_code: '10001', country: 'US' },
          payment_provider_customer_id: 'cus_stripe123',
        } as Customer,
      });

      await service.createReservation(params);

      expect(postReservationSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentMethod: 'credit',
          cardToken: 'cus_stripe123',
        }),
        expect.anything(),
      );
    });

    it('sends the earliest Stripe payment booking_confirmation_id as paymentAuthorizationCode', async () => {
      const params = buildCreateReservationParams({
        customer: {
          id: 'cust-uuid-1',
          hotel_id: 'hotel-uuid-1',
          phone_number: '+15551234567',
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          address: { postal_code: '10001', country: 'US' },
          payment_provider_customer_id: 'cus_stripe123',
        } as Customer,
        reservation: buildReservation({
          payments: [
            buildPayment({
              id: 'payment-old',
              booking_confirmation_id: 'ch_old',
              created_at: new Date('2026-01-01'),
            }),
            buildPayment({
              id: 'payment-new',
              booking_confirmation_id: 'ch_new',
              created_at: new Date('2026-02-01'),
            }),
          ],
        }),
      });

      await service.createReservation(params);

      expect(postReservationSpy).toHaveBeenCalledWith(
        expect.objectContaining({ paymentAuthorizationCode: 'ch_old' }),
        expect.anything(),
      );
    });

    it('omits cardToken, paymentAuthorizationCode, and defaults to paymentMethod=cash without a Stripe customer id', async () => {
      const params = buildCreateReservationParams();

      await service.createReservation(params);

      const payload = postReservationSpy.mock.calls[0][0];
      expect(payload).toMatchObject({ paymentMethod: 'cash' });
      expect(payload).not.toHaveProperty('cardToken');
      expect(payload).not.toHaveProperty('paymentAuthorizationCode');
    });

    it('omits paymentAuthorizationCode when a Stripe payment exists but the customer has no cardToken', async () => {
      const params = buildCreateReservationParams({
        reservation: buildReservation({
          payments: [
            buildPayment({
              id: 'payment-new',
              booking_confirmation_id: 'ch_new',
              created_at: new Date('2026-02-01'),
            }),
          ],
        }),
      });

      await service.createReservation(params);

      const payload = postReservationSpy.mock.calls[0][0];
      expect(payload).toMatchObject({ paymentMethod: 'cash' });
      expect(payload).not.toHaveProperty('cardToken');
      expect(payload).not.toHaveProperty('paymentAuthorizationCode');
    });
  });

  describe('when CLOUDBEDS_CARD_TOKEN_ENABLED is false', () => {
    beforeEach(() => {
      config.CLOUDBEDS_CARD_TOKEN_ENABLED = false;
    });

    it('falls back to paymentMethod=cash and omits cardToken/paymentAuthorizationCode even when the customer has a Stripe customer id', async () => {
      const params = buildCreateReservationParams({
        customer: {
          id: 'cust-uuid-1',
          hotel_id: 'hotel-uuid-1',
          phone_number: '+15551234567',
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          address: { postal_code: '10001', country: 'US' },
          payment_provider_customer_id: 'cus_stripe123',
        } as Customer,
        reservation: buildReservation({
          payments: [
            buildPayment({
              id: 'payment-new',
              booking_confirmation_id: 'ch_new',
              created_at: new Date('2026-02-01'),
            }),
          ],
        }),
      });

      await service.createReservation(params);

      const payload = postReservationSpy.mock.calls[0][0];
      expect(payload).toMatchObject({ paymentMethod: 'cash' });
      expect(payload).not.toHaveProperty('cardToken');
      expect(payload).not.toHaveProperty('paymentAuthorizationCode');
    });
  });
});
