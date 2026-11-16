import { Knex } from 'knex';

// Creates pg_trgm locally (Docker superuser). In dev/prod, infra pre-installs it;
// IF NOT EXISTS then succeeds as a no-op for the app migration user.
export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP EXTENSION IF EXISTS pg_trgm');
}
