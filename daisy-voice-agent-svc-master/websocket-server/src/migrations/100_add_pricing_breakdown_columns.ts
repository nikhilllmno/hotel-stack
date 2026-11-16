import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('quotes', (table) => {
    table.jsonb('platform_pricing').nullable();
  });

  await knex.schema.alterTable('hotel_configurations', (table) => {
    table.jsonb('pet_fee_configuration').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('quotes', (table) => {
    table.dropColumn('platform_pricing');
  });

  await knex.schema.alterTable('hotel_configurations', (table) => {
    table.dropColumn('pet_fee_configuration');
  });
}
