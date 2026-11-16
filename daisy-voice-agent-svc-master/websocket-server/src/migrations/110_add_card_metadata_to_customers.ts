import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('customers', 'card_metadata');
  if (!hasColumn) {
    await knex.schema.table('customers', (table) => {
      table.jsonb('card_metadata').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('customers', 'card_metadata');
  if (hasColumn) {
    await knex.schema.table('customers', (table) => {
      table.dropColumn('card_metadata');
    });
  }
}
