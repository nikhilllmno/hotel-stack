import dayjs from 'dayjs';
import { CalryPetFeeQuote } from '../../calry/types';
import { CloudbedsPetFeeQuote } from '../../cloudbeds/types';
import config from '../../config';
import { BadRequestError } from '../../errors/BadRequestError';
import { GetQuoteResponse as ResnexusQuote } from '../../resNexus/model/response/quote';
import { StayntouchPetFeeQuote } from '../../stayntouch/utils/helper';
import { PetFeeConfiguration } from '../../types/hotelConfiguration';
import { PetFeeStrategyType } from '../../types/petFeeStrategy';
import { roundCurrency } from '../../utils/helper';

/**
 * Pet fee calculation strategy interface
 */
export interface PetFeeStrategy {
  /**
   * Validates if the number of pets is allowed
   * @throws BadRequestError if validation fails
   */
  validatePetCount(numPets: number): void;

  /**
   * Calculates the pet fee for the reservation
   */
  calculatePetFee(
    quote:
      | ResnexusQuote
      | StayntouchPetFeeQuote
      | CloudbedsPetFeeQuote
      | CalryPetFeeQuote,
    numPets: number,
  ): number;
}

/**
 * Cave Springs pet fee strategy: per-night, per-pet calculation
 */
class PerNightPerPetFeeStrategy implements PetFeeStrategy {
  private readonly maxPetsPerRoom?: number;
  private readonly feePerNight: number;

  constructor(feePerNight: number, maxPetsPerRoom?: number) {
    this.maxPetsPerRoom = maxPetsPerRoom;
    this.feePerNight = feePerNight;
  }

  validatePetCount(numPets: number): void {
    if (this.maxPetsPerRoom && numPets > this.maxPetsPerRoom) {
      throw new BadRequestError(
        `Maximum pet capacity of each room is ${this.maxPetsPerRoom}`,
      );
    }
  }

  calculatePetFee(
    quote:
      | ResnexusQuote
      | StayntouchPetFeeQuote
      | CloudbedsPetFeeQuote
      | CalryPetFeeQuote,
    numPets: number,
  ): number {
    if (numPets <= 0) {
      return 0;
    }
    const numNights = dayjs(quote.check_out).diff(dayjs(quote.check_in), 'day');
    return roundCurrency(this.feePerNight * numNights * numPets);
  }
}

/**
 * Per night per room
 */
class PerNightFeeStrategy implements PetFeeStrategy {
  private readonly maxPetsPerRoom?: number;
  private readonly feePerNight: number;

  constructor(feePerNight: number, maxPetsPerRoom?: number) {
    this.maxPetsPerRoom = maxPetsPerRoom;
    this.feePerNight = feePerNight;
  }

  validatePetCount(numPets: number): void {
    if (this.maxPetsPerRoom && numPets > this.maxPetsPerRoom) {
      throw new BadRequestError(
        `Maximum pet capacity of each room is ${this.maxPetsPerRoom}`,
      );
    }
  }

  calculatePetFee(
    quote:
      | ResnexusQuote
      | StayntouchPetFeeQuote
      | CloudbedsPetFeeQuote
      | CalryPetFeeQuote,
    numPets: number,
  ): number {
    if (numPets <= 0) {
      return 0;
    }
    const numNights = dayjs(quote.check_out).diff(dayjs(quote.check_in), 'day');
    return roundCurrency(this.feePerNight * numNights);
  }
}

/**
 * Springs Motel pet fee strategy: flat fee
 */
class FlatFeeStrategy implements PetFeeStrategy {
  private readonly flatFee: number;
  readonly maxPetsPerRoom?: number;

  constructor(flatFee: number, maxPetsPerRoom?: number) {
    this.flatFee = flatFee;
    this.maxPetsPerRoom = maxPetsPerRoom;
  }

  validatePetCount(numPets: number): void {
    if (this.maxPetsPerRoom && numPets > this.maxPetsPerRoom) {
      throw new BadRequestError(
        `Maximum pet capacity of each room is ${this.maxPetsPerRoom}`,
      );
    }
  }

  calculatePetFee(
    _quote:
      | ResnexusQuote
      | StayntouchPetFeeQuote
      | CloudbedsPetFeeQuote
      | CalryPetFeeQuote,
    numPets: number,
  ): number {
    if (numPets <= 0) {
      return 0;
    }
    return this.flatFee;
  }
}

class PerPetFlatFeeStrategy implements PetFeeStrategy {
  private readonly feePerPet: number;
  private readonly maxPetsPerRoom?: number;

  constructor(feePerPet: number, maxPetsPerRoom?: number) {
    this.feePerPet = feePerPet;
    this.maxPetsPerRoom = maxPetsPerRoom;
  }

  validatePetCount(numPets: number): void {
    if (this.maxPetsPerRoom && numPets > this.maxPetsPerRoom) {
      throw new BadRequestError(
        `Maximum pet capacity of each room is ${this.maxPetsPerRoom}`,
      );
    }
  }

  calculatePetFee(
    _quote:
      | ResnexusQuote
      | StayntouchPetFeeQuote
      | CloudbedsPetFeeQuote
      | CalryPetFeeQuote,
    numPets: number,
  ): number {
    if (numPets <= 0) {
      return 0;
    }
    return roundCurrency(this.feePerPet * numPets);
  }
}

class LosRiosPetFeeStrategy implements PetFeeStrategy {
  private readonly feePerNight: number;
  private readonly discountedFeePerNight: number;
  private readonly maxPetsPerRoom?: number;
  private readonly discountedUnitGroupIds?: number[];

  constructor(
    feePerNight: number,
    discountedFeePerNight?: number,
    maxPetsPerRoom?: number,
    discountedUnitGroupIds?: number[],
  ) {
    this.feePerNight = feePerNight;
    this.discountedFeePerNight = discountedFeePerNight ?? feePerNight;
    this.maxPetsPerRoom = maxPetsPerRoom;
    this.discountedUnitGroupIds = discountedUnitGroupIds;
  }

  validatePetCount(numPets: number): void {
    if (this.maxPetsPerRoom && numPets > this.maxPetsPerRoom) {
      throw new BadRequestError(
        `Maximum pet capacity of each room is ${this.maxPetsPerRoom}`,
      );
    }
  }

  calculatePetFee(
    quote:
      | ResnexusQuote
      | StayntouchPetFeeQuote
      | CloudbedsPetFeeQuote
      | CalryPetFeeQuote,
    numPets: number,
  ): number {
    if (numPets <= 0) {
      return 0;
    }
    const numNights = dayjs(quote.check_out).diff(dayjs(quote.check_in), 'day');
    if (
      this.discountedUnitGroupIds &&
      this.discountedUnitGroupIds.length > 0 &&
      this.discountedUnitGroupIds.some(
        (id) => String(id) === String(quote.unit_group_id),
      )
    ) {
      return roundCurrency(
        this.discountedFeePerNight * numNights * (numPets - 1),
      );
    }
    return roundCurrency(this.feePerNight * numNights * numPets);
  }
}

/**
 * Factory for creating pet fee strategies
 */
export class PetFeeStrategyFactory {
  private strategies: Map<string, PetFeeStrategy> = new Map();

  constructor() {
    this.loadStrategies();
  }

  /**
   * Load and register all pet fee strategies
   */
  private loadStrategies(): void {
    // Register Cave Springs strategy
    if (config.CAVE_SPRINGS_ID) {
      const caveSpringStrategy = new PerNightPerPetFeeStrategy(
        config.CAVE_SPRINGS_PET_FEE_PER_NIGHT,
        config.CAVE_SPRINGS_PER_ROOM_PET_CAPACITY,
      );
      this.strategies.set(config.CAVE_SPRINGS_ID, caveSpringStrategy);
    }

    // Register Springs Motel strategy
    if (config.SPRINGS_MOTEL_ID) {
      const springsMotelStrategy = new FlatFeeStrategy(
        config.SPRINGS_MOTEL_FLAT_FEE,
      );
      this.strategies.set(config.SPRINGS_MOTEL_ID, springsMotelStrategy);
    }

    // Register AshleyRose strategy
    if (config.ASHLEY_ROSE_ID) {
      const ashleyRoseStrategy = new FlatFeeStrategy(
        config.ASHLEY_ROSE_FLAT_FEE,
        config.ASHLEY_ROSE_PER_ROOM_PET_CAPACITY,
      );
      this.strategies.set(config.ASHLEY_ROSE_ID, ashleyRoseStrategy);
    }

    //Register Los Rios strategy
    if (config.LOS_RIOS_ID) {
      const losRiosStrategy = new LosRiosPetFeeStrategy(
        config.LOS_RIOS_PET_FEE_PER_NIGHT,
        config.LOS_RIOS_DISCOUNTED_PET_FEE_PER_NIGHT,
        config.LOS_RIOS_PER_ROOM_PET_CAPACITY,
        config.LOS_RIOS_DISCOUNTED_UNIT_GROUP_IDS,
      );
      this.strategies.set(config.LOS_RIOS_ID, losRiosStrategy);
    }
  }

  /**
   * Get the pet fee strategy for a given hotel
   * @param hotelId - The hotel ID
   * @returns The pet fee strategy or undefined if not configured
   */
  getStrategy(hotelId: string): PetFeeStrategy | undefined {
    return this.strategies.get(hotelId);
  }
}

// Create a singleton instance of the factory
const petFeeStrategyFactory = new PetFeeStrategyFactory();

/**
 * Creates a PetFeeStrategy from a PetFeeConfiguration object
 * @param config - The pet fee configuration
 * @returns The corresponding PetFeeStrategy
 */
export function getPetFeeStrategyFromConfig(
  config: PetFeeConfiguration,
): PetFeeStrategy {
  switch (config.strategy) {
    case PetFeeStrategyType.PerNightPerPet:
      return new PerNightPerPetFeeStrategy(
        config.fee_amount,
        config.max_pets_per_room,
      );
    case PetFeeStrategyType.PerNight:
      return new PerNightFeeStrategy(
        config.fee_amount,
        config.max_pets_per_room,
      );
    case PetFeeStrategyType.FlatFee:
      return new FlatFeeStrategy(config.fee_amount, config.max_pets_per_room);
    case PetFeeStrategyType.PerNightPerPetWithDiscountedUnits:
      return new LosRiosPetFeeStrategy(
        config.fee_amount,
        config.discounted_fee_amount ?? config.fee_amount,
        config.max_pets_per_room,
        config.discounted_unit_group_ids,
      );
    case PetFeeStrategyType.PerPetFlatFee:
      return new PerPetFlatFeeStrategy(
        config.fee_amount,
        config.max_pets_per_room,
      );
    default: {
      const _exhaustive: never = config.strategy;
      return _exhaustive;
    }
  }
}

/**
 * Gets the pet fee strategy for a given hotel.
 * If a hotelPetFeeConfig is provided and non-null, checks room_type_overrides
 * first: when roomTypeId matches a rule, that rule's config is used. Otherwise
 * falls back to the base config, then to the env-var-based factory.
 * @param hotelId - The hotel ID
 * @param hotelPetFeeConfig - Optional pet fee configuration from the DB
 * @param roomTypeId - Optional PMS-native room type ID for room-type-level overrides
 * @returns The pet fee strategy or undefined if not configured
 */
export function getPetFeeStrategy(
  hotelId: string,
  hotelPetFeeConfig?: PetFeeConfiguration | null,
  roomTypeId?: string,
): PetFeeStrategy | undefined {
  if (hotelPetFeeConfig) {
    if (roomTypeId && hotelPetFeeConfig.room_type_overrides?.length) {
      const override = hotelPetFeeConfig.room_type_overrides.find((o) =>
        o.room_type_ids.includes(roomTypeId),
      );
      if (override) {
        return getPetFeeStrategyFromConfig({
          strategy: override.strategy,
          fee_amount: override.fee_amount,
          max_pets_per_room: override.max_pets_per_room,
        });
      }
    }
    return getPetFeeStrategyFromConfig(hotelPetFeeConfig);
  }
  return petFeeStrategyFactory.getStrategy(hotelId);
}
