import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotels', (table) => {
    // Remove default from telegram_alerts_group_id
    table.string('telegram_alerts_group_id').notNullable().alter();
    // Remove default from currency
    table.string('currency').notNullable().alter();
    // Remove default from sms_number
    table.string('sms_number').notNullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotels', (table) => {
    // Restore default to telegram_alerts_group_id
    table
      .string('telegram_alerts_group_id')
      .notNullable()
      .defaultTo('')
      .alter();
    // Restore default to currency
    table.string('currency').notNullable().defaultTo('$').alter();
    // Restore default to sms_number
    table.string('sms_number').defaultTo('18054914137').alter();
  });
}
