import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    'hotel_configurations',
    'addon_modification_allowlist',
  );
  if (!hasColumn) {
    await knex.schema.alterTable('hotel_configurations', (table) => {
      table.jsonb('addon_modification_allowlist').nullable().defaultTo(null);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    'hotel_configurations',
    'addon_modification_allowlist',
  );
  if (hasColumn) {
    await knex.schema.alterTable('hotel_configurations', (table) => {
      table.dropColumn('addon_modification_allowlist');
    });
  }
}
