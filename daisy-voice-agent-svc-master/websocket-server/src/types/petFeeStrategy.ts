/**
 * Pet fee calculation strategy.
 * Values match DB/API string representation.
 */
export enum PetFeeStrategyType {
  PerNightPerPet = 'per_night_per_pet',
  PerNight = 'per_night',
  FlatFee = 'flat_fee',
  PerNightPerPetWithDiscountedUnits = 'per_night_per_pet_with_discounted_units',
  PerPetFlatFee = 'per_pet_flat_fee',
}
