import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('customers', (table) => {
    // Make email nullable
    table.string('email').nullable().alter();
  });
  await knex.schema.alterTable('address', (table) => {
    table.string('postal_code').nullable().alter();
    table.string('state_or_province').nullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('address', (table) => {
    table.string('postal_code').notNullable().alter();
    table.string('state_or_province').notNullable().alter();
  });
  await knex.schema.alterTable('customers', (table) => {
    table.string('email').notNullable().alter();
  });
}
