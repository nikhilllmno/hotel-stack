import { Knex } from 'knex';
import { ReservationStatus } from '../dtos/enum/ReservationStatus';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('reservations', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.bigint('business_id').notNullable();
    table.string('booking_id').notNullable();

    table.date('check_in').notNullable();
    table.date('check_out').notNullable();
    table.string('unit_group_id').notNullable();
    table.integer('num_adults').notNullable();
    table.integer('num_children').notNullable();
    table.uuid('customer_id').notNullable();
    table.string('phone_number').notNullable();
    table
      .enum('status', [
        ReservationStatus.ACTIVE,
        ReservationStatus.INACTIVE,
        ReservationStatus.FAILED,
        ReservationStatus.CANCELLED,
      ])
      .defaultTo(ReservationStatus.INACTIVE);
    table.text('notes_from_partner');
    table.string('latest_payment_id');

    table.timestamp('created_at', { useTz: false }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: false }).defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('reservations');
}
