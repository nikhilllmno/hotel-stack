import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    'hotel_configurations',
    'dextr_pms_source_id',
  );
  if (!hasColumn) {
    await knex.schema.alterTable('hotel_configurations', (table) => {
      table
        .string('dextr_pms_source_id')
        .nullable()
        .comment(
          "Identifier that marks Dextr as the booking source in the hotel's external PMS (e.g. Cloudbeds sourceID), passed on reservation creation.",
        );
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    'hotel_configurations',
    'dextr_pms_source_id',
  );
  if (hasColumn) {
    await knex.schema.alterTable('hotel_configurations', (table) => {
      table.dropColumn('dextr_pms_source_id');
    });
  }
}
