import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Step 1: Make hotel_id columns NOT NULL
  await knex.schema.alterTable('customers', (table) => {
    table.uuid('hotel_id').notNullable().alter();
  });

  await knex.schema.alterTable('payments', (table) => {
    table.uuid('hotel_id').notNullable().alter();
  });

  await knex.schema.alterTable('conversations', (table) => {
    table.uuid('hotel_id').notNullable().alter();
  });

  // Step 2: Add foreign key constraints for hotel_id
  await knex.schema.alterTable('customers', (table) => {
    table
      .foreign('hotel_id')
      .references('id')
      .inTable('hotels')
      .withKeyName('customers_hotel_id_fkey');
  });

  await knex.schema.alterTable('payments', (table) => {
    table
      .foreign('hotel_id')
      .references('id')
      .inTable('hotels')
      .withKeyName('payments_hotel_id_fkey');
  });

  await knex.schema.alterTable('conversations', (table) => {
    table
      .foreign('hotel_id')
      .references('id')
      .inTable('hotels')
      .withKeyName('conversations_hotel_id_fkey');
  });
}

export async function down(knex: Knex): Promise<void> {
  // Drop hotel_id foreign keys
  await knex.schema.alterTable('conversations', (table) => {
    table.dropForeign(['hotel_id'], 'conversations_hotel_id_fkey');
  });

  await knex.schema.alterTable('payments', (table) => {
    table.dropForeign(['hotel_id'], 'payments_hotel_id_fkey');
  });

  await knex.schema.alterTable('customers', (table) => {
    table.dropForeign(['hotel_id'], 'customers_hotel_id_fkey');
  });

  // Make hotel_id columns nullable again
  await knex.schema.alterTable('conversations', (table) => {
    table.uuid('hotel_id').nullable().alter();
  });

  await knex.schema.alterTable('payments', (table) => {
    table.uuid('hotel_id').nullable().alter();
  });

  await knex.schema.alterTable('customers', (table) => {
    table.uuid('hotel_id').nullable().alter();
  });
}
