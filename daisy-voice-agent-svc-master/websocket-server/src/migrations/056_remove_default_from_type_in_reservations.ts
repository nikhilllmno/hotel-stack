import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Remove default value from type column
  return knex.schema.alterTable('reservations', (table) => {
    table.string('type').notNullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  // Restore default value
  return knex.schema.alterTable('reservations', (table) => {
    table.string('type').notNullable().defaultTo('CALL').alter();
  });
}
