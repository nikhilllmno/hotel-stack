import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Drop foreign key constraint from sessions table
  await knex.schema.alterTable('sessions', (table) => {
    table.dropForeign(['assistant_phone_number']);
  });
}

export async function down(knex: Knex): Promise<void> {
  // Re-add foreign key constraint to sessions table
  await knex.schema.alterTable('sessions', (table) => {
    table
      .foreign('assistant_phone_number')
      .references('assistant_phone_number')
      .inTable('hotels');
  });
}
