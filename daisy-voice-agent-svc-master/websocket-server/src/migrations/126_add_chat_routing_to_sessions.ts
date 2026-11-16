import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    'sessions',
    'chat_routing_mode',
  );
  if (!hasColumn) {
    await knex.schema.alterTable('sessions', (table) => {
      table.string('chat_routing_mode', 10).notNullable().defaultTo('AI');
      table.timestamp('chat_routing_updated_at').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    'sessions',
    'chat_routing_mode',
  );
  if (hasColumn) {
    await knex.schema.alterTable('sessions', (table) => {
      table.dropColumn('chat_routing_mode');
      table.dropColumn('chat_routing_updated_at');
    });
  }
}
