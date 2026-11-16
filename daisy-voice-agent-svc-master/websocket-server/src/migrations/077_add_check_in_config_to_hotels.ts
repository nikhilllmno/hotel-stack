import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('hotel_configurations', (table) => {
    table.jsonb('same_day_booking_configuration').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('hotel_configurations', (table) => {
    table.dropColumn('same_day_booking_configuration');
  });
}
