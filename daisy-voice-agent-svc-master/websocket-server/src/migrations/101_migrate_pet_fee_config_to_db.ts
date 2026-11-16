import { Knex } from 'knex';
import { PetFeeConfiguration } from '../types/hotelConfiguration';
import { PetFeeStrategyType } from '../types/petFeeStrategy';

interface HotelPetFeeConfig {
  hotel_id: string | undefined;
  pet_fee_configuration: PetFeeConfiguration;
}

function parseLosRiosDiscountedUnitGroupIds(): number[] {
  const raw =
    process.env.LOS_RIOS_DISCOUNTED_UNIT_GROUP_IDS ??
    '18150,18151,18152,18153,18154,18155,18156,18157,18158,18159,18160,18161,18162,18163';

  return raw
    .split(',')
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !Number.isNaN(id));
}

export async function up(knex: Knex): Promise<void> {
  const hotelConfigs: HotelPetFeeConfig[] = [
    {
      hotel_id: process.env.CAVE_SPRINGS_ID,
      pet_fee_configuration: {
        strategy: PetFeeStrategyType.PerNightPerPet,
        fee_amount: parseFloat(
          process.env.CAVE_SPRINGS_PET_FEE_PER_NIGHT || '25',
        ),
        max_pets_per_room: parseInt(
          process.env.CAVE_SPRINGS_PER_ROOM_PET_CAPACITY || '2',
          10,
        ),
      },
    },
    {
      hotel_id:
        process.env.SPRINGS_MOTEL_ID || '2d7758d4-57f8-4ffe-aaa1-16f85ef09df4',
      pet_fee_configuration: {
        strategy: PetFeeStrategyType.FlatFee,
        fee_amount: parseFloat(process.env.SPRINGS_MOTEL_FLAT_FEE || '50'),
      },
    },
    {
      hotel_id: process.env.ASHLEY_ROSE_ID,
      pet_fee_configuration: {
        strategy: PetFeeStrategyType.FlatFee,
        fee_amount: parseFloat(process.env.ASHLEY_ROSE_FLAT_FEE || '150'),
        max_pets_per_room: parseInt(
          process.env.ASHLEY_ROSE_PER_ROOM_PET_CAPACITY || '2',
          10,
        ),
      },
    },
    {
      hotel_id:
        process.env.LOS_RIOS_ID || '8b1c2997-59c0-4855-82de-9315b285e6a1',
      pet_fee_configuration: {
        strategy: PetFeeStrategyType.PerNightPerPetWithDiscountedUnits,
        fee_amount: parseFloat(process.env.LOS_RIOS_PET_FEE_PER_NIGHT || '15'),
        discounted_fee_amount: parseFloat(
          process.env.LOS_RIOS_DISCOUNTED_PET_FEE_PER_NIGHT || '0',
        ),
        max_pets_per_room: parseInt(
          process.env.LOS_RIOS_PER_ROOM_PET_CAPACITY || '2',
          10,
        ),
        discounted_unit_group_ids: parseLosRiosDiscountedUnitGroupIds(),
      },
    },
  ];

  // Filter out hotels where hotel_id is undefined or null
  const validConfigs = hotelConfigs.filter(
    (config): config is HotelPetFeeConfig & { hotel_id: string } =>
      config.hotel_id != null && config.hotel_id !== '',
  );

  await knex.transaction(async (trx) => {
    const notFoundIds: string[] = [];

    for (const config of validConfigs) {
      const updatedCount = await trx('hotel_configurations')
        .where({ hotel_id: config.hotel_id })
        .whereNull('deleted_at')
        .update({
          pet_fee_configuration: JSON.stringify(config.pet_fee_configuration),
          updated_at: trx.fn.now(),
        });

      if (updatedCount === 0) {
        notFoundIds.push(config.hotel_id);
      }
    }

    // Allow partial updates: dev/local DBs may not have all hotels seeded
    if (notFoundIds.length > 0) {
      console.warn(
        `Pet fee config migration: skipped ${notFoundIds.length} hotel(s) (no matching non-deleted row): ${notFoundIds.join(', ')}`,
      );
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  const hotelIds = [
    process.env.CAVE_SPRINGS_ID,
    process.env.SPRINGS_MOTEL_ID || '2d7758d4-57f8-4ffe-aaa1-16f85ef09df4',
    process.env.ASHLEY_ROSE_ID,
    process.env.LOS_RIOS_ID || '8b1c2997-59c0-4855-82de-9315b285e6a1',
  ].filter((id): id is string => id != null && id !== '');

  await knex('hotel_configurations')
    .whereIn('hotel_id', hotelIds)
    .whereNull('deleted_at')
    .update({
      pet_fee_configuration: null,
      updated_at: knex.fn.now(),
    });
}
