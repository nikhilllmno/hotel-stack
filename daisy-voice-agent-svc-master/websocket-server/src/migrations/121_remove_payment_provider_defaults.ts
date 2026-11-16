import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotels', (table) => {
    table.string('payment_provider').notNullable().alter();
  });

  await knex.schema.alterTable('payments', (table) => {
    table.string('payment_provider').notNullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotels', (table) => {
    table.string('payment_provider').notNullable().defaultTo('stripe').alter();
  });

  await knex.schema.alterTable('payments', (table) => {
    table.string('payment_provider').notNullable().defaultTo('stripe').alter();
  });
}
