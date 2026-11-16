import { Knex } from 'knex';
import { encrypt } from '../utils/encryption';

function parseHotelCloudbedsConfig(): Record<string, string> {
  try {
    const parsed = JSON.parse(
      process.env.HOTEL_CLOUDBEDS_CONFIG || '{}',
    ) as Record<string, unknown>;

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}

export async function up(knex: Knex): Promise<void> {
  const cloudbedsConfig = parseHotelCloudbedsConfig();
  const hotelIds = Object.keys(cloudbedsConfig);

  if (hotelIds.length === 0) {
    return;
  }

  await knex.transaction(async (trx) => {
    const notFoundHotelIds: string[] = [];

    for (const hotelId of hotelIds) {
      const updatedCount = await trx('hotel_configurations')
        .where({ hotel_id: hotelId })
        .whereNull('deleted_at')
        .whereNull('external_auth_config')
        .update({
          external_auth_config: JSON.stringify({
            apiToken: encrypt(cloudbedsConfig[hotelId]),
            disabledAt: null,
          }),
          updated_at: trx.fn.now(),
        });

      if (updatedCount === 0) {
        notFoundHotelIds.push(hotelId);
      }
    }

    if (notFoundHotelIds.length > 0) {
      console.warn(
        `Cloudbeds auth config migration: skipped ${notFoundHotelIds.length} hotel(s) (no matching hotel_configurations row, or external_auth_config already set): ${notFoundHotelIds.join(', ')}`,
      );
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  const hotelIds = Object.keys(parseHotelCloudbedsConfig());

  if (hotelIds.length === 0) {
    return;
  }

  await knex('hotel_configurations')
    .whereIn('hotel_id', hotelIds)
    .whereNull('deleted_at')
    .update({
      external_auth_config: null,
      updated_at: knex.fn.now(),
    });
}
