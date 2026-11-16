import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('escalations', (table) => {
    table.uuid('session_id');
    table
      .foreign('session_id')
      .references('id')
      .inTable('sessions')
      .onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('escalations', (table) => {
    table.dropColumn('session_id');
  });
}
