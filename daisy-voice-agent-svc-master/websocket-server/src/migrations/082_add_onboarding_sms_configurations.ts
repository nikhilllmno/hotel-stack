import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotel_configurations', (table) => {
    table.jsonb('onboarding_sms_configuration').nullable();
  });
  await knex.schema.alterTable('reservations', (table) => {
    table.boolean('onboarding_sms_sent').defaultTo(false).notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reservations', (table) => {
    table.dropColumn('onboarding_sms_sent');
  });
  await knex.schema.alterTable('hotel_configurations', (table) => {
    table.dropColumn('onboarding_sms_configuration');
  });
}
