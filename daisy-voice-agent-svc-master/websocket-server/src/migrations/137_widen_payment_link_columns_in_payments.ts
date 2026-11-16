import { Knex } from 'knex';

// This is needed to support stripe checkout links that are longer than 255 characters
export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('payments', (table) => {
    table.text('payment_link').alter();
    table.text('payment_link_id').alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('payments', (table) => {
    table.string('payment_link').alter();
    table.string('payment_link_id').alter();
  });
}
