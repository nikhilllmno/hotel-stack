import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('payments', 'payment_provider');
  if (!hasColumn) {
    await knex.schema.alterTable('payments', (table) => {
      table.string('payment_provider').notNullable().defaultTo('stripe');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('payments', 'payment_provider');
  if (hasColumn) {
    await knex.schema.alterTable('payments', (table) => {
      table.dropColumn('payment_provider');
    });
  }
}
