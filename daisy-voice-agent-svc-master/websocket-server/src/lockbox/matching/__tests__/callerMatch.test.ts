/* global describe, expect, it */
import {
  isSamePhone,
  isSimilarFullName,
  isSimilarLastName,
  phoneMatchKey,
} from '@/lockbox/matching/callerMatch';

describe('phoneMatchKey', () => {
  it.each([
    ['+1 (828) 268-3803', '8282683803'],
    ['18282683803', '8282683803'],
    ['828.268.3803', '8282683803'],
    ['+44 20 7946 0958', '2079460958'],
    ['020 7946 0958', '2079460958'],
    ['268-3803', '2683803'],
  ])('%j -> %j', (phone, key) => {
    expect(phoneMatchKey(phone)).toBe(key);
  });

  it.each([[''], ['   '], ['ext 12'], ['555-123'], [null], [undefined]])(
    'gives nothing for %j, which can identify no one',
    (phone) => {
      expect(phoneMatchKey(phone)).toBeNull();
    },
  );
});

describe('isSamePhone', () => {
  it.each([
    ['+18282683803', '(828) 268-3803'],
    ['18282683803', '+1 828 268 3803'],
    ['+44 20 7946 0958', '020 7946 0958'],
    ['2683803', '268-3803'],
  ])('matches %j and %j', (a, b) => {
    expect(isSamePhone(a, b)).toBe(true);
  });

  it.each([
    ['+18282683803', '+18282683804'],
    ['8282683803', '2683803'],
    ['', ''],
    ['555-123', '555-123'],
    [null, null],
    ['+18282683803', undefined],
  ])('does not match %j and %j', (a, b) => {
    expect(isSamePhone(a, b)).toBe(false);
  });
});

describe('isSimilarLastName', () => {
  it.each([
    ['Lovelace', 'Lovelace'],
    ['LOVELACE', ' lovelace '],
    ['Nunez', 'Núñez'],
    ['OBrien', "O'Brien"],
    ['Smith Jones', 'Smith-Jones'],
    ['Mc Donald', 'McDonald'],
  ])(
    'matches %j to %j, ignoring case, accents and punctuation',
    (said, held) => {
      expect(isSimilarLastName(said, held)).toBe(true);
    },
  );

  it.each([
    ['Smyth', 'Smith', 'one typo in 5 letters'],
    ['Hoper', 'Hopper', 'one letter missing'],
    ['Jonson', 'Johnson', 'one letter missing in 7'],
    ['Lovlase', 'Lovelace', 'two typos in 7 letters or more'],
    ['Lovleace', 'Lovelace', 'swapped letters'],
  ])('accepts %j for %j (%s)', (said, held) => {
    expect(isSimilarLastName(said, held)).toBe(true);
  });

  it.each([
    ['Garcia', 'García López'],
    ['Lopez', 'Garcia Lopez'],
    ['Smith', 'Smith-Jones'],
    ['Smith-Jones', 'Smith'],
  ])('accepts %j for %j: one part of a several-part name', (said, held) => {
    expect(isSimilarLastName(said, held)).toBe(true);
  });

  it.each([
    ['Jones', 'Smith', 'another name'],
    ['Smiht', 'Smith', 'two typos in 5 letters'],
    ['Loveridge', 'Lovelace-Smith', 'more than two typos'],
    ['Lea', 'Lee', 'any typo in 3 letters'],
    ['Lu', 'Li', 'any typo in 2 letters'],
    ['Van', 'Van der Berg', 'a part under 4 letters'],
    ['Lovelace', 'Byron Kingsley', 'no part close enough'],
    ['', 'Lovelace', 'a blank name'],
    ['Lovelace', '', 'a blank name on file'],
    ['-', "'", 'no letters at all'],
  ])('refuses %j for %j (%s)', (said, held) => {
    expect(isSimilarLastName(said, held)).toBe(false);
  });
});

describe('isSimilarFullName', () => {
  it.each([
    ['Voice Tester', 'Voice', 'Tester', 'the same name'],
    ['VOICE  tester', 'Voice', 'Tester', 'case and spaces'],
    ['José Núñez', 'Jose', 'Nunez', 'accents'],
    [
      'Voicetester Tester',
      'Voice',
      'Tester',
      'the first name run into the last',
    ],
    ['Voicetester', 'Voice', 'Tester', 'one run-together word'],
    [
      'Voicetestor Testor',
      'Voice',
      'Tester',
      'run together, with a typo in the last name',
    ],
    [
      'Steven Lovelace',
      'Stephen',
      'Lovelace',
      'two typos in a first name of 6 letters or more',
    ],
    [
      'Sara Smith',
      'Sarah',
      'Smith',
      'one typo in a first name of 4 or 5 letters',
    ],
    ['Ada Lovlace', 'Ada', 'Lovelace', 'a typo in the last name'],
    ['Mary Smith', 'Mary Ann', 'Smith', 'the first word of the first name'],
    [
      'Sarah Garcia Lopes',
      'Sarah',
      'Garcia Lopez',
      'a typo in a two-word last name',
    ],
    ['Sarah Garcia Lopez', 'Sarah', 'Garcia Lopez', 'a two-word last name'],
  ])('accepts %j for %j %j (%s)', (said, first, last) => {
    expect(isSimilarFullName(said, first, last)).toBe(true);
  });

  it.each([
    ['Grace Tester', 'Voice', 'Tester', 'another first name'],
    ['Voice Smith', 'Voice', 'Tester', 'another last name'],
    ['Tester', 'Voice', 'Tester', 'the last name alone'],
    ['Voice', 'Voice', 'Tester', 'the first name alone'],
    [
      'Ana Lovelace',
      'Ada',
      'Lovelace',
      'any typo in a first name of 3 letters',
    ],
    ['Lovelace Ada', 'Ada', 'Lovelace', 'last name first, without a comma'],
    ['', 'Voice', 'Tester', 'a blank name'],
    ['Voice Tester', '', 'Tester', 'no first name on file'],
    ['Voice Tester', 'Voice', '', 'no last name on file'],
  ])('refuses %j for %j %j (%s)', (said, first, last) => {
    expect(isSimilarFullName(said, first, last)).toBe(false);
  });
});
