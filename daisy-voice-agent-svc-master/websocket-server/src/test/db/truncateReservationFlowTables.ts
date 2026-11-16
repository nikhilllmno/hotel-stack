import { Knex } from 'knex';

/**
 * basically: resets all the data in the db
 */
export async function truncateReservationFlowTables(knex: Knex): Promise<void> {
  await knex.raw('TRUNCATE TABLE hotels RESTART IDENTITY CASCADE');
}
