import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // add type
  return knex.schema.alterTable('reservations', (table) => {
    table.string('type').notNullable().defaultTo('CALL');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('reservations', (table) => {
    table.dropColumn('type');
  });
}
