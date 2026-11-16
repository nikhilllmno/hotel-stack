import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('hotel_configurations', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('hotel_id').notNullable();
    table.json('payment_configuration').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('deleted_at').nullable();

    // Foreign key constraint to hotels table
    table
      .foreign('hotel_id')
      .references('id')
      .inTable('hotels')
      .onDelete('CASCADE');

    // Unique constraint to ensure one active configuration per hotel (hotel_id + deleted_at)
    table.unique(['hotel_id', 'deleted_at']);

    // Index for performance
    table.index(['hotel_id']);
    table.index(['deleted_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTableIfExists('hotel_configurations');
}
