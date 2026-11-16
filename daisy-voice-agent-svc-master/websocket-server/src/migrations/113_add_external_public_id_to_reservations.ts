import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    'reservations',
    'external_public_id',
  );
  if (!hasColumn) {
    await knex.schema.alterTable('reservations', (table) => {
      table.string('external_public_id').nullable();
      table.index('external_public_id');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    'reservations',
    'external_public_id',
  );
  if (hasColumn) {
    await knex.schema.alterTable('reservations', (table) => {
      table.dropIndex('external_public_id');
      table.dropColumn('external_public_id');
    });
  }
}
