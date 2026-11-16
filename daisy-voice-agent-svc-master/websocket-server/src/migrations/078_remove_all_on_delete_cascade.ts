import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Remove ON DELETE CASCADE from reservations.session_id
  await knex.schema.alterTable('reservations', (table) => {
    table.dropForeign(['session_id']);
    table.foreign('session_id').references('id').inTable('sessions');
  });

  // Remove ON DELETE CASCADE from escalations.session_id
  await knex.schema.alterTable('escalations', (table) => {
    table.dropForeign(['session_id']);
    table.foreign('session_id').references('id').inTable('sessions');
  });

  // Remove ON DELETE CASCADE from escalations.hotel_id
  await knex.schema.alterTable('escalations', (table) => {
    table.dropForeign(['hotel_id']);
    table.foreign('hotel_id').references('id').inTable('hotels');
  });

  // Remove ON DELETE CASCADE from conversations.conversation_session_id
  await knex.schema.alterTable('conversations', (table) => {
    table.dropForeign(['conversation_session_id']);
    table
      .foreign('conversation_session_id')
      .references('id')
      .inTable('sessions');
  });

  // Remove ON DELETE CASCADE from parent_reservations.session_id
  await knex.schema.alterTable('parent_reservations', (table) => {
    table.dropForeign(['session_id']);
    table.foreign('session_id').references('id').inTable('sessions');
  });

  // Remove ON DELETE CASCADE from payment_reservations.payment_id
  await knex.schema.alterTable('payment_reservations', (table) => {
    table.dropForeign(['payment_id']);
    table.foreign('payment_id').references('id').inTable('payments');
  });

  // Remove ON DELETE CASCADE from payment_reservations.reservation_id
  await knex.schema.alterTable('payment_reservations', (table) => {
    table.dropForeign(['reservation_id']);
    table.foreign('reservation_id').references('id').inTable('reservations');
  });

  // Remove ON DELETE CASCADE from hotel_configurations.hotel_id
  await knex.schema.alterTable('hotel_configurations', (table) => {
    table.dropForeign(['hotel_id']);
    table.foreign('hotel_id').references('id').inTable('hotels');
  });
}

export async function down(knex: Knex): Promise<void> {
  // Restore ON DELETE CASCADE to reservations.session_id
  await knex.schema.alterTable('reservations', (table) => {
    table.dropForeign(['session_id']);
    table
      .foreign('session_id')
      .references('id')
      .inTable('sessions')
      .onDelete('CASCADE');
  });

  // Restore ON DELETE CASCADE to escalations.session_id
  await knex.schema.alterTable('escalations', (table) => {
    table.dropForeign(['session_id']);
    table
      .foreign('session_id')
      .references('id')
      .inTable('sessions')
      .onDelete('CASCADE');
  });

  // Restore ON DELETE CASCADE to escalations.hotel_id
  await knex.schema.alterTable('escalations', (table) => {
    table.dropForeign(['hotel_id']);
    table
      .foreign('hotel_id')
      .references('id')
      .inTable('hotels')
      .onDelete('CASCADE');
  });

  // Restore ON DELETE CASCADE to conversations.conversation_session_id
  await knex.schema.alterTable('conversations', (table) => {
    table.dropForeign(['conversation_session_id']);
    table
      .foreign('conversation_session_id')
      .references('id')
      .inTable('sessions')
      .onDelete('CASCADE');
  });

  // Restore ON DELETE CASCADE to parent_reservations.session_id
  await knex.schema.alterTable('parent_reservations', (table) => {
    table.dropForeign(['session_id']);
    table
      .foreign('session_id')
      .references('id')
      .inTable('sessions')
      .onDelete('CASCADE');
  });

  // Restore ON DELETE CASCADE to payment_reservations.payment_id
  await knex.schema.alterTable('payment_reservations', (table) => {
    table.dropForeign(['payment_id']);
    table
      .foreign('payment_id')
      .references('id')
      .inTable('payments')
      .onDelete('CASCADE');
  });

  // Restore ON DELETE CASCADE to payment_reservations.reservation_id
  await knex.schema.alterTable('payment_reservations', (table) => {
    table.dropForeign(['reservation_id']);
    table
      .foreign('reservation_id')
      .references('id')
      .inTable('reservations')
      .onDelete('CASCADE');
  });

  // Restore ON DELETE CASCADE to hotel_configurations.hotel_id
  await knex.schema.alterTable('hotel_configurations', (table) => {
    table.dropForeign(['hotel_id']);
    table
      .foreign('hotel_id')
      .references('id')
      .inTable('hotels')
      .onDelete('CASCADE');
  });
}
