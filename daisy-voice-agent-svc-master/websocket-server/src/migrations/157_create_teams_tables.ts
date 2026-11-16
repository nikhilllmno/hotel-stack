import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('teams_conversation_references'))) {
    await knex.schema.createTable('teams_conversation_references', (table) => {
      table
        .string('channel_id')
        .primary()
        .comment('Teams channel id (19:...@thread.tacv2)');
      table.string('tenant_id').notNullable();
      table
        .text('service_url')
        .notNullable()
        .comment(
          'Regional Bot Connector endpoint the channel was last seen on',
        );
      table.string('team_id').nullable();
      table.string('bot_id').notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
  }

  // Teams replies and reactions do not carry the text of the message they point
  // at, so what the bot posts is kept here to find the guest phone again.
  if (!(await knex.schema.hasTable('chat_outbound_messages'))) {
    await knex.schema.createTable('chat_outbound_messages', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('provider').notNullable();
      table.string('channel_id').notNullable();
      table.string('message_id').notNullable();
      table.text('text').notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());

      table.unique(['provider', 'channel_id', 'message_id']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('chat_outbound_messages');
  await knex.schema.dropTableIfExists('teams_conversation_references');
}
