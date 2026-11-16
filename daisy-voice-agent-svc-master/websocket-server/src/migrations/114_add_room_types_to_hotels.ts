import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('hotels', 'room_types');
  if (!hasColumn) {
    await knex.schema.alterTable('hotels', (table) => {
      table.jsonb('room_types').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('hotels', 'room_types');
  if (hasColumn) {
    await knex.schema.alterTable('hotels', (table) => {
      table.dropColumn('room_types');
    });
  }
}
