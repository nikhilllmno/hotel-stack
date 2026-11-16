/* global describe, expect, it, jest */
import { BadRequestError } from '@/errors/BadRequestError';
import { NoDataError } from '@/errors/NoDataError';
import { RateCalendar } from '@/models/response/rateCalendar';
import { PMSServiceFactory } from '@/pms/PMSServiceFactory';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

const HOTEL_TZ = 'America/New_York';

function upcomingWindow() {
  const start = dayjs().tz(HOTEL_TZ).add(1, 'day');
  return {
    start_date: start.format('YYYY-MM-DD'),
    end_date: start.add(6, 'day').format('YYYY-MM-DD'),
  };
}

/** Night `day` of the month `monthsAhead` months from now, in the hotel's timezone. */
function laterNight(monthsAhead: number, day: number) {
  return dayjs()
    .tz(HOTEL_TZ)
    .add(monthsAhead, 'month')
    .startOf('month')
    .date(day)
    .format('YYYY-MM-DD');
}

const sampleCalendar: RateCalendar = {
  currency: 'USD',
  units: [{ id: '11', name: 'Creekside Yurt', max_guests: 4 }],
  nights: [],
};

/** The sample calendar with a night for every date from start to end. */
function calendarFor(start: string, end: string): RateCalendar {
  const nights = [];
  for (
    let day = dayjs(start);
    !day.isAfter(dayjs(end), 'day');
    day = day.add(1, 'day')
  ) {
    nights.push({ date: day.format('YYYY-MM-DD'), rates: [] });
  }
  return { ...sampleCalendar, nights };
}

const monthStart = (date: string) =>
  dayjs(date).startOf('month').format('YYYY-MM-DD');
const monthEnd = (date: string) =>
  dayjs(date).endOf('month').format('YYYY-MM-DD');

function factoryReturning(pmsService: object) {
  return {
    getReservationService: jest.fn().mockResolvedValue(pmsService),
  } as unknown as PMSServiceFactory;
}

describe('RoomReservationService.getRateCalendar', () => {
  const ctx = installPgMemTestContext();

  it("returns the requested nights with the hotel's name, fetching the whole month they fall in", async () => {
    const getRateCalendar = jest.fn(
      async (_businessId: string, start: string, end: string) =>
        calendarFor(start, end),
    );
    const { service } = createTestRoomReservationService({
      knex: ctx.knex,
      externalStubs: {
        pmsServiceFactory: factoryReturning({ getRateCalendar }),
      },
    });
    const window = {
      start_date: laterNight(2, 5),
      end_date: laterNight(2, 11),
    };

    const result = await service.getRateCalendar({
      business_id: RESERVATION_FLOW_FIXTURE_IDS.businessId,
      ...window,
    });

    expect(getRateCalendar).toHaveBeenCalledWith(
      RESERVATION_FLOW_FIXTURE_IDS.businessId,
      monthStart(window.start_date),
      monthEnd(window.start_date),
    );
    expect(result).toEqual({
      hotel_name: RESERVATION_FLOW_FIXTURE_IDS.hotelName,
      hotel_phone: RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
      hotel_website: 'https://hotel.test.dextr',
      ...window,
      ...calendarFor(window.start_date, window.end_date),
    });
  });

  it('serves overlapping windows in the same month from one PMS call, each with only its own nights', async () => {
    const getRateCalendar = jest.fn(
      async (_businessId: string, start: string, end: string) =>
        calendarFor(start, end),
    );
    const { service } = createTestRoomReservationService({
      knex: ctx.knex,
      externalStubs: {
        pmsServiceFactory: factoryReturning({ getRateCalendar }),
      },
    });
    const first = { start_date: laterNight(2, 5), end_date: laterNight(2, 11) };
    const second = {
      start_date: laterNight(2, 10),
      end_date: laterNight(2, 20),
    };

    const results = await Promise.all(
      [first, second].map((window) =>
        service.getRateCalendar({
          business_id: RESERVATION_FLOW_FIXTURE_IDS.businessId,
          ...window,
        }),
      ),
    );

    expect(getRateCalendar).toHaveBeenCalledTimes(1);
    [first, second].forEach((window, i) => {
      expect(results[i]).toMatchObject({
        ...window,
        nights: calendarFor(window.start_date, window.end_date).nights,
      });
    });
  });

  it('fetches every whole month a window touches', async () => {
    const getRateCalendar = jest.fn(
      async (_businessId: string, start: string, end: string) =>
        calendarFor(start, end),
    );
    const { service } = createTestRoomReservationService({
      knex: ctx.knex,
      externalStubs: {
        pmsServiceFactory: factoryReturning({ getRateCalendar }),
      },
    });
    const window = {
      start_date: laterNight(2, 25),
      end_date: laterNight(3, 5),
    };

    const result = await service.getRateCalendar({
      business_id: RESERVATION_FLOW_FIXTURE_IDS.businessId,
      ...window,
    });

    expect(getRateCalendar).toHaveBeenCalledWith(
      RESERVATION_FLOW_FIXTURE_IDS.businessId,
      monthStart(window.start_date),
      monthEnd(window.end_date),
    );
    expect(result).toMatchObject({
      ...window,
      nights: calendarFor(window.start_date, window.end_date).nights,
    });
  });

  it('serves repeat and concurrent requests for the same window from one PMS call', async () => {
    const getRateCalendar = jest.fn().mockResolvedValue(sampleCalendar);
    const { service } = createTestRoomReservationService({
      knex: ctx.knex,
      externalStubs: {
        pmsServiceFactory: factoryReturning({ getRateCalendar }),
      },
    });
    const params = {
      business_id: RESERVATION_FLOW_FIXTURE_IDS.businessId,
      ...upcomingWindow(),
    };

    await Promise.all([
      service.getRateCalendar(params),
      service.getRateCalendar(params),
    ]);
    await service.getRateCalendar(params);

    expect(getRateCalendar).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed PMS call', async () => {
    const getRateCalendar = jest
      .fn()
      .mockRejectedValueOnce(new Error('PMS timeout'))
      .mockResolvedValueOnce(sampleCalendar);
    const { service } = createTestRoomReservationService({
      knex: ctx.knex,
      externalStubs: {
        pmsServiceFactory: factoryReturning({ getRateCalendar }),
      },
    });
    const params = {
      business_id: RESERVATION_FLOW_FIXTURE_IDS.businessId,
      ...upcomingWindow(),
    };

    await expect(service.getRateCalendar(params)).rejects.toThrow(
      'PMS timeout',
    );
    await expect(service.getRateCalendar(params)).resolves.toMatchObject({
      currency: 'USD',
    });
    expect(getRateCalendar).toHaveBeenCalledTimes(2);
  });

  it('rejects a hotel whose PMS has no rate calendar', async () => {
    const { service } = createTestRoomReservationService({
      knex: ctx.knex,
      externalStubs: { pmsServiceFactory: factoryReturning({}) },
    });

    await expect(
      service.getRateCalendar({
        business_id: RESERVATION_FLOW_FIXTURE_IDS.businessId,
        ...upcomingWindow(),
      }),
    ).rejects.toThrow(BadRequestError);
  });

  it('returns NoDataError for an unknown business id', async () => {
    const { service } = createTestRoomReservationService({ knex: ctx.knex });

    await expect(
      service.getRateCalendar({ business_id: '999999', ...upcomingWindow() }),
    ).rejects.toThrow(NoDataError);
  });
});
