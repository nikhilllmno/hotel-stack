import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('sessions', 'metadata');
  if (!hasColumn) {
    await knex.schema.alterTable('sessions', (table) => {
      table.jsonb('metadata').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('sessions', 'metadata');
  if (hasColumn) {
    await knex.schema.alterTable('sessions', (table) => {
      table.dropColumn('metadata');
    });
  }
}
