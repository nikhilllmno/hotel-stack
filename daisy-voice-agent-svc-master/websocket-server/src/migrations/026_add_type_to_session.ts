import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('sessions', (table) => {
    table.string('session_type').notNullable().defaultTo('CALL');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('sessions', (table) => {
    table.dropColumn('session_type');
  });
}
