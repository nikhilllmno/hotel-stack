import { Knex } from 'knex';

// Set while a card submission is booking the room in the PMS, so a second
// submission for the same booking cannot create and charge it again.
export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    'reservations',
    'pms_booking_claimed_at',
  );
  if (!hasColumn) {
    await knex.schema.alterTable('reservations', (table) => {
      table.timestamp('pms_booking_claimed_at', { useTz: false }).nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    'reservations',
    'pms_booking_claimed_at',
  );
  if (hasColumn) {
    await knex.schema.alterTable('reservations', (table) => {
      table.dropColumn('pms_booking_claimed_at');
    });
  }
}
