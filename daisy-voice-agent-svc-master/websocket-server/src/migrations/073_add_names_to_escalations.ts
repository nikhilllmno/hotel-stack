import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('escalations', (table) => {
    table.string('first_name').defaultTo('Guest');
    table.string('last_name').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('escalations', (table) => {
    table.dropColumn('first_name');
    table.dropColumn('last_name');
  });
}
