import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('reservations', (table) => {
    table.unique(['resnexus_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('reservations', (table) => {
    table.dropUnique(['resnexus_id']);
  });
}
