import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('escalations', (table) => {
    table.uuid('hotel_id').notNullable().alter();
    table.foreign('hotel_id').references('hotels.id').onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('escalations', (table) => {
    table.dropForeign('hotel_id');
    table.string('hotel_id').notNullable().alter();
  });
}
