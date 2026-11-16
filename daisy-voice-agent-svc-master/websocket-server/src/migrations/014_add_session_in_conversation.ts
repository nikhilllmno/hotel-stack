import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('conversations', (table) => {
    table.uuid('conversation_session_id');
    table
      .foreign('conversation_session_id')
      .references('id')
      .inTable('sessions')
      .onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('conversations', (table) => {
    table.dropColumn('conversation_session_id');
  });
}
