import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotels', (table) => {
    table.timestamp('created_at').notNullable().alter();
    table.timestamp('updated_at').notNullable().alter();
    table.string('address').notNullable().alter();
    table.string('image_url').notNullable().alter();
    table.string('url').notNullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotels', (table) => {
    table.timestamp('created_at').nullable().alter();
    table.timestamp('updated_at').nullable().alter();
    table.string('address').nullable().alter();
    table.string('image_url').nullable().alter();
    table.string('url').nullable().alter();
  });
}
