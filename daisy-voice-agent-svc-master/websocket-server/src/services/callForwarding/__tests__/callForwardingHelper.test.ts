import { CallForwardingConfiguration } from '@/types/hotelConfiguration';
import {
  CallForwardingHelper,
  callForwardingHelper,
} from '../callForwardingHelper';

describe('CallForwardingService', () => {
  let service: CallForwardingHelper;

  beforeEach(() => {
    service = callForwardingHelper;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const mockConfig = (
    overrides?: Partial<CallForwardingConfiguration>,
  ): CallForwardingConfiguration => ({
    enabled: true,
    default_phone_number: '+10000000000',
    rules: [],
    ...overrides,
  });

  /**
   * Sets the fake system time so that dayjs().tz(tz) will produce the expected local time.
   * We compute the UTC instant that corresponds to `localTimeStr` in the given timezone.
   */
  function setTime(localTimeStr: string, tz: string) {
    // localTimeStr e.g. "2025-06-10 14:00"
    // We construct a UTC date that, when viewed in `tz`, shows localTimeStr
    const dayjs = require('dayjs');
    require('dayjs/plugin/utc');
    require('dayjs/plugin/timezone');
    dayjs.extend(require('dayjs/plugin/utc'));
    dayjs.extend(require('dayjs/plugin/timezone'));

    const utcDate = dayjs.tz(localTimeStr, tz).toDate();
    jest.setSystemTime(utcDate);
  }

  describe('returns null when config is missing or disabled', () => {
    it('returns null when config is null', () => {
      expect(
        service.resolveForwardingNumber(null, 'America/New_York'),
      ).toBeNull();
    });

    it('returns null when config is undefined', () => {
      expect(
        service.resolveForwardingNumber(undefined, 'America/New_York'),
      ).toBeNull();
    });

    it('returns null when config is disabled', () => {
      const config = mockConfig({ enabled: false });
      expect(
        service.resolveForwardingNumber(config, 'America/New_York'),
      ).toBeNull();
    });
  });

  describe('returns default_phone_number when no rules match', () => {
    it('returns default when rules array is empty', () => {
      setTime('2025-06-10 14:00', 'America/New_York');
      const result = service.resolveForwardingNumber(
        mockConfig(),
        'America/New_York',
      );
      expect(result).toBe('+10000000000');
    });

    it('returns default when all rules are disabled', () => {
      setTime('2025-06-10 14:00', 'America/New_York');
      const config = mockConfig({
        rules: [
          {
            id: '1',
            priority: 10,
            phone_number: '+11111111111',
            conditions: {},
            enabled: false,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+10000000000');
    });

    it('returns default when no rule conditions match', () => {
      setTime('2025-06-10 14:00', 'America/New_York'); // Tuesday
      const config = mockConfig({
        rules: [
          {
            id: '1',
            priority: 10,
            phone_number: '+11111111111',
            conditions: { days_of_week: [0] }, // Sunday only
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+10000000000');
    });
  });

  describe('priority-based rule selection', () => {
    it('selects the rule with the highest priority when multiple match', () => {
      setTime('2025-06-10 14:00', 'America/New_York'); // Tuesday
      const config = mockConfig({
        rules: [
          {
            id: 'low',
            priority: 5,
            phone_number: '+11111111111',
            conditions: { days_of_week: [2] },
            enabled: true,
          },
          {
            id: 'high',
            priority: 20,
            phone_number: '+12222222222',
            conditions: { days_of_week: [2] },
            enabled: true,
          },
          {
            id: 'mid',
            priority: 10,
            phone_number: '+13333333333',
            conditions: { days_of_week: [2] },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+12222222222');
    });
  });

  describe('day_of_week matching', () => {
    it('matches when today is in days_of_week', () => {
      setTime('2025-06-10 14:00', 'America/New_York'); // Tuesday = day 2
      const config = mockConfig({
        rules: [
          {
            id: '1',
            priority: 10,
            phone_number: '+11111111111',
            conditions: { days_of_week: [1, 2, 3, 4, 5] },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+11111111111');
    });

    it('does not match when today is not in days_of_week', () => {
      setTime('2025-06-08 14:00', 'America/New_York'); // Sunday = day 0
      const config = mockConfig({
        rules: [
          {
            id: '1',
            priority: 10,
            phone_number: '+11111111111',
            conditions: { days_of_week: [1, 2, 3, 4, 5] },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+10000000000');
    });
  });

  describe('specific_dates matching', () => {
    it('matches when today is in specific_dates', () => {
      setTime('2025-12-25 10:00', 'America/New_York');
      const config = mockConfig({
        rules: [
          {
            id: 'christmas',
            priority: 30,
            phone_number: '+19999999999',
            label: 'Christmas Line',
            conditions: { specific_dates: ['2025-12-25'] },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+19999999999');
    });

    it('does not match when today is not in specific_dates', () => {
      setTime('2025-12-24 10:00', 'America/New_York');
      const config = mockConfig({
        rules: [
          {
            id: 'christmas',
            priority: 30,
            phone_number: '+19999999999',
            conditions: { specific_dates: ['2025-12-25'] },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+10000000000');
    });
  });

  describe('time_range matching (normal range)', () => {
    it('matches when current time is within a normal range', () => {
      setTime('2025-06-10 12:30', 'America/New_York');
      const config = mockConfig({
        rules: [
          {
            id: 'business',
            priority: 10,
            phone_number: '+11111111111',
            conditions: { time_range: { start: '08:00', end: '17:00' } },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+11111111111');
    });

    it('does not match when current time is before start', () => {
      setTime('2025-06-10 07:59', 'America/New_York');
      const config = mockConfig({
        rules: [
          {
            id: 'business',
            priority: 10,
            phone_number: '+11111111111',
            conditions: { time_range: { start: '08:00', end: '17:00' } },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+10000000000');
    });

    it('does not match when current time is at or after end', () => {
      setTime('2025-06-10 17:00', 'America/New_York');
      const config = mockConfig({
        rules: [
          {
            id: 'business',
            priority: 10,
            phone_number: '+11111111111',
            conditions: { time_range: { start: '08:00', end: '17:00' } },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+10000000000');
    });

    it('matches at exact start time', () => {
      setTime('2025-06-10 08:00', 'America/New_York');
      const config = mockConfig({
        rules: [
          {
            id: 'business',
            priority: 10,
            phone_number: '+11111111111',
            conditions: { time_range: { start: '08:00', end: '17:00' } },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+11111111111');
    });
  });

  describe('time_range matching (overnight / cross-midnight range)', () => {
    it('matches in the late evening portion (after start)', () => {
      setTime('2025-06-10 23:30', 'America/New_York');
      const config = mockConfig({
        rules: [
          {
            id: 'night',
            priority: 20,
            phone_number: '+15555555555',
            label: 'Night Manager',
            conditions: { time_range: { start: '22:00', end: '06:00' } },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+15555555555');
    });

    it('matches in the early morning portion (before end)', () => {
      setTime('2025-06-11 03:00', 'America/New_York');
      const config = mockConfig({
        rules: [
          {
            id: 'night',
            priority: 20,
            phone_number: '+15555555555',
            conditions: { time_range: { start: '22:00', end: '06:00' } },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+15555555555');
    });

    it('does not match during the day (between end and start)', () => {
      setTime('2025-06-10 12:00', 'America/New_York');
      const config = mockConfig({
        rules: [
          {
            id: 'night',
            priority: 20,
            phone_number: '+15555555555',
            conditions: { time_range: { start: '22:00', end: '06:00' } },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+10000000000');
    });

    it('matches at exact start time of overnight range', () => {
      setTime('2025-06-10 22:00', 'America/New_York');
      const config = mockConfig({
        rules: [
          {
            id: 'night',
            priority: 20,
            phone_number: '+15555555555',
            conditions: { time_range: { start: '22:00', end: '06:00' } },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+15555555555');
    });

    it('does not match at exact end time of overnight range', () => {
      setTime('2025-06-10 06:00', 'America/New_York');
      const config = mockConfig({
        rules: [
          {
            id: 'night',
            priority: 20,
            phone_number: '+15555555555',
            conditions: { time_range: { start: '22:00', end: '06:00' } },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+10000000000');
    });
  });

  describe('overnight range with days_of_week (yesterday check)', () => {
    it('matches early Saturday morning for a Friday night shift rule', () => {
      setTime('2025-06-14 03:00', 'America/New_York'); // Saturday, yesterday was Friday
      const config = mockConfig({
        rules: [
          {
            id: 'fri-night',
            priority: 20,
            phone_number: '+15555555555',
            label: 'Friday Night Manager',
            conditions: {
              days_of_week: [5], // Friday
              time_range: { start: '22:00', end: '06:00' },
            },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+15555555555');
    });

    it('does not match early Sunday morning for a Friday night shift rule', () => {
      setTime('2025-06-15 03:00', 'America/New_York'); // Sunday, yesterday was Saturday
      const config = mockConfig({
        rules: [
          {
            id: 'fri-night',
            priority: 20,
            phone_number: '+15555555555',
            conditions: {
              days_of_week: [5], // Friday
              time_range: { start: '22:00', end: '06:00' },
            },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+10000000000');
    });

    it('matches Friday evening for a Friday night shift rule', () => {
      setTime('2025-06-13 23:00', 'America/New_York'); // Friday at 23:00
      const config = mockConfig({
        rules: [
          {
            id: 'fri-night',
            priority: 20,
            phone_number: '+15555555555',
            conditions: {
              days_of_week: [5], // Friday
              time_range: { start: '22:00', end: '06:00' },
            },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+15555555555');
    });
  });

  describe('combined conditions (AND logic)', () => {
    it('matches only when ALL conditions are true', () => {
      setTime('2025-06-10 14:00', 'America/New_York'); // Tuesday at 14:00
      const config = mockConfig({
        rules: [
          {
            id: 'weekday-business',
            priority: 10,
            phone_number: '+11111111111',
            conditions: {
              days_of_week: [1, 2, 3, 4, 5],
              time_range: { start: '08:00', end: '17:00' },
            },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+11111111111');
    });

    it('does not match when day matches but time does not', () => {
      setTime('2025-06-10 20:00', 'America/New_York'); // Tuesday at 20:00
      const config = mockConfig({
        rules: [
          {
            id: 'weekday-business',
            priority: 10,
            phone_number: '+11111111111',
            conditions: {
              days_of_week: [1, 2, 3, 4, 5],
              time_range: { start: '08:00', end: '17:00' },
            },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+10000000000');
    });

    it('does not match when time matches but day does not', () => {
      setTime('2025-06-08 10:00', 'America/New_York'); // Sunday at 10:00
      const config = mockConfig({
        rules: [
          {
            id: 'weekday-business',
            priority: 10,
            phone_number: '+11111111111',
            conditions: {
              days_of_week: [1, 2, 3, 4, 5],
              time_range: { start: '08:00', end: '17:00' },
            },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+10000000000');
    });

    it('specific_date + time_range both must match', () => {
      const config = mockConfig({
        rules: [
          {
            id: 'christmas-morning',
            priority: 30,
            phone_number: '+19999999999',
            conditions: {
              specific_dates: ['2025-12-25'],
              time_range: { start: '08:00', end: '12:00' },
            },
            enabled: true,
          },
        ],
      });
      // Christmas at 10:00 — both match
      setTime('2025-12-25 10:00', 'America/New_York');
      expect(service.resolveForwardingNumber(config, 'America/New_York')).toBe(
        '+19999999999',
      );

      // Christmas at 14:00 — date matches, time does not
      setTime('2025-12-25 14:00', 'America/New_York');
      expect(service.resolveForwardingNumber(config, 'America/New_York')).toBe(
        '+10000000000',
      );

      // Dec 24 at 10:00 — time matches, date does not
      setTime('2025-12-24 10:00', 'America/New_York');
      expect(service.resolveForwardingNumber(config, 'America/New_York')).toBe(
        '+10000000000',
      );
    });
  });

  describe('complex real-world scenario', () => {
    const hotelConfig = mockConfig({
      default_phone_number: '+10000000000',
      rules: [
        {
          id: 'weekday-front-desk',
          priority: 10,
          phone_number: '+11111111111',
          label: 'Front Desk',
          conditions: {
            days_of_week: [1, 2, 3, 4, 5],
            time_range: { start: '08:00', end: '17:00' },
          },
          enabled: true,
        },
        {
          id: 'weekend-manager',
          priority: 10,
          phone_number: '+12222222222',
          label: 'Weekend Manager',
          conditions: {
            days_of_week: [0, 6],
          },
          enabled: true,
        },
        {
          id: 'night-shift',
          priority: 20,
          phone_number: '+13333333333',
          label: 'Night Manager',
          conditions: {
            time_range: { start: '22:00', end: '06:00' },
          },
          enabled: true,
        },
        {
          id: 'christmas',
          priority: 30,
          phone_number: '+14444444444',
          label: 'Holiday Line',
          conditions: {
            specific_dates: ['2025-12-25'],
          },
          enabled: true,
        },
      ],
    });

    it('weekday business hours -> front desk', () => {
      setTime('2025-06-10 10:00', 'America/New_York'); // Tuesday 10am
      const result = service.resolveForwardingNumber(
        hotelConfig,
        'America/New_York',
      );
      expect(result).toBe('+11111111111');
    });

    it('weekday evening (not night shift yet) -> default', () => {
      setTime('2025-06-10 19:00', 'America/New_York'); // Tuesday 7pm
      const result = service.resolveForwardingNumber(
        hotelConfig,
        'America/New_York',
      );
      expect(result).toBe('+10000000000');
    });

    it('weekday night shift -> night manager (higher priority)', () => {
      setTime('2025-06-10 23:00', 'America/New_York'); // Tuesday 11pm
      const result = service.resolveForwardingNumber(
        hotelConfig,
        'America/New_York',
      );
      expect(result).toBe('+13333333333');
    });

    it('weekend daytime -> weekend manager', () => {
      setTime('2025-06-14 14:00', 'America/New_York'); // Saturday 2pm
      const result = service.resolveForwardingNumber(
        hotelConfig,
        'America/New_York',
      );
      expect(result).toBe('+12222222222');
    });

    it('weekend night -> night manager beats weekend manager (higher priority)', () => {
      setTime('2025-06-14 23:00', 'America/New_York'); // Saturday 11pm
      const result = service.resolveForwardingNumber(
        hotelConfig,
        'America/New_York',
      );
      expect(result).toBe('+13333333333');
    });

    it('christmas day -> holiday line beats everything (highest priority)', () => {
      setTime('2025-12-25 10:00', 'America/New_York'); // Christmas 10am
      const result = service.resolveForwardingNumber(
        hotelConfig,
        'America/New_York',
      );
      expect(result).toBe('+14444444444');
    });
  });

  describe('timezone awareness', () => {
    it('uses the hotel timezone for evaluation', () => {
      setTime('2025-06-10 14:00', 'Asia/Kolkata');
      const config = mockConfig({
        rules: [
          {
            id: 'business',
            priority: 10,
            phone_number: '+11111111111',
            conditions: { time_range: { start: '08:00', end: '17:00' } },
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(config, 'Asia/Kolkata');
      expect(result).toBe('+11111111111');
    });
  });

  describe('rule with no conditions matches always', () => {
    it('a rule with empty conditions object always matches', () => {
      setTime('2025-06-10 03:00', 'America/New_York');
      const config = mockConfig({
        rules: [
          {
            id: 'catch-all',
            priority: 5,
            phone_number: '+18888888888',
            conditions: {},
            enabled: true,
          },
        ],
      });
      const result = service.resolveForwardingNumber(
        config,
        'America/New_York',
      );
      expect(result).toBe('+18888888888');
    });
  });
});
