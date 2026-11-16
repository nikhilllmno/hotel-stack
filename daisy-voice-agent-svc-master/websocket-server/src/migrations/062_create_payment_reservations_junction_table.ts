import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('payment_reservations', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('payment_id').notNullable();
    table.uuid('reservation_id').notNullable();

    // Create foreign key constraints
    table
      .foreign('payment_id')
      .references('id')
      .inTable('payments')
      .onDelete('CASCADE');
    table
      .foreign('reservation_id')
      .references('id')
      .inTable('reservations')
      .onDelete('CASCADE');

    // Create unique constraint to prevent duplicate relationships
    table.unique(['payment_id', 'reservation_id']);

    table.timestamp('created_at', { useTz: false }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: false }).defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('payment_reservations');
}
