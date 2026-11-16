import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('parent_reservations', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.bigint('business_id').notNullable();
    table.string('booking_id').notNullable();
    table.date('check_in').notNullable();
    table.date('check_out').notNullable();
    table.integer('num_adults').notNullable();
    table.integer('num_children').notNullable();
    table.uuid('customer_id').notNullable();
    table.string('phone_number').notNullable();
    table.string('status').defaultTo('INACTIVE');
    table.string('latest_payment_id');
    table.uuid('session_id');
    table
      .foreign('session_id')
      .references('id')
      .inTable('sessions')
      .onDelete('CASCADE');

    table.timestamp('created_at', { useTz: false }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: false }).defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('parent_reservations');
}
