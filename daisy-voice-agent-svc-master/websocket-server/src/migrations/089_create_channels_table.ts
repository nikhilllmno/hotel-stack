import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Step 1: Create channels table
  await knex.schema.createTable('channels', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('hotel_id').notNullable().references('id').inTable('hotels');
    table
      .string('check_in_group_id')
      .nullable()
      .comment('Group for check-in notifications');
    table.string('alerts_group_id').nullable().comment('Group for alerts');
    table
      .string('transcript_group_id')
      .nullable()
      .comment('Group for transcripts');
    table.string('type').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.timestamp('deleted_at').nullable();

    // Add unique index on hotel_id
    table.unique(['hotel_id']);
  });

  // Step 2: Migrate data from hotels table to channels table
  // Get all hotels with telegram group IDs
  const hotels = await knex('hotels').select(
    'id',
    'telegram_check_in_group_id',
    'telegram_alerts_group_id',
    'telegram_transcript_group_id',
  );

  // Insert channel records for each hotel
  const channelRecords = hotels.map((hotel) => ({
    hotel_id: hotel.id,
    check_in_group_id: hotel.telegram_check_in_group_id,
    alerts_group_id: hotel.telegram_alerts_group_id,
    transcript_group_id: hotel.telegram_transcript_group_id,
    type: 'telegram',
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  }));

  if (channelRecords.length > 0) {
    await knex('channels').insert(channelRecords);
  }
}

export async function down(knex: Knex): Promise<void> {
  // Step 1: Migrate data back from channels to hotels
  const channels = await knex('channels')
    .select(
      'hotel_id',
      'check_in_group_id',
      'alerts_group_id',
      'transcript_group_id',
    )
    .where({ type: 'telegram' })
    .whereNull('deleted_at');

  for (const channel of channels) {
    await knex('hotels').where({ id: channel.hotel_id }).update({
      telegram_check_in_group_id: channel.check_in_group_id,
      telegram_alerts_group_id: channel.alerts_group_id,
      telegram_transcript_group_id: channel.transcript_group_id,
    });
  }

  // Step 2: Drop channels table
  await knex.schema.dropTableIfExists('channels');
}
