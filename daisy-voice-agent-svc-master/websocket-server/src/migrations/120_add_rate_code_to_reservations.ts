import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('reservations', 'rate_code');
  if (!hasColumn) {
    await knex.schema.alterTable('reservations', (table) => {
      table.string('rate_code').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('reservations', 'rate_code');
  if (hasColumn) {
    await knex.schema.alterTable('reservations', (table) => {
      table.dropColumn('rate_code');
    });
  }
}
