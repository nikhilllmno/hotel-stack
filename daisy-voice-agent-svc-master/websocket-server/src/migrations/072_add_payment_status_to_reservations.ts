import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.table('reservations', (table) => {
    table.string('payment_status').nullable().defaultTo(null);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.table('reservations', (table) => {
    table.dropColumn('payment_status');
  });
}
