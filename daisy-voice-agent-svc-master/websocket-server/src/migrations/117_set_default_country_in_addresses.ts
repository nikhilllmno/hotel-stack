import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex('address').whereNull('country').update({ country: 'US' });
}

export async function down(knex: Knex): Promise<void> {
  // No rollback needed - we don't want to set countries back to null
}
