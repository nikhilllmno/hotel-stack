import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('booking_reviews', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('reservation_review_id', 64).notNullable().unique();
    table
      .string('booking_id', 32)
      .notNullable()
      .comment(
        '(e.g. BK12345). For multi-room bookings, this is the shared prefix — individual reservations are BK12345_1, BK12345_2, etc. For single-room bookings, this is the same as the booking ID.',
      );
    table.uuid('hotel_id').notNullable();

    table.foreign('hotel_id').references('id').inTable('hotels');

    table.timestamp('created_at', { useTz: false }).defaultTo(knex.fn.now());

    table.index(['booking_id'], 'idx_booking_reviews_booking_id');
    table.index(['hotel_id'], 'idx_booking_reviews_hotel_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('booking_reviews');
}
