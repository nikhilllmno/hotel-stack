import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotel_configurations', (table) => {
    table.jsonb('length_of_stay_discount_policy').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotel_configurations', (table) => {
    table.dropColumn('length_of_stay_discount_policy');
  });
}
