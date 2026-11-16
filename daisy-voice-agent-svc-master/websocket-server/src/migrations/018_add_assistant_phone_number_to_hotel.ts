import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('hotels', (table) => {
    table.string('assistant_phone_number');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('hotels', (table) => {
    table.dropColumn('assistant_phone_number');
  });
}
