import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotel_configurations', (table) => {
    table.jsonb('reservation_date_policy').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotel_configurations', (table) => {
    table.dropColumn('reservation_date_policy');
  });
}
