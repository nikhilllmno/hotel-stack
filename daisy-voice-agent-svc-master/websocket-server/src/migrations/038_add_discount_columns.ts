import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('discount', (table) => {
    table.decimal('tax_rate', 5, 2).notNullable().defaultTo(6.0);
    table
      .text('note')
      .notNullable()
      .defaultTo('Discount applied due to customer hang-up citing high price');
    table.integer('expiry_days').notNullable().defaultTo(2);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('discount', (table) => {
    table.dropColumn('tax_rate');
    table.dropColumn('note');
    table.dropColumn('expiry_days');
  });
}
