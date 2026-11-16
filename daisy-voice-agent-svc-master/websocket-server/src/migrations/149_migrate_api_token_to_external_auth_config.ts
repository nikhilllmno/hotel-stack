import { Knex } from 'knex';

/**
 * Copies every hotel's existing (already AES-256-GCM encrypted) `api_token`
 * into the new `external_auth_config.apiToken` — no decrypt/re-encrypt needed,
 * since both columns use the same encryption scheme. Covers every current
 * `api_token` consumer (Stayntouch, Mews) in one pass, since neither is
 * distinguishable from the column alone — `hotels.pms_provider` isn't needed
 * here, we just move whatever is already there.
 *
 * Skips rows that already have a `external_auth_config` (e.g. Cloudbeds hotels
 * migrated by 148) so this never clobbers data that isn't `api_token`-sourced.
 */
export async function up(knex: Knex): Promise<void> {
  const rows = await knex('hotel_configurations')
    .whereNull('deleted_at')
    .whereNotNull('api_token')
    .whereNull('external_auth_config')
    .select('hotel_id', 'api_token');

  if (rows.length === 0) {
    return;
  }

  await knex.transaction(async (trx) => {
    for (const row of rows) {
      await trx('hotel_configurations')
        .where({ hotel_id: row.hotel_id })
        .whereNull('deleted_at')
        .whereNull('external_auth_config')
        .update({
          external_auth_config: JSON.stringify({
            apiToken: row.api_token,
            disabledAt: null,
          }),
          updated_at: trx.fn.now(),
        });
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex('hotel_configurations')
    .whereNull('deleted_at')
    .whereNotNull('api_token')
    .whereNotNull('external_auth_config')
    .update({
      external_auth_config: null,
      updated_at: knex.fn.now(),
    });
}
