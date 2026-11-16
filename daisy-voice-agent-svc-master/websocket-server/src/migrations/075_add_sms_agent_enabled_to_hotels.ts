import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotels', (table) => {
    table.boolean('sms_agent_enabled').defaultTo(false).notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('hotels', (table) => {
    table.dropColumn('sms_agent_enabled');
  });
}
