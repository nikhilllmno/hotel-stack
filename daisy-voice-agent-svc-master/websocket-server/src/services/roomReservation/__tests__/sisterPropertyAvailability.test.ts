/* global describe, expect, it */
import { SisterPropertyAvailabilityResult } from '@/models/response/roomReservation';
import {
  buildCrossSellMessage,
  hasBookableGroups,
} from '@/services/roomReservation/sisterPropertyAvailability';

const sister = (
  overrides: Partial<SisterPropertyAvailabilityResult>,
): SisterPropertyAvailabilityResult => ({
  hotel_name: 'The Haven Hotel',
  available: false,
  ...overrides,
});

describe('hasBookableGroups', () => {
  it.each([
    ['not an array', undefined, false],
    ['an empty list', [], false],
    ['a quote with no units left', [{ number_of_units_available: 0 }], false],
    ['a quote with units left', [{ number_of_units_available: 2 }], true],
    [
      'a room description',
      [{ 'Juliet King': 'The Juliet King has a total of $300.' }],
      true,
    ],
    [
      'only Stayntouch restriction descriptions',
      [{ Townhome: 'The Townhome is not available due to a 3-night minimum.' }],
      false,
    ],
    [
      'a restriction next to a bookable room',
      [
        { Townhome: 'The Townhome is not available due to a minimum stay.' },
        { Suite: 'The Suite has a total of $410.' },
      ],
      true,
    ],
  ])('is %s → %s', (_label, groups, expected) => {
    expect(hasBookableGroups(groups)).toBe(expected);
  });
});

describe('buildCrossSellMessage', () => {
  it('names one available sister hotel with its distance and website', () => {
    expect(
      buildCrossSellMessage([
        sister({
          available: true,
          distance_miles: 3,
          website: 'https://havenhotel.co',
        }),
      ]),
    ).toBe(
      "The Haven Hotel (3 miles away, https://havenhotel.co) has availability for your dates. Rooms at a sister property can't be booked on this call: give the guest its website or phone number.",
    );
  });

  it('lists several available sister hotels in order', () => {
    expect(
      buildCrossSellMessage([
        sister({ hotel_name: 'A', available: true }),
        sister({ hotel_name: 'B', available: false }),
        sister({ hotel_name: 'C', available: true }),
        sister({ hotel_name: 'D', available: true }),
      ]),
    ).toMatch(/^A, C and D have availability for your dates\./);
  });

  it('keeps the original no-availability wording when every check worked', () => {
    expect(buildCrossSellMessage([sister({}), sister({})])).toBe(
      'Unfortunately, none of the nearby sister properties have availability for your dates either.',
    );
  });

  it('says which sister hotels could not be checked', () => {
    expect(
      buildCrossSellMessage([
        sister({ hotel_name: 'A' }),
        sister({
          hotel_name: 'B',
          error: 'timed out',
          website: 'https://b.co',
        }),
      ]),
    ).toBe(
      "None of the other sister properties have availability for your dates. Availability couldn't be checked at B (https://b.co) right now; the guest can check its website or call it directly.",
    );
  });

  it('says nothing could be checked when every check failed', () => {
    expect(
      buildCrossSellMessage([
        sister({ hotel_name: 'A', error: 'failed' }),
        sister({ hotel_name: 'B', error: 'timed out' }),
      ]),
    ).toBe(
      "Availability couldn't be checked at A and B right now; the guest can check their websites or call them directly.",
    );
  });
});
