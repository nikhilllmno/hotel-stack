import { MewsRestriction, MewsRestrictionException } from '../types';

/**
 * Mews restrictions close a rate/room combination for a set of dates. Availability
 * metrics know nothing about them, so a room can report free resources while the
 * property still refuses the booking — a `Start` restriction or a `MinAdvance`
 * exception silently kills same-day bookings that `services/getAvailability` says
 * are fine.
 *
 * A restriction blocks a reservation when its `Conditions` all match AND its
 * `Exceptions` do not rescue it. `Exceptions` are the escape hatch: they are the
 * rules that prevent an otherwise-matching restriction from applying, so a
 * restriction carrying `MinLength: P2D` reads as "closed, unless you stay at
 * least 2 nights".
 */

// Anchored so the two meanings of M stay apart: before T it is months, after T
// minutes. Same reasoning as parseMewsOffsetToMinutes, but this parser accepts
// date-position components — restriction durations are legitimately days long.
const ISO_DURATION =
  /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

const MINUTES_PER_DAY = 1440;

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/**
 * Minutes represented by an ISO 8601 duration, or null when absent or malformed.
 * Years and months are approximated (365 / 30 days) — Mews emits them as the
 * zero-valued placeholders of `P0M2DT0H0M0S`, so the approximation only ever
 * applies to values we would otherwise have to reject outright.
 */
export function parseIsoDurationToMinutes(raw: unknown): number | null {
  if (typeof raw !== 'string' || !raw) return null;

  const match = ISO_DURATION.exec(raw);
  if (!match) return null;

  const [, years, months, weeks, days, hours, minutes, seconds] = match;

  const total =
    Number(years ?? 0) * 365 * MINUTES_PER_DAY +
    Number(months ?? 0) * 30 * MINUTES_PER_DAY +
    Number(weeks ?? 0) * 7 * MINUTES_PER_DAY +
    Number(days ?? 0) * MINUTES_PER_DAY +
    Number(hours ?? 0) * 60 +
    Number(minutes ?? 0) +
    Math.floor(Number(seconds ?? 0) / 60);

  if (!Number.isFinite(total) || total < 0) return null;
  return total;
}

/** One night of the stay, in both the forms restriction conditions are keyed by. */
export interface MewsRestrictionNight {
  /** Hotel-local date, `YYYY-MM-DD`. Drives the day-of-week condition. */
  localDate: string;
  /** UTC instant of the time unit start. Drives the interval condition. */
  timeUnitStartUtc: string;
}

export interface MewsRestrictionContext {
  /** One entry per night, in order. The first entry is the check-in night. */
  nights: MewsRestrictionNight[];
  /** The check-out day — the day an `End` restriction is evaluated against. */
  checkOut: MewsRestrictionNight;
  /** The service the booked room belongs to. Other services' restrictions don't apply. */
  serviceId: string;
  resourceCategoryId: string;
  /** `MewsResourceCategory.Type`, e.g. `Room`. Absent means type conditions can't match. */
  resourceCategoryType?: string | null;
  rateId?: string | null;
  baseRateId?: string | null;
  rateGroupId?: string | null;
  /** Booking time, for the advance-booking exceptions. Defaults to now. */
  nowUtc?: Date;
  /**
   * Gross price per time unit, for the price exceptions. When absent, price
   * exceptions are treated as satisfied — we cannot prove the restriction
   * applies, and blocking a bookable room is the worse failure.
   */
  pricePerTimeUnit?: number;
}

function matchesScope(
  restriction: MewsRestriction,
  ctx: MewsRestrictionContext,
): boolean {
  if (restriction.ServiceId !== ctx.serviceId) return false;

  const c = restriction.Conditions;

  // An unset condition matches everything. An unset context value is the
  // opposite — we don't know the reservation's rate, so we cannot claim the
  // restriction applies to it.
  if (c.ExactRateId && c.ExactRateId !== ctx.rateId) return false;
  if (c.BaseRateId && c.BaseRateId !== ctx.baseRateId) return false;
  if (c.RateGroupId && c.RateGroupId !== ctx.rateGroupId) return false;
  if (c.ResourceCategoryId && c.ResourceCategoryId !== ctx.resourceCategoryId) {
    return false;
  }
  if (
    c.ResourceCategoryType &&
    c.ResourceCategoryType !== ctx.resourceCategoryType
  ) {
    return false;
  }
  return true;
}

/** The days this restriction type is evaluated against. */
function relevantDays(
  restriction: MewsRestriction,
  ctx: MewsRestrictionContext,
): MewsRestrictionNight[] {
  switch (restriction.Conditions.Type) {
    case 'Start':
      return ctx.nights.length ? [ctx.nights[0]] : [];
    case 'End':
      return [ctx.checkOut];
    case 'Stay':
      return ctx.nights;
    default:
      return [];
  }
}

function isDayMatched(
  restriction: MewsRestriction,
  day: MewsRestrictionNight,
): boolean {
  const c = restriction.Conditions;

  const dayMs = Date.parse(day.timeUnitStartUtc);
  if (Number.isNaN(dayMs)) return false;

  // Both bounds are time unit starts, so both ends are inclusive.
  if (c.StartUtc) {
    const start = Date.parse(c.StartUtc);
    if (!Number.isNaN(start) && dayMs < start) return false;
  }
  if (c.EndUtc) {
    const end = Date.parse(c.EndUtc);
    if (!Number.isNaN(end) && dayMs > end) return false;
  }

  // Days defaults to every day when not provided. The name is derived from the
  // hotel-local date — a restriction on Saturdays means local Saturdays.
  if (c.Days?.length) {
    const localMs = Date.parse(`${day.localDate}T00:00:00Z`);
    if (Number.isNaN(localMs)) return false;
    const dayName = DAY_NAMES[new Date(localMs).getUTCDay()];
    if (!c.Days.includes(dayName)) return false;
  }

  // `Hours` is deliberately ignored: it only narrows services whose time unit
  // is shorter than a day, and every path that builds a MewsRestrictionContext
  // works in whole days.
  return true;
}

/**
 * True when the exceptions rescue the reservation from an otherwise-matching
 * restriction. Every specified rule must be satisfied; a restriction with no
 * exception rules at all is an unconditional close-out and rescues nothing.
 */
function isExcepted(
  exceptions: MewsRestrictionException | null | undefined,
  ctx: MewsRestrictionContext,
): boolean {
  if (!exceptions) return false;

  const minAdvance = parseIsoDurationToMinutes(exceptions.MinAdvance);
  const maxAdvance = parseIsoDurationToMinutes(exceptions.MaxAdvance);
  const minLength = parseIsoDurationToMinutes(exceptions.MinLength);
  const maxLength = parseIsoDurationToMinutes(exceptions.MaxLength);
  const minPrice = exceptions.MinPrice?.Value;
  const maxPrice = exceptions.MaxPrice?.Value;

  const hasAnyRule = [
    minAdvance,
    maxAdvance,
    minLength,
    maxLength,
    minPrice,
    maxPrice,
  ].some((v) => v !== null && v !== undefined);
  if (!hasAnyRule) return false;

  if (minAdvance !== null || maxAdvance !== null) {
    const startMs = ctx.nights.length
      ? Date.parse(ctx.nights[0].timeUnitStartUtc)
      : NaN;
    if (Number.isNaN(startMs)) return false;
    const advanceMinutes =
      (startMs - (ctx.nowUtc ?? new Date()).getTime()) / 60000;
    if (minAdvance !== null && advanceMinutes < minAdvance) return false;
    if (maxAdvance !== null && advanceMinutes > maxAdvance) return false;
  }

  if (minLength !== null || maxLength !== null) {
    const lengthMinutes = ctx.nights.length * MINUTES_PER_DAY;
    if (minLength !== null && lengthMinutes < minLength) return false;
    if (maxLength !== null && lengthMinutes > maxLength) return false;
  }

  // Unknown price leaves the price rules unproven, so they stay satisfied.
  if (ctx.pricePerTimeUnit !== undefined) {
    if (minPrice !== undefined && ctx.pricePerTimeUnit < minPrice) return false;
    if (maxPrice !== undefined && ctx.pricePerTimeUnit > maxPrice) return false;
  }

  return true;
}

/**
 * The first restriction that blocks this reservation, or null when none do.
 * Callers surface the returned restriction for logging — the guest-facing
 * message should stay generic, since restriction reasons are internal.
 */
export function findBlockingRestriction(
  restrictions: MewsRestriction[],
  ctx: MewsRestrictionContext,
): MewsRestriction | null {
  if (!restrictions.length || !ctx.nights.length) return null;

  for (const restriction of restrictions) {
    if (!matchesScope(restriction, ctx)) continue;
    const days = relevantDays(restriction, ctx);
    if (!days.some((day) => isDayMatched(restriction, day))) continue;
    if (isExcepted(restriction.Exceptions, ctx)) continue;
    return restriction;
  }

  return null;
}

/** Convenience wrapper for callers that only need the boolean. */
export function isRestricted(
  restrictions: MewsRestriction[],
  ctx: MewsRestrictionContext,
): boolean {
  return findBlockingRestriction(restrictions, ctx) !== null;
}
