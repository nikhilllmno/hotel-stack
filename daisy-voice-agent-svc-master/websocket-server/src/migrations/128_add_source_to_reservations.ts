import { Knex } from 'knex';
import { ReservationSource } from '../dtos/enum/ReservationSource';
import { SessionType } from '../dtos/enum/SessionType';
import { mapStayntouchSourceCodeToReservationSource } from '../stayntouch/utils/helper';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reservations', (table) => {
    table.string('source');
  });

  const reservations = await knex('reservations').select('id', 'type');

  for (const res of reservations) {
    let source: ReservationSource;
    if (res.type !== SessionType.EXTERNAL) {
      source = ReservationSource.DIRECT_HOTEL_RESERVATION;
    } else {
      // For existing EXTERNAL reservations, we don't have source_code stored.
      // mapStayntouchSourceCodeToReservationSource(undefined) returns ReservationSource.THIRD_PARTY_RESERVATION.
      source = mapStayntouchSourceCodeToReservationSource(undefined);
    }
    await knex('reservations').where({ id: res.id }).update({ source });
  }

  await knex.schema.alterTable('reservations', (table) => {
    table.string('source').notNullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reservations', (table) => {
    table.dropColumn('source');
  });
}
