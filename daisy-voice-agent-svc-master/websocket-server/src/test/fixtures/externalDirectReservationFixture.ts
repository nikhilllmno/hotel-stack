import dayjs from 'dayjs';
import { Knex } from 'knex';
import { ReservationSource } from '../../dtos/enum/ReservationSource';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { SessionType } from '../../dtos/enum/SessionType';
import { PmsProvider } from '../../types/enums';
import {
  RESERVATION_FLOW_FIXTURE_IDS,
  seedReservationFlowHotel,
} from './reservationFlowFixture';

export const EXTERNAL_DIRECT_FIXTURE_IDS = {
  customerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  reservationId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  externalId: '8018156056034',
  externalPublicId: '8018156056034',
} as const;

export interface ExternalDirectReservationFixture {
  customerId: string;
  externalId: string;
  hotelId: string;
  reservationId: string;
}

export interface SeedExternalDirectReservationOptions {
  checkIn?: string;
  checkOut?: string;
  externalId?: string;
  externalPublicId?: string;
  reservationSource?: ReservationSource;
  seedHotel?: boolean;
  status?: ReservationStatus;
}

export async function seedExternalDirectReservation(
  knex: Knex,
  options: SeedExternalDirectReservationOptions = {},
): Promise<ExternalDirectReservationFixture> {
  const now = new Date();
  const {
    customerId,
    reservationId,
    externalId: defaultExternalId,
    externalPublicId: defaultExternalPublicId,
  } = EXTERNAL_DIRECT_FIXTURE_IDS;
  const externalId = options.externalId ?? defaultExternalId;
  const externalPublicId = options.externalPublicId ?? defaultExternalPublicId;
  const checkIn =
    options.checkIn ?? dayjs().add(30, 'day').format('YYYY-MM-DD');
  const checkOut =
    options.checkOut ?? dayjs().add(32, 'day').format('YYYY-MM-DD');
  const status = options.status ?? ReservationStatus.ACTIVE;
  const source =
    options.reservationSource ?? ReservationSource.DIRECT_HOTEL_RESERVATION;
  const hotelId = RESERVATION_FLOW_FIXTURE_IDS.hotelId;

  if (options.seedHotel ?? false) {
    await seedReservationFlowHotel(knex);
  }

  await knex('hotels').where({ id: hotelId }).update({
    pms_provider: PmsProvider.STAYNTOUCH,
    telegram_alerts_group_id: '-1001234567890',
    updated_at: now,
  });

  await knex('customers').insert({
    created_at: now,
    email: 'aslam@dextr.ai',
    first_name: 'Hashrin',
    hotel_id: hotelId,
    id: customerId,
    last_name: 'Gay',
    phone_number: '+15550001111',
    updated_at: now,
  });

  await knex('reservations').insert({
    booking_id: externalId,
    business_id: Number(RESERVATION_FLOW_FIXTURE_IDS.businessId),
    check_in: checkIn,
    check_out: checkOut,
    created_at: now,
    customer_id: customerId,
    external_id: externalId,
    external_public_id: externalPublicId,
    hotel_id: hotelId,
    id: reservationId,
    num_adults: 1,
    num_children: 0,
    phone_number: '+15550001111',
    pms_provider: PmsProvider.STAYNTOUCH,
    room_id: 674377,
    room_type: 'Deluxe Queen',
    source,
    status,
    previous_status: status,
    type: SessionType.EXTERNAL,
    updated_at: now,
  });

  return {
    customerId,
    externalId,
    hotelId,
    reservationId,
  };
}
