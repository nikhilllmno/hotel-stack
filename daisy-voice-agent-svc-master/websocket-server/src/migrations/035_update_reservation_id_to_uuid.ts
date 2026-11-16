import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('discount', (table) => {
    // Alter the existing reservation_id column to UUID type
    table.uuid('reservation_id').nullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('discount', (table) => {
    // Revert changes: alter back to string type
    table.string('reservation_id').nullable().unique().alter();
  });
}
