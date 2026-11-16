import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // First, make assistant_phone_number unique in hotels table
  await knex.schema.alterTable('hotels', (table) => {
    table.unique(['assistant_phone_number'], {
      indexName: 'hotels_assistant_phone_number_unique',
    });
  });

  // Then, add foreign key constraint to sessions table
  await knex.schema.alterTable('sessions', (table) => {
    table
      .foreign('assistant_phone_number')
      .references('assistant_phone_number')
      .inTable('hotels');
  });
}

export async function down(knex: Knex): Promise<void> {
  // Drop foreign key constraint first
  await knex.schema.alterTable('sessions', (table) => {
    table.dropForeign(['assistant_phone_number']);
  });

  // Then drop unique constraint from hotels table
  await knex.schema.alterTable('hotels', (table) => {
    table.dropUnique(
      ['assistant_phone_number'],
      'hotels_assistant_phone_number_unique',
    );
  });
}
