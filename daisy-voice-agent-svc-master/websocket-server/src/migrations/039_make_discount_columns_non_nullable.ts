import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('discount', (table) => {
    table.decimal('tax_rate', 5, 2).notNullable().alter();
    table.text('note').notNullable().alter();
    table.integer('expiry_days').notNullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('discount', (table) => {
    table.decimal('tax_rate', 5, 2).nullable().alter();
    table.text('note').nullable().alter();
    table.integer('expiry_days').nullable().alter();
  });
}
