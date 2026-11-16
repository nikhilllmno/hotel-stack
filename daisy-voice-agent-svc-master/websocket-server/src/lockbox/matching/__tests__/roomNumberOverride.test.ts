/* global describe, expect, it */
import { overriddenRoomNumber } from '@/lockbox/matching/roomNumberOverride';

const FREYA = 'Freya Accessible King Retreat';
const MARLO_OVERRIDES = { [FREYA]: '19' };

describe('overriddenRoomNumber', () => {
  it('gives the room number the hotel set for the room name', () => {
    expect(overriddenRoomNumber(FREYA, MARLO_OVERRIDES)).toBe('19');
  });

  it.each([
    ['  Freya Accessible King Retreat  '],
    ['freya accessible king retreat'],
    ['FREYA ACCESSIBLE KING RETREAT'],
  ])('matches %j, ignoring case and surrounding spaces', (roomName) => {
    expect(overriddenRoomNumber(roomName, MARLO_OVERRIDES)).toBe('19');
  });

  it('matches a stored name that has surrounding spaces, and trims the number', () => {
    expect(
      overriddenRoomNumber(FREYA, {
        ' freya accessible king retreat ': ' 19 ',
      }),
    ).toBe('19');
  });

  it.each([
    ['Freya'],
    ['Freya Accessible King'],
    ['Freya  Accessible King Retreat'],
    ['King 12'],
    [''],
    ['   '],
    [undefined],
    [null],
  ])('gives nothing for %j, which the hotel did not name', (roomName) => {
    expect(overriddenRoomNumber(roomName, MARLO_OVERRIDES)).toBeNull();
  });

  it.each([[undefined], [null], [{}]])(
    'gives nothing when the hotel has no overrides (%j)',
    (overrides) => {
      expect(overriddenRoomNumber(FREYA, overrides)).toBeNull();
    },
  );

  it.each([
    ['an array', [FREYA]],
    ['a string', FREYA],
    ['a number', 19],
  ])('reads a stored config that is %s as no overrides', (_case, overrides) => {
    expect(
      overriddenRoomNumber(
        FREYA,
        overrides as unknown as Record<string, string>,
      ),
    ).toBeNull();
  });

  it.each([
    ['a blank number', { [FREYA]: '  ' }],
    ['a number that is not text', { [FREYA]: 19 }],
    ['a number longer than 20 characters', { [FREYA]: '1'.repeat(21) }],
    [
      'the name twice with different numbers',
      { [FREYA]: '19', 'freya accessible king retreat': '20' },
    ],
    [
      'the name twice, once with a number longer than 20 characters',
      { [FREYA]: '19', 'freya accessible king retreat': '1'.repeat(21) },
    ],
  ])('gives nothing for %s', (_case, overrides) => {
    expect(
      overriddenRoomNumber(
        FREYA,
        overrides as unknown as Record<string, string>,
      ),
    ).toBeNull();
  });

  it('gives nothing for a stored name longer than 100 characters', () => {
    const longName = 'R'.repeat(101);
    expect(overriddenRoomNumber(longName, { [longName]: '19' })).toBeNull();
  });

  it('accepts a name of 100 characters and a number of 20, measured after trimming', () => {
    const name = 'R'.repeat(100);
    const roomNumber = '1'.repeat(20);
    expect(
      overriddenRoomNumber(name, { [` ${name} `]: ` ${roomNumber} ` }),
    ).toBe(roomNumber);
  });

  it('accepts the name twice when both give the same number', () => {
    expect(
      overriddenRoomNumber(FREYA, {
        [FREYA]: '19',
        'FREYA ACCESSIBLE KING RETREAT ': ' 19',
      }),
    ).toBe('19');
  });
});
