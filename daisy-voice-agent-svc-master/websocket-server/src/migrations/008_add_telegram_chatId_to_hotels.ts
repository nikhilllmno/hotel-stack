import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('hotels', (table) => {
    table.string('telegram_chatId').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('hotels', (table) => {
    table.dropColumn('telegram_chatId');
  });
}
