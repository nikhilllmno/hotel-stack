import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Step 1: Add pms_provider_id column as nullable first
  await knex.schema.alterTable('hotels', (table) => {
    table.uuid('pms_provider_id').nullable();
  });
  await knex.schema.alterTable('reservations', (table) => {
    table.uuid('pms_provider_id').nullable();
  });

  // Step 2: Create Resnexus PMS provider
  const [resnexusProvider] = await knex('pms_providers')
    .insert({
      name: 'Resnexus',
      is_active: true,
    })
    .returning('*');

  // Step 3: Update all existing hotels to use Resnexus as their PMS provider
  await knex('hotels').update({
    pms_provider_id: resnexusProvider.id,
  });

  // Step 4: Update all existing reservations to use Resnexus as their PMS provider
  await knex('reservations').update({
    pms_provider_id: resnexusProvider.id,
  });

  // Step 5: Make pms_provider_id NOT NULL
  await knex.schema.alterTable('hotels', (table) => {
    table.uuid('pms_provider_id').notNullable().alter();
  });

  // Step 6: Add foreign key constraint
  await knex.schema.alterTable('hotels', (table) => {
    table
      .foreign('pms_provider_id')
      .references('id')
      .inTable('pms_providers')
      .withKeyName('hotels_pms_provider_id_fkey');
  });

  // Step 7: Make pms_provider_id NOT NULL for reservations
  await knex.schema.alterTable('reservations', (table) => {
    table.uuid('pms_provider_id').notNullable().alter();
  });

  // Step 8: Add foreign key constraint for reservations
  await knex.schema.alterTable('reservations', (table) => {
    table
      .foreign('pms_provider_id')
      .references('id')
      .inTable('pms_providers')
      .withKeyName('reservations_pms_provider_id_fkey');
  });
}

export async function down(knex: Knex): Promise<void> {
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
  await knex('pms_providers').where({ name: 'Resnexus' }).delete();
}
