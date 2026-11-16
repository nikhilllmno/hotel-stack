import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotels', (table) => {
    table.json('cancellation_policy').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotels', (table) => {
    table.dropColumn('cancellation_policy');
  });
}
