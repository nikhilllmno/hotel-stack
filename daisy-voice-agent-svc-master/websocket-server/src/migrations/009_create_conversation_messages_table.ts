import { Knex } from 'knex';
import { ConversationMessageRole } from '../dtos/enum/ConversationMessageRole';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('conversation_messages', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('conversation_id').notNullable();
    table
      .enum('role', [
        ConversationMessageRole.USER,
        ConversationMessageRole.AI,
        ConversationMessageRole.SYSTEM,
      ])
      .notNullable();
    table.text('message').notNullable();
    table.timestamp('timestamp', { useTz: false }).notNullable();
    table.timestamp('created_at', { useTz: false }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: false }).defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('conversation_messages');
}
