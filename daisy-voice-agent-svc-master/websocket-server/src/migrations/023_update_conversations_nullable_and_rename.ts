import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('conversations', (table) => {
    // Alter existing columns to be nullable
    table.timestamp('ended_at').nullable().alter();
    table.json('cost_details').nullable().alter();
    table.json('call_metadata').nullable().alter();
    table.float('cost').nullable().alter();

    // Rename column
    table.renameColumn('call_metadata', 'metadata');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('conversations', (table) => {
    // Rename column back to original
    table.renameColumn('metadata', 'call_metadata');

    // Revert columns to not nullable
    table.timestamp('ended_at').notNullable().alter();
    table.json('cost_details').notNullable().alter();
    table.json('call_metadata').notNullable().alter();
    table.float('cost').notNullable().alter();
  });
}
