import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('escalations', (table) => {
    table.string('external_message_id').nullable();
    table.integer('reminder_count').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('escalations', (table) => {
    table.dropColumn('reminder_count');
    table.dropColumn('external_message_id');
  });
}
