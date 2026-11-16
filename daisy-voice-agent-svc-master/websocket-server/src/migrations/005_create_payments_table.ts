import { Knex } from 'knex';
import { PaymentStatus } from '../dtos/enum/PaymentStatus';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('payments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('reservation_id').notNullable();
    table.string('booking_confirmation_id').unique();
    table
      .enum('payment_status', [
        PaymentStatus.PENDING,
        PaymentStatus.COMPLETED,
        PaymentStatus.FAILED,
        PaymentStatus.CANCELLED,
        PaymentStatus.REFUNDED,
      ])
      .defaultTo(PaymentStatus.PENDING);
    table.string('payment_link').notNullable();
    table.string('payment_link_id').notNullable();
    table.string('amount_charged').notNullable();
    table.string('currency').notNullable();
    table.timestamp('created_at', { useTz: false }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: false }).defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('payments');
}
