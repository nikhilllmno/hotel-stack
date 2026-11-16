import { Knex } from 'knex';
import { encrypt } from '../utils/encryption';

interface TwilioConfigEntry {
  twilioAccountSid: string;
  twilioAuthToken: string;
}

function parseHotelTwilioConfig(): Record<string, TwilioConfigEntry> {
  try {
    const parsed = JSON.parse(
      process.env.HOTEL_TWILIO_CONFIG || '{}',
    ) as Record<string, unknown>;

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, TwilioConfigEntry] => {
          const val = entry[1];
          return (
            typeof val === 'object' &&
            val !== null &&
            typeof (val as TwilioConfigEntry).twilioAccountSid === 'string' &&
            typeof (val as TwilioConfigEntry).twilioAuthToken === 'string'
          );
        },
      ),
    );
  } catch {
    return {};
  }
}

export async function up(knex: Knex): Promise<void> {
  const twilioConfig = parseHotelTwilioConfig();
  const smsNumbers = Object.keys(twilioConfig);

  if (smsNumbers.length === 0) {
    return;
  }

  await knex.transaction(async (trx) => {
    const notFoundNumbers: string[] = [];

    for (const smsNumber of smsNumbers) {
      const hotel = await trx('hotels')
        .where({ sms_number: smsNumber })
        .first('id');

      if (!hotel) {
        notFoundNumbers.push(smsNumber);
        continue;
      }

      const updatedCount = await trx('hotel_configurations')
        .where({ hotel_id: hotel.id })
        .whereNull('deleted_at')
        .update({
          twilio_configuration: encrypt(
            JSON.stringify(twilioConfig[smsNumber]),
          ),
          updated_at: trx.fn.now(),
        });

      if (updatedCount === 0) {
        notFoundNumbers.push(smsNumber);
      }
    }

    if (notFoundNumbers.length > 0) {
      console.warn(
        `Twilio configuration migration: skipped ${notFoundNumbers.length} number(s) (no matching hotel or config row): ${notFoundNumbers.join(', ')}`,
      );
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  const smsNumbers = Object.keys(parseHotelTwilioConfig());

  if (smsNumbers.length === 0) {
    return;
  }

  const hotelIds = await knex('hotels')
    .whereIn('sms_number', smsNumbers)
    .pluck('id');

  if (hotelIds.length === 0) {
    return;
  }

  await knex('hotel_configurations')
    .whereIn('hotel_id', hotelIds)
    .whereNull('deleted_at')
    .update({
      twilio_configuration: null,
      updated_at: knex.fn.now(),
    });
}
