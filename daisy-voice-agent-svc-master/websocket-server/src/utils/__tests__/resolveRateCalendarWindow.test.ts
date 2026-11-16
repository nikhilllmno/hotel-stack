/* global afterEach, beforeEach, describe, expect, it, jest */
import { BadRequestError } from '../../errors/BadRequestError';
import {
  RATE_CALENDAR_MAX_NIGHTS,
  rateCalendarMonthWindow,
  resolveRateCalendarWindow,
} from '../helper';

const TIMEZONE = 'America/Los_Angeles';

describe('resolveRateCalendarWindow', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // 10:00 on Nov 10 in Los Angeles.
    jest.setSystemTime(new Date('2026-11-10T18:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps a window that starts today or later', () => {
    expect(
      resolveRateCalendarWindow('2026-11-10', '2026-11-30', TIMEZONE),
    ).toEqual({ startDate: '2026-11-10', endDate: '2026-11-30' });
  });

  it("moves a past start date up to today in the hotel's timezone", () => {
    expect(
      resolveRateCalendarWindow('2026-11-01', '2026-11-30', TIMEZONE),
    ).toEqual({ startDate: '2026-11-10', endDate: '2026-11-30' });
  });

  it('allows a single night', () => {
    expect(
      resolveRateCalendarWindow('2026-11-12', '2026-11-12', TIMEZONE),
    ).toEqual({ startDate: '2026-11-12', endDate: '2026-11-12' });
  });

  it.each([
    ['an end date in the past', '2026-10-01', '2026-10-31'],
    ['an end date before the start date', '2026-11-20', '2026-11-19'],
    ['an impossible date', '2026-11-10', '2026-11-31'],
  ])('rejects %s', (_label, start, end) => {
    expect(() => resolveRateCalendarWindow(start, end, TIMEZONE)).toThrow(
      BadRequestError,
    );
  });

  it(`rejects a window longer than ${RATE_CALENDAR_MAX_NIGHTS} nights`, () => {
    expect(() =>
      resolveRateCalendarWindow('2026-11-10', '2027-01-11', TIMEZONE),
    ).toThrow(BadRequestError);
    expect(
      resolveRateCalendarWindow('2026-11-10', '2027-01-10', TIMEZONE),
    ).toEqual({ startDate: '2026-11-10', endDate: '2027-01-10' });
  });
});

describe('rateCalendarMonthWindow', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // 10:00 on Nov 10 in Los Angeles.
    jest.setSystemTime(new Date('2026-11-10T18:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('covers the rest of the current month, from today', () => {
    expect(
      rateCalendarMonthWindow('2026-11-12', '2026-11-20', TIMEZONE),
    ).toEqual({ startDate: '2026-11-10', endDate: '2026-11-30' });
  });

  it('covers a later month from its first night to its last', () => {
    expect(
      rateCalendarMonthWindow('2026-12-05', '2026-12-12', TIMEZONE),
    ).toEqual({ startDate: '2026-12-01', endDate: '2026-12-31' });
  });

  it('covers every month a window touches', () => {
    expect(
      rateCalendarMonthWindow('2026-11-25', '2027-01-10', TIMEZONE),
    ).toEqual({ startDate: '2026-11-10', endDate: '2027-01-31' });
  });

  it("uses today in the hotel's timezone", () => {
    // Already 07:00 on Nov 11 in Auckland.
    expect(
      rateCalendarMonthWindow('2026-11-12', '2026-11-20', 'Pacific/Auckland'),
    ).toEqual({ startDate: '2026-11-11', endDate: '2026-11-30' });
  });

  it('never starts after the window it covers', () => {
    expect(
      rateCalendarMonthWindow('2026-11-05', '2026-11-08', TIMEZONE),
    ).toEqual({ startDate: '2026-11-05', endDate: '2026-11-30' });
  });
});
