import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import _ from 'lodash';
import { Reservation } from '../../dtos/Reservation';
import { ConversationSummary } from '../../dtos/dashboard/conversationSummary';
import { BadRequestError } from '../../errors/BadRequestError';
import { ReservationDatePolicyError } from '../../errors/ReservationDatePolicyError';
import { SameDayAvailabilityError } from '../../errors/SameDayAvailabilityError';
import { Discount } from '../../models/Discount';
import { Hotel } from '../../models/Hotel';
import { GetQuoteResponse } from '../../resNexus/model/response/quote';
import { DiscountType } from '../../types/discount';
import {
  LengthOfStayDiscountPolicy,
  OnboardingSmsConfiguration,
  PetFeeConfiguration,
  ReservationDatePolicy,
  ReservationDatePolicyType,
  SameDayBookingConfiguration,
} from '../../types/hotelConfiguration';
import { generatePresignedUrl } from '../../utils/aws';
import {
  adjustEndDateIfSameAsStartDate,
  correctDateIfPastInCurrentYear,
  roundCurrency,
  roundTaxRate,
  validateReservationDates,
} from '../../utils/helper';
import logger from '../../utils/logger';
import { getPetFeeStrategy } from './petFeeStrategies';

dayjs.extend(utc);
dayjs.extend(timezone);
// Constants for quote modification conditions
export const SHORTEN_QUOTE_CONDITIONS = new Set([
  'shortening_beginning',
  'shortening_end',
]);

export const EXTENSION_CONDITIONS = new Set([
  'extension_beginning',
  'extension_end',
]);

export const getDateModificationCategory = (
  new_checkin: string,
  new_checkout: string,
  existing_checkin: string,
  existing_checkout: string,
): string | string[] => {
  if (!new_checkin && !new_checkout) {
    return 'no_date_change';
  }

  // Convert string dates to Date objects for comparison
  const existingCheckIn = new Date(existing_checkin).setHours(0, 0, 0, 0);
  const existingCheckOut = new Date(existing_checkout).setHours(0, 0, 0, 0);
  const newCheckIn = new_checkin
    ? new Date(new_checkin).setHours(0, 0, 0, 0)
    : existingCheckIn;
  const newCheckOut = new_checkout
    ? new Date(new_checkout).setHours(0, 0, 0, 0)
    : existingCheckOut;

  if (newCheckIn > newCheckOut) {
    throw new BadRequestError('New check-in date is after new check-out date');
  }

  if (newCheckIn === existingCheckIn && newCheckOut === existingCheckOut) {
    return 'no_date_change';
  }

  if (
    (newCheckIn < existingCheckIn && newCheckOut <= existingCheckIn) ||
    (newCheckIn >= existingCheckOut && newCheckOut > existingCheckOut)
  ) {
    return 'outside_range';
  }

  let modificationCategory: string[] = [];

  if (newCheckIn > existingCheckIn) {
    modificationCategory.push('shortening_beginning');
  }

  if (newCheckOut > existingCheckOut) {
    modificationCategory.push('extension_end');
  }

  if (newCheckIn < existingCheckIn) {
    modificationCategory.push('extension_beginning');
  }

  if (newCheckOut < existingCheckOut) {
    modificationCategory.push('shortening_end');
  }

  if (modificationCategory.length === 0) {
    return 'unknown';
  }

  return modificationCategory;
};

/**
 * Gets the exclusive date ranges between existing and new reservation dates
 */
export const getExclusiveDates = (
  existingCheckIn: string,
  existingCheckOut: string,
  newCheckIn: string,
  newCheckOut: string,
  overlapCategory: string | string[],
): Array<{ startDate: string; endDate: string; overlapCategory: string }> => {
  // Handle single category case
  if (!Array.isArray(overlapCategory)) {
    return [
      {
        startDate: newCheckIn,
        endDate: newCheckOut,
        overlapCategory,
      },
    ];
  }

  // Map multiple categories to their respective date ranges
  return overlapCategory.map((category) => {
    switch (category) {
      case 'extension_beginning':
        return {
          startDate: newCheckIn,
          endDate: existingCheckIn,
          overlapCategory: 'extension_beginning',
        };
      case 'extension_end':
        return {
          startDate: existingCheckOut,
          endDate: newCheckOut,
          overlapCategory: 'extension_end',
        };
      default:
        return {
          startDate: newCheckIn,
          endDate: newCheckOut,
          overlapCategory: category,
        };
    }
  });
};

/**
 * Applies a discount to a quote's total amount.
 * Taxes will be recalculated based on the new base rate.
 * Ensures consistency between base_rate and rate_for_date_list
 *
 * @param quote - The quote to apply the discount to
 * @param discount - The discount to apply (can be null/undefined)
 * @param taxRate - The tax rate to use for calculations
 * @returns The quote with the discount applied
 */
export function applyDiscountToQuote(
  quote: GetQuoteResponse,
  discount: Discount | null,
): GetQuoteResponse {
  if (!discount) {
    return quote;
  }

  if (discount.type === DiscountType.FLAT) {
    const taxRate = roundTaxRate(
      quote.base_rate > 0 ? quote.taxes / quote.base_rate : 0,
    );
    quote.base_rate = roundCurrency(
      Math.max(0, quote.base_rate - discount.value),
    );
    quote.taxes = roundCurrency(quote.base_rate * taxRate);
    let rate_for_date_list_sum = 0;
    if (!_.isEmpty(quote.rate_for_date_list)) {
      quote.rate_for_date_list!.forEach((rate) => {
        rate.Rate = roundCurrency(
          Math.max(
            0,
            rate.Rate - discount.value / quote.rate_for_date_list!.length,
          ),
        );
        rate_for_date_list_sum = roundCurrency(
          rate_for_date_list_sum + rate.Rate,
        );
      });
    }
    if (quote.base_rate != rate_for_date_list_sum) {
      logger.warn(
        `applyDiscountToQuote: Base rate ${roundCurrency(quote.base_rate)} and rate for date list sum ${roundCurrency(rate_for_date_list_sum)} do not match. Setting base_rate to rate_for_date_list_sum`,
      );
      quote.base_rate = roundCurrency(rate_for_date_list_sum);
      quote.taxes = roundCurrency(quote.base_rate * taxRate);
    }
    quote.total_amount = roundCurrency(
      quote.base_rate + quote.taxes + quote.fees,
    );
  } else if (discount.type === DiscountType.PERCENTAGE) {
    const taxRate = roundTaxRate(
      quote.base_rate > 0 ? quote.taxes / quote.base_rate : 0,
    );
    quote.base_rate = roundCurrency(
      quote.base_rate - (quote.base_rate * discount.value) / 100,
    );
    quote.taxes = roundCurrency(quote.base_rate * taxRate);
    let rate_for_date_list_sum = 0;
    if (!_.isEmpty(quote.rate_for_date_list)) {
      quote.rate_for_date_list!.forEach((rate) => {
        rate.Rate = roundCurrency(
          rate.Rate - (rate.Rate * discount.value) / 100,
        );
        rate_for_date_list_sum = roundCurrency(
          rate_for_date_list_sum + rate.Rate,
        );
      });
    }
    if (quote.base_rate != rate_for_date_list_sum) {
      logger.warn(
        `applyDiscountToQuote: Base rate ${roundCurrency(quote.base_rate)} and rate for date list sum ${roundCurrency(rate_for_date_list_sum)} do not match. Setting base_rate to rate_for_date_list_sum`,
      );
      quote.base_rate = roundCurrency(Math.max(rate_for_date_list_sum, 0));
      quote.taxes = roundCurrency(quote.base_rate * taxRate);
    }
    quote.total_amount = roundCurrency(
      quote.base_rate + quote.taxes + quote.fees,
    );
  }

  // If 100% is collected during the booking itself, and there is a discount, then the booking amount should not exceed the total amount
  quote.amountCharged = roundCurrency(
    Math.min(quote.amountCharged, quote.total_amount),
  );

  return quote;
}

/**
 * Applies a length-of-stay discount policy to a quote.
 * Rules are evaluated in order and the first rule matching unit_group_id,
 * occupancy, and night count is applied. Tax and rate_for_date_list are kept
 * consistent with applyDiscountToQuote.
 *
 * @param quote  - The quote to apply the discount to
 * @param policy - The length-of-stay discount policy (can be null/undefined)
 * @returns The quote with the discount applied (mutated in place, matching applyDiscountToQuote behaviour)
 */
export function applyLengthOfStayDiscountPolicyToQuote(
  quote: GetQuoteResponse,
  policy: LengthOfStayDiscountPolicy,
): GetQuoteResponse {
  if (!policy || !policy.enabled || !policy.rules.length) {
    logger.info(
      `applyLengthOfStayDiscountPolicyToQuote: No length-of-stay discount policy found. No discount applied.`,
    );
    return quote;
  }

  const nights = dayjs(quote.check_out).diff(dayjs(quote.check_in), 'day');
  const unitGroupId = quote.unit_group_id;
  const occupancy = quote.occupancy;

  const matchedRule = policy.rules.find((rule) => {
    if (
      rule.unit_group_ids?.length &&
      !rule.unit_group_ids.includes(unitGroupId)
    ) {
      return false;
    }
    if (occupancy != null) {
      if (rule.min_occupancy != null && occupancy < rule.min_occupancy)
        return false;
      if (rule.max_occupancy != null && occupancy > rule.max_occupancy)
        return false;
    }
    const meetsMin = nights >= rule.min_nights;
    const meetsMax = rule.max_nights == null || nights <= rule.max_nights;
    return meetsMin && meetsMax;
  });

  if (!matchedRule) {
    logger.info(
      `applyLengthOfStayDiscountPolicyToQuote: No matching rule found for unit_group_id=${unitGroupId}, occupancy=${occupancy ?? 'N/A'}, nights=${nights}. No discount applied.`,
    );
    if (!quote.platform_pricing) quote.platform_pricing = {};
    quote.platform_pricing.length_of_stay_discount_incl_tax = 0;
    return quote;
  }

  logger.info(
    `applyLengthOfStayDiscountPolicyToQuote: Applying ${matchedRule.discount_type} discount of ${matchedRule.discount_value} for unit_group_id=${unitGroupId}, occupancy=${occupancy ?? 'N/A'}, ${nights} night(s) (nights: ${matchedRule.min_nights}–${matchedRule.max_nights ?? '∞'}, occupancy: ${matchedRule.min_occupancy ?? 0}–${matchedRule.max_occupancy ?? '∞'}, unit_group_ids: ${matchedRule.unit_group_ids?.join(',') || 'all'})`,
  );

  const originalBaseRate = roundCurrency(quote.base_rate);
  const originalTaxes = roundCurrency(quote.taxes);
  const taxRate = roundTaxRate(
    quote.base_rate > 0 ? quote.taxes / quote.base_rate : 0,
  );

  if (matchedRule.discount_type === DiscountType.FLAT) {
    quote.base_rate = roundCurrency(
      matchedRule.discount_value < quote.base_rate
        ? quote.base_rate - matchedRule.discount_value
        : 0,
    );
    quote.taxes = roundCurrency(quote.base_rate * taxRate);
    let rate_for_date_list_sum = 0;
    if (!_.isEmpty(quote.rate_for_date_list)) {
      quote.rate_for_date_list!.forEach((rate) => {
        rate.Rate = roundCurrency(
          rate.Rate -
            matchedRule.discount_value / quote.rate_for_date_list!.length,
        );
        rate_for_date_list_sum = roundCurrency(
          rate_for_date_list_sum + rate.Rate,
        );
      });
    }
    if (quote.base_rate !== rate_for_date_list_sum) {
      logger.warn(
        `applyLengthOfStayDiscountPolicyToQuote: Base rate ${roundCurrency(quote.base_rate)} and rate_for_date_list sum ${roundCurrency(rate_for_date_list_sum)} do not match. Setting base_rate to rate_for_date_list_sum`,
      );
      quote.base_rate = roundCurrency(Math.max(rate_for_date_list_sum, 0));
      quote.taxes = roundCurrency(quote.base_rate * taxRate);
    }
    quote.total_amount = roundCurrency(
      quote.base_rate + quote.taxes + quote.fees,
    );
  } else if (matchedRule.discount_type === DiscountType.PERCENTAGE) {
    quote.base_rate = roundCurrency(
      quote.base_rate - (quote.base_rate * matchedRule.discount_value) / 100,
    );
    quote.taxes = roundCurrency(quote.base_rate * taxRate);
    let rate_for_date_list_sum = 0;
    if (!_.isEmpty(quote.rate_for_date_list)) {
      quote.rate_for_date_list!.forEach((rate) => {
        rate.Rate = roundCurrency(
          rate.Rate - (rate.Rate * matchedRule.discount_value) / 100,
        );
        rate_for_date_list_sum = roundCurrency(
          rate_for_date_list_sum + rate.Rate,
        );
      });
    }
    if (quote.base_rate !== rate_for_date_list_sum) {
      logger.warn(
        `applyLengthOfStayDiscountPolicyToQuote: Base rate ${roundCurrency(quote.base_rate)} and rate_for_date_list sum ${roundCurrency(rate_for_date_list_sum)} do not match. Setting base_rate to rate_for_date_list_sum`,
      );
      quote.base_rate = roundCurrency(rate_for_date_list_sum);
      quote.taxes = roundCurrency(quote.base_rate * taxRate);
    }
    quote.total_amount = roundCurrency(
      quote.base_rate + quote.taxes + quote.fees,
    );
  }
  quote.amountCharged = roundCurrency(
    Math.min(quote.amountCharged, quote.total_amount),
  );

  const lengthOfStayDiscountInclTax = roundCurrency(
    originalBaseRate + originalTaxes - (quote.base_rate + quote.taxes),
  );
  if (!quote.platform_pricing) quote.platform_pricing = {};
  quote.platform_pricing.length_of_stay_discount_incl_tax =
    lengthOfStayDiscountInclTax;

  return quote;
}

/**
 * Applies hotel-specific pet fees to a quote
 * Uses strategy pattern to support different fee calculation methods per hotel
 *
 * @param hotelId - The hotel ID to determine which fee strategy to use
 * @param quote - The quote to apply the pet fee to
 * @param numPets - The number of pets (optional)
 * @param taxRate - The tax rate snapshot from the raw PMS quote (optional)
 * @param hotelPetFeeConfig - Pet fee configuration from the DB (optional, falls back to env vars)
 * @returns The quote with pet fee applied
 */
export function applyPetFeeToQuote(
  hotelId: string,
  quote: GetQuoteResponse,
  numPets?: number,
  hotelPetFeeConfig?: PetFeeConfiguration | null,
): GetQuoteResponse {
  logger.info(
    `applyPetFeeToQuote: Finding pet fee for hotel ${hotelId} with ${numPets} pets`,
  );
  // Return early if no pets
  if (!numPets || numPets === 0) {
    return quote;
  }

  // Get the strategy for this hotel (DB config takes priority, falls back to env vars)
  const strategy = getPetFeeStrategy(
    hotelId,
    hotelPetFeeConfig,
    quote.unit_group_id != null ? String(quote.unit_group_id) : undefined,
  );

  // Return early if hotel doesn't have a pet fee strategy
  if (!strategy) {
    return quote;
  }

  // Validate pet count
  strategy.validatePetCount(numPets);

  // Calculate pet fee base amount
  const petFeeInclTax = strategy.calculatePetFee(quote, numPets);
  logger.info(
    `applyPetFeeToQuote: Applying pet fee of ${roundCurrency(petFeeInclTax)} for hotel ${hotelId} with ${numPets} pets`,
  );

  // Store pet fee tax-inclusive in fees (consistent with PMS fees being tax-inclusive)
  quote.fees = roundCurrency(quote.fees + petFeeInclTax);
  quote.amountCharged = roundCurrency(quote.amountCharged + petFeeInclTax);
  if (!quote.platform_pricing) quote.platform_pricing = {};
  quote.platform_pricing.pet_fee_incl_tax = roundCurrency(petFeeInclTax);
  quote.total_amount = roundCurrency(
    quote.base_rate + quote.taxes + quote.fees,
  );

  return quote;
}

/**
 * Validates if same-day check-in is allowed based on hotel configuration
 * @param hotel The hotel object with same_day_booking_configuration
 * @param startDate The check-in date in YYYY-MM-DD format
 * @param todayInHotelTz Today's date in hotel timezone in YYYY-MM-DD format
 * @param timezone The hotel's timezone
 * @throws SameDayAvailabilityError if same-day check-in is not allowed
 */
export function validateSameDayBooking(
  startDate: string,
  todayInHotelTz: string,
  timezone: string,
  same_day_booking_configuration:
    | SameDayBookingConfiguration
    | null
    | undefined,
): void {
  if (!same_day_booking_configuration) {
    return;
  }
  const {
    allow_same_day_checkin,
    cutoff_time,
    transfer_to_manager_for_same_day,
  } = same_day_booking_configuration;
  // return if there is no config
  if (allow_same_day_checkin === null || allow_same_day_checkin === undefined) {
    return;
  }

  if (startDate !== todayInHotelTz) {
    return;
  }

  // Case 1: Same-day check-in is completely disabled
  if (allow_same_day_checkin === false) {
    throw new SameDayAvailabilityError();
  }

  // Case 2: Same-day check-in is allowed, but check additional constraints
  const currentTimeInHotelTz = dayjs().tz(timezone).format('HH:mm');
  const isPastCutoff = cutoff_time && currentTimeInHotelTz >= cutoff_time;

  // If past cutoff time, always block
  if (isPastCutoff) {
    throw new SameDayAvailabilityError(
      `validateSameDayBooking: Same-day reservations are not allowed after ${cutoff_time}`,
    );
  }

  // If manager should handle same-day (even before cutoff)
  if (transfer_to_manager_for_same_day) {
    throw new SameDayAvailabilityError(
      `validateSameDayBooking: Same-day availability check is not authorized. Please contact the manager`,
    );
  }
}

/** Converts days to a human-readable "X month(s)" or "X day(s)" for error messages. */
function formatOffsetForMessage(days: number): string {
  const DAYS_IN_MONTH_APPROX = 30;
  if (days >= DAYS_IN_MONTH_APPROX) {
    const months = Math.floor(days / DAYS_IN_MONTH_APPROX);
    return months === 1 ? '1 month' : `${months} months`;
  }
  return days === 1 ? '1 day' : `${days} days`;
}

/**
 * Validates reservation date policy: when check-in is more than date_offset_days in the future,
 * do not check availability and throw so the guest is told to contact manager or that reservation is not possible.
 *
 * @param startDate - Check-in date (YYYY-MM-DD)
 * @param timezone - Hotel timezone (e.g. Europe/London)
 * @param policy - Reservation date policy (date_offset_days, reservation_policy)
 * @throws ReservationDatePolicyError when check-in is beyond the offset
 */
export function validateReservationDatePolicy(
  startDate: string,
  timezone: string,
  policy: ReservationDatePolicy | null | undefined,
): void {
  if (!policy?.date_offset_days) {
    return;
  }
  const todayInHotelTz = dayjs().tz(timezone).format('YYYY-MM-DD');
  const daysFromToday = dayjs(startDate).diff(dayjs(todayInHotelTz), 'day');
  if (daysFromToday <= policy.date_offset_days) {
    return;
  }
  const offsetLabel = formatOffsetForMessage(policy.date_offset_days);
  if (
    policy.reservation_policy === ReservationDatePolicyType.ESCALATE_TO_MANAGER
  ) {
    throw new ReservationDatePolicyError(
      `Reservations more than ${offsetLabel} in advance require approval from the property manager.`,
    );
  }
  throw new ReservationDatePolicyError(
    `Reservations more than ${offsetLabel} in advance are not available for booking. Please contact the property directly for assistance.`,
  );
}
/** Parses HH:mm or H:mm to minutes since midnight for reliable comparison. */
function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm
    .trim()
    .split(':')
    .map((s) => parseInt(s, 10) || 0);
  return h * 60 + m;
}

/**
 * Returns true if the current time in the given timezone falls within the call-forwarding window.
 * - Same-day window (start <= end, e.g. 02:00–07:00): within only when start <= current <= end. So 01:00 is outside.
 * - Overnight window (start > end, e.g. 18:00–07:00): within when current >= start or current < end.
 * Uses minute-of-day comparison so "01:00" and "1:00" are handled correctly.
 */
export function isWithinTimeWindow(
  timezone: string,
  startTime: string,
  endTime: string,
): boolean {
  const current = dayjs().tz(timezone).format('HH:mm');
  const currentM = timeToMinutes(current);
  const startM = timeToMinutes(startTime);
  const endM = timeToMinutes(endTime);

  if (startM > endM) {
    return currentM >= startM || currentM < endM;
  }
  return currentM >= startM && currentM <= endM;
}

export function sanitizeDiscount(
  discount: Discount | null,
): Omit<
  Discount,
  | 'reservation_id'
  | 'created_at'
  | 'updated_at'
  | 'id'
  | 'hotel_id'
  | 'deleted_at'
  | 'phone_number'
> | null {
  if (!discount) {
    return null;
  }
  const {
    reservation_id,
    created_at,
    updated_at,
    id,
    hotel_id,
    deleted_at,
    phone_number,
    ...sanitizedDiscountResponse
  } = discount;
  return sanitizedDiscountResponse;
}

/**
 * Builds template variables object from reservation, hotel, and configuration data
 */
export function buildTemplateVariables(
  reservation: Reservation,
  hotel: Hotel,
  config: OnboardingSmsConfiguration,
  roomNumber: string | null,
  doorCode: string | null,
): Record<string, string> {
  const variables: Record<string, string> = {
    hotel_name: hotel.name,
    hotel_phone: hotel.assistant_phone_number,
    hotel_address: hotel.address,
    check_in_date:
      typeof reservation.check_in === 'string'
        ? reservation.check_in
        : dayjs(reservation.check_in).format('YYYY-MM-DD'),
    check_out_date:
      typeof reservation.check_out === 'string'
        ? reservation.check_out
        : dayjs(reservation.check_out).format('YYYY-MM-DD'),
    guest_first_name: reservation.customer?.first_name || 'Guest',
    guest_last_name: reservation.customer?.last_name || '',
    guest_email: reservation.customer?.email || '',
  };

  // Add room information
  if (roomNumber) variables.room_number = roomNumber;
  if (doorCode) variables.door_code = doorCode;

  // Add configuration variables if they exist
  if (config.check_in_time) variables.check_in_time = config.check_in_time;
  if (config.check_out_time) variables.check_out_time = config.check_out_time;
  if (config.contact_phone) variables.contact_phone = config.contact_phone;
  if (config.urgent_contact_phone)
    variables.urgent_contact_phone = config.urgent_contact_phone;

  return variables;
}

/**
 * Renders a message template with placeholders using a single pass
 */
export function renderMessageTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{([^}]+)\}/g, (match, key) => {
    const trimmedKey = key.trim();
    return variables[trimmedKey] ?? match;
  });
}

/**
 * Corrects past dates, adjusts same-day check-out, and validates reservation dates
 * against hotel policy. Returns the (potentially corrected) dates and a correction summary.
 * Shared across all PMS services (ResNexus, Stayntouch, Cloudbeds, etc.).
 */
export function validateAndCorrectDates(
  start_date: string,
  end_date: string,
  timezone: string,
  hotelConfig:
    | {
        same_day_booking_configuration?: SameDayBookingConfiguration | null;
        reservation_date_policy?: ReservationDatePolicy | null;
      }
    | null
    | undefined,
): { start_date: string; end_date: string; dateCorrectionDetails: string } {
  let correctedStart = start_date;
  let correctedEnd = end_date;
  let dateCorrectionDetails = '';

  const correctedStartDateResult = correctDateIfPastInCurrentYear(
    correctedStart,
    timezone,
  );
  const correctedEndDateResult = correctDateIfPastInCurrentYear(
    correctedEnd,
    timezone,
  );

  if (
    correctedStartDateResult.shouldBeCorrected &&
    correctedEndDateResult.shouldBeCorrected
  ) {
    dateCorrectionDetails += `Start date corrected from ${correctedStart} to ${correctedStartDateResult.date}. `;
    correctedStart = correctedStartDateResult.date;
    dateCorrectionDetails += `End date corrected from ${correctedEnd} to ${correctedEndDateResult.date}. `;
    correctedEnd = correctedEndDateResult.date;
  }

  const adjustedEndDateResult = adjustEndDateIfSameAsStartDate(
    correctedStart,
    correctedEnd,
  );
  if (adjustedEndDateResult.shouldBeCorrected) {
    dateCorrectionDetails += adjustedEndDateResult.message;
    correctedEnd = adjustedEndDateResult.date;
  }

  validateReservationDates(correctedStart, correctedEnd, timezone);

  const todayInHotelTz = dayjs().tz(timezone).format('YYYY-MM-DD');
  if (hotelConfig?.same_day_booking_configuration) {
    validateSameDayBooking(
      correctedStart,
      todayInHotelTz,
      timezone,
      hotelConfig.same_day_booking_configuration,
    );
  }
  if (hotelConfig?.reservation_date_policy) {
    validateReservationDatePolicy(
      correctedStart,
      timezone,
      hotelConfig.reservation_date_policy,
    );
  }

  return {
    start_date: correctedStart,
    end_date: correctedEnd,
    dateCorrectionDetails,
  };
}

/**
 * Enriches reservation DTOs by adding signature_presigned_url to customer when customer.signature is set.
 */
export async function enrichReservationsWithPolicySignaturePresignedUrl(
  reservations: Reservation[],
): Promise<Reservation[]> {
  const enriched = await Promise.all(
    reservations.map(async (r) => {
      if (!r.customer?.signature) return r;
      try {
        const presigned = await generatePresignedUrl(
          r.customer.signature,
          3600,
        );
        return {
          ...r,
          customer: { ...r.customer, signature_presigned_url: presigned },
        };
      } catch (err) {
        logger.warn(
          `enrichReservationsWithPolicySignaturePresignedUrl: Could not generate presigned URL: ${err}`,
        );
        return r;
      }
    }),
  );
  return enriched;
}

/**
 * Adds recording_presigned_url when conversations.recording_url is set.
 * s3:// paths are presigned; legacy http URLs are passed through.
 */
export async function enrichConversationSummaryWithRecordingPresignedUrl(
  summary: ConversationSummary | null | undefined,
): Promise<ConversationSummary | null | undefined> {
  if (!summary?.recording_url) {
    return summary;
  }

  const stored = summary.recording_url;

  if (stored.startsWith('s3://')) {
    try {
      const recording_presigned_url = await generatePresignedUrl(stored, 3600);
      const { recording_url: _recordingUrl, ...rest } = summary;
      return {
        ...rest,
        recording_presigned_url,
      };
    } catch (err) {
      logger.warn(
        `enrichConversationSummaryWithRecordingPresignedUrl: Could not generate presigned URL: ${err}`,
      );
      return summary;
    }
  }

  if (stored.startsWith('http')) {
    return {
      ...summary,
      recording_url: stored,
      recording_presigned_url: stored,
    };
  }

  return summary;
}
