/**
 * Unit tests for forwarding the customer's full address to ResNexus.
 *
 * ResNexus's addreservation/modifyreservation endpoints accept `address_line`
 * (in addition to state_or_province/postal_code) for OTA exclusive partners.
 * These tests confirm we map our stored `address_first_line` onto it for both
 * reservation creation and modification.
 */

import { Customer } from '@/dtos/Customer';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import { Reservation } from '@/dtos/Reservation';
import { Hotel } from '@/models/Hotel';
import { Country, PaymentProvider } from '@/types/enums';
import { ReservationDetails } from '@/types/reservation';
import { convertToModifyReservationRequest } from '../../../utils/helper';
import { ResNexusService } from '../reservationService';

const HOTEL_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const BUSINESS_ID = '12345';

function buildHotel(overrides: Partial<Hotel> = {}): Hotel {
  return {
    id: HOTEL_ID,
    name: 'Cave Springs',
    business_id: BUSINESS_ID,
    pms_provider: 'resnexus',
    assistant_phone_number: '+15550001111',
    country: Country.US,
    timezone: 'America/Los_Angeles',
    telegram_check_in_group_id: '',
    telegram_alerts_group_id: '',
    sms_number: '',
    internal_phone_number: '',
    url: '',
    address: '',
    image_url: '',
    currency: 'USD',
    payment_provider: PaymentProvider.SHIFT4,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as Hotel;
}

function buildCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    phone_number: '+14083205093',
    hotel_id: HOTEL_ID,
    first_name: 'Joe',
    last_name: 'Schmoe',
    email: 'joe@schmoe.com',
    address: {
      address_first_line: '1234 Schmoe St',
      city: 'Schmoton',
      state_or_province: 'OH',
      postal_code: '12345',
      country: 'US',
    },
    ...overrides,
  } as Customer;
}

function buildReservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: 'res-1',
    booking_id: 'BOOKING1',
    phone_number: '+14083205093',
    type: SessionType.CALL,
    room_id: 123,
    room_type: 'Standard',
    business_id: BUSINESS_ID,
    hotel_id: HOTEL_ID,
    pms_provider: 'resnexus',
    status: ReservationStatus.ACTIVE,
    check_in: new Date('2026-01-01'),
    check_out: new Date('2026-01-03'),
    num_adults: 2,
    num_children: 0,
    num_pets: 0,
    customer: buildCustomer(),
    hotel: buildHotel(),
    hotel_configuration: null,
    channel: null,
    payments: null,
    quote: null,
    discount: null,
    ...overrides,
  } as Reservation;
}

describe('ResNexusService.createReservation — customer address', () => {
  function buildService(mockPost: jest.Mock) {
    return new ResNexusService(
      { post: mockPost } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      { getHotelById: jest.fn() } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      {} as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      {} as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    );
  }

  it('sends address_line mapped from the stored address_first_line', async () => {
    const mockPost = jest.fn().mockResolvedValue({
      data: { reservation_id: 'PMS-1', response_errors: [] },
    });
    const service = buildService(mockPost);

    await service.createReservation({
      reservation: buildReservation(),
      customer: buildCustomer(),
      quote: {
        base_rate: 200,
        taxes: 30,
        fees: 10,
        amount_charged: 240,
        quote_object: {},
      } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      discount: null,
    });

    const [, body] = mockPost.mock.calls[0];
    expect(body.customer.address).toEqual({
      address_line: '1234 Schmoe St',
      city: 'Schmoton',
      postal_code: '12345',
      state_or_province: 'OH',
      country: 'US',
    });
  });

  it('defaults address_line to an empty string when address_first_line is missing', async () => {
    const mockPost = jest.fn().mockResolvedValue({
      data: { reservation_id: 'PMS-1', response_errors: [] },
    });
    const service = buildService(mockPost);

    await service.createReservation({
      reservation: buildReservation(),
      customer: buildCustomer({
        address: { state_or_province: 'OH', postal_code: '12345' },
      }),
      quote: {
        base_rate: 200,
        taxes: 30,
        fees: 10,
        amount_charged: 240,
        quote_object: {},
      } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      discount: null,
    });

    const [, body] = mockPost.mock.calls[0];
    expect(body.customer.address.address_line).toBe('');
  });
});

describe('convertToModifyReservationRequest — customer address', () => {
  function buildReservationDetails(
    overrides: Partial<ReservationDetails> = {},
  ): ReservationDetails {
    return {
      id: 'res-1',
      business_id: BUSINESS_ID,
      check_in: '2026-01-01',
      check_out: '2026-01-03',
      room_id: 123,
      num_adults: 2,
      external_id: 'BOOKING1',
      customer: buildCustomer(),
      ...overrides,
    };
  }

  it('maps address_first_line to address_line for reservation modification', () => {
    const request = convertToModifyReservationRequest(
      buildReservationDetails(),
    );

    expect(request.customer?.address).toEqual({
      address_line: '1234 Schmoe St',
      state_or_province: 'OH',
      postal_code: '12345',
    });
  });

  it('defaults address_line to an empty string when address_first_line is missing', () => {
    const request = convertToModifyReservationRequest(
      buildReservationDetails({
        customer: buildCustomer({
          address: { state_or_province: 'OH', postal_code: '12345' },
        }),
      }),
    );

    expect(request.customer?.address?.address_line).toBe('');
  });
});
