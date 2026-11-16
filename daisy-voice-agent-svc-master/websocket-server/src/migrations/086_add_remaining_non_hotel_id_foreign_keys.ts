import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 1. reservations → customer_id
  await knex.schema.alterTable('reservations', (table) => {
    table
      .foreign('customer_id')
      .references('id')
      .inTable('customers')
      .withKeyName('reservations_customer_id_fkey');
  });

  // 2. address → customer_id
  await knex.schema.alterTable('address', (table) => {
    table
      .foreign('customer_id')
      .references('id')
      .inTable('customers')
      .withKeyName('address_customer_id_fkey');
  });

  // 3. conversation_messages → conversation_id
  await knex.schema.alterTable('conversation_messages', (table) => {
    table
      .foreign('conversation_id')
      .references('id')
      .inTable('conversations')
      .withKeyName('conversation_messages_conversation_id_fkey');
  });

  // 4. discount → reservation_id (nullable)
  await knex.schema.alterTable('discount', (table) => {
    table
      .foreign('reservation_id')
      .references('id')
      .inTable('reservations')
      .withKeyName('discount_reservation_id_fkey');
  });

  // 5. quotes → reservation_id
  await knex.schema.alterTable('quotes', (table) => {
    table
      .foreign('reservation_id')
      .references('id')
      .inTable('reservations')
      .withKeyName('quotes_reservation_id_fkey');
  });
}

export async function down(knex: Knex): Promise<void> {
  // Drop foreign keys in reverse order to avoid dependency issues

  await knex.schema.alterTable('quotes', (table) => {
    table.dropForeign(['reservation_id'], 'quotes_reservation_id_fkey');
  });

  await knex.schema.alterTable('discount', (table) => {
    table.dropForeign(['reservation_id'], 'discount_reservation_id_fkey');
  });

  await knex.schema.alterTable('conversation_messages', (table) => {
    table.dropForeign(
      ['conversation_id'],
      'conversation_messages_conversation_id_fkey',
    );
  });

  await knex.schema.alterTable('address', (table) => {
    table.dropForeign(['customer_id'], 'address_customer_id_fkey');
  });

  await knex.schema.alterTable('reservations', (table) => {
    table.dropForeign(['customer_id'], 'reservations_customer_id_fkey');
  });
}
