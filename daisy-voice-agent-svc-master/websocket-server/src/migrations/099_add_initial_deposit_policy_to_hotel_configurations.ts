import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotel_configurations', (table) => {
    table.jsonb('initial_deposit_policy').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotel_configurations', (table) => {
    table.dropColumn('initial_deposit_policy');
  });
}
