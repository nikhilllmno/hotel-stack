import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('payments', (table) => {
    table.string('payment_link').nullable().alter();
    table.string('payment_link_id').nullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('payments', (table) => {
    table.string('payment_link').notNullable().alter();
    table.string('payment_link_id').notNullable().alter();
  });
}
