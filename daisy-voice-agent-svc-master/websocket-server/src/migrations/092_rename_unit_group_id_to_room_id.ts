import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('reservations', (table) => {
    // Rename column from unit_group_id to room_id
    table.renameColumn('unit_group_id', 'room_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('reservations', (table) => {
    // Rename column back to original
    table.renameColumn('room_id', 'unit_group_id');
  });
}
