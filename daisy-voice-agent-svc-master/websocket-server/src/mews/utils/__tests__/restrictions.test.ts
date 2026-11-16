import { MewsRestriction, MewsRestrictionCondition } from '@/mews/types';
import {
  findBlockingRestriction,
  isRestricted,
  MewsRestrictionContext,
  parseIsoDurationToMinutes,
} from '@/mews/utils/restrictions';

const SERVICE_ID = 'service-stay';
const CATEGORY_ID = 'category-king';
const RATE_ID = 'rate-standard';
const BASE_RATE_ID = 'rate-base';
const RATE_GROUP_ID = 'rate-group-1';

/** 2026-09-15 → 2026-09-17, a two-night stay at UTC midnight boundaries. */
function buildContext(
  overrides: Partial<MewsRestrictionContext> = {},
): MewsRestrictionContext {
  return {
    nights: [
      { localDate: '2026-09-15', timeUnitStartUtc: '2026-09-15T00:00:00.000Z' },
      { localDate: '2026-09-16', timeUnitStartUtc: '2026-09-16T00:00:00.000Z' },
    ],
    checkOut: {
      localDate: '2026-09-17',
      timeUnitStartUtc: '2026-09-17T00:00:00.000Z',
    },
    serviceId: SERVICE_ID,
    resourceCategoryId: CATEGORY_ID,
    resourceCategoryType: 'Room',
    rateId: RATE_ID,
    baseRateId: BASE_RATE_ID,
    rateGroupId: RATE_GROUP_ID,
    nowUtc: new Date('2026-09-14T12:00:00.000Z'),
    ...overrides,
  };
}

function buildRestriction(
  conditions: Partial<MewsRestrictionCondition> = {},
  exceptions: MewsRestriction['Exceptions'] = null,
): MewsRestriction {
  return {
    Id: 'restriction-1',
    ServiceId: SERVICE_ID,
    Origin: 'User',
    Conditions: {
      Type: 'Stay',
      StartUtc: '2026-09-01T00:00:00.000Z',
      EndUtc: '2026-09-30T00:00:00.000Z',
      ...conditions,
    },
    Exceptions: exceptions,
  };
}

describe('parseIsoDurationToMinutes', () => {
  it('reads days and time components', () => {
    expect(parseIsoDurationToMinutes('P0M2DT0H0M0S')).toBe(2 * 1440);
    expect(parseIsoDurationToMinutes('P0Y0M1DT6H30M0S')).toBe(1440 + 390);
  });

  it('keeps months and minutes apart', () => {
    expect(parseIsoDurationToMinutes('P1M')).toBe(30 * 1440);
    expect(parseIsoDurationToMinutes('PT1M')).toBe(1);
  });

  it('returns null for absent or malformed values', () => {
    expect(parseIsoDurationToMinutes(null)).toBeNull();
    expect(parseIsoDurationToMinutes('')).toBeNull();
    expect(parseIsoDurationToMinutes('2 days')).toBeNull();
    expect(parseIsoDurationToMinutes(2)).toBeNull();
  });
});

describe('findBlockingRestriction — conditions', () => {
  it('blocks an unconditional close-out covering the stay', () => {
    const restriction = buildRestriction();
    expect(findBlockingRestriction([restriction], buildContext())).toBe(
      restriction,
    );
  });

  it('ignores restrictions belonging to another service', () => {
    const restriction = buildRestriction();
    restriction.ServiceId = 'service-apartment';
    expect(isRestricted([restriction], buildContext())).toBe(false);
  });

  it('ignores an interval that ends before the stay', () => {
    const restriction = buildRestriction({
      StartUtc: '2026-08-01T00:00:00.000Z',
      EndUtc: '2026-09-14T00:00:00.000Z',
    });
    expect(isRestricted([restriction], buildContext())).toBe(false);
  });

  it('treats both interval bounds as inclusive', () => {
    const restriction = buildRestriction({
      Type: 'Start',
      StartUtc: '2026-09-15T00:00:00.000Z',
      EndUtc: '2026-09-15T00:00:00.000Z',
    });
    expect(isRestricted([restriction], buildContext())).toBe(true);
  });

  it('scopes to ExactRateId, BaseRateId and RateGroupId', () => {
    expect(
      isRestricted(
        [buildRestriction({ ExactRateId: RATE_ID })],
        buildContext(),
      ),
    ).toBe(true);
    expect(
      isRestricted(
        [buildRestriction({ ExactRateId: 'rate-other' })],
        buildContext(),
      ),
    ).toBe(false);
    expect(
      isRestricted(
        [buildRestriction({ BaseRateId: BASE_RATE_ID })],
        buildContext(),
      ),
    ).toBe(true);
    expect(
      isRestricted(
        [buildRestriction({ RateGroupId: RATE_GROUP_ID })],
        buildContext(),
      ),
    ).toBe(true);
  });

  it('does not apply a rate-scoped restriction when the rate is unknown', () => {
    expect(
      isRestricted(
        [buildRestriction({ ExactRateId: RATE_ID })],
        buildContext({ rateId: null, baseRateId: null, rateGroupId: null }),
      ),
    ).toBe(false);
  });

  it('scopes to resource category id and type', () => {
    expect(
      isRestricted(
        [buildRestriction({ ResourceCategoryId: CATEGORY_ID })],
        buildContext(),
      ),
    ).toBe(true);
    expect(
      isRestricted(
        [buildRestriction({ ResourceCategoryId: 'category-other' })],
        buildContext(),
      ),
    ).toBe(false);
    expect(
      isRestricted(
        [buildRestriction({ ResourceCategoryType: 'Room' })],
        buildContext(),
      ),
    ).toBe(true);
    expect(
      isRestricted(
        [buildRestriction({ ResourceCategoryType: 'Bed' })],
        buildContext(),
      ),
    ).toBe(false);
  });
});

describe('findBlockingRestriction — restriction type', () => {
  it('Start looks only at the arrival day', () => {
    const onArrival = buildRestriction({
      Type: 'Start',
      StartUtc: '2026-09-15T00:00:00.000Z',
      EndUtc: '2026-09-15T00:00:00.000Z',
    });
    const onSecondNight = buildRestriction({
      Type: 'Start',
      StartUtc: '2026-09-16T00:00:00.000Z',
      EndUtc: '2026-09-16T00:00:00.000Z',
    });
    expect(isRestricted([onArrival], buildContext())).toBe(true);
    expect(isRestricted([onSecondNight], buildContext())).toBe(false);
  });

  it('End looks only at the departure day', () => {
    const onDeparture = buildRestriction({
      Type: 'End',
      StartUtc: '2026-09-17T00:00:00.000Z',
      EndUtc: '2026-09-17T00:00:00.000Z',
    });
    const onLastNight = buildRestriction({
      Type: 'End',
      StartUtc: '2026-09-16T00:00:00.000Z',
      EndUtc: '2026-09-16T00:00:00.000Z',
    });
    expect(isRestricted([onDeparture], buildContext())).toBe(true);
    expect(isRestricted([onLastNight], buildContext())).toBe(false);
  });

  it('Stay matches when any night falls inside the interval', () => {
    const secondNightOnly = buildRestriction({
      Type: 'Stay',
      StartUtc: '2026-09-16T00:00:00.000Z',
      EndUtc: '2026-09-16T00:00:00.000Z',
    });
    expect(isRestricted([secondNightOnly], buildContext())).toBe(true);
  });

  it('matches Days against the hotel-local date', () => {
    // 2026-09-15 is a Tuesday.
    expect(
      isRestricted(
        [buildRestriction({ Type: 'Start', Days: ['Tuesday'] })],
        buildContext(),
      ),
    ).toBe(true);
    expect(
      isRestricted(
        [buildRestriction({ Type: 'Start', Days: ['Saturday', 'Sunday'] })],
        buildContext(),
      ),
    ).toBe(false);
  });
});

describe('findBlockingRestriction — exceptions', () => {
  it('MinAdvance blocks a booking made too close to arrival', () => {
    const restriction = buildRestriction(
      { Type: 'Start' },
      {
        MinAdvance: 'P0M1DT0H0M0S',
      },
    );
    // Booked two hours before arrival — inside the one-day advance window.
    expect(
      isRestricted(
        [restriction],
        buildContext({ nowUtc: new Date('2026-09-14T22:00:00.000Z') }),
      ),
    ).toBe(true);
    // Booked three days out — the exception rescues it.
    expect(
      isRestricted(
        [restriction],
        buildContext({ nowUtc: new Date('2026-09-12T00:00:00.000Z') }),
      ),
    ).toBe(false);
  });

  it('MaxAdvance blocks a booking made too far out', () => {
    const restriction = buildRestriction(
      { Type: 'Start' },
      {
        MaxAdvance: 'P0M3DT0H0M0S',
      },
    );
    expect(
      isRestricted(
        [restriction],
        buildContext({ nowUtc: new Date('2026-09-01T00:00:00.000Z') }),
      ),
    ).toBe(true);
    expect(
      isRestricted(
        [restriction],
        buildContext({ nowUtc: new Date('2026-09-13T00:00:00.000Z') }),
      ),
    ).toBe(false);
  });

  it('MinLength blocks a stay shorter than the minimum', () => {
    const restriction = buildRestriction(
      { Type: 'Start' },
      { MinLength: 'P0M3DT0H0M0S' },
    );
    // Two nights, minimum three.
    expect(isRestricted([restriction], buildContext())).toBe(true);
  });

  it('MinLength and MaxLength together define an allowed window', () => {
    const restriction = buildRestriction(
      { Type: 'Start' },
      { MinLength: 'P0M2DT0H0M0S', MaxLength: 'P0M7DT0H0M0S' },
    );
    expect(isRestricted([restriction], buildContext())).toBe(false);
    expect(
      isRestricted(
        [restriction],
        buildContext({
          nights: [
            {
              localDate: '2026-09-15',
              timeUnitStartUtc: '2026-09-15T00:00:00.000Z',
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('applies price exceptions when the price is known, and skips them when it is not', () => {
    const restriction = buildRestriction(
      { Type: 'Start' },
      { MinPrice: { Value: 50, Currency: 'EUR' } },
    );
    expect(
      isRestricted([restriction], buildContext({ pricePerTimeUnit: 40 })),
    ).toBe(true);
    expect(
      isRestricted([restriction], buildContext({ pricePerTimeUnit: 60 })),
    ).toBe(false);
    // Unknown price leaves the rule unproven, so the restriction does not apply.
    expect(isRestricted([restriction], buildContext())).toBe(false);
  });

  it('requires every specified exception rule to be satisfied', () => {
    const restriction = buildRestriction(
      { Type: 'Start' },
      { MinLength: 'P0M2DT0H0M0S', MinAdvance: 'P0M5DT0H0M0S' },
    );
    // Length is fine, advance is not — the restriction still blocks.
    expect(isRestricted([restriction], buildContext())).toBe(true);
  });

  it('treats an all-null exception block as no exception at all', () => {
    const restriction = buildRestriction(
      { Type: 'Start' },
      {
        MinAdvance: null,
        MaxAdvance: null,
        MinLength: null,
        MaxLength: null,
        MinPrice: null,
        MaxPrice: null,
      },
    );
    expect(isRestricted([restriction], buildContext())).toBe(true);
  });
});

describe('findBlockingRestriction — edge cases', () => {
  it('returns null when there are no restrictions or no nights', () => {
    expect(findBlockingRestriction([], buildContext())).toBeNull();
    expect(
      findBlockingRestriction(
        [buildRestriction()],
        buildContext({ nights: [] }),
      ),
    ).toBeNull();
  });

  it('returns the first blocking restriction', () => {
    const notBlocking = buildRestriction({ ExactRateId: 'rate-other' });
    const blocking = buildRestriction({ Type: 'Start' });
    blocking.Id = 'restriction-2';
    expect(
      findBlockingRestriction([notBlocking, blocking], buildContext()),
    ).toBe(blocking);
  });
});
