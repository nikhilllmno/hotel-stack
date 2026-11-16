import {
  CalendarDayData,
  CalendarResponse,
} from '../../model/response/reservation';
import { UnitGroup } from '../../model/response/unitGroups';
import { buildResNexusRateCalendar } from '../rateCalendar';

function unitGroup(overrides: Partial<UnitGroup> = {}): UnitGroup {
  return {
    unit_group_id: 11,
    business_id: 1001,
    name: 'Creekside Yurt',
    unit_ids: [1, 2],
    number_of_units: 2,
    description: '',
    per_unit_capacity: 4,
    max_children: 2,
    unit_type: 'Yurt',
    ...overrides,
  };
}

function day(overrides: Partial<CalendarDayData>): CalendarDayData {
  return {
    start_date: '2026-11-01',
    end_date: '2026-11-01',
    price: 189,
    available_units: 1,
    booked_units: 1,
    blocked_units: 0,
    adults_included_in_rate: 2,
    extra_adult_rate: null,
    min_stay: 1,
    ...overrides,
  };
}

function calendar(
  groups: Array<{ id: number; data: CalendarDayData[]; currency?: string }>,
): CalendarResponse {
  return {
    business_id: 1001,
    response_errors: [],
    calendars: groups.map((group) => ({
      unit_group_id: group.id,
      currency: group.currency ?? 'USD',
      data: group.data,
      multi_unit: { total_units: 2, unit_ids: ['1', '2'] },
    })),
  };
}

describe('buildResNexusRateCalendar', () => {
  it('expands an inclusive date range into one night per date', () => {
    const result = buildResNexusRateCalendar(
      [unitGroup()],
      calendar([
        {
          id: 11,
          data: [
            day({
              start_date: '2026-11-01',
              end_date: '2026-11-03',
              price: 189,
              min_stay: 2,
            }),
          ],
        },
      ]),
      '2026-11-01',
      '2026-11-03',
    );

    expect(result.nights.map((night) => night.date)).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ]);
    expect(result.nights[2].rates).toEqual([
      { unit_id: '11', price: 189, available: true, min_stay: 2 },
    ]);
  });

  it('marks nights with no open units, or no calendar data, as unavailable', () => {
    const result = buildResNexusRateCalendar(
      [unitGroup()],
      calendar([
        {
          id: 11,
          data: [day({ start_date: '2026-11-01', available_units: 0 })],
        },
      ]),
      '2026-11-01',
      '2026-11-02',
    );

    expect(result.nights[0].rates[0]).toMatchObject({
      available: false,
      price: 189,
    });
    expect(result.nights[1].rates[0]).toEqual({
      unit_id: '11',
      price: null,
      available: false,
      min_stay: null,
    });
  });

  it("treats ResNexus's -1 price as no price", () => {
    const result = buildResNexusRateCalendar(
      [unitGroup()],
      calendar([
        { id: 11, data: [day({ price: -1, available_units: 0, min_stay: 2 })] },
      ]),
      '2026-11-01',
      '2026-11-01',
    );

    expect(result.nights[0].rates[0]).toEqual({
      unit_id: '11',
      price: null,
      available: false,
      min_stay: 2,
    });
  });

  it('lists every unit group with units, in PMS order, on every night', () => {
    const result = buildResNexusRateCalendar(
      [
        unitGroup(),
        unitGroup({ unit_group_id: 12, name: 'Safari Tent' }),
        unitGroup({ unit_group_id: 13, name: 'Retired', number_of_units: 0 }),
      ],
      calendar([
        { id: 11, data: [day({ price: 189 })] },
        { id: 12, data: [day({ price: 149 })] },
      ]),
      '2026-11-01',
      '2026-11-01',
    );

    expect(result.units).toEqual([
      { id: '11', name: 'Creekside Yurt', max_guests: 4 },
      { id: '12', name: 'Safari Tent', max_guests: 4 },
    ]);
    expect(result.nights[0].rates.map((rate) => rate.price)).toEqual([
      189, 149,
    ]);
  });

  it('ignores calendar days outside the requested window', () => {
    const result = buildResNexusRateCalendar(
      [unitGroup()],
      calendar([
        {
          id: 11,
          data: [day({ start_date: '2026-10-30', end_date: '2026-11-04' })],
        },
      ]),
      '2026-11-01',
      '2026-11-02',
    );

    expect(result.nights).toHaveLength(2);
  });

  it('takes the currency from the calendar and defaults to USD', () => {
    const withCurrency = buildResNexusRateCalendar(
      [unitGroup()],
      calendar([{ id: 11, data: [day({})], currency: 'CAD' }]),
      '2026-11-01',
      '2026-11-01',
    );
    const empty = buildResNexusRateCalendar(
      [],
      calendar([]),
      '2026-11-01',
      '2026-11-01',
    );

    expect(withCurrency.currency).toBe('CAD');
    expect(empty).toEqual({
      currency: 'USD',
      units: [],
      nights: [{ date: '2026-11-01', rates: [] }],
    });
  });
});
