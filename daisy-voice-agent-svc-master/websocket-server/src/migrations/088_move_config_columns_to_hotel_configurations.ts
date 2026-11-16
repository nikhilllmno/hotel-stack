import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Step 1: Add new columns to hotel_configurations table
  await knex.schema.alterTable('hotel_configurations', (table) => {
    table.json('last_daily_message').nullable();
    table.json('discount_settings').nullable();
    table.json('cancellation_policy').nullable();
    table.jsonb('platform_fee_settings').nullable();
    table.boolean('sms_agent_enabled').defaultTo(false).notNullable();
  });

  // Step 2: Migrate data from hotels to hotel_configurations
  // For each hotel, update or create a hotel_configuration record
  const hotels = await knex('hotels').select(
    'id',
    'last_daily_message',
    'discount_settings',
    'cancellation_policy',
    'platform_fee_settings',
    'sms_agent_enabled',
  );

  for (const hotel of hotels) {
    // Check if hotel_configuration exists for this hotel
    const existingConfig = await knex('hotel_configurations')
      .where({ hotel_id: hotel.id })
      .whereNull('deleted_at')
      .first();

    if (existingConfig) {
      // Update existing configuration
      await knex('hotel_configurations')
        .where({ id: existingConfig.id })
        .update({
          last_daily_message: hotel.last_daily_message,
          discount_settings: hotel.discount_settings,
          cancellation_policy: hotel.cancellation_policy,
          platform_fee_settings: hotel.platform_fee_settings,
          sms_agent_enabled: hotel.sms_agent_enabled,
          updated_at: knex.fn.now(),
        });
    } else {
      // Create new configuration
      await knex('hotel_configurations').insert({
        hotel_id: hotel.id,
        last_daily_message: hotel.last_daily_message,
        discount_settings: hotel.discount_settings,
        cancellation_policy: hotel.cancellation_policy,
        platform_fee_settings: hotel.platform_fee_settings,
        sms_agent_enabled: hotel.sms_agent_enabled,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  // Step 1: Migrate data back from hotel_configurations to hotels
  const configs = await knex('hotel_configurations')
    .select(
      'hotel_id',
      'last_daily_message',
      'discount_settings',
      'cancellation_policy',
      'platform_fee_settings',
      'sms_agent_enabled',
    )
    .whereNull('deleted_at');

  for (const config of configs) {
    await knex('hotels').where({ id: config.hotel_id }).update({
      last_daily_message: config.last_daily_message,
      discount_settings: config.discount_settings,
      cancellation_policy: config.cancellation_policy,
      platform_fee_settings: config.platform_fee_settings,
      sms_agent_enabled: config.sms_agent_enabled,
    });
  }

  // Step 2: Drop columns from hotel_configurations table
  await knex.schema.alterTable('hotel_configurations', (table) => {
    table.dropColumn('last_daily_message');
    table.dropColumn('discount_settings');
    table.dropColumn('cancellation_policy');
    table.dropColumn('platform_fee_settings');
    table.dropColumn('sms_agent_enabled');
  });
}
