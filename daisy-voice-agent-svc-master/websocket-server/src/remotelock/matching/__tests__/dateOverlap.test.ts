import {
  isSameCalendarDate,
  overlapsDateRange,
} from '@/remotelock/matching/dateOverlap';

describe('overlapsDateRange', () => {
  it('returns true when ranges are identical', () => {
    expect(
      overlapsDateRange(
        { start: '2026-08-01T14:00:00', end: '2026-08-05T11:00:00' },
        { start: '2026-08-01T00:00:00', end: '2026-08-05T00:00:00' },
      ),
    ).toBe(true);
  });

  it('ignores time-of-day, comparing only calendar dates', () => {
    expect(
      overlapsDateRange(
        { start: '2026-08-01T23:59:00', end: '2026-08-05T00:01:00' },
        { start: '2026-08-01T00:00:00', end: '2026-08-05T00:00:00' },
      ),
    ).toBe(true);
  });

  it('returns true for a room-change day where windows abut', () => {
    // guest checks out old room and starts new room on the same day
    expect(
      overlapsDateRange(
        { start: '2026-08-03T00:00:00', end: '2026-08-05T00:00:00' },
        { start: '2026-08-01T00:00:00', end: '2026-08-03T00:00:00' },
      ),
    ).toBe(true);
  });

  it('returns false when ranges do not overlap at all', () => {
    expect(
      overlapsDateRange(
        { start: '2026-08-10T00:00:00', end: '2026-08-12T00:00:00' },
        { start: '2026-08-01T00:00:00', end: '2026-08-05T00:00:00' },
      ),
    ).toBe(false);
  });

  it('reads the calendar date from the string directly, unaffected by server timezone', () => {
    const originalTZ = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati'; // UTC+14 — furthest-ahead TZ, maximizes any local-parse shift
    try {
      expect(
        overlapsDateRange(
          { start: '2026-08-01T00:30:00', end: '2026-08-05T00:00:00' },
          { start: '2026-08-01T14:00:00', end: '2026-08-05T11:00:00' },
        ),
      ).toBe(true);
    } finally {
      process.env.TZ = originalTZ;
    }
  });

  it('accepts Date instances as well as strings', () => {
    expect(
      overlapsDateRange(
        {
          start: new Date('2026-08-02T00:00:00Z'),
          end: new Date('2026-08-04T00:00:00Z'),
        },
        { start: '2026-08-01T00:00:00', end: '2026-08-05T00:00:00' },
      ),
    ).toBe(true);
  });

  it('reads a local-midnight Date as its own calendar day east of UTC', () => {
    const originalTZ = process.env.TZ;
    process.env.TZ = 'Asia/Kolkata'; // UTC+5:30 — local midnight is 18:30Z the previous day
    try {
      // What a pg `date` column yields: local midnight on the checkout day.
      const checkIn = new Date(2026, 7, 5, 0, 0, 0);
      const checkOut = new Date(2026, 7, 7, 0, 0, 0);

      // A guest whose window is exactly the stay must match on both boundaries.
      expect(
        overlapsDateRange(
          { start: '2026-08-05T15:00:00', end: '2026-08-07T11:00:00' },
          { start: checkIn, end: checkOut },
        ),
      ).toBe(true);

      // The day before check-in must not.
      expect(
        overlapsDateRange(
          { start: '2026-08-04T15:00:00', end: '2026-08-04T23:00:00' },
          { start: checkIn, end: checkOut },
        ),
      ).toBe(false);
    } finally {
      process.env.TZ = originalTZ;
    }
  });
});

describe('isSameCalendarDate', () => {
  it('matches two date-only strings', () => {
    expect(isSameCalendarDate('2026-08-24', '2026-08-24')).toBe(true);
    expect(isSameCalendarDate('2026-08-24', '2026-08-25')).toBe(false);
  });

  it('ignores the time part of a timestamp string', () => {
    expect(isSameCalendarDate('2026-08-24T11:00:00', '2026-08-24')).toBe(true);
  });

  // A pg `date` column arrives as local midnight; comparing it against the
  // caller's YYYY-MM-DD must not shift a day on a non-UTC server.
  it('matches a local-midnight Date against a date-only string east of UTC', () => {
    const originalTZ = process.env.TZ;
    process.env.TZ = 'Asia/Kolkata';
    try {
      expect(
        isSameCalendarDate(new Date(2026, 7, 24, 0, 0, 0), '2026-08-24'),
      ).toBe(true);
      expect(
        isSameCalendarDate(new Date(2026, 7, 24, 0, 0, 0), '2026-08-23'),
      ).toBe(false);
    } finally {
      process.env.TZ = originalTZ;
    }
  });
});
