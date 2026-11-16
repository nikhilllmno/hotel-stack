import dayjs from 'dayjs';
import { ReservationSource } from '../../dtos/enum/ReservationSource';
import { PaymentProvider } from '../../types/enums';
import {
  DepositType,
  InitialDepositPolicy,
} from '../../types/hotelConfiguration';
import { roundCurrency, roundTaxRate } from '../../utils/helper';
import logger from '../../utils/logger';
import { Addon } from '../types/AddonsResponse';
import { RoomRatesResponse, StayDate } from '../types/RoomRatesResponse';

/**
 * Calculates tax rate from stay_dates and separates a tax-inclusive pet fee into components.
 *
 * @param petFeeInclTax - Total pet fee (tax-inclusive)
 * @param stayDates - Array of stay dates to derive tax rate from
 * @returns Object with pre-tax and tax portions of the pet fee
 */
export const separatePetFeeTaxComponents = (
  petFeeInclTax: number,
  stayDates: StayDate[],
): { petFeeExclTax: number; petFeeTax: number } => {
  if (petFeeInclTax === 0 || stayDates.length === 0) {
    return { petFeeExclTax: 0, petFeeTax: 0 };
  }

  const firstStayDate = stayDates[0];
  const denominator = firstStayDate.rate_amount + firstStayDate.addon_amount;
  const taxRate = roundTaxRate(
    denominator > 0 ? firstStayDate.exclusive_tax / denominator : 0,
  );
  const petFeeExclTax = roundCurrency(petFeeInclTax / (1 + taxRate));
  const petFeeTax = roundCurrency(petFeeInclTax - petFeeExclTax);

  return { petFeeExclTax, petFeeTax };
};

/**
 * Calculates the initial deposit amount based on the deposit policy.
 * Tiers are evaluated in order; first matching tier by night count is applied.
 *
 * Deposit semantics driven by tier value and hotel payment_provider:
 * - PERCENTAGE 100  → full payment upfront (replaces legacy force_full_payment)
 * - PERCENTAGE 0 / FLAT 0 → no initial deposit; combined with payment_provider
 *   determines whether autocharge is set up (Stripe/Shift4) or skipped (NOT_APPLICABLE)
 * - Other values → partial deposit collected upfront, remainder autocharged
 *
 * @param checkIn  - Check-in date string
 * @param checkOut - Check-out date string
 * @param pricing  - Stayntouch room rates response
 * @param policy   - The initial deposit policy (can be null/undefined)
 * @param forceFullDeposit - If true, collects the full amount as deposit
 *   (e.g., rate codes flagged in rate_code_config.full_deposit)
 * @returns The calculated deposit amount, or null if no policy applies
 */
export function applyInitialDepositPolicyToStayntouchQuote(
  checkIn: string,
  checkOut: string,
  pricing: RoomRatesResponse,
  policy: InitialDepositPolicy | null | undefined,
  forceFullDeposit: boolean = false,
  paymentProvider: PaymentProvider,
): number | null {
  if (paymentProvider === PaymentProvider.NOT_APPLICABLE) {
    logger.info(
      'applyInitialDepositPolicyToStayntouchQuote: Payment provider is NOT_APPLICABLE, setting initial deposit to 0',
    );
    return 0;
  }

  if (forceFullDeposit) {
    if (!pricing.total_stay_cost || pricing.total_stay_cost <= 0) {
      logger.warn(
        `calculateInitialDeposit: forceFullDeposit=true but total_amount is invalid: ${roundCurrency(pricing.total_stay_cost)}`,
      );
      return null;
    }
    logger.info(
      `calculateInitialDeposit: forceFullDeposit=true. Collecting full amount as deposit: ${roundCurrency(pricing.total_stay_cost)}`,
    );
    return roundCurrency(pricing.total_stay_cost);
  }

  if (!policy?.enabled || !policy.tiers?.length) {
    return null;
  }

  const nights = dayjs(checkOut).diff(dayjs(checkIn), 'day');
  const matchedTier = policy.tiers.find((tier) => {
    const meetsMin = nights >= tier.min_nights;
    const meetsMax = tier.max_nights == null || nights <= tier.max_nights;
    return meetsMin && meetsMax;
  });

  if (!matchedTier) {
    logger.info(
      `calculateInitialDeposit: No matching tier for ${nights} night(s). Returning null.`,
    );
    return null;
  }

  let depositAmount: number | undefined;

  const firstNight = pricing.stay_dates?.[0];
  if (!firstNight) {
    logger.warn(
      'applyInitialDepositPolicyToStayntouchQuote: No stay dates found in pricing. Cannot calculate first night deposit.',
    );
    return null;
  }

  const firstNightBaseRate = roundCurrency(pricing.stay_dates[0].rate_amount);
  const firstNightTax = roundCurrency(pricing.stay_dates[0].exclusive_tax);
  const firstNightFees = roundCurrency(pricing.stay_dates[0].addon_amount);

  switch (matchedTier.deposit_type) {
    case DepositType.FIRST_NIGHT_PLUS_TAX: {
      depositAmount = roundCurrency(firstNightBaseRate + firstNightTax);
      logger.info(
        `calculateInitialDeposit: Applying ${DepositType.FIRST_NIGHT_PLUS_TAX} for ${nights} night(s). First night rate=${roundCurrency(firstNightBaseRate)}, first night tax=${roundCurrency(firstNightTax)}, deposit=${depositAmount}`,
      );
      break;
    }
    case DepositType.FIRST_NIGHT_PLUS_TAX_PLUS_FEE: {
      depositAmount = roundCurrency(
        firstNightBaseRate + firstNightTax + firstNightFees,
      );
      logger.info(
        `calculateInitialDeposit: Applying ${DepositType.FIRST_NIGHT_PLUS_TAX_PLUS_FEE} for ${nights} night(s). First night rate=${roundCurrency(firstNightBaseRate)}, first night tax=${roundCurrency(firstNightTax)}, first night fees = ${roundCurrency(firstNightFees)}, deposit=${depositAmount}`,
      );
      break;
    }
    case DepositType.PERCENTAGE: {
      const pct = matchedTier.value;
      if (pct == null) {
        logger.info(
          `calculateInitialDeposit: PERCENTAGE tier has no value for ${nights} night(s). Skipping.`,
        );
        return null;
      }
      depositAmount = roundCurrency((pricing.total_stay_cost * pct) / 100);
      logger.info(
        `calculateInitialDeposit: Applying ${pct}% of total for ${nights} night(s). total_amount=${roundCurrency(pricing.total_stay_cost)}, deposit=${depositAmount}`,
      );
      break;
    }
    case DepositType.FLAT: {
      const flat = matchedTier.value;
      if (flat == null) {
        logger.info(
          `calculateInitialDeposit: FLAT tier has no value for ${nights} night(s). Skipping.`,
        );
        return null;
      }
      depositAmount = roundCurrency(flat);
      logger.info(
        `calculateInitialDeposit: Applying flat deposit of ${flat} for ${nights} night(s).`,
      );
      break;
    }
  }

  if (depositAmount == null) {
    return null;
  }
  return roundCurrency(Math.min(depositAmount, pricing.total_stay_cost));
}

/**
 * Minimal quote shape required to compute and apply a Stayntouch pet fee.
 * Fields mirror what pet fee strategies read (check_in/check_out/unit_group_id)
 * plus the monetary fields this helper mutates.
 */
export interface StayntouchPetFeeQuote {
  check_in: string;
  check_out: string;
  unit_group_id: number;
  base_rate: number;
  taxes: number;
  fees: number;
  total_amount: number;
  amountCharged: number;
}

/**
 * Returns the nights multiplier for an addon based on its post_type:
 * - STAY (Nightly): posted every night → numNights
 * - NIGHT (First Night): posted once on the first night → 1
 * - LAST_NIGHT: posted once on the last night → 1
 * - WEEKLY: posted once per week → ceil(numNights / 7)
 */
function resolveAddonNightsMultiplier(
  postType: Addon['post_type'],
  numNights: number,
): number {
  switch (postType) {
    case 'STAY':
      return numNights; // applicable for the entire stay
    case 'NIGHT':
      return 1; // applicable for one night
    case 'LAST_NIGHT':
      return 1;
    case 'WEEKLY':
      return Math.ceil(numNights / 7);
    default:
      return numNights;
  }
}

/**
 * Returns the quantity to use when posting the addon, based on its amount_type:
 * - ROOM / FLAT: flat per-room charge → quantity is always 1
 * - PERSON / ADULT / CHILD: per-occupant charge → quantity is numPets
 *
 * This quantity is used both for quoting (total = amount × quantity × nightsMultiplier)
 * and for the addons array sent to the StayNTouch reservations API.
 */
export function resolveAddonQuantity(
  amountType: Addon['amount_type'],
  quantity: number,
): number {
  switch (amountType) {
    case 'ROOM':
    case 'FLAT':
      return 1;
    case 'PERSON': // per person
    case 'ADULT': // per adult
    case 'CHILD': // per child
      return quantity;
    default:
      return quantity;
  }
}

/**
 * Applies a pet fee to a quote using the Addon object fetched directly from the StayNTouch
 * addons API. The addon amount is treated as pre-tax (exclusive of tax); tax is estimated
 * using the effective rate derived from existing stay_dates.
 *
 * The total pre-tax fee is: addon.amount × resolveAddonQuantity(addon.amount_type, numPets) × nightsMultiplier
 * where nightsMultiplier is derived from addon.post_type and quantity from addon.amount_type.
 *
 * @param quote - The quote to apply the pet fee to
 * @param stayDates - Stay dates used to derive the effective tax rate and night count
 * @param addon - The pet fee Addon object from the StayNTouch addons API
 * @param numPets - Number of pets
 * @returns Updated quote and stay dates with pet fee applied
 */
export function applyPetFeeToStayntouchQuote(
  quote: StayntouchPetFeeQuote,
  stayDates: StayDate[],
  addon: Addon,
  numPets: number,
): StayntouchPetFeeQuote {
  if (
    !numPets ||
    numPets === 0 ||
    addon.amount === 0 ||
    stayDates.length === 0
  ) {
    return quote;
  }

  const numNights = stayDates.length;
  const quantity = resolveAddonQuantity(addon.amount_type, numPets);
  const nightsMultiplier = resolveAddonNightsMultiplier(
    addon.post_type,
    numNights,
  );
  const petFeePreTaxTotal = roundCurrency(
    addon.amount * quantity * nightsMultiplier,
  );

  const firstStayDate = stayDates[0];
  const denominator = firstStayDate.rate_amount + firstStayDate.addon_amount;
  const taxRate = roundTaxRate(
    denominator > 0 ? firstStayDate.exclusive_tax / denominator : 0,
  );

  const petFeeTaxTotal = roundCurrency(petFeePreTaxTotal * taxRate);

  quote.fees = roundCurrency(quote.fees + petFeePreTaxTotal);
  quote.taxes = roundCurrency(quote.taxes + petFeeTaxTotal);
  quote.total_amount = roundCurrency(
    quote.base_rate + quote.taxes + quote.fees,
  );
  quote.amountCharged = roundCurrency(quote.total_amount);

  return quote;
}

export const ADDON_MODIFICATION_BLOCKED_NOTE =
  "This reservation cannot be modified via Danny since it has addons and was not created via Danny. Danny doesn't have the ability to determine the impact of those addons, but cancellation is still possible via Danny.";

export function hasBlockingAddons(
  addons: { id: number }[] | undefined,
  allowlist: number[] | null | undefined,
): boolean {
  const normalizedAllowlist = new Set(
    (Array.isArray(allowlist) ? allowlist : []).map((id) => String(id)),
  );
  return (addons ?? []).some(
    (addon) => !normalizedAllowlist.has(String(addon.id)),
  );
}

/**
 * Maps Stayntouch source_code to a descriptive reservation_source string.
 * @param sourceCode - The source_code from Stayntouch reservation response
 * @returns A descriptive string for the reservation source
 */
export function mapStayntouchSourceCodeToReservationSource(
  sourceCode: string | undefined,
): ReservationSource {
  const code = (sourceCode ?? '').trim();
  if (
    code.toLowerCase() === 'property' ||
    code.toLowerCase() === 'hotel website'
  ) {
    return ReservationSource.DIRECT_HOTEL_RESERVATION;
  }

  switch (code) {
    case 'GDS':
    case 'OTA':
    case 'Group':
    case 'Internal':
    case 'IHOS':
    default:
      return ReservationSource.THIRD_PARTY_RESERVATION;
  }
}
