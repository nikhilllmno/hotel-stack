import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('discount', (table) => {
    table.decimal('tax_rate', 5, 2).nullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  // Do nothing
}
