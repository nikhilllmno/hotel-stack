import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reservations', (table) => {
    // Add the new hotel_id column as nullable first
    table.uuid('hotel_id').nullable();
  });

  // Populate hotel_id from business_id by joining with hotels table
  await knex.raw(`
    UPDATE reservations
    SET hotel_id = hotels.id
    FROM hotels
    WHERE reservations.business_id = hotels.business_id
  `);

  // Now make hotel_id not nullable and add foreign key constraint
  await knex.schema.alterTable('reservations', (table) => {
    table.uuid('hotel_id').notNullable().alter();
    table
      .foreign('hotel_id')
      .references('id')
      .inTable('hotels')
      .withKeyName('reservations_hotel_id_fkey');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reservations', (table) => {
    table.dropForeign(['hotel_id'], 'reservations_hotel_id_fkey');
    table.dropColumn('hotel_id');
  });
}
