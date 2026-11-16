import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Drop the existing constraint
  await knex.raw(`
    ALTER TABLE payments 
    DROP CONSTRAINT IF EXISTS payments_payment_status_check
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Restore the original constraint
  await knex.raw(`
    ALTER TABLE payments 
    ADD CONSTRAINT payments_payment_status_check 
    CHECK (payment_status = ANY (ARRAY[
      'PENDING'::text, 
      'COMPLETED'::text, 
      'FAILED'::text, 
      'CANCELLED'::text, 
      'REFUNDED'::text
    ]))
  `);
}
