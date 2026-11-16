import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Populate the junction table with existing reservation-payment relationships
  await knex.raw(`
    INSERT INTO payment_reservations (payment_id, reservation_id, created_at, updated_at)
    SELECT 
      r.payment_id,
      r.id as reservation_id,
      NOW() as created_at,
      NOW() as updated_at
    FROM reservations r
    WHERE r.payment_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM payments p WHERE p.id = r.payment_id)
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Clear all records from the junction table
  await knex('payment_reservations').del();
}
