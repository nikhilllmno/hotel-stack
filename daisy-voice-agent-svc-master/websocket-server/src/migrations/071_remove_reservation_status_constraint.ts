import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Drop the existing status constraint to allow NO_SHOW status
  await knex.raw(`
    ALTER TABLE reservations 
    DROP CONSTRAINT IF EXISTS reservations_status_check
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Restore the original constraint
  await knex.raw(`
    ALTER TABLE reservations 
    ADD CONSTRAINT reservations_status_check 
    CHECK (status = ANY (ARRAY[
      'ACTIVE'::text, 
      'INACTIVE'::text, 
      'FAILED'::text, 
      'CANCELLED'::text
    ]))
  `);
}
