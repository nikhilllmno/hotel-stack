import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { LockboxLog, LockboxLogEntry } from '../types';

dayjs.extend(utc);
dayjs.extend(timezone);

/** Before this local hour, a Today tab dated yesterday still applies. */
const OVERNIGHT_CUTOFF_HOUR = 12;

export interface LockboxAssignment {
  /** The date the entries were assigned for (YYYY-MM-DD). */
  date: string;
  source: 'today' | 'archive';
  entries: LockboxLogEntry[];
}

/**
 * The dates (YYYY-MM-DD) a lockbox assignment in force right now can be for,
 * in the hotel's timezone, today first: today, and before noon also
 * yesterday, since a guest arriving after midnight uses the previous
 * evening's assignment. The log ({@link selectLockboxAssignment}) and the
 * reservation check both go by these dates.
 */
export function lockboxAssignmentDates(
  hotelTimezone: string,
  now: Date,
): string[] {
  const local = dayjs(now).tz(hotelTimezone);
  const today = local.format('YYYY-MM-DD');
  if (local.hour() >= OVERNIGHT_CUTOFF_HOUR) return [today];
  return [today, dayjs.utc(today).subtract(1, 'day').format('YYYY-MM-DD')];
}

/**
 * The lockbox assignments in force right now, in the hotel's timezone:
 * - the Today tab, when it is dated one of {@link lockboxAssignmentDates}
 *   (today, or yesterday before noon);
 * - otherwise the Archive rows dated today.
 * Null when none of these exist, i.e. the log hasn't been kept up to date.
 */
export function selectLockboxAssignment(
  log: LockboxLog,
  hotelTimezone: string,
  now: Date,
): LockboxAssignment | null {
  const dates = lockboxAssignmentDates(hotelTimezone, now);
  const todayTabDate = log.today.date;

  if (todayTabDate && dates.includes(todayTabDate)) {
    return { date: todayTabDate, source: 'today', entries: log.today.entries };
  }

  const [today] = dates;
  const archived = log.archive.get(today);
  return archived?.length
    ? { date: today, source: 'archive', entries: archived }
    : null;
}
