import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reservations', (table) => {
    table.string('previous_status').nullable();
  });
  await knex.schema.alterTable('parent_reservations', (table) => {
    table.string('previous_status').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reservations', (table) => {
    table.dropColumn('previous_status');
  });
  await knex.schema.alterTable('parent_reservations', (table) => {
    table.dropColumn('previous_status');
  });
}
