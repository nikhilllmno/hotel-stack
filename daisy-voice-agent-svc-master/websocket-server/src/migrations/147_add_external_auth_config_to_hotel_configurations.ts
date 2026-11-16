import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    'hotel_configurations',
    'external_auth_config',
  );
  if (!hasColumn) {
    await knex.schema.alterTable('hotel_configurations', (table) => {
      table
        .jsonb('external_auth_config')
        .nullable()
        .comment(
          'Live external-PMS credential for the hotel, e.g. ' +
            '{ "apiToken": "<encrypted>", "disabledAt": "<iso>|null" }. ' +
            'Which provider it is for is already known from hotels.pms_provider, ' +
            'so this is flat rather than keyed by provider name. ' +
            'apiToken is AES-256-GCM encrypted; disabledAt is plain.',
        );
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    'hotel_configurations',
    'external_auth_config',
  );
  if (hasColumn) {
    await knex.schema.alterTable('hotel_configurations', (table) => {
      table.dropColumn('external_auth_config');
    });
  }
}
