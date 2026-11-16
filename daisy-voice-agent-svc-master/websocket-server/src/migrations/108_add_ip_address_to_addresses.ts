import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('address', 'ip_address');
  if (!hasColumn) {
    await knex.schema.alterTable('address', (table) => {
      table.string('ip_address', 45).nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('address', 'ip_address');
  if (hasColumn) {
    await knex.schema.alterTable('address', (table) => {
      table.dropColumn('ip_address');
    });
  }
}
