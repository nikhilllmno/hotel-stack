import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotels', (table) => {
    table.jsonb('platform_fee_settings').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotels', (table) => {
    table.dropColumn('platform_fee_settings');
  });
}
