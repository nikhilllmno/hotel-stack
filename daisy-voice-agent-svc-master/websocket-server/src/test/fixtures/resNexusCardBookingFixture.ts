import { randomUUID } from 'crypto';
import dayjs from 'dayjs';
import { Knex } from 'knex';
import { SessionType } from '../../dtos/enum/SessionType';
import { AddressType } from '../../models/Address';
import type { RoomReservationService } from '../../services/roomReservation/roomReservationService';
import { RESERVATION_FLOW_FIXTURE_IDS } from './reservationFlowFixture';

export async function createResNexusCardBooking(
  service: RoomReservationService,
  knex: Knex,
) {
  const created = await service.createSingleRoomReservation(
    {
      check_in: dayjs().add(7, 'day').format('YYYY-MM-DD'),
      check_out: dayjs().add(9, 'day').format('YYYY-MM-DD'),
      customer_email: 'ada@example.com',
      customer_first_name: 'Ada',
      customer_last_name: 'Lovelace',
      customer_phone_number: '+15559876543',
      num_adults: 2,
      room_id: 101,
      session_type: SessionType.SMS,
    } as never,
    '+15559876543',
    RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
    '77777777-7777-7777-7777-777777777777',
    SessionType.SMS,
  );

  // ResNexus rejects a booking without a billing address, and
  // `validateReservationForCreation` refuses to send one, so the guest's
  // address has to exist before the card is submitted.
  const reservationRow = await knex('reservations')
    .where({ booking_id: created.booking_id })
    .first();
  await knex('address').insert({
    address_first_line: '1 Ada Way',
    address_type: AddressType.CONTACT,
    city: 'Schmoton',
    country: 'US',
    created_at: new Date(),
    customer_id: reservationRow.customer_id,
    id: randomUUID(),
    postal_code: '12345',
    state_or_province: 'OH',
    updated_at: new Date(),
  });

  const review = await knex('booking_reviews')
    .where({ booking_id: created.booking_id })
    .first();

  return { created, reviewId: review.reservation_review_id };
}
