import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(
    `CREATE TYPE discount_type AS ENUM ('flat', 'percentage')`,
  );

  await knex.schema.createTable('discount', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('phone_number').notNullable();
    table.decimal('value', 10, 2).notNullable();
    table.enum('type', ['flat', 'percentage']).notNullable();
    table.string('hotel_id').notNullable();
    table.timestamp('expiry_date').notNullable();
    table.string('reservation_id').nullable().unique();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('discount');
  await knex.schema.raw('DROP TYPE discount_type');
}
