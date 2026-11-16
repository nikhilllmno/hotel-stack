import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('conversations', (table) => {
    table.string('intent').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('conversations', (table) => {
    table.dropColumn('intent');
  });
}
