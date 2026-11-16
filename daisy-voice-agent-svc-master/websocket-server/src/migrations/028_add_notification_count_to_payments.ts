import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('payments', (table) => {
    table.integer('notification_count').notNullable().defaultTo(0);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('payments', (table) => {
    table.dropColumn('notification_count');
  });
}
