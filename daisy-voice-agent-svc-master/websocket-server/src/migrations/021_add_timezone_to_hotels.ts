import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('hotels', (table) => {
    table
      .string('timezone')
      .comment("Timezone string for the hotel (e.g., 'America/New_York')");
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('hotels', (table) => {
    table.dropColumn('timezone');
  });
}
