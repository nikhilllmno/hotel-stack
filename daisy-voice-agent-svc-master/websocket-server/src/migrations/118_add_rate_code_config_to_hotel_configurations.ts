import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    'hotel_configurations',
    'rate_code_config',
  );
  if (!hasColumn) {
    await knex.schema.alterTable('hotel_configurations', (table) => {
      table.jsonb('rate_code_config').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    'hotel_configurations',
    'rate_code_config',
  );
  if (hasColumn) {
    await knex.schema.alterTable('hotel_configurations', (table) => {
      table.dropColumn('rate_code_config');
    });
  }
}
