import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // First, add the column without a default
  await knex.schema.alterTable('hotels', (table) => {
    table.string('internal_phone_number');
  });

  // Then, set existing rows to use the sms_number value
  await knex.raw(`
    UPDATE hotels 
    SET internal_phone_number = sms_number 
    WHERE internal_phone_number IS NULL
  `);

  // Finally, make it non-nullable
  await knex.schema.alterTable('hotels', (table) => {
    table.string('internal_phone_number').notNullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotels', (table) => {
    table.dropColumn('internal_phone_number');
  });
}
