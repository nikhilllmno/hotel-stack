import { Knex } from 'knex';

// Chat provider the hotel receives notifications on. The telegram_*_group_id
// columns keep their names and hold the matching provider's chat/channel id.
export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('hotels', 'notification_type');
  if (!hasColumn) {
    await knex.schema.alterTable('hotels', (table) => {
      table.string('notification_type').notNullable().defaultTo('telegram');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('hotels', 'notification_type');
  if (hasColumn) {
    await knex.schema.alterTable('hotels', (table) => {
      table.dropColumn('notification_type');
    });
  }
}
