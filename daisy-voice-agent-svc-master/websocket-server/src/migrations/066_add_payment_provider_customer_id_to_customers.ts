import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.table('customers', (table) => {
    table.string('payment_provider_customer_id').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.table('customers', (table) => {
    table.dropColumn('payment_provider_customer_id');
  });
}
