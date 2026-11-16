import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotels', (table) => {
    table.string('business_id').notNullable().alter();
  });

  await knex.schema.alterTable('reservations', (table) => {
    table.string('business_id').notNullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotels', (table) => {
    table.integer('business_id').notNullable().alter();
  });

  await knex.schema.alterTable('reservations', (table) => {
    table.integer('business_id').notNullable().alter();
  });
}
