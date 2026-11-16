import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.dropTable('pms_providers');
}

export async function down(knex: Knex): Promise<void> {
  // NIL
}
