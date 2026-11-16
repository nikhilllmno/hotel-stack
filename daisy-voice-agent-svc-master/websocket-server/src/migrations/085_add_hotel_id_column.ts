import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Step 1: Add hotel_id column as nullable first
  await knex.schema.alterTable('customers', (table) => {
    table.uuid('hotel_id').nullable();
  });

  await knex.schema.alterTable('payments', (table) => {
    table.uuid('hotel_id').nullable();
  });

  await knex.schema.alterTable('conversations', (table) => {
    table.uuid('hotel_id').nullable();
  });

  // Note: user table already has hotel_id column (from migration 018)
  // Note: discount table already has hotel_id column (from migration 033)

  // Step 2: Populate hotel_id
  await knex.raw(`
    UPDATE customers
    SET hotel_id = subquery.hotel_id
    FROM (
      SELECT DISTINCT ON (customer_id) 
        customer_id, 
        hotel_id
      FROM reservations
      WHERE hotel_id IS NOT NULL
      ORDER BY customer_id, created_at ASC
    ) AS subquery
    WHERE customers.id = subquery.customer_id
  `);

  await knex.raw(`
    UPDATE payments
    SET hotel_id = subquery.hotel_id
    FROM (
      SELECT DISTINCT ON (pr.payment_id) 
        pr.payment_id, 
        r.hotel_id
      FROM payment_reservations pr
      INNER JOIN reservations r ON pr.reservation_id = r.id
      WHERE r.hotel_id IS NOT NULL
      ORDER BY pr.payment_id, pr.created_at ASC
    ) AS subquery
    WHERE payments.id = subquery.payment_id
  `);

  await knex.raw(`
    UPDATE conversations
    SET hotel_id = sessions.hotel_id
    FROM sessions
    WHERE conversations.conversation_session_id = sessions.id
      AND sessions.hotel_id IS NOT NULL
  `);

  // Step 3: Convert discount.hotel_id from string to UUID
  await knex.raw(`
    ALTER TABLE discount
    ALTER COLUMN hotel_id TYPE UUID USING hotel_id::UUID
  `);

  // Step 4: Add foreign key constraint

  await knex.schema.alterTable('user', (table) => {
    table
      .foreign('hotel_id')
      .references('id')
      .inTable('hotels')
      .withKeyName('user_hotel_id_fkey');
  });

  await knex.schema.alterTable('discount', (table) => {
    table
      .foreign('hotel_id')
      .references('id')
      .inTable('hotels')
      .withKeyName('discount_hotel_id_fkey');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('user', (table) => {
    // Drop foreign key constraint
    table.dropForeign(['hotel_id'], 'user_hotel_id_fkey');
  });

  await knex.schema.alterTable('discount', (table) => {
    // Drop foreign key constraint
    table.dropForeign(['hotel_id'], 'discount_hotel_id_fkey');
  });

  // Revert discount.hotel_id from UUID back to string
  await knex.raw(`
    ALTER TABLE discount
    ALTER COLUMN hotel_id TYPE VARCHAR(255) USING hotel_id::VARCHAR
  `);
}
