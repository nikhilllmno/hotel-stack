import dayjs from 'dayjs';
import { Knex } from 'knex';
import { randomUUID as uuidv4 } from 'node:crypto';
import { ReservationSource } from '../../dtos/enum/ReservationSource';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { SessionType } from '../../dtos/enum/SessionType';
import { PaymentProvider, PmsProvider } from '../../types/enums';
import { RESERVATION_FLOW_FIXTURE_IDS } from './reservationFlowFixture';

export const OTHER_HOTEL_ID = '33333333-3333-3333-3333-333333333333';

export interface SeedReservationParams {
  checkIn: string;
  checkOut: string;
  firstName: string;
  lastName: string;
  customerId?: string;
  hotelId?: string;
  externalId?: string;
}

export interface SeededReservation {
  bookingId: string;
  checkIn: string;
  checkOut: string;
  customerId: string;
  firstName: string;
  lastName: string;
  hotelId: string;
  reservationId: string;
  externalId?: string;
}

export async function seedReservation(
  knex: Knex,
  params: SeedReservationParams,
): Promise<SeededReservation> {
  const now = new Date();
  const hotelId = params.hotelId ?? RESERVATION_FLOW_FIXTURE_IDS.hotelId;
  const customerId = params.customerId ?? uuidv4();
  const reservationId = uuidv4();
  const bookingId = `BK-${reservationId.slice(0, 8)}`.toUpperCase();

  if (!params.customerId) {
    await knex('customers').insert({
      created_at: now,
      first_name: params.firstName,
      hotel_id: hotelId,
      id: customerId,
      last_name: params.lastName,
      phone_number: '+15550001111',
      updated_at: now,
    });
  }

  await knex('reservations').insert({
    booking_id: bookingId,
    business_id: Number(RESERVATION_FLOW_FIXTURE_IDS.businessId),
    check_in: params.checkIn,
    check_out: params.checkOut,
    created_at: now,
    customer_id: customerId,
    external_id: params.externalId ?? null,
    hotel_id: hotelId,
    id: reservationId,
    num_adults: 2,
    num_children: 0,
    phone_number: '+15550001111',
    room_id: 101,
    room_type: 'Standard',
    source: ReservationSource.DIRECT_HOTEL_RESERVATION,
    status: ReservationStatus.ACTIVE,
    type: SessionType.CALL,
    updated_at: now,
  });

  return {
    bookingId,
    checkIn: params.checkIn,
    checkOut: params.checkOut,
    customerId,
    firstName: params.firstName,
    lastName: params.lastName,
    hotelId,
    reservationId,
    externalId: params.externalId,
  };
}

export async function seedOtherHotel(knex: Knex): Promise<void> {
  const now = new Date();

  await knex('hotels').insert({
    address: '456 Other St',
    assistant_phone_number: '+15559998888',
    business_id: 2002,
    country: 'US',
    created_at: now,
    currency: '$',
    id: OTHER_HOTEL_ID,
    image_url: 's3://test-bucket/hotels/other-hotel.png',
    internal_phone_number: '+15559998888',
    name: 'Other Hotel',
    payment_provider: PaymentProvider.STRIPE,
    pms_provider: PmsProvider.RESNEXUS,
    sms_number: '+15559990000',
    telegram_alerts_group_id: '',
    timezone: 'America/New_York',
    updated_at: now,
    url: 'https://other-hotel.test.dextr',
  });
}

export function defaultStayDates(): { checkIn: string; checkOut: string } {
  return {
    checkIn: dayjs().add(1, 'day').format('YYYY-MM-DD'),
    checkOut: dayjs().add(3, 'day').format('YYYY-MM-DD'),
  };
}
