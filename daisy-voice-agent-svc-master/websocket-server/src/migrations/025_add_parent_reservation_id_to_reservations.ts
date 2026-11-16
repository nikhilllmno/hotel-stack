import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('reservations', (table) => {
    table.uuid('parent_reservation_id');
    table
      .foreign('parent_reservation_id')
      .references('id')
      .inTable('parent_reservations');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('reservations', (table) => {
    table.dropForeign('parent_reservation_id');
    table.dropColumn('parent_reservation_id');
  });
}
