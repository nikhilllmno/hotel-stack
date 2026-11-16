/**
 * Maps a Calry rate plan onto the PMS-agnostic `PMSQuote`, applying the
 * hotel's pet fee.
 *
 * Calry reports `ratePlans[].totalPrice` *including* `deposit`, so the cost
 * of the stay itself is `totalPrice - deposit`. The `deposit` Calry reports is
 * a security deposit and is informational only — it is excluded from the quote
 * rather than charged. What Daisy collects up front is the hotel's own initial
 * deposit policy, applied here.
 */

import dayjs from 'dayjs';
import { HotelConfiguration } from '../../models/HotelConfiguration';
import { PMSQuote } from '../../pms/types/Quote';
import { getPetFeeStrategy } from '../../services/roomReservation/petFeeStrategies';
import { DepositType } from '../../types/hotelConfiguration';
import { roundCurrency } from '../../utils/helper';
import logger from '../../utils/logger';
import { CalryPetFeeQuote, CalryQuote, CalryRatePlan } from '../types';

export interface CalryQuoteMappingParams {
  quote: CalryQuote;
  plan: CalryRatePlan;
  rateCode: string | null;
  checkIn: string;
  checkOut: string;
  roomTypeId: string;
  numPets: number;
  hotelId: string;
  hotelConfig?: HotelConfiguration | null;
}

export function mapCalryRatePlanToPMSQuote({
  quote,
  plan,
  rateCode,
  checkIn,
  checkOut,
  roomTypeId,
  numPets,
  hotelId,
  hotelConfig,
}: CalryQuoteMappingParams): PMSQuote {
  const baseRate = roundCurrency(plan.basePrice?.totalBasePrice ?? 0);
  const taxes = roundCurrency(plan.tax?.totalTax ?? 0);
  const discount = roundCurrency(plan.discount?.totalDiscount ?? 0);
  let fees = roundCurrency((plan.fee?.totalFee ?? 0) + discount);

  const petFee = calculatePetFee({
    checkIn,
    checkOut,
    roomTypeId,
    numPets,
    hotelId,
    hotelConfig,
    pricing: { base_rate: baseRate, taxes, fees },
  });

  if (petFee > 0) {
    fees = roundCurrency(fees + petFee);
  }

  const totalAmount = roundCurrency(baseRate + taxes + fees);

  return {
    base_rate: baseRate,
    taxes,
    fees,
    total_amount: totalAmount,
    amountCharged: calculateAmountCharged({
      checkIn,
      checkOut,
      rateCode,
      hotelConfig,
      pricing: { base_rate: baseRate, taxes, fees, total_amount: totalAmount },
    }),
    currency: quote.currency,
    rate_code: rateCode,
    rate_id: plan.ratePlanId ?? rateCode,
    raw_response: quote,
  };
}

/**
 * How much of the stay is taken up front. Without a configured policy the full
 * total is charged, which is how every Calry hotel behaved before deposits
 * were supported.
 *
 * Calry quotes carry no per-night breakdown, so the first-night deposit types
 * use the nightly average of base rate and tax. That is exact for a flat rate
 * and close enough for a varying one — the balance is collected either way.
 */
function calculateAmountCharged({
  checkIn,
  checkOut,
  rateCode,
  hotelConfig,
  pricing,
}: {
  checkIn: string;
  checkOut: string;
  rateCode: string | null;
  hotelConfig?: HotelConfiguration | null;
  pricing: {
    base_rate: number;
    taxes: number;
    fees: number;
    total_amount: number;
  };
}): number {
  const total = pricing.total_amount;

  const fullDeposit = hotelConfig?.rate_code_config?.full_deposit;
  if (rateCode && fullDeposit?.includes(rateCode.toUpperCase())) {
    return total;
  }

  const policy = hotelConfig?.initial_deposit_policy;
  if (!policy?.enabled || !policy.tiers?.length) return total;

  const nights = dayjs(checkOut).diff(dayjs(checkIn), 'day');
  const matchedTier = policy.tiers.find((tier) => {
    const meetsMin = nights >= tier.min_nights;
    const meetsMax = tier.max_nights == null || nights <= tier.max_nights;
    return meetsMin && meetsMax;
  });
  if (!matchedTier) return total;

  const perNight = nights > 0 ? nights : 1;
  const firstNightBaseRate = roundCurrency(pricing.base_rate / perNight);
  const firstNightTax = roundCurrency(pricing.taxes / perNight);

  let depositAmount: number | undefined;

  switch (matchedTier.deposit_type) {
    case DepositType.PERCENTAGE: {
      if (matchedTier.value == null) return total;
      depositAmount = roundCurrency((total * matchedTier.value) / 100);
      break;
    }
    case DepositType.FLAT: {
      if (matchedTier.value == null) return total;
      depositAmount = roundCurrency(matchedTier.value);
      break;
    }
    case DepositType.FIRST_NIGHT_PLUS_TAX: {
      depositAmount = roundCurrency(firstNightBaseRate + firstNightTax);
      break;
    }
    case DepositType.FIRST_NIGHT_PLUS_TAX_PLUS_FEE: {
      depositAmount = roundCurrency(
        firstNightBaseRate + firstNightTax + pricing.fees,
      );
      break;
    }
    default:
      return total;
  }

  return roundCurrency(Math.min(depositAmount, total));
}

function calculatePetFee({
  checkIn,
  checkOut,
  roomTypeId,
  numPets,
  hotelId,
  hotelConfig,
  pricing,
}: {
  checkIn: string;
  checkOut: string;
  roomTypeId: string;
  numPets: number;
  hotelId: string;
  hotelConfig?: HotelConfiguration | null;
  pricing: { base_rate: number; taxes: number; fees: number };
}): number {
  if (numPets <= 0) return 0;

  const strategy = getPetFeeStrategy(
    hotelId,
    hotelConfig?.pet_fee_configuration,
    roomTypeId,
  );
  if (!strategy) return 0;

  const total = roundCurrency(pricing.base_rate + pricing.taxes + pricing.fees);
  const quoteAdapter: CalryPetFeeQuote = {
    check_in: checkIn,
    check_out: checkOut,
    unit_group_id: roomTypeId,
    base_rate: pricing.base_rate,
    taxes: pricing.taxes,
    fees: pricing.fees,
    total_amount: total,
    amountCharged: total,
  };

  strategy.validatePetCount(numPets);
  const petFee = roundCurrency(
    strategy.calculatePetFee(quoteAdapter, numPets) || 0,
  );

  if (petFee > 0) {
    logger.info('Calry mapCalryRatePlanToPMSQuote: applying pet fee', {
      hotelId,
      roomTypeId,
      numPets,
      petFee,
    });
  }

  return petFee;
}
