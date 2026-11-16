import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { ToWords } from 'to-words';
import twilio from 'twilio';
import { URL as NodeURL } from 'url';
import config from '../config';
import { CustomRequest } from '../customheaderTypes/express';
import { SessionType } from '../dtos/enum/SessionType';
import { BadRequestError } from '../errors/BadRequestError';
import { NoDataError } from '../errors/NoDataError';
import { Payment } from '../models/Payment';
import { PeoplePerRoom } from '../models/request/roomReservation';
import { Country, PaymentProvider } from '../types/enums';
import { TwilioConfiguration } from '../types/hotelConfiguration';
import { trueValues } from './common';
import logger from './logger';

dayjs.extend(utc);
dayjs.extend(timezone);

export function convertToPhoneNumber(
  phone: string | number | undefined,
): string | undefined {
  if (!phone) return undefined;
  // Remove any non-digit characters (including + and -)
  const cleaned = String(phone).replace(/[^0-9]/g, '');
  return cleaned;
}

/**
 * Formats a phone number by adding a country code prefix
 * @param phone The phone number to format. It should include the country code
 * @param country The country the phone number belongs to
 * @returns The formatted phone number
 */
export function formatPhoneNumber(phone: string, country: Country): string {
  const cleaned = convertToPhoneNumber(phone);
  if (!cleaned) {
    throw new BadRequestError('formatPhoneNumber: Invalid phone number format');
  }

  if (country === Country.US) {
    const digitCount = cleaned.length;
    // Check if the phone number already includes the country code (1)
    if (digitCount === 11 && cleaned.startsWith('1')) {
      // Format as +1 (xxx) xxx xxxx - country code already included
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)} ${cleaned.slice(7)}`;
    } else if (digitCount === 10) {
      // Format as +1 (xxx) xxx xxxx - adding country code
      return `+1 (${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`;
    } else {
      return `+${cleaned}`;
    }
  } else if (country === Country.UK) {
    const digitCount = cleaned.length;
    // Check if the phone number already includes the country code (44)
    if (digitCount === 12 && cleaned.startsWith('44')) {
      // Format as +44 xxxx xxx xxx - country code already included
      return `+44 ${cleaned.slice(2, 6)} ${cleaned.slice(6, 9)} ${cleaned.slice(9)}`;
    } else if (digitCount === 10) {
      // Format as +44 xxxx xxx xxx - adding country code
      return `+44 ${cleaned.slice(0, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7)}`;
    } else {
      return `+${cleaned}`;
    }
  }

  return `+${cleaned}`;
}

/**
 * Validates a phone number using the Twilio Lookup API. Throws BadRequestError if invalid.
 * @param phoneNumber The phone number string (E.164 or formatted)
 */
export async function validatePhoneWithTwilio(
  phone: string,
  twilioConfig: TwilioConfiguration | null | undefined,
  country: Country,
) {
  if (!twilioConfig) {
    throw new BadRequestError(
      'validatePhoneWithTwilio: Twilio configuration is not available',
    );
  }
  const formattedPhone = formatPhoneNumber(
    convertToPhoneNumber(phone) || '',
    country,
  );
  try {
    const twilioClient = twilio(
      twilioConfig.twilioAccountSid,
      twilioConfig.twilioAuthToken,
    );
    const lookup = await twilioClient.lookups.v2
      .phoneNumbers(formattedPhone)
      .fetch();
    if (
      !lookup.phoneNumber ||
      !lookup.valid ||
      lookup.validationErrors?.length
    ) {
      throw new BadRequestError(`Invalid phone number ${formattedPhone}`);
    }
  } catch (err) {
    throw new BadRequestError(`Invalid phone number ${formattedPhone}`);
  }
}

/**
 * Resolves the target phone number for SMS sending.
 * Prefers customer phone number if it's a valid Twilio number.
 * For payment links, throws if customer phone is invalid, since payment link generation happens when the customer is calling/chatting,
 * unlike other SMS types which happens when the customer is not actively conversing with the agent.
 * For other SMS types, falls back to reservation phone number if customer phone is invalid.
 */
export async function resolveSmsTargetPhoneNumber(
  customerPhone: string | undefined,
  reservationPhone: string | undefined,
  twilioConfig: TwilioConfiguration | null | undefined,
  country: Country,
  isPaymentLink: boolean = false,
): Promise<string> {
  if (!customerPhone) {
    if (isPaymentLink) {
      throw new BadRequestError(
        'Customer phone number is required for payment link SMS',
      );
    }
    return reservationPhone || '';
  }

  try {
    await validatePhoneWithTwilio(customerPhone, twilioConfig, country);
    return formatPhoneNumber(
      convertToPhoneNumber(customerPhone) || '',
      country,
    );
  } catch (error) {
    if (isPaymentLink) {
      throw new BadRequestError(
        `Invalid customer phone number ${customerPhone} for payment link SMS`,
      );
    }
    return reservationPhone || '';
  }
}

/**
 * Generates a unique booking ID in the format BK<3 timestamp digits><2 random digits>
 * @returns string Booking ID (e.g., "BK12345")
 */
export function generateBookingId(): string {
  const timestampPart = Date.now().toString().slice(-3);
  const randomPart = Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, '0');
  return `BK${timestampPart}${randomPart}`;
}

/**
 * Generates a unique 10-digit invoice ID for Shift4 payments
 * @returns string Invoice ID (e.g., "1234567890")
 */
export function generateInvoiceId(): string {
  // Generate a random number between 1000000000 and 9999999999 (10 digits)
  return Math.floor(1000000000 + Math.random() * 9000000000).toString();
}

export function getCallerPhoneNumber(req: CustomRequest): string {
  return req.phoneNumber || '';
}

export function getAssistantPhoneNumber(req: CustomRequest): string {
  return req.assistantPhoneNumber || '';
}

export function getCurrentSessionId(req: CustomRequest): string {
  const sessionId = req.sessionId;
  if (!sessionId) {
    const errorMessage = 'Session ID is required';
    logger.error(errorMessage);
    throw new BadRequestError(errorMessage);
  }
  return sessionId;
}

export function getSessionType(req: CustomRequest) {
  const sessionType = req.sessionType;
  if (!sessionType) {
    const errorMessage = 'Session type is required';
    logger.error(errorMessage);
    throw new BadRequestError(errorMessage);
  }
  if (!Object.values(SessionType).includes(sessionType as SessionType)) {
    const errorMessage = 'Session type is invalid';
    logger.error(errorMessage);
    throw new BadRequestError(errorMessage);
  }
  return sessionType as SessionType;
}

export function formatDateYYYYMMDD(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Converts a monetary value to a combined format with both number and words
 * to improve speech-to-speech model pronunciation
 * @param value The monetary value to convert
 * @param currency Optional currency symbol (e.g., '$', '₹', '€') to determine currency name
 * @returns A string in the format "178.00 (One Hundred Seventy Eight Dollars and Fifty Cents)"
 */
export function numberToWords(value: number, currency?: string): string {
  const toWords = new ToWords({
    localeCode: 'en-US',
    converterOptions: {
      currency: false,
      ignoreDecimal: false,
      ignoreZeroCurrency: false,
    },
  });

  const formattedNumber = value.toFixed(2);
  const mainUnit = Math.floor(value);
  const subUnit = Math.round((value - mainUnit) * 100);

  // Map currency symbols to their names
  const currencyMap: { [key: string]: { main: string; sub: string } } = {
    $: { main: 'Dollar', sub: 'Cent' },
    USD: { main: 'Dollar', sub: 'Cent' },
    '₹': { main: 'Rupee', sub: 'Paisa' },
    INR: { main: 'Rupee', sub: 'Paisa' },
    '€': { main: 'Euro', sub: 'Cent' },
    EUR: { main: 'Euro', sub: 'Cent' },
    '£': { main: 'Pound', sub: 'Pence' },
    GBP: { main: 'Pound', sub: 'Pence' },
    '¥': { main: 'Yen', sub: 'Sen' },
    JPY: { main: 'Yen', sub: 'Sen' },
    CAD: { main: 'Dollar', sub: 'Cent' },
    AUD: { main: 'Dollar', sub: 'Cent' },
  };

  const currencyInfo = currency ? currencyMap[currency] : null;

  let words = toWords.convert(mainUnit);

  if (currencyInfo) {
    const mainLabel =
      mainUnit === 1 ? currencyInfo.main : `${currencyInfo.main}s`;
    words = `${words} ${mainLabel}`;

    if (subUnit > 0) {
      const subWords = toWords.convert(subUnit);
      const subLabel =
        subUnit === 1 ? currencyInfo.sub : `${currencyInfo.sub}s`;
      words = `${words} and ${subWords} ${subLabel}`;
    }
  } else {
    if (subUnit > 0) {
      const subWords = toWords.convert(subUnit);
      const subLabel = subUnit === 1 ? 'Cent' : 'Cents';
      words = `${words} and ${subWords} ${subLabel}`;
    }
  }

  return `${currency ? currency + ' ' : ''}${formattedNumber} (${words})`;
}

/**
 * Converts a numeric string to spoken words digit by digit.
 * e.g., "5093" -> "five zero nine three"
 * @param value The numeric string to convert
 * @returns A string with each digit spelled out, separated by spaces
 */
export function digitsToSpoken(value: string): string {
  const digitWords: Record<string, string> = {
    '0': 'zero',
    '1': 'one',
    '2': 'two',
    '3': 'three',
    '4': 'four',
    '5': 'five',
    '6': 'six',
    '7': 'seven',
    '8': 'eight',
    '9': 'nine',
  };

  return value
    .split('')
    .map((char) => digitWords[char] ?? char)
    .join(' ');
}

export function isMultiRoomReservation(
  unitGroupIds: number[],
  peoplePerRoom: PeoplePerRoom,
): boolean {
  let isMultiRoomReservation = false;
  if (unitGroupIds.length > 1) {
    isMultiRoomReservation = true;
  }
  if (Object.keys(peoplePerRoom).length > 1) {
    isMultiRoomReservation = true;
  }

  for (const value of Object.values(peoplePerRoom)) {
    if (value.length > 1) {
      isMultiRoomReservation = true;
      break;
    }
  }
  return isMultiRoomReservation;
}

export function getSecurePaymentUrl(
  paymentRecord: Payment,
  hotelName: string,
): string {
  if (!paymentRecord.payment_link) {
    throw new NoDataError(
      `getSecurePaymentUrl: payment_link doesn't exist for payment ${paymentRecord.id}`,
    );
  }
  // Since Shift4 payment URL is directly generated by us, we can simply return it
  if (paymentRecord.payment_provider === PaymentProvider.SHIFT4) {
    return paymentRecord.payment_link;
  }

  // Stripe payment links are generated by Stripe. So we take the unique part and append it to Dextr URL.
  const identifier = paymentRecord.payment_link.split('/').pop();
  const hotelPath = hotelName.trim().toLowerCase().replace(/\s+/g, '_');
  return `${config.SECURE_URL}/${hotelPath}/${identifier}`;
}

/**
 * Appends prefilled_email to a Stripe payment link. Stripe Checkout Session
 * URLs carry a `#fidk...` fragment; naively string-concatenating `?prefilled_email=`
 * lands inside that fragment and corrupts it, so the checkout page fails to load.
 * The URL API inserts the query param before the fragment regardless of format.
 */
export function appendPrefilledEmailToPaymentLink(
  paymentLink: string,
  email: string,
): string {
  const url = new NodeURL(paymentLink);
  url.searchParams.set('prefilled_email', email);
  return url.toString();
}

/**
 * Generates a unique 10-digit reservation review ID.
 * Uses the same format as Shift4 invoice IDs for consistency.
 */
export function generateReservationReviewId(): string {
  return generateInvoiceId();
}

/**
 * Builds the Dextr secure URL for the review page using a reservation_review_id.
 */
export function getSecureReviewUrl(
  reservationReviewId: string,
  hotelName: string,
): string {
  const hotelPath = hotelName.trim().toLowerCase().replace(/\s+/g, '_');
  return `${config.SECURE_URL}/${hotelPath}/${reservationReviewId}`;
}

export function formatDateToWords(
  date: dayjs.Dayjs,
  includeYear = true,
): string {
  const day = String(date.date()).padStart(2, '0');
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const month = monthNames[date.month()];
  const year = date.year();
  if (!includeYear) {
    return `${day} ${month}`;
  }
  return `${day} ${month} ${year}`;
}

export function isATrueValue(value: any): boolean {
  if (!value) {
    return false;
  }
  if (typeof value === 'string') {
    value = value.toLowerCase();
  }
  return trueValues.includes(value);
}

/**
 * Merges consecutive date ranges with the same available_units count
 */
export function mergeConsecutiveDateRanges(
  dateRanges: Array<{ start_date: string; end_date: string; min_stay: number }>,
) {
  if (dateRanges.length === 0) return [];

  const merged: Array<{
    start_date: string;
    end_date: string;
    min_stay: number;
  }> = [];
  let current = { ...dateRanges[0] };

  for (let i = 1; i < dateRanges.length; i++) {
    const next = dateRanges[i];
    const currentEndPlusOne = dayjs(current.end_date)
      .add(1, 'day')
      .format('YYYY-MM-DD');

    // Check if next range starts immediately after current and the min_stay is same
    if (
      currentEndPlusOne === next.start_date &&
      current.min_stay === next.min_stay
    ) {
      // Merge by extending the end_date
      current.end_date = next.end_date;
    } else {
      // Push current and start a new range
      merged.push(current);
      current = { ...next };
    }
  }

  // Push the last range
  merged.push(current);
  return merged;
}

/** Splits sorted YYYY-MM-DD date strings into runs of consecutive days. */
export function groupContiguousDates(dates: string[]): string[][] {
  if (dates.length === 0) return [];
  const groups: string[][] = [[dates[0]]];
  for (let i = 1; i < dates.length; i++) {
    const prev = dayjs(dates[i - 1]);
    const curr = dayjs(dates[i]);
    if (curr.diff(prev, 'day') === 1) {
      groups[groups.length - 1].push(dates[i]);
    } else {
      groups.push([dates[i]]);
    }
  }
  return groups;
}

/**
 * Checks if a date is in a past month of the current year and returns a corrected version.
 *
 * This function identifies dates that are in past months (not the current month) of the current year
 * and provides a corrected version by adding 1 year. The caller should decide whether to apply
 * the correction based on the context (e.g., only apply if both start and end dates need correction).
 *
 * Dates in the current month are not flagged for correction, even if they are a few days in the past.
 * Such dates will be caught by validation and result in an error.
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param timezone - Hotel's timezone
 * @returns Object with corrected date and flag indicating if correction is suggested
 */
export function correctDateIfPastInCurrentYear(
  dateStr: string,
  timezone: string,
): { date: string; shouldBeCorrected: boolean } {
  const inputDate = dayjs.tz(dateStr, timezone);
  const today = dayjs().tz(timezone);

  // Check if the input date is in the same year as today
  if (inputDate.year() === today.year()) {
    // Only suggest correction if the date is in a past month (not the current month)
    if (inputDate.month() < today.month()) {
      // Add 1 year to the input date
      return {
        date: inputDate.add(1, 'year').format('YYYY-MM-DD'),
        shouldBeCorrected: true,
      };
    }
  }

  return { date: dateStr, shouldBeCorrected: false };
}

/**
 * Adjusts end_date to start_date + 1 day if they are the same date
 * @param start_date The check-in date in YYYY-MM-DD format
 * @param end_date The check-out date in YYYY-MM-DD format
 * @returns Object containing the adjusted end_date, correction flag, and message
 */
export function adjustEndDateIfSameAsStartDate(
  start_date: string,
  end_date: string,
): { date: string; shouldBeCorrected: boolean; message: string } {
  if (end_date === start_date) {
    const adjustedEndDate = dayjs(start_date)
      .add(1, 'day')
      .format('YYYY-MM-DD');
    return {
      date: adjustedEndDate,
      shouldBeCorrected: true,
      message: `End date automatically adjusted to ${adjustedEndDate} (check-out must be after check-in). `,
    };
  }

  return { date: end_date, shouldBeCorrected: false, message: '' };
}

/**
 * Rounds a number to 2 decimal places for currency calculations.
 *
 * Uses Number.EPSILON to avoid floating-point precision issues.
 * For example, without EPSILON:
 *   Math.round(1.005 * 100) / 100 might give 1.00 instead of 1.01
 *
 * @param value - The number to round
 * @returns The value rounded to 2 decimal places
 */
export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Truncates a dollar amount DOWN to two decimal places (drops any fraction of a
 * cent). Cloudbeds' tax engine ignores everything past the second decimal when
 * computing tax/fee line amounts — e.g. a tax of 259.32 × 6.57% = 17.037324 is
 * stored as 17.03, not 17.04. Matching that truncation here makes Dextr's
 * computed reservation total land exactly on Cloudbeds' folio total, so there is
 * no cent-level drift to reconcile. Use this for tax/fee line items instead of
 * `roundCurrency`'s round-to-nearest behavior.
 *
 * Adds a tolerance before flooring so a value that is already an exact cent
 * amount (but represented with tiny floating-point noise just below it, e.g.
 * 10.139999999999999) isn't dropped an extra cent. The tolerance is scaled to
 * the magnitude of the cents value — a fixed `Number.EPSILON` (~2.2e-16) is
 * only meaningful for numbers near 1 and is far smaller than the noise
 * `value * 100` can introduce at real dollar amounts.
 */
export function truncateCurrency(value: number): number {
  const cents = value * 100;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(cents));
  // `+ 0` normalizes a -0 result (e.g. for a $0 tax line) to 0.
  return Math.floor(cents + tolerance) / 100 + 0;
}

/**
 * Coerces numeric string fields from PostgreSQL back to JavaScript numbers.
 * PostgreSQL numeric/decimal columns are returned as strings by the pg driver.
 */
export function transformPaymentNumericFields<
  T extends { amount_charged?: any; amount_refunded?: any },
>(payment: T): T {
  if (!payment) return payment;
  return {
    ...payment,
    amount_charged: payment.amount_charged ? Number(payment.amount_charged) : 0,
    amount_refunded: payment.amount_refunded
      ? Number(payment.amount_refunded)
      : 0,
  } as T;
}

/**
 * Computes the platform-adjusted total amount from quote financial components.
 * Use this instead of reading total_amount from quote_object directly.
 */
export function computeQuoteTotal(
  baseRate: number,
  taxes: number,
  fees: number,
): number {
  return roundCurrency(baseRate + taxes + fees);
}

const CURRENCY_CODE_TO_SYMBOL: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  INR: '₹',
  JPY: '¥',
  CAD: 'CA$',
  AUD: 'A$',
  SGD: 'S$',
  AED: 'AED ',
  CHF: 'CHF ',
  MXN: 'MX$',
  BRL: 'R$',
  NZD: 'NZ$',
};

/** Converts a currency code (e.g. "USD") to its display symbol (e.g. "$"). Returns the code unchanged if no mapping exists. */
export function currencyCodeToSymbol(code: string): string {
  return CURRENCY_CODE_TO_SYMBOL[code?.toUpperCase()] ?? code ?? '';
}

/** Formats a monetary amount with the currency symbol prefix (e.g. $100.00). */
export function formatCurrencyAmount(currency: string, amount: number): string {
  return `${currencyCodeToSymbol(currency)}${roundCurrency(amount).toFixed(2)}`;
}

/**
 * Rounds a tax rate to 4 decimal places.
 * Uses Number.EPSILON to avoid floating-point precision issues.
 *
 * @param value - The tax rate (e.g. 0.0825)
 * @returns The value rounded to 4 decimal places
 */
export function roundTaxRate(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

/**
 * Validates that check-in and check-out dates are not in the past and that check-out is after check-in
 * @param checkIn - Check-in date string in YYYY-MM-DD format
 * @param checkOut - Check-out date string in YYYY-MM-DD format
 * @param timezone - Hotel timezone (e.g., 'America/New_York')
 * @throws BadRequestError if dates are invalid
 */
export function validateReservationDates(
  checkIn: string,
  checkOut: string,
  timezone: string,
): void {
  // Get today's date in the hotel's timezone
  const todayInHotelTz = dayjs().tz(timezone).format('YYYY-MM-DD');

  // Check if check-in is in the past
  if (checkIn < todayInHotelTz) {
    throw new BadRequestError(
      'validateReservationDates: Check-in date cannot be in the past',
    );
  }

  // Check if check-out is in the past
  if (checkOut < todayInHotelTz) {
    throw new BadRequestError(
      'validateReservationDates: Check-out date cannot be in the past',
    );
  }

  // Check if check-out is after check-in
  if (checkOut <= checkIn) {
    throw new BadRequestError(
      'validateReservationDates: Check-out must be greater than check-in',
    );
  }
}

export const RATE_CALENDAR_MAX_NIGHTS = 62;

/**
 * Resolves the nights a rate calendar covers. Both dates are inclusive nights, not a
 * check-in/check-out pair. A start date already in the past (in the hotel's timezone)
 * is moved up to today, so a widget can always ask for a whole month.
 */
export function resolveRateCalendarWindow(
  startDate: string,
  endDate: string,
  timezone: string,
): { startDate: string; endDate: string } {
  for (const [name, value] of [
    ['start_date', startDate],
    ['end_date', endDate],
  ]) {
    if (dayjs(value).format('YYYY-MM-DD') !== value) {
      throw new BadRequestError(
        `resolveRateCalendarWindow: ${name} is not a valid date`,
      );
    }
  }

  const todayInHotelTz = dayjs().tz(timezone).format('YYYY-MM-DD');
  if (endDate < todayInHotelTz) {
    throw new BadRequestError(
      'resolveRateCalendarWindow: end_date cannot be in the past',
    );
  }
  if (endDate < startDate) {
    throw new BadRequestError(
      'resolveRateCalendarWindow: end_date cannot be before start_date',
    );
  }

  const resolvedStart = startDate < todayInHotelTz ? todayInHotelTz : startDate;
  const nights = dayjs(endDate).diff(dayjs(resolvedStart), 'day') + 1;
  if (nights > RATE_CALENDAR_MAX_NIGHTS) {
    throw new BadRequestError(
      `resolveRateCalendarWindow: a rate calendar can cover at most ${RATE_CALENDAR_MAX_NIGHTS} nights`,
    );
  }

  return { startDate: resolvedStart, endDate };
}

/**
 * The whole calendar months a resolved rate calendar window falls in, from today
 * (in the hotel's timezone) in the current month, and never starting after the
 * window itself. The rate calendar is fetched and cached for these months, so
 * every window within the same months shares one PMS call.
 */
export function rateCalendarMonthWindow(
  startDate: string,
  endDate: string,
  timezone: string,
): { startDate: string; endDate: string } {
  const todayInHotelTz = dayjs().tz(timezone).format('YYYY-MM-DD');
  const monthStart = dayjs(startDate).startOf('month').format('YYYY-MM-DD');
  const notPast = monthStart < todayInHotelTz ? todayInHotelTz : monthStart;
  return {
    startDate: notPast < startDate ? notPast : startDate,
    endDate: dayjs(endDate).endOf('month').format('YYYY-MM-DD'),
  };
}

export function toHotelMidnightUtc(
  date: string | Date,
  hotelTimezone: string,
): string {
  const datePart =
    date instanceof Date
      ? dayjs(date).tz(hotelTimezone).format('YYYY-MM-DD')
      : date.split('T')[0];
  return dayjs.tz(datePart, hotelTimezone).startOf('day').utc().toISOString();
}

/**
 * Wall-clock time on a hotel-local date, as a UTC instant.
 *
 * Built by formatting the target wall time and resolving it in the hotel zone —
 * not by adding minutes to midnight. Adding advances the absolute timestamp, so
 * on a DST-transition date midnight + 900 minutes lands on 16:00 or 14:00 local
 * instead of 15:00.
 */
export function toHotelLocalTimeUtc(
  date: string | Date,
  hotelTimezone: string,
  minutesFromMidnight: number,
): string {
  if (!Number.isFinite(minutesFromMidnight) || minutesFromMidnight <= 0) {
    return toHotelMidnightUtc(date, hotelTimezone);
  }
  const datePart =
    date instanceof Date
      ? dayjs(date).tz(hotelTimezone).format('YYYY-MM-DD')
      : date.split('T')[0];
  const hours = Math.floor(minutesFromMidnight / 60);
  const minutes = Math.floor(minutesFromMidnight % 60);
  const wallClock = `${datePart}T${String(hours).padStart(2, '0')}:${String(
    minutes,
  ).padStart(2, '0')}`;
  return dayjs.tz(wallClock, hotelTimezone).utc().toISOString();
}

/** Card expiry as the card forms post it, YYMM. */
export const CARD_EXPIRY_YYMM_PATTERN = /^[0-9]{2}(0[1-9]|1[0-2])$/;

/**
 * @param yyMm - Expiry in YYMM, e.g. "2612".
 * @returns The last day of that month as YYYY-MM-DD, e.g. "2026-12-31".
 */
export function yyMmToEndOfMonthDate(yyMm: string): string {
  if (!CARD_EXPIRY_YYMM_PATTERN.test(yyMm)) {
    throw new BadRequestError('Card expiry must be in YYMM format');
  }

  return dayjs(`20${yyMm.slice(0, 2)}-${yyMm.slice(2)}-01`)
    .endOf('month')
    .format('YYYY-MM-DD');
}

/**
 * @param yyMm - Expiry in YYMM, e.g. "2612".
 * @returns e.g. `{ month: 12, year: 2026 }`.
 */
export function parseYyMm(yyMm: string): { month: number; year: number } {
  if (!CARD_EXPIRY_YYMM_PATTERN.test(yyMm)) {
    throw new BadRequestError('Card expiry must be in YYMM format');
  }

  return {
    month: Number(yyMm.slice(2)),
    year: 2000 + Number(yyMm.slice(0, 2)),
  };
}
