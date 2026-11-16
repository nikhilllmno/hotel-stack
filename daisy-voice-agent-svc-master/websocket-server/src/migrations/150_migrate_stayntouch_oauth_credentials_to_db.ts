import { Knex } from 'knex';
import { encrypt } from '../utils/encryption';

interface StayntouchHotelCredentials {
  client_id: string;
  client_secret: string;
}

function parseHotelStayntouchConfig(): Record<
  string,
  StayntouchHotelCredentials
> {
  try {
    const parsed = JSON.parse(
      process.env.HOTEL_STAYNTOUCH_CONFIG || '{}',
    ) as Record<string, unknown>;

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, StayntouchHotelCredentials] => {
          const val = entry[1];
          return (
            val != null &&
            typeof val === 'object' &&
            typeof (val as StayntouchHotelCredentials).client_id === 'string' &&
            (val as StayntouchHotelCredentials).client_id.trim() !== '' &&
            typeof (val as StayntouchHotelCredentials).client_secret ===
              'string' &&
            (val as StayntouchHotelCredentials).client_secret.trim() !== ''
          );
        },
      ),
    );
  } catch {
    return {};
  }
}

export async function up(knex: Knex): Promise<void> {
  const stayntouchConfig = parseHotelStayntouchConfig();
  const hotelIds = Object.keys(stayntouchConfig);

  if (hotelIds.length === 0) {
    return;
  }

  await knex.transaction(async (trx) => {
    const skippedHotelIds: string[] = [];

    for (const hotelId of hotelIds) {
      const { client_id, client_secret } = stayntouchConfig[hotelId];

      const row = await trx('hotel_configurations')
        .where({ hotel_id: hotelId })
        .whereNull('deleted_at')
        .forUpdate()
        .first('external_auth_config');

      if (!row) {
        skippedHotelIds.push(hotelId);
        continue;
      }

      const existing =
        row.external_auth_config != null
          ? typeof row.external_auth_config === 'string'
            ? JSON.parse(row.external_auth_config)
            : row.external_auth_config
          : {};

      const merged = {
        ...existing,
        oauth_client_id: encrypt(client_id),
        oauth_client_secret: encrypt(client_secret),
      };

      await trx('hotel_configurations')
        .where({ hotel_id: hotelId })
        .whereNull('deleted_at')
        .update({
          external_auth_config: JSON.stringify(merged),
          updated_at: trx.fn.now(),
        });
    }

    if (skippedHotelIds.length > 0) {
      console.warn(
        `Stayntouch OAuth migration: skipped ${skippedHotelIds.length} hotel(s) (no matching hotel_configurations row): ${skippedHotelIds.join(', ')}`,
      );
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  const hotelIds = Object.keys(parseHotelStayntouchConfig());

  if (hotelIds.length === 0) {
    return;
  }

  await knex.transaction(async (trx) => {
    for (const hotelId of hotelIds) {
      const row = await trx('hotel_configurations')
        .where({ hotel_id: hotelId })
        .whereNull('deleted_at')
        .forUpdate()
        .first('external_auth_config');

      if (!row?.external_auth_config) continue;

      const existing =
        typeof row.external_auth_config === 'string'
          ? JSON.parse(row.external_auth_config)
          : row.external_auth_config;

      delete existing.oauth_client_id;
      delete existing.oauth_client_secret;

      await trx('hotel_configurations')
        .where({ hotel_id: hotelId })
        .whereNull('deleted_at')
        .update({
          external_auth_config: JSON.stringify(existing),
          updated_at: trx.fn.now(),
        });
    }
  });
}
