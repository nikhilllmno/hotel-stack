import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('reservations', (table) => {
    table.string('resnexus_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('reservations', (table) => {
    table.dropColumn('resnexus_id');
  });
}
