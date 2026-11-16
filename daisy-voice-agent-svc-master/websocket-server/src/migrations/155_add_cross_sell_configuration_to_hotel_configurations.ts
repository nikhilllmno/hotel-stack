import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    'hotel_configurations',
    'cross_sell_configuration',
  );
  if (!hasColumn) {
    await knex.schema.alterTable('hotel_configurations', (table) => {
      table.jsonb('cross_sell_configuration').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    'hotel_configurations',
    'cross_sell_configuration',
  );
  if (hasColumn) {
    await knex.schema.alterTable('hotel_configurations', (table) => {
      table.dropColumn('cross_sell_configuration');
    });
  }
}
