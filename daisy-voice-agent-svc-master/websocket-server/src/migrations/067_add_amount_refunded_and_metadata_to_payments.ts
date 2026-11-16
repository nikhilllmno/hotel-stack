import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('payments', (table) => {
    table.decimal('amount_refunded', 10, 2).defaultTo(0);
    table.jsonb('metadata').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('payments', (table) => {
    table.dropColumn('amount_refunded');
    table.dropColumn('metadata');
  });
}
