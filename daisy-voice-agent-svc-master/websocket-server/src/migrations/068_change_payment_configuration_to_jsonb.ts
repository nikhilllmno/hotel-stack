import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.raw(
    'ALTER TABLE hotel_configurations ALTER COLUMN payment_configuration TYPE jsonb USING payment_configuration::jsonb',
  );
}

export async function down(knex: Knex): Promise<void> {
  return knex.raw(
    'ALTER TABLE hotel_configurations ALTER COLUMN payment_configuration TYPE json USING payment_configuration::json',
  );
}
