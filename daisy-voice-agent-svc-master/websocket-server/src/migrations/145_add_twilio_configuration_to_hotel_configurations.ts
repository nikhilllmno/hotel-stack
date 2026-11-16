import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotel_configurations', (table) => {
    table
      .text('twilio_configuration')
      .nullable()
      .comment(
        'AES-256-GCM encrypted Twilio credentials — format: iv:authTag:ciphertext (hex)',
      );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('hotel_configurations', (table) => {
    table.dropColumn('twilio_configuration');
  });
}
