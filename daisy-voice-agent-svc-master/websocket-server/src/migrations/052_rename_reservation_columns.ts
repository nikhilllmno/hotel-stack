import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reservations', (table) => {
    table.renameColumn('latest_payment_id', 'payment_id');
    table.renameColumn('resnexus_id', 'external_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reservations', (table) => {
    table.renameColumn('payment_id', 'latest_payment_id');
    table.renameColumn('external_id', 'resnexus_id');
  });
}
