import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('hotels', (table) => {
    // Rename telegram_chatId to telegram_check_in_group_id
    table.renameColumn('telegram_chatId', 'telegram_check_in_group_id');
    // Add new telegram_alerts_group_id column
    table.string('telegram_alerts_group_id').notNullable().defaultTo('');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('hotels', (table) => {
    // Rename back to telegram_chatId
    table.renameColumn('telegram_check_in_group_id', 'telegram_chatId');
    // Drop the telegram_alerts_group_id column
    table.dropColumn('telegram_alerts_group_id');
  });
}
