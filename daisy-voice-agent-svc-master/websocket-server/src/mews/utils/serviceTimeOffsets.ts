import { MewsService } from '../types';

/**
 * A Mews reservation does not start at the time unit boundary. The service defines
 * `StartOffset` from the start of the unit and `EndOffset` from its end, both as
 * ISO 8601 durations — e.g. `P0M0DT15H0M0S` for a 15:00 local check-in.
 *
 * This matters beyond correctness: the production enterprise rejects any
 * `reservations/add` whose `StartUtc` falls before `timeUnitStart + StartOffset`,
 * returning "no availability for the selected dates" even when the room is free.
 * Sending hotel-local midnight therefore fails every same-day booking.
 */

// Anchored so the two meanings of M stay apart: before T it is months, after T
// minutes. A global (\d+)M scan reads "P1M" as one minute.
const ISO_DURATION =
  /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

const MINUTES_PER_DAY = 1440;

/**
 * Minutes from the time unit start, or null when the value is absent, malformed,
 * or outside the shape we can safely act on. Callers treat null as "fall back to
 * the time unit boundary" — never as an error.
 */
export function parseMewsOffsetToMinutes(raw: unknown): number | null {
  if (typeof raw !== 'string' || !raw) return null;

  const match = ISO_DURATION.exec(raw);
  if (!match) return null;

  const [, years, months, weeks, days, hours, minutes, seconds] = match;

  // A date-position component would push the start into another day. Not
  // something Mews has been observed to emit, and silently shifting the booking
  // to the wrong date is worse than falling back.
  if (Number(years ?? 0) || Number(months ?? 0)) return null;
  if (Number(weeks ?? 0) || Number(days ?? 0)) return null;

  const total =
    Number(hours ?? 0) * 60 +
    Number(minutes ?? 0) +
    Math.floor(Number(seconds ?? 0) / 60);

  if (!Number.isFinite(total) || total < 0 || total >= MINUTES_PER_DAY) {
    return null;
  }
  return total;
}

export interface MewsServiceTimeOffsets {
  startOffsetMinutes: number | null;
  endOffsetMinutes: number | null;
  /** Raw values, for logging when parsing falls back. */
  rawStartOffset: string | null;
  rawEndOffset: string | null;
  timeUnitPeriod: string | null;
}

/**
 * Reads the offsets off a Bookable service. Non-bookable services and time unit
 * periods other than `Day` yield nulls: midnight-plus-offset has no meaning for
 * an `Hour` or `Month` unit, and those services keep their existing behaviour.
 */
export function getMewsServiceTimeOffsets(
  service: MewsService | undefined,
): MewsServiceTimeOffsets {
  const value =
    service?.Data?.Discriminator === 'Bookable'
      ? service.Data.Value
      : undefined;

  const rawStartOffset =
    typeof value?.StartOffset === 'string' ? value.StartOffset : null;
  const rawEndOffset =
    typeof value?.EndOffset === 'string' ? value.EndOffset : null;
  const timeUnitPeriod =
    typeof value?.TimeUnitPeriod === 'string' ? value.TimeUnitPeriod : null;

  if (timeUnitPeriod && timeUnitPeriod !== 'Day') {
    return {
      startOffsetMinutes: null,
      endOffsetMinutes: null,
      rawStartOffset,
      rawEndOffset,
      timeUnitPeriod,
    };
  }

  return {
    startOffsetMinutes: parseMewsOffsetToMinutes(rawStartOffset),
    endOffsetMinutes: parseMewsOffsetToMinutes(rawEndOffset),
    rawStartOffset,
    rawEndOffset,
    timeUnitPeriod,
  };
}

/** True when an offset was configured but we could not use it — worth logging. */
export function isUnusableStartOffset(
  offsets: MewsServiceTimeOffsets,
): boolean {
  return offsets.rawStartOffset !== null && offsets.startOffsetMinutes === null;
}
