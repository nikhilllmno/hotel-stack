import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('customers', 'external_id');
  if (!hasColumn) {
    await knex.schema.alterTable('customers', (table) => {
      table
        .string('external_id')
        .nullable()
        .comment('External PMS guest ID (e.g., Stayntouch guest ID)');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('customers', 'external_id');
  if (hasColumn) {
    await knex.schema.alterTable('customers', (table) => {
      table.dropColumn('external_id');
    });
  }
}
