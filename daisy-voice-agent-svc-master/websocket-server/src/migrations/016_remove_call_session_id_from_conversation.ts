import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('conversations', (table) => {
    table.dropColumn('call_session_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('conversations', (table) => {
    table.uuid('call_session_id').notNullable();
  });
}
