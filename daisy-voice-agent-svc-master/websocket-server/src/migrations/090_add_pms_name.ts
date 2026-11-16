import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Step 1: Drop foreign key constraint for reservations
  await knex.schema.alterTable('reservations', (table) => {
    table.dropForeign(['pms_provider_id'], 'reservations_pms_provider_id_fkey');
  });

  // Step 2: Drop foreign key constraint for hotels
  await knex.schema.alterTable('hotels', (table) => {
    table.dropForeign(['pms_provider_id'], 'hotels_pms_provider_id_fkey');
  });

  // Step 3: Drop column for reservations
  await knex.schema.alterTable('reservations', (table) => {
    table.dropColumn('pms_provider_id');
  });

  // Step 4: Drop column for hotels
  await knex.schema.alterTable('hotels', (table) => {
    table.dropColumn('pms_provider_id');
  });

  // Step 3: Delete Resnexus provider (optional - you might want to keep it)
  await knex('pms_providers').where({ name: 'resnexus' }).delete();

  await knex.schema.alterTable('hotels', (table) => {
    table.string('pms_provider').notNullable().defaultTo('resnexus');
  });
  await knex.schema.alterTable('reservations', (table) => {
    table.string('pms_provider').notNullable().defaultTo('resnexus');
  });
}

export async function down(knex: Knex): Promise<void> {
  // NIL
}
