import { roundCurrency } from '../../utils/helper';
import { MewsProduct } from '../types';

/**
 * Computes the pet-product fee for a Mews reservation and the Count to attach on
 * the ProductOrder / addProduct call. The multipliers are driven entirely by the
 * product's ChargingMode:
 *
 * | ChargingMode          | ×pets | ×nights |
 * | Once                  | no    | no      |
 * | PerTimeUnit           | no    | yes     |
 * | PerPerson             | yes   | no      |
 * | PerPersonPerTimeUnit  | yes   | yes     |
 *
 * Mews applies the nights multiplier server-side (products/getAll: "count 1 means
 * a single product every night"), so `count` carries only the pets factor; the
 * nights factor is applied here only for the fee we display in the quote.
 */
export function computeMewsPetProductFee(
  chargingMode: MewsProduct['ChargingMode'],
  grossValue: number,
  numPets: number,
  nights: number,
): { fees: number; count: number } {
  if (numPets <= 0) {
    return { fees: 0, count: 0 };
  }
  const perPet =
    chargingMode === 'PerPerson' || chargingMode === 'PerPersonPerTimeUnit';
  const perNight =
    chargingMode === 'PerTimeUnit' || chargingMode === 'PerPersonPerTimeUnit';
  const petsFactor = perPet ? numPets : 1;
  const nightsFactor = perNight ? nights : 1;
  return {
    fees: roundCurrency(grossValue * petsFactor * nightsFactor),
    count: petsFactor,
  };
}
