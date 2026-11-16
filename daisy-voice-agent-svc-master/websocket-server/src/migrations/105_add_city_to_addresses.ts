import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('address', 'city');
  if (!hasColumn) {
    await knex.schema.alterTable('address', (table) => {
      table.string('city');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('address', 'city');
  if (hasColumn) {
    await knex.schema.alterTable('address', (table) => {
      table.dropColumn('city');
    });
  }
}
