import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    'hotel_configurations',
    'door_lock_config',
  );
  if (!hasColumn) {
    await knex.schema.alterTable('hotel_configurations', (table) => {
      table.jsonb('door_lock_config').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    'hotel_configurations',
    'door_lock_config',
  );
  if (hasColumn) {
    await knex.schema.alterTable('hotel_configurations', (table) => {
      table.dropColumn('door_lock_config');
    });
  }
}
