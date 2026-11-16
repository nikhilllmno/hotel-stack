import { Knex } from 'knex';

const OLD_CONSTRAINT_NAME = 'reservations_resnexus_id_unique';
const NEW_CONSTRAINT_NAME =
  'reservations_hotel_id_pms_provider_external_id_unique';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reservations', (table) => {
    table.dropUnique(['external_id'], OLD_CONSTRAINT_NAME);
    table.unique(['hotel_id', 'pms_provider', 'external_id'], {
      indexName: NEW_CONSTRAINT_NAME,
    });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reservations', (table) => {
    table.dropUnique(
      ['hotel_id', 'pms_provider', 'external_id'],
      NEW_CONSTRAINT_NAME,
    );
    table.unique(['external_id'], { indexName: OLD_CONSTRAINT_NAME });
  });
}
