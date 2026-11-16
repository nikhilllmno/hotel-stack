import {
  appendPrefilledEmailToPaymentLink,
  parseYyMm,
  toHotelLocalTimeUtc,
  toHotelMidnightUtc,
  truncateCurrency,
  yyMmToEndOfMonthDate,
} from '../helper';

describe('appendPrefilledEmailToPaymentLink', () => {
  it('appends prefilled_email as a query param on a plain payment link', () => {
    const result = appendPrefilledEmailToPaymentLink(
      'https://buy.stripe.com/test_abc123',
      'jenny@example.com',
    );
    expect(result).toBe(
      'https://buy.stripe.com/test_abc123?prefilled_email=jenny%40example.com',
    );
  });

  it('inserts prefilled_email before the fragment on a Checkout Session URL', () => {
    // Checkout Session URLs carry a `#fidk...` fragment; string-concatenating
    // `?prefilled_email=` after it corrupts the fragment and the page fails to load.
    const result = appendPrefilledEmailToPaymentLink(
      'https://checkout.stripe.com/c/pay/cs_test_abc#fidkdWxOYHwn',
      'jenny@example.com',
    );
    expect(result).toBe(
      'https://checkout.stripe.com/c/pay/cs_test_abc?prefilled_email=jenny%40example.com#fidkdWxOYHwn',
    );
  });

  it('percent-encodes special characters in the email', () => {
    const result = appendPrefilledEmailToPaymentLink(
      'https://buy.stripe.com/test_abc123',
      'jenny+test@example.com',
    );
    expect(result).toContain('prefilled_email=jenny%2Btest%40example.com');
  });
});

describe('truncateCurrency', () => {
  it('truncates a fractional-cent amount down, matching Cloudbeds', () => {
    // 259.32 * 6.57% = 17.037324 and 259.32 * 8.45% = 21.91254 — Cloudbeds
    // drops everything past the second decimal.
    expect(truncateCurrency(17.037324)).toBe(17.03);
    expect(truncateCurrency(21.91254)).toBe(21.91);
    // 120 * 6.57% = 7.884
    expect(truncateCurrency(7.884)).toBe(7.88);
  });

  it('does not drop an exact cent amount that carries floating-point noise', () => {
    expect(truncateCurrency(10.139999999999999)).toBe(10.14);
    expect(truncateCurrency(26.880000000000003)).toBe(26.88);
  });

  it('leaves an already-exact cent amount unchanged', () => {
    expect(truncateCurrency(10.14)).toBe(10.14);
    expect(truncateCurrency(365.76)).toBe(365.76);
    expect(truncateCurrency(0)).toBe(0);
  });
});

describe('toHotelLocalTimeUtc', () => {
  const NY = 'America/New_York';

  it('resolves a 15:00 local check-in to the right UTC instant in EDT', () => {
    expect(toHotelLocalTimeUtc('2026-08-11', NY, 900)).toBe(
      '2026-08-11T19:00:00.000Z',
    );
  });

  it('shifts by one hour across the EST/EDT boundary', () => {
    expect(toHotelLocalTimeUtc('2026-01-15', NY, 900)).toBe(
      '2026-01-15T20:00:00.000Z',
    );
    expect(toHotelLocalTimeUtc('2026-06-15', NY, 900)).toBe(
      '2026-06-15T19:00:00.000Z',
    );
  });

  // Adding 900 minutes to local midnight would land on 16:00 local here,
  // because the day is only 23 hours long.
  it('keeps the wall-clock time on a spring-forward date', () => {
    expect(toHotelLocalTimeUtc('2026-03-08', NY, 900)).toBe(
      '2026-03-08T19:00:00.000Z',
    );
  });

  it('keeps the wall-clock time on a fall-back date', () => {
    expect(toHotelLocalTimeUtc('2026-11-01', NY, 900)).toBe(
      '2026-11-01T20:00:00.000Z',
    );
  });

  it('matches toHotelMidnightUtc when there is no offset', () => {
    for (const minutes of [0, -30, Number.NaN]) {
      expect(toHotelLocalTimeUtc('2026-08-11', NY, minutes)).toBe(
        toHotelMidnightUtc('2026-08-11', NY),
      );
    }
  });

  it('handles a timezone ahead of UTC', () => {
    expect(toHotelLocalTimeUtc('2026-08-11', 'Europe/Budapest', 900)).toBe(
      '2026-08-11T13:00:00.000Z',
    );
  });

  it('accepts a Date and resolves it in the hotel zone', () => {
    expect(
      toHotelLocalTimeUtc(new Date('2026-08-11T12:00:00.000Z'), NY, 900),
    ).toBe('2026-08-11T19:00:00.000Z');
  });
});

describe('yyMmToEndOfMonthDate', () => {
  it('maps YYMM to the last day of that month, because a card is valid through it', () => {
    expect(yyMmToEndOfMonthDate('2612')).toBe('2026-12-31');
    expect(yyMmToEndOfMonthDate('3001')).toBe('2030-01-31');
  });

  it('resolves February against the right year', () => {
    expect(yyMmToEndOfMonthDate('2402')).toBe('2024-02-29');
    expect(yyMmToEndOfMonthDate('2502')).toBe('2025-02-28');
  });

  it.each([
    ['a month of 00', '2600'],
    ['a month past 12', '2613'],
    ['a separator', '26-12'],
    ['a four-digit year', '202612'],
    ['non-digits', '26ab'],
    ['an empty string', ''],
  ])('rejects %s', (_case, input) => {
    expect(() => yyMmToEndOfMonthDate(input)).toThrow(
      'Card expiry must be in YYMM format',
    );
  });
});

describe('parseYyMm', () => {
  it('splits YYMM into a month and a four-digit year', () => {
    expect(parseYyMm('2612')).toEqual({ month: 12, year: 2026 });
  });

  it('drops the leading zero on a single-digit month', () => {
    // ResNexus wants numbers, so '01' must arrive as 1 rather than '01'.
    expect(parseYyMm('3001')).toEqual({ month: 1, year: 2030 });
  });

  it.each([
    ['a month of 00', '2600'],
    ['a month past 12', '2613'],
    ['a separator', '26-12'],
    ['a four-digit year', '202612'],
    ['non-digits', '26ab'],
    ['an empty string', ''],
  ])('rejects %s', (_case, input) => {
    expect(() => parseYyMm(input)).toThrow(
      'Card expiry must be in YYMM format',
    );
  });
});
