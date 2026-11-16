import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('conversations', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('call_session_id').notNullable();
    table.string('phone_number').notNullable();
    table.timestamp('started_at').notNullable();
    table.timestamp('ended_at').notNullable();
    table.float('cost').notNullable();
    table.json('cost_details').notNullable();
    table.string('recording_url');
    table.text('summary');
    table.json('call_metadata').notNullable();
    table.timestamp('created_at', { useTz: false }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: false }).defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('conversations');
}
