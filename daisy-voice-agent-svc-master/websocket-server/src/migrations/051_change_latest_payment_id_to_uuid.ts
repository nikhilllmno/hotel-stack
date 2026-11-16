import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reservations', (table) => {
    // Alter the existing latest_payment_id column to UUID type
    table.uuid('latest_payment_id').nullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reservations', (table) => {
    // Revert changes: alter back to string type
    table.string('latest_payment_id').nullable().alter();
  });
}
