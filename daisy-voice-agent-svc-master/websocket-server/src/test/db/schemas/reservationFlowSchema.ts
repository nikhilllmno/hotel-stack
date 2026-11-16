import { Knex } from 'knex';

function uuidPrimary(table: Knex.CreateTableBuilder, knex: Knex): void {
  table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
}

export async function applyReservationFlowSchema(knex: Knex): Promise<void> {
  await knex.schema.createTable('hotels', (table) => {
    uuidPrimary(table, knex);
    table.string('name').notNullable();
    table.bigInteger('business_id').notNullable();
    table.string('pms_provider');
    table.string('payment_provider');
    table.string('telegram_check_in_group_id');
    table.string('telegram_alerts_group_id');
    table.string('timezone');
    table.string('assistant_phone_number');
    table.string('country');
    table.string('url');
    table.string('sms_number');
    table.string('internal_phone_number');
    table.text('address');
    table.string('image_url');
    table.string('currency');
    table.string('telegram_transcript_group_id');
    table.string('notification_type').notNullable().defaultTo('telegram');
    table.timestamp('created_at', { useTz: false });
    table.timestamp('updated_at', { useTz: false });
    table.timestamp('deleted_at', { useTz: false });
  });

  await knex.schema.createTable('customers', (table) => {
    uuidPrimary(table, knex);
    table.uuid('hotel_id').notNullable();
    table.string('first_name');
    table.string('last_name');
    table.string('phone_number');
    table.string('email');
    table.string('payment_provider_customer_id');
    table.text('signature');
    table.text('device_details');
    table.text('card_metadata');
    table.timestamp('created_at', { useTz: false });
    table.timestamp('updated_at', { useTz: false });
  });

  await knex.schema.createTable('reservations', (table) => {
    uuidPrimary(table, knex);
    table.bigInteger('business_id').notNullable();
    table.uuid('hotel_id').notNullable();
    table.string('booking_id').notNullable();
    table.string('status').notNullable();
    table.string('previous_status');
    table.string('payment_status');
    table.date('check_in').notNullable();
    table.date('check_out').notNullable();
    table.integer('room_id');
    table.string('room_type');
    table.integer('num_adults').notNullable();
    table.integer('num_children').notNullable();
    table.integer('num_pets');
    table.uuid('customer_id').notNullable();
    table.string('phone_number').notNullable();
    table.string('pms_provider');
    table.text('notes_from_partner');
    table.text('customer_special_request');
    table.uuid('session_id');
    table.string('external_id');
    table.string('external_public_id');
    table.string('type');
    table.text('auto_charge');
    table.boolean('onboarding_sms_sent');
    table.string('rate_code');
    table.string('source').notNullable();
    table.timestamp('pms_booking_claimed_at', { useTz: false });
    table.timestamp('created_at', { useTz: false });
    table.timestamp('updated_at', { useTz: false });
  });

  await knex.schema.createTable('payments', (table) => {
    uuidPrimary(table, knex);
    table.uuid('hotel_id');
    table.string('booking_confirmation_id');
    table.string('payment_status');
    table.string('payment_link');
    table.string('payment_link_id');
    table.string('amount_charged');
    table.string('currency');
    table.integer('notification_count');
    table.string('payment_provider');
    table.string('amount_refunded');
    table.text('metadata');
    table.boolean('payment_link_disabled');
    table.timestamp('created_at', { useTz: false });
    table.timestamp('updated_at', { useTz: false });
  });

  await knex.schema.createTable('payment_reservations', (table) => {
    uuidPrimary(table, knex);
    table.uuid('payment_id').notNullable();
    table.uuid('reservation_id').notNullable();
    table.timestamp('created_at', { useTz: false });
    table.timestamp('updated_at', { useTz: false });
  });

  await knex.schema.createTable('hotel_configurations', (table) => {
    uuidPrimary(table, knex);
    table.uuid('hotel_id');
    table.text('last_daily_message');
    table.text('discount_settings');
    table.text('cancellation_policy');
    table.text('platform_fee_settings');
    table.boolean('sms_agent_enabled');
    table.boolean('enable_manager_barge_in');
    table.integer('manager_routing_timeout_seconds');
    table.text('payment_configuration');
    table.text('same_day_booking_configuration');
    table.text('onboarding_sms_configuration');
    table.text('terms_and_policy_config');
    table.text('check_in_check_out_configuration');
    table.boolean('negative_sentiment_followup_enabled');
    table.string('processing_fee_percentage');
    table.text('transcript_agent_url');
    table.text('escalation_agent_url');
    table.jsonb('addon_modification_allowlist');
    table.text('pet_policy_configuration');
    table.jsonb('followup_payment_link_configuration');
    table.text('twilio_configuration');
    table.text('payment_account_id');
    table.jsonb('threeDS_config');
    table.jsonb('door_lock_config');
    table.jsonb('cross_sell_configuration');
    table.jsonb('external_auth_config');
    table.jsonb('escalation_report_configuration');
    table.timestamp('created_at', { useTz: false });
    table.timestamp('updated_at', { useTz: false });
    table.timestamp('deleted_at', { useTz: false });
  });

  await knex.schema.createTable('channels', (table) => {
    uuidPrimary(table, knex);
    table.uuid('hotel_id');
    table.string('check_in_group_id');
    table.string('alerts_group_id');
    table.string('transcript_group_id');
    table.string('type');
    table.timestamp('created_at', { useTz: false });
    table.timestamp('updated_at', { useTz: false });
    table.timestamp('deleted_at', { useTz: false });
  });

  await knex.schema.createTable('address', (table) => {
    uuidPrimary(table, knex);
    table.uuid('customer_id');
    table.string('state_or_province');
    table.string('postal_code');
    table.string('country');
    table.string('address_first_line');
    table.string('city');
    table.string('address_type');
    table.timestamp('created_at', { useTz: false });
    table.timestamp('updated_at', { useTz: false });
  });

  await knex.schema.createTable('quotes', (table) => {
    uuidPrimary(table, knex);
    table.uuid('reservation_id');
    table.float('base_rate');
    table.float('taxes');
    table.float('fees');
    table.float('amount_charged');
    table.text('quote_object');
    table.text('platform_pricing');
    table.timestamp('created_at', { useTz: false });
    table.timestamp('updated_at', { useTz: false });
  });

  await knex.schema.createTable('discount', (table) => {
    uuidPrimary(table, knex);
    table.string('phone_number');
    table.uuid('reservation_id');
    table.string('value');
    table.string('type');
    table.uuid('hotel_id');
    table.integer('expiry_days');
    table.text('note');
    table.timestamp('created_at', { useTz: false });
    table.timestamp('updated_at', { useTz: false });
  });

  await knex.schema.createTable('booking_reviews', (table) => {
    uuidPrimary(table, knex);
    table.string('reservation_review_id', 64).notNullable().unique();
    table.string('booking_id', 32).notNullable();
    table.uuid('hotel_id').notNullable();
    table.timestamp('created_at', { useTz: false });
  });

  await knex.schema.createTable('escalations', (table) => {
    uuidPrimary(table, knex);
    table.string('phone_number').notNullable();
    table.string('full_name');
    table.text('message').notNullable();
    table.uuid('hotel_id').notNullable();
    table.uuid('session_id');
    table.string('status').defaultTo('OPEN');
    table.string('external_message_id');
    table.integer('reminder_count');
    table.timestamp('created_at', { useTz: false });
    table.timestamp('updated_at', { useTz: false });
  });

  await knex.schema.createTable('teams_conversation_references', (table) => {
    table.string('channel_id').primary();
    table.string('tenant_id').notNullable();
    table.text('service_url').notNullable();
    table.string('team_id').nullable();
    table.string('bot_id').notNullable();
    table.timestamp('created_at', { useTz: false });
    table.timestamp('updated_at', { useTz: false });
  });

  await knex.schema.createTable('chat_outbound_messages', (table) => {
    uuidPrimary(table, knex);
    table.string('provider').notNullable();
    table.string('channel_id').notNullable();
    table.string('message_id').notNullable();
    table.text('text').notNullable();
    table.timestamp('created_at', { useTz: false });
    table.unique(['provider', 'channel_id', 'message_id']);
  });
}
