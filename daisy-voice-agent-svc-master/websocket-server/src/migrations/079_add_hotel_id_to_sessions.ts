import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Step 1: Add hotel_id column as nullable first
  await knex.schema.alterTable('sessions', (table) => {
    table.uuid('hotel_id');
  });

  // Step 2: Backfill existing sessions with hotel_id from hotels table
  await knex.raw(`
    UPDATE sessions
    SET hotel_id = hotels.id
    FROM hotels
    WHERE sessions.assistant_phone_number = hotels.assistant_phone_number
  `);

  // Step 3: Make hotel_id NOT NULL
  await knex.schema.alterTable('sessions', (table) => {
    table.uuid('hotel_id').notNullable().alter();
  });

  // Step 4: Add foreign key constraint without CASCADE
  await knex.schema.alterTable('sessions', (table) => {
    table.foreign('hotel_id').references('id').inTable('hotels');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('sessions', (table) => {
    // Drop foreign key constraint
    table.dropForeign(['hotel_id']);

    // Drop column
    table.dropColumn('hotel_id');
  });
}
