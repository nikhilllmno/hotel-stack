import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('sessions', (table) => {
    // Alter existing columns to be nullable
    table.string('external_provider_id').nullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('sessions', (table) => {
    table.string('external_provider_id').notNullable().alter();
  });
}
