import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reservations', (table) => {
    table
      .jsonb('auto_charge')
      .nullable()
      .comment(
        'Stores auto charge configuration with is_enabled flag and finalizes_at timestamp',
      );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('reservations', (table) => {
    table.dropColumn('auto_charge');
  });
}
