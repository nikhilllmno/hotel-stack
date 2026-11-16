import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotel_configurations', (table) => {
    table.jsonb('pet_policy_configuration').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotel_configurations', (table) => {
    table.dropColumn('pet_policy_configuration');
  });
}
