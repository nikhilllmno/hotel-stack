import { Knex } from 'knex';

/**
 * Migrates `force_full_payment` and `skip_initial_deposit` out of
 * `payment_configuration` and into `initial_deposit_policy`.
 *
 * up:
 *   - For every hotel_configuration where payment_configuration contains
 *     `force_full_payment: true` and initial_deposit_policy is not yet set,
 *     create a PERCENTAGE 100 deposit policy (all nights, single tier).
 *   - Strip `force_full_payment` and `skip_initial_deposit` keys from
 *     payment_configuration for all rows.
 *
 * down:
 *   - Restore `force_full_payment: true` on payment_configuration for rows
 *     whose initial_deposit_policy is a single PERCENTAGE 100 tier.
 *   - Clear initial_deposit_policy for those rows.
 */

const FULL_PAYMENT_POLICY = {
  enabled: true,
  tiers: [
    {
      min_nights: 1,
      max_nights: null,
      deposit_type: 'percentage',
      value: 100,
    },
  ],
};

export async function up(knex: Knex): Promise<void> {
  const rows = await knex('hotel_configurations')
    .whereNull('deleted_at')
    .select('id', 'payment_configuration', 'initial_deposit_policy');

  for (const row of rows) {
    const paymentConfig =
      typeof row.payment_configuration === 'string'
        ? JSON.parse(row.payment_configuration)
        : (row.payment_configuration ?? {});

    const hasForceFullPayment = paymentConfig.force_full_payment === true;
    const hasDepositPolicy =
      row.initial_deposit_policy != null &&
      row.initial_deposit_policy !== 'null';

    // Strip deprecated keys
    const { force_full_payment, skip_initial_deposit, ...cleanedConfig } =
      paymentConfig;

    const updates: Record<string, unknown> = {
      payment_configuration: JSON.stringify(cleanedConfig),
      updated_at: knex.fn.now(),
    };

    // Migrate force_full_payment -> PERCENTAGE 100 deposit policy only when
    // no policy is already configured (don't overwrite intentional settings).
    if (hasForceFullPayment && !hasDepositPolicy) {
      updates.initial_deposit_policy = JSON.stringify(FULL_PAYMENT_POLICY);
    }

    await knex('hotel_configurations').where({ id: row.id }).update(updates);
  }
}

export async function down(knex: Knex): Promise<void> {
  const rows = await knex('hotel_configurations')
    .whereNull('deleted_at')
    .whereNotNull('initial_deposit_policy')
    .select('id', 'payment_configuration', 'initial_deposit_policy');

  for (const row of rows) {
    const policy =
      typeof row.initial_deposit_policy === 'string'
        ? JSON.parse(row.initial_deposit_policy)
        : row.initial_deposit_policy;

    const paymentConfig =
      typeof row.payment_configuration === 'string'
        ? JSON.parse(row.payment_configuration)
        : (row.payment_configuration ?? {});

    // Only restore force_full_payment for the exact pattern we created in up():
    // a single enabled PERCENTAGE 100 tier.
    const isFullPaymentPolicy =
      policy?.enabled === true &&
      Array.isArray(policy?.tiers) &&
      policy.tiers.length === 1 &&
      policy.tiers[0].deposit_type === 'percentage' &&
      policy.tiers[0].value === 100;

    if (!isFullPaymentPolicy) {
      continue;
    }

    await knex('hotel_configurations')
      .where({ id: row.id })
      .update({
        payment_configuration: JSON.stringify({
          ...paymentConfig,
          force_full_payment: true,
        }),
        initial_deposit_policy: null,
        updated_at: knex.fn.now(),
      });
  }
}
