import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable(
    'hotel_daily_guest_telegram_messages',
    (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

      table.uuid('hotel_id').notNullable();
      table.string('chat_id').notNullable();
      table.integer('message_id').notNullable();
      table.timestamp('date').notNullable();

      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.timestamp('deleted_at').nullable();
    },
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('hotel_daily_guest_telegram_messages');
}
