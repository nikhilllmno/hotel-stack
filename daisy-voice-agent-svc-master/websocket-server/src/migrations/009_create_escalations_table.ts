import { Knex } from 'knex';
import { EscalationStatus } from '../dtos/enum/EscalationStatus';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('escalations', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('phone_number').notNullable();
    table.text('message').notNullable();
    table.string('hotel_id').notNullable();
    table.string('status').defaultTo(EscalationStatus.OPEN);
    table.timestamp('created_at', { useTz: false }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: false }).defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('escalations');
}
