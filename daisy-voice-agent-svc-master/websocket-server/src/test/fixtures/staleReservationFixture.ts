import { Knex } from 'knex';
import { PaymentStatus } from '../../dtos/enum/PaymentStatus';
import { ReservationSource } from '../../dtos/enum/ReservationSource';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { SessionType } from '../../dtos/enum/SessionType';
import {
  RESERVATION_FLOW_FIXTURE_IDS,
  seedReservationFlowHotel,
} from './reservationFlowFixture';

export const STALE_FIXTURE_IDS = {
  customerId: '11111111-1111-1111-1111-111111111111',
  hotelId: RESERVATION_FLOW_FIXTURE_IDS.hotelId,
  junctionId: '33333333-3333-3333-3333-333333333333',
  paymentId: '44444444-4444-4444-4444-444444444444',
  reservationId: '55555555-5555-5555-5555-555555555555',
} as const;

export interface StaleReservationFixture {
  customerId: string;
  hotelId: string;
  paymentId: string;
  reservationId: string;
}

export async function seedStaleReservationWithPayment(
  knex: Knex,
  options: { ageMinutes: number },
): Promise<StaleReservationFixture> {
  const now = Date.now();
  const staleCreatedAt = new Date(now - options.ageMinutes * 60 * 1000);
  const { customerId, hotelId, junctionId, paymentId, reservationId } =
    STALE_FIXTURE_IDS;

  await seedReservationFlowHotel(knex);

  await knex('customers').insert({
    created_at: staleCreatedAt,
    email: 'guest@example.com',
    first_name: 'Test',
    hotel_id: hotelId,
    id: customerId,
    last_name: 'Guest',
    phone_number: '+15559876543',
    updated_at: staleCreatedAt,
  });

  await knex('reservations').insert({
    booking_id: 'BKTEST001',
    business_id: Number(RESERVATION_FLOW_FIXTURE_IDS.businessId),
    check_in: '2026-06-01',
    check_out: '2026-06-03',
    created_at: staleCreatedAt,
    customer_id: customerId,
    hotel_id: hotelId,
    id: reservationId,
    num_adults: 2,
    num_children: 0,
    phone_number: '+15559876543',
    pms_provider: 'RESNEXUS',
    room_id: 101,
    room_type: 'standard',
    source: ReservationSource.DIRECT_HOTEL_RESERVATION,
    status: ReservationStatus.INACTIVE,
    type: SessionType.CALL,
    updated_at: staleCreatedAt,
  });

  await knex('payments').insert({
    amount_charged: '100.00',
    booking_confirmation_id: 'BKTEST001',
    created_at: staleCreatedAt,
    currency: 'USD',
    hotel_id: hotelId,
    id: paymentId,
    notification_count: 0,
    payment_link: '',
    payment_link_id: '',
    payment_provider: 'STRIPE',
    payment_status: PaymentStatus.PENDING,
    updated_at: staleCreatedAt,
  });

  await knex('payment_reservations').insert({
    created_at: staleCreatedAt,
    id: junctionId,
    payment_id: paymentId,
    reservation_id: reservationId,
    updated_at: staleCreatedAt,
  });

  return {
    customerId,
    hotelId,
    paymentId,
    reservationId,
  };
}

export const PAID_INACTIVE_FIXTURE_IDS = {
  customerId: '66666666-7777-8888-9999-000000000001',
  hotelId: RESERVATION_FLOW_FIXTURE_IDS.hotelId,
  junctionId: '66666666-7777-8888-9999-000000000002',
  paymentId: '66666666-7777-8888-9999-000000000003',
  reservationId: '66666666-7777-8888-9999-000000000004',
} as const;

/** A second, distinct fixture ID set for tests that need two matched payments under the same hotel. */
export const PAID_INACTIVE_FIXTURE_IDS_2 = {
  customerId: '66666666-7777-8888-9999-000000000011',
  hotelId: RESERVATION_FLOW_FIXTURE_IDS.hotelId,
  junctionId: '66666666-7777-8888-9999-000000000012',
  paymentId: '66666666-7777-8888-9999-000000000013',
  reservationId: '66666666-7777-8888-9999-000000000014',
} as const;

export interface PaidInactiveReservationFixture {
  customerId: string;
  hotelId: string;
  paymentId: string;
  reservationId: string;
  sessionId: string;
}

export interface PaidInactiveReservationFixtureIds {
  customerId: string;
  hotelId: string;
  junctionId: string;
  paymentId: string;
  reservationId: string;
}

/**
 * Seeds a reservation stuck in INACTIVE whose linked payment already
 * COMPLETED — the "payment succeeded but PMS reservation creation failed"
 * case. Pass `ids` (e.g. `PAID_INACTIVE_FIXTURE_IDS_2`) and `skipHotelSeed:
 * true` to seed a second, independent match under the same hotel.
 */
export async function seedPaidInactiveReservation(
  knex: Knex,
  options: {
    sessionId?: string;
    ids?: PaidInactiveReservationFixtureIds;
    skipHotelSeed?: boolean;
  } = {},
): Promise<PaidInactiveReservationFixture> {
  const now = new Date();
  const sessionId = options.sessionId ?? '77777777-0000-0000-0000-000000000001';
  const { customerId, hotelId, junctionId, paymentId, reservationId } =
    options.ids ?? PAID_INACTIVE_FIXTURE_IDS;

  if (!options.skipHotelSeed) {
    await seedReservationFlowHotel(knex);
  }

  await knex('customers').insert({
    created_at: now,
    email: 'paid-guest@example.com',
    first_name: 'Paid',
    hotel_id: hotelId,
    id: customerId,
    last_name: 'Guest',
    phone_number: '+15559876544',
    updated_at: now,
  });

  await knex('reservations').insert({
    booking_id: `BKTEST-${reservationId}`,
    business_id: Number(RESERVATION_FLOW_FIXTURE_IDS.businessId),
    check_in: '2026-06-01',
    check_out: '2026-06-03',
    created_at: now,
    customer_id: customerId,
    hotel_id: hotelId,
    id: reservationId,
    num_adults: 2,
    num_children: 0,
    phone_number: '+15559876544',
    pms_provider: 'RESNEXUS',
    room_id: 102,
    room_type: 'standard',
    session_id: sessionId,
    source: ReservationSource.DIRECT_HOTEL_RESERVATION,
    status: ReservationStatus.INACTIVE,
    type: SessionType.CALL,
    updated_at: now,
  });

  await knex('payments').insert({
    amount_charged: '150.00',
    booking_confirmation_id: `BKTEST-${reservationId}`,
    created_at: now,
    currency: 'USD',
    hotel_id: hotelId,
    id: paymentId,
    notification_count: 0,
    payment_link: '',
    payment_link_id: '',
    payment_provider: 'STRIPE',
    payment_status: PaymentStatus.COMPLETED,
    updated_at: now,
  });

  await knex('payment_reservations').insert({
    created_at: now,
    id: junctionId,
    payment_id: paymentId,
    reservation_id: reservationId,
    updated_at: now,
  });

  return {
    customerId,
    hotelId,
    paymentId,
    reservationId,
    sessionId,
  };
}
