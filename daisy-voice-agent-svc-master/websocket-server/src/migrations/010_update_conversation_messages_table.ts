import { Knex } from 'knex';
import { ConversationMessageRole } from '../dtos/enum/ConversationMessageRole';
import { formatAlterTableEnumSql } from './util/helper';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    formatAlterTableEnumSql('conversation_messages', 'role', [
      ConversationMessageRole.AI,
      ConversationMessageRole.USER,
      ConversationMessageRole.SYSTEM,
      ConversationMessageRole.TOOL_CALL_RESULT,
      ConversationMessageRole.TOOL_CALLS,
    ]),
  );
  return knex.schema.alterTable('conversation_messages', (table) => {
    table.text('message').nullable().alter();
    table.json('tool_calls');
    table.text('tool_call_name');
    table.json('tool_call_results');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    `DELETE FROM conversation_messages WHERE role IN ('${ConversationMessageRole.TOOL_CALL_RESULT}','${ConversationMessageRole.TOOL_CALLS}');`,
  );

  await knex.raw(
    formatAlterTableEnumSql('conversation_messages', 'role', [
      ConversationMessageRole.AI,
      ConversationMessageRole.USER,
      ConversationMessageRole.SYSTEM,
    ]),
  );
  return knex.schema.alterTable('conversation_messages', (table) => {
    table.text('message').notNullable().alter();
    table.dropColumn('tool_calls');
    table.dropColumn('tool_call_name');
    table.dropColumn('tool_call_results');
  });
}
