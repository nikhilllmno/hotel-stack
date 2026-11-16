import { Knex } from 'knex';
import { UserRole } from '../models/User';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(
    `CREATE TYPE user_role AS ENUM ('superadmin', 'admin', 'user')`,
  );

  await knex.schema.createTable('user', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('username').notNullable().unique();
    table.string('password').notNullable();
    table
      .enum('role', [UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.USER])
      .defaultTo(UserRole.NO_ACCESS);
    table.uuid('hotel_id').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('deleted_at').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('user');
  await knex.schema.raw('DROP TYPE user_role');
}
