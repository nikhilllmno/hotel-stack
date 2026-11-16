import dayjs from 'dayjs';
import { DateModificationScenario } from '../types/ExternalModification';

/**
 * Determines how a proposed check-in/check-out change relates to the
 * existing reservation dates.
 */
export function determineDateModificationScenario(
  existingCheckIn: string,
  existingCheckOut: string,
  newCheckIn: string,
  newCheckOut: string,
): DateModificationScenario {
  const existingStart = dayjs(existingCheckIn);
  const existingEnd = dayjs(existingCheckOut);
  const newStart = dayjs(newCheckIn);
  const newEnd = dayjs(newCheckOut);

  if (newStart.isSame(existingStart) && newEnd.isSame(existingEnd)) {
    return 'same_dates';
  }

  const hasOverlap =
    newStart.isBefore(existingEnd) && newEnd.isAfter(existingStart);
  if (!hasOverlap) {
    return 'non_overlapping';
  }

  const isReduction =
    !newStart.isBefore(existingStart) && !newEnd.isAfter(existingEnd);
  if (isReduction) {
    return 'stay_reduction';
  }

  return 'stay_extension';
}

/**
 * Groups sorted YYYY-MM-DD date strings into contiguous ranges.
 * e.g. ["2026-09-25", "2026-09-28", "2026-09-29"] → [["2026-09-25"], ["2026-09-28", "2026-09-29"]]
 */
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
