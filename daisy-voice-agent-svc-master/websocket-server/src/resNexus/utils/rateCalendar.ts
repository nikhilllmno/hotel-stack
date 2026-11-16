import dayjs from 'dayjs';
import {
  RateCalendar,
  RateCalendarRate,
} from '../../models/response/rateCalendar';
import { CalendarResponse } from '../model/response/reservation';
import { UnitGroup } from '../model/response/unitGroups';

const DATE_FORMAT = 'YYYY-MM-DD';

/**
 * Turns a ResNexus getcalendar response into one row per night between startDate and
 * endDate (both inclusive). ResNexus returns date ranges with an inclusive end_date, so
 * each range is expanded day by day; nights it doesn't cover come back as unavailable.
 */
export function buildResNexusRateCalendar(
  unitGroups: UnitGroup[],
  calendar: CalendarResponse,
  startDate: string,
  endDate: string,
): RateCalendar {
  const ratesByUnit = new Map<number, Map<string, RateCalendarRate>>();
  let currency: string | undefined;

  for (const group of calendar.calendars ?? []) {
    currency ??= group.currency || undefined;
    const ratesByDate = new Map<string, RateCalendarRate>();
    for (const range of group.data ?? []) {
      const rangeEnd = dayjs(range.end_date);
      for (
        let day = dayjs(range.start_date);
        !day.isAfter(rangeEnd, 'day');
        day = day.add(1, 'day')
      ) {
        ratesByDate.set(day.format(DATE_FORMAT), {
          unit_id: String(group.unit_group_id),
          // ResNexus sends -1 for nights it has no rate for (typically closed units).
          price:
            Number.isFinite(range.price) && range.price > 0
              ? range.price
              : null,
          available: range.available_units > 0,
          min_stay: range.min_stay > 0 ? range.min_stay : null,
        });
      }
    }
    ratesByUnit.set(group.unit_group_id, ratesByDate);
  }

  const units = unitGroups
    .filter((group) => group.number_of_units > 0)
    .map((group) => ({
      id: String(group.unit_group_id),
      name: group.name,
      max_guests: group.per_unit_capacity > 0 ? group.per_unit_capacity : null,
    }));

  const nights = [];
  const last = dayjs(endDate);
  for (
    let day = dayjs(startDate);
    !day.isAfter(last, 'day');
    day = day.add(1, 'day')
  ) {
    const date = day.format(DATE_FORMAT);
    nights.push({
      date,
      rates: units.map(
        (unit) =>
          ratesByUnit.get(Number(unit.id))?.get(date) ?? {
            unit_id: unit.id,
            price: null,
            available: false,
            min_stay: null,
          },
      ),
    });
  }

  return { currency: currency ?? 'USD', units, nights };
}
