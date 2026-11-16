import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('customers', (table) => {
    table.string('first_name').nullable().alter();
    table.string('last_name').nullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('customers', (table) => {
    table.string('first_name').notNullable().alter();
    table.string('last_name').notNullable().alter();
  });
}
