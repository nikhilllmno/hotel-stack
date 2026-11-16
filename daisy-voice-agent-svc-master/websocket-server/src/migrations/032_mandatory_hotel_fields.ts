import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotels', (table) => {
    table.string('country').notNullable().alter();
    table.string('assistant_phone_number').notNullable().alter();
    table.string('timezone').notNullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  // Revert back to nullable
  await knex.schema.alterTable('hotels', (table) => {
    table.string('country').nullable().alter();
    table.string('assistant_phone_number').nullable().alter();
    table.string('timezone').nullable().alter();
  });
}
