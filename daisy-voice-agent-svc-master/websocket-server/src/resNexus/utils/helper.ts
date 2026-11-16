import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import * as _ from 'lodash';
import { BaseError } from '../../errors/BaseError';
import { PaymentProvider } from '../../types/enums';
import {
  DepositType,
  InitialDepositPolicy,
} from '../../types/hotelConfiguration';
import { ReservationDetails } from '../../types/reservation';
import {
  formatCurrencyAmount,
  formatDateYYYYMMDD,
  roundCurrency,
  roundTaxRate,
} from '../../utils/helper';
import logger from '../../utils/logger';
import { CardFields, Customer } from '../model/request/common';
import { ModifyReservationRequest } from '../model/request/reservation';
import { GetQuoteResponse } from '../model/response/quote';
import { UnitGroup } from '../model/response/unitGroups';
dayjs.extend(utc);
dayjs.extend(timezone);

export const convertToModifyReservationRequest = (
  reservation: ReservationDetails,
): ModifyReservationRequest => {
  const request: ModifyReservationRequest = {
    business_id: Number(reservation.business_id),
    check_in: reservation.check_in,
    check_out: reservation.check_out,
    num_adults: reservation.num_adults?.toString(),
    external_id: reservation.external_id,
    unit_group_id: Number(reservation.room_id),
  };
  if (!_.isEmpty(reservation.customer)) {
    if (
      !reservation.customer.first_name ||
      !reservation.customer.email ||
      !reservation.customer.phone_number
    ) {
      throw new BaseError(
        'convertToModifyReservationRequest: Customer name and phone number are required',
      );
    }
    if (!reservation.customer.address) {
      throw new BaseError(
        'convertToModifyReservationRequest: Customer address is required',
      );
    }
    if (
      !reservation.customer.address.state_or_province ||
      !reservation.customer.address.postal_code
    ) {
      throw new BaseError(
        'convertToModifyReservationRequest: Customer address state or province and postal code are required',
      );
    }
    const customer: Customer = {
      first_name: reservation.customer.first_name,
      last_name: reservation.customer.last_name || '',
      email: reservation.customer.email,
      phone_number: reservation.customer.phone_number,
      address: {
        address_line: reservation.customer.address.address_first_line || '',
        state_or_province: reservation.customer.address.state_or_province,
        postal_code: reservation.customer.address.postal_code,
      },
    };
    request.customer = customer;
  }

  if (reservation.quote) {
    request.quote = (() => {
      const quoteClone = _.cloneDeep(reservation.quote);
      // Ensure required GetQuoteResponse fields are present
      const result: GetQuoteResponse = {
        ...quoteClone,
        check_in: reservation.check_in,
        check_out: reservation.check_out,
        unit_group_id: Number(reservation.room_id),
      };
      return result;
    })();
  }

  // Only add num_children if it's present in the reservation
  if (
    reservation.num_children !== undefined &&
    reservation.num_children !== null
  ) {
    request.num_children = reservation.num_children.toString();
  }

  return request;
};

/**
 * Transforms an array of UnitGroup objects into a simplified format
 * with unit_group_id as the key and selected properties as values
 *
 * @param unitGroups Array of UnitGroup objects
 * @returns Object with unit_group_id as keys and simplified properties as values
 */
export function generateUnitGroupMetadata(unitGroups: UnitGroup[] = []) {
  return unitGroups.reduce(
    (acc, group) => {
      acc[group.unit_group_id] = {
        unit_group_id: group.unit_group_id,
        room_id: group.unit_group_id, // alias for unit_group_id
        room_name: group.name,
        name: group.name,
        max_children: group.max_children,
        max_capacity: group.per_unit_capacity,
        description: group.description,
      };
      return acc;
    },
    {} as Record<
      number,
      {
        unit_group_id: number;
        room_id: number;
        room_name: string;
        name: string;
        max_children: number;
        max_capacity: number;
        description: string;
      }
    >,
  );
}

/**
 * Combines two quotes for reservation modification (e.g., extending dates)
 * Sums numeric fields and merges rate_for_date_list arrays
 *
 * @param existingQuote - The existing quote
 * @param newQuote - The new quote to combine with
 * @param overlapCategory - The type of date overlap (extension_beginning, extension_end, etc.)
 * @returns Combined quote with updated totals
 */
export const combineQuotes = (
  existingQuote: GetQuoteResponse,
  newQuote: GetQuoteResponse,
  overlapCategory: string,
): GetQuoteResponse => {
  // Create a deep copy of the new quote to start with
  let combinedQuote = _.cloneDeep(newQuote);

  // Sum the numeric fields
  combinedQuote.base_rate =
    (existingQuote.base_rate || 0) + (newQuote.base_rate || 0);
  combinedQuote.taxes = (existingQuote.taxes || 0) + (newQuote.taxes || 0);
  combinedQuote.fees = (existingQuote.fees || 0) + (newQuote.fees || 0);
  combinedQuote.amountCharged =
    (existingQuote.amountCharged || 0) + (newQuote.amountCharged || 0);
  combinedQuote.total_amount =
    (existingQuote.total_amount || 0) + (newQuote.total_amount || 0);

  // Set check_in and check_out based on the overlap category
  if (overlapCategory === 'extension_beginning') {
    combinedQuote.check_in = newQuote.check_in; // Use the earlier check-in date
    combinedQuote.check_out = existingQuote.check_out;
  } else if (overlapCategory === 'extension_end') {
    combinedQuote.check_in = existingQuote.check_in;
    combinedQuote.check_out = newQuote.check_out; // Use the later check-out date
  } else {
    // For other cases, use the new dates
    combinedQuote.check_in = newQuote.check_in;
    combinedQuote.check_out = newQuote.check_out;
  }

  // Combine rate_for_date_list arrays, avoiding duplicates by date
  const rateMap = new Map<string, { Rate: number; ResDate: string }>();

  // Add existing rates to the map
  if (
    existingQuote.rate_for_date_list &&
    Array.isArray(existingQuote.rate_for_date_list)
  ) {
    existingQuote.rate_for_date_list.forEach(
      (rate: { Rate: number; ResDate: string }) => {
        rateMap.set(rate.ResDate, rate);
      },
    );
  }

  // Add new rates to the map (will overwrite if dates overlap)
  if (
    newQuote.rate_for_date_list &&
    Array.isArray(newQuote.rate_for_date_list)
  ) {
    newQuote.rate_for_date_list.forEach(
      (rate: { Rate: number; ResDate: string }) => {
        rateMap.set(rate.ResDate, rate);
      },
    );
  }

  // Convert the map back to an array
  combinedQuote.rate_for_date_list = Array.from(rateMap.values());
  combinedQuote.total_amount = roundCurrency(
    combinedQuote.base_rate + combinedQuote.taxes + combinedQuote.fees,
  );

  return combinedQuote;
};

/**
 * Shortens a quote by filtering rate_for_date_list to a new date range
 * Recalculates base_rate, taxes, and fees proportionally
 *
 * @param existingQuote - The existing quote to shorten
 * @param newCheckIn - New check-in date
 * @param newCheckOut - New check-out date
 * @returns Shortened quote with recalculated totals
 */
export const shortenQuote = (
  existingQuote: GetQuoteResponse,
  newCheckIn: string,
  newCheckOut: string,
): GetQuoteResponse => {
  const newStartDate = new Date(newCheckIn);
  const newEndDate = new Date(newCheckOut);

  // Create a copy of the existing quote
  let shortenedQuote = _.cloneDeep(existingQuote);

  // Update the check-in and check-out dates
  shortenedQuote.check_in = newCheckIn;
  shortenedQuote.check_out = newCheckOut;

  // Filter rate_for_date_list to only include dates within the new range
  if (
    shortenedQuote.rate_for_date_list &&
    Array.isArray(shortenedQuote.rate_for_date_list)
  ) {
    const filteredRates = shortenedQuote.rate_for_date_list.filter(
      (rate: { Rate: number; ResDate: string }) => {
        const rateDate = new Date(rate.ResDate);
        return rateDate >= newStartDate && rateDate < newEndDate;
      },
    );

    // Update the rate_for_date_list
    shortenedQuote.rate_for_date_list = filteredRates;

    // Recalculate the base_rate as the sum of all rates in the filtered list
    shortenedQuote.base_rate = filteredRates.reduce(
      (sum: number, rate: { Rate: number }) => sum + (rate.Rate || 0),
      0,
    );

    // Adjust taxes and fees proportionally
    const originalBaseRate = existingQuote.base_rate || 0;
    const newBaseRate = shortenedQuote.base_rate;

    if (originalBaseRate > 0) {
      const ratio = newBaseRate / originalBaseRate;
      shortenedQuote.taxes = (existingQuote.taxes || 0) * ratio;
      // Set as flat since when computed using ration, amount could be less. Need to keep as a config later
      shortenedQuote.fees = existingQuote.fees || 0;
      shortenedQuote.amountCharged = (existingQuote.amountCharged || 0) * ratio;
    }

    shortenedQuote.total_amount = roundCurrency(
      shortenedQuote.base_rate + shortenedQuote.taxes + shortenedQuote.fees,
    );
  }

  return shortenedQuote;
};

/**
 * Generates notes for ResNexus reservation including balance due, discount info, and amount paid
 * @param params Object containing reservation quote details, discount info, and currency
 * @returns Formatted notes string for ResNexus partner notes
 */
export function generateResNexusPartnerNotes(params: {
  currency: string;
  baseRate: number;
  taxes?: number;
  fees?: number;
  amountPaid: number;
  existingNotes?: string;
}): string {
  const { baseRate, taxes, fees, amountPaid, currency, existingNotes } = params;

  const date = formatDateYYYYMMDD();
  const totalAmount = baseRate + (taxes || 0) + (fees || 0);
  const remainingAmount = totalAmount - amountPaid;

  let notes =
    (existingNotes ? existingNotes + '\n' : '') +
    `${date} - Balance Due = ${formatCurrencyAmount(currency, remainingAmount)} | Already Paid = ${formatCurrencyAmount(currency, amountPaid)}`;

  return notes.trim();
}

// Only the pet fee: buildPartnerNotes already wrote the pet count into existingNotes at booking time.
export function generateResNexusPetNotes(params: {
  currency: string;
  numPets?: number;
  petFeeToCollect?: number | null;
  existingNotes?: string;
}): string {
  const { currency, numPets, petFeeToCollect, existingNotes } = params;
  const lines = existingNotes ? [existingNotes] : [];
  if (numPets && petFeeToCollect) {
    lines.push(
      `Pet fee to collect at property = ${formatCurrencyAmount(currency, petFeeToCollect)}`,
    );
  }
  return lines.join('\n');
}

/**
 * Applies the initial deposit policy to set amountCharged (initial amount to collect).
 * Tiers are evaluated in order; first matching tier by night count is applied.
 *
 * Deposit semantics driven by tier value and hotel payment_provider:
 * - PERCENTAGE 100  → full payment upfront (replaces legacy force_full_payment)
 * - PERCENTAGE 0 / FLAT 0 → no initial deposit; combined with payment_provider
 *   determines whether autocharge is set up (Stripe/Shift4) or skipped (NOT_APPLICABLE)
 * - Other values → partial deposit collected upfront, remainder autocharged
 *
 * @param quote  - The quote to apply the deposit policy to (mutated in place)
 * @param policy - The initial deposit policy (can be null/undefined)
 * @returns The quote with amountCharged set to the deposit amount
 */
export function applyInitialDepositPolicyToResnexusQuote(
  quote: GetQuoteResponse,
  policy: InitialDepositPolicy | null | undefined,
  paymentProvider: PaymentProvider,
): GetQuoteResponse {
  if (paymentProvider === PaymentProvider.NOT_APPLICABLE) {
    quote.amountCharged = 0;
    logger.info(
      'applyInitialDepositPolicyToResnexusQuote: Payment provider is NOT_APPLICABLE, setting amountCharged to 0',
    );
    return quote;
  }

  if (!policy?.enabled || !policy.tiers?.length) {
    return quote;
  }

  const nights = dayjs(quote.check_out).diff(dayjs(quote.check_in), 'day');
  const matchedTier = policy.tiers.find((tier) => {
    const meetsMin = nights >= tier.min_nights;
    const meetsMax = tier.max_nights == null || nights <= tier.max_nights;
    return meetsMin && meetsMax;
  });

  if (!matchedTier) {
    logger.info(
      `applyInitialDepositPolicyToResnexusQuote: No matching tier for ${nights} night(s). Leaving amountCharged unchanged.`,
    );
    return quote;
  }

  let depositAmount: number | undefined;

  switch (matchedTier.deposit_type) {
    case DepositType.FIRST_NIGHT_PLUS_TAX: {
      const firstNightRate = roundCurrency(
        quote.rate_for_date_list?.length && quote.rate_for_date_list[0] != null
          ? quote.rate_for_date_list[0].Rate
          : quote.base_rate > 0 && nights > 0
            ? quote.base_rate / nights
            : 0,
      );
      const totalTaxes = roundCurrency(quote.taxes ?? 0);
      const taxRate = roundTaxRate(
        quote.base_rate > 0 ? totalTaxes / quote.base_rate : 0,
      );
      const firstNightTax = roundCurrency(firstNightRate * taxRate);
      depositAmount = roundCurrency(firstNightRate + firstNightTax);
      logger.info(
        `applyInitialDepositPolicyToResnexusQuote: Applying ${DepositType.FIRST_NIGHT_PLUS_TAX} for ${nights} night(s). First night rate=${firstNightRate}, tax rate=${taxRate}, first night tax=${firstNightTax}, deposit=${depositAmount}`,
      );
      break;
    }
    case DepositType.PERCENTAGE: {
      const pct = matchedTier.value;
      if (pct == null) {
        logger.info(
          `applyInitialDepositPolicyToResnexusQuote: PERCENTAGE tier has no value for ${nights} night(s). Skipping.`,
        );
        return quote;
      }
      depositAmount = roundCurrency((quote.total_amount * pct) / 100);
      logger.info(
        `applyInitialDepositPolicyToResnexusQuote: Applying ${pct}% of total for ${nights} night(s). total_amount=${roundCurrency(quote.total_amount)}, deposit=${depositAmount}`,
      );
      break;
    }
    case DepositType.FLAT: {
      const flat = matchedTier.value;
      if (flat == null) {
        logger.info(
          `applyInitialDepositPolicyToResnexusQuote: FLAT tier has no value for ${nights} night(s). Skipping.`,
        );
        return quote;
      }
      depositAmount = roundCurrency(flat);
      logger.info(
        `applyInitialDepositPolicyToResnexusQuote: Applying flat deposit of ${flat} for ${nights} night(s).`,
      );
      break;
    }
  }

  if (depositAmount == null) {
    return quote;
  }
  quote.amountCharged = roundCurrency(
    Math.min(depositAmount, quote.total_amount),
  );
  return quote;
}

/** Keyed off `CardFields`, so adding a field there fails the build until it is listed here. */
const CARD_FIELD_NAMES: Record<keyof CardFields, true> = {
  card_name: true,
  card_number: true,
  card_cvv: true,
  expire_month: true,
  expire_year: true,
};

const CARD_REDACTION_PLACEHOLDER = '[REDACTED]';

/** Returns a copy of a ResNexus body with card fields redacted, for logging. Bodies are flat, so it does not recurse. */
export function stripCardFields(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }
  const entries = Object.entries(body as Record<string, unknown>);
  if (!entries.some(([key]) => key in CARD_FIELD_NAMES)) {
    return body;
  }
  return Object.fromEntries(
    entries.map(([key, value]) => [
      key,
      key in CARD_FIELD_NAMES ? CARD_REDACTION_PLACEHOLDER : value,
    ]),
  );
}
