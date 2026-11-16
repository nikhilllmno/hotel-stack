import { Knex } from 'knex';

function parseConnectedAccountIdConfig(): Record<string, string> {
  try {
    const parsed = JSON.parse(
      process.env.HOTEL_STRIPE_CONNECTED_ACCOUNT_ID_CONFIG || '{}',
    ) as Record<string, unknown>;

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && entry[1] !== '',
      ),
    );
  } catch {
    return {};
  }
}

export async function up(knex: Knex): Promise<void> {
  const accountConfig = parseConnectedAccountIdConfig();
  const hotelIds = Object.keys(accountConfig);

  if (hotelIds.length === 0) {
    return;
  }

  await knex.transaction(async (trx) => {
    const notFoundIds: string[] = [];

    for (const hotelId of hotelIds) {
      const updatedCount = await trx('hotel_configurations')
        .where({ hotel_id: hotelId })
        .whereNull('deleted_at')
        .update({
          payment_account_id: accountConfig[hotelId],
          updated_at: trx.fn.now(),
        });

      if (updatedCount === 0) {
        notFoundIds.push(hotelId);
      }
    }

    if (notFoundIds.length > 0) {
      console.warn(
        `Payment account ID migration: skipped ${notFoundIds.length} hotel(s) (no matching non-deleted row): ${notFoundIds.join(', ')}`,
      );
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  const hotelIds = Object.keys(parseConnectedAccountIdConfig());

  if (hotelIds.length === 0) {
    return;
  }

  await knex('hotel_configurations')
    .whereIn('hotel_id', hotelIds)
    .whereNull('deleted_at')
    .update({
      payment_account_id: null,
      updated_at: knex.fn.now(),
    });
}
