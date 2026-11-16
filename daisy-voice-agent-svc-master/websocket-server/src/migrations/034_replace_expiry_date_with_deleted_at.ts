import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('discount', (table) => {
    // Drop the expiry_date column
    table.dropColumn('expiry_date');

    // Add the deleted_at column (nullable)
    table.timestamp('deleted_at').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('discount', (table) => {
    // Revert changes: add back expiry_date and remove deleted_at
    table
      .timestamp('expiry_date')
      .notNullable()
      .defaultTo(knex.raw("NOW() + INTERVAL '2 days'"));
    table.dropColumn('deleted_at');
  });
}
