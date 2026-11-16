import { Knex } from 'knex';
import { PetPolicyConfiguration } from '../types/hotelConfiguration';

/**
 * Pet-friendly unit group IDs for Cave Springs (business_id: 18616).
 * Identified by "(pet friendly)" or "(Pet Friendly)" in the ResNexus unit group name:
 *   13525 - Hotel room 1 (pet friendly)
 *   13531 - Hotel room 2 (pet friendly)
 *   13537 - Hotel room 9 (Pet friendly)
 *   13538 - Hotel room 10 (Pet friendly)
 *   13684 - Modern Cabin (Banyan) with Private Hot Tub (Pet friendly)
 *   13685 - Modern Cabin (Blue Spruce) with Private Hot Tub (Pet friendly)
 *   13687 - Modern Cabin (Elm) Pet Friendly
 *   13690 - Modern Cabin (Oak) with Private Hot Tub (Pet Friendly)
 *   13698 - Tiny Home (Beech) with Private Hot Tub (Pet Friendly)
 *   13703 - Tiny Home (Koa) (Pet Friendly)
 */
const CAVE_SPRINGS_PET_POLICY: PetPolicyConfiguration = {
  pet_friendly_unit_group_ids: [
    13525, 13531, 13537, 13538, 13684, 13685, 13687, 13690, 13698, 13703,
  ],
};

export async function up(knex: Knex): Promise<void> {
  const hotelId = process.env.CAVE_SPRINGS_ID;

  if (!hotelId) {
    console.warn(
      '134_seed_cave_springs_pet_policy: CAVE_SPRINGS_ID env var not set, skipping seed',
    );
    return;
  }

  const updatedCount = await knex('hotel_configurations')
    .where({ hotel_id: hotelId })
    .whereNull('deleted_at')
    .update({
      pet_policy_configuration: JSON.stringify(CAVE_SPRINGS_PET_POLICY),
      updated_at: knex.fn.now(),
    });

  if (updatedCount === 0) {
    console.warn(
      `134_seed_cave_springs_pet_policy: No hotel_configurations row found for hotel_id ${hotelId}, skipping`,
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  const hotelId = process.env.CAVE_SPRINGS_ID;

  if (!hotelId) return;

  await knex('hotel_configurations')
    .where({ hotel_id: hotelId })
    .whereNull('deleted_at')
    .update({
      pet_policy_configuration: null,
      updated_at: knex.fn.now(),
    });
}
