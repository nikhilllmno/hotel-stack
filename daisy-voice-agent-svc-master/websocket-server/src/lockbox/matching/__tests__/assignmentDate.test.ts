/* global describe, expect, it */
import {
  lockboxAssignmentDates,
  selectLockboxAssignment,
} from '@/lockbox/matching/assignmentDate';
import { LockboxLog, LockboxLogEntry } from '@/lockbox/types';

const TIMEZONE = 'America/Los_Angeles';

const todayEntries: LockboxLogEntry[] = [
  {
    lockboxNumber: '1',
    guestName: 'OPEN',
    originalNameText: '',
    rooms: ['7'],
    code: '*1111',
    notes: '',
  },
];
const archivedEntries: LockboxLogEntry[] = [
  {
    lockboxNumber: '1',
    guestName: 'OPEN',
    originalNameText: '',
    rooms: ['7'],
    code: '*2222',
    notes: '',
  },
];

function log(
  todayDate: string | null,
  archive: Record<string, LockboxLogEntry[]> = {},
): LockboxLog {
  return {
    sheetNames: ['Today', 'Archive'],
    today: { date: todayDate, entries: todayEntries },
    archive: new Map(Object.entries(archive)),
  };
}

/** A wall-clock time at the hotel; October 2026 in Los Angeles is UTC-7. */
function pacific(isoLocal: string): Date {
  return new Date(`${isoLocal}-07:00`);
}

describe('lockboxAssignmentDates', () => {
  it('is today and yesterday until 11:59', () => {
    expect(
      lockboxAssignmentDates(TIMEZONE, pacific('2026-10-29T11:59:59')),
    ).toEqual(['2026-10-29', '2026-10-28']);
  });

  it('is only today from noon', () => {
    expect(
      lockboxAssignmentDates(TIMEZONE, pacific('2026-10-29T12:00:00')),
    ).toEqual(['2026-10-29']);
  });

  it('crosses a month boundary', () => {
    expect(
      lockboxAssignmentDates(TIMEZONE, pacific('2026-11-01T00:30:00')),
    ).toEqual(['2026-11-01', '2026-10-31']);
  });

  it("is read in the hotel's timezone, not UTC", () => {
    // 05:30 UTC on Oct 29 is 22:30 on Oct 28 in Los Angeles.
    const now = new Date('2026-10-29T05:30:00Z');

    expect(lockboxAssignmentDates(TIMEZONE, now)).toEqual(['2026-10-28']);
    expect(lockboxAssignmentDates('UTC', now)).toEqual([
      '2026-10-29',
      '2026-10-28',
    ]);
  });
});

describe('selectLockboxAssignment', () => {
  it('uses the Today tab when it is dated today', () => {
    expect(
      selectLockboxAssignment(
        log('2026-10-28'),
        TIMEZONE,
        pacific('2026-10-28T21:30:00'),
      ),
    ).toEqual({ date: '2026-10-28', source: 'today', entries: todayEntries });
  });

  // A guest arriving at 1 AM was given last evening's box.
  it("keeps using yesterday's Today tab until noon", () => {
    expect(
      selectLockboxAssignment(
        log('2026-10-27'),
        TIMEZONE,
        pacific('2026-10-28T11:59:00'),
      ),
    ).toEqual({ date: '2026-10-27', source: 'today', entries: todayEntries });
  });

  it("stops using yesterday's Today tab at noon and falls back to the Archive", () => {
    const result = selectLockboxAssignment(
      log('2026-10-27', { '2026-10-28': archivedEntries }),
      TIMEZONE,
      pacific('2026-10-28T12:00:00'),
    );

    expect(result).toEqual({
      date: '2026-10-28',
      source: 'archive',
      entries: archivedEntries,
    });
  });

  it('uses the Archive for today when the Today tab has moved on to another date', () => {
    const result = selectLockboxAssignment(
      log('2026-10-29', {
        '2026-10-27': todayEntries,
        '2026-10-28': archivedEntries,
      }),
      TIMEZONE,
      pacific('2026-10-28T23:00:00'),
    );

    expect(result?.source).toBe('archive');
    expect(result?.entries).toBe(archivedEntries);
  });

  it('uses the Archive when the Today date cannot be read', () => {
    expect(
      selectLockboxAssignment(
        log(null, { '2026-10-28': archivedEntries }),
        TIMEZONE,
        pacific('2026-10-28T20:00:00'),
      )?.source,
    ).toBe('archive');
  });

  it('returns null when neither the Today tab nor the Archive covers today', () => {
    expect(
      selectLockboxAssignment(
        log('2026-10-25', { '2026-10-25': archivedEntries }),
        TIMEZONE,
        pacific('2026-10-28T20:00:00'),
      ),
    ).toBeNull();
  });

  it("decides 'today' in the hotel's timezone, not UTC", () => {
    // 23:45 on Oct 28 in Los Angeles is already Oct 29 in UTC, and 12:15
    // on Oct 29 in Kolkata, where yesterday's Today tab no longer applies.
    const now = pacific('2026-10-28T23:45:00');
    expect(now.toISOString().slice(0, 10)).toBe('2026-10-29');

    expect(
      selectLockboxAssignment(log('2026-10-28'), TIMEZONE, now)?.source,
    ).toBe('today');
    expect(
      selectLockboxAssignment(log('2026-10-28'), 'Asia/Kolkata', now),
    ).toBeNull();
  });
});
