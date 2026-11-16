/**
 * Date-level (not timestamp-level) range overlap check.
 *
 * RemoteLock `access_guest.starts_at`/`ends_at` carry no timezone (lock-local
 * time) and a reservation's checkout time can shift on a room move, so exact
 * timestamp equality is too fragile for matching a guest to a reservation.
 * Comparing by calendar date with an inclusive overlap is robust to both.
 */

export interface DateRange {
  start: string | Date;
  end: string | Date;
}

/**
 * `new Date(isoStringWithNoOffset)` is parsed as server-local time per the
 * ECMAScript spec, but RemoteLock's `starts_at`/`ends_at` carry no timezone
 * at all (lock-local time, not UTC) — going through `Date` would silently
 * shift the calendar date near midnight on any non-UTC server. Read the
 * Y-M-D digits directly out of the string instead of parsing it as a moment
 * in time.
 *
 * `Date` inputs get the same calendar-date treatment via their *local*
 * components. A reservation's `check_in`/`check_out` come from a pg `date`
 * column, which arrives as local midnight; reading UTC components off that
 * lands on the previous day on any server east of UTC (IST is -1 day), which
 * shifts the whole stay window and breaks boundary-day matches.
 */
export function toDateOnly(value: string | Date): number {
  if (value instanceof Date) {
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    throw new Error(`toDateOnly: unable to parse date-only value "${value}"`);
  }
  const [, year, month, day] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day));
}

export function overlapsDateRange(a: DateRange, b: DateRange): boolean {
  const aStart = toDateOnly(a.start);
  const aEnd = toDateOnly(a.end);
  const bStart = toDateOnly(b.start);
  const bEnd = toDateOnly(b.end);
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Calendar-date equality, for comparing a caller-supplied `YYYY-MM-DD` against a
 * reservation's `check_out` (a pg `date`, which arrives as a local-midnight
 * `Date`). Shares {@link toDateOnly}'s timezone handling.
 */
export function isSameCalendarDate(
  a: string | Date,
  b: string | Date,
): boolean {
  return toDateOnly(a) === toDateOnly(b);
}
