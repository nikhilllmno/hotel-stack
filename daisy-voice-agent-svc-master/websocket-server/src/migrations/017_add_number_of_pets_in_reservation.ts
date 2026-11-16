import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('reservations', (table) => {
    table.integer('num_pets');
    table.text('customer_special_request');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('reservations', (table) => {
    table.dropColumn('num_pets');
    table.dropColumn('customer_special_request');
  });
}
