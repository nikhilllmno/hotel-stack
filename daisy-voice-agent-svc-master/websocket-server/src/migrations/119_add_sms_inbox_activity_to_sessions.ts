import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('sessions', 'last_messaged_at');
  if (!hasColumn) {
    await knex.schema.alterTable('sessions', (table) => {
      table.timestamp('last_messaged_at').nullable();
      table.boolean('has_unread_messages').notNullable().defaultTo(false);
    });

    await knex.raw(`
      UPDATE sessions
      SET last_messaged_at = updated_at
      WHERE last_messaged_at IS NULL
    `);
  }

  // SMS operator inbox: DISTINCT ON (caller_phone_number) … ORDER BY last_messaged_at, outer sort by last_messaged_at
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_sessions_sms_inbox_list
    ON sessions (hotel_id, session_type, caller_phone_number, last_messaged_at DESC NULLS LAST);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP INDEX IF EXISTS idx_sessions_sms_inbox_list;
  `);
  const hasColumn = await knex.schema.hasColumn('sessions', 'last_messaged_at');
  if (hasColumn) {
    await knex.schema.alterTable('sessions', (table) => {
      table.dropColumn('last_messaged_at');
      table.dropColumn('has_unread_messages');
    });
  }
}
