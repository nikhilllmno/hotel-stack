/* global describe, expect, it */
import {
  findReservationLockboxes,
  isSameFullName,
  isSameGuestInRoom,
  isSameGuestName,
  normalizeGuestName,
  normalizeRoomNumber,
} from '@/lockbox/matching/lockboxMatch';
import { LockboxLogEntry } from '@/lockbox/types';

function entry(overrides: Partial<LockboxLogEntry>): LockboxLogEntry {
  return {
    lockboxNumber: '1',
    guestName: 'OPEN',
    originalNameText: '',
    rooms: [],
    code: '',
    notes: '',
    ...overrides,
  };
}

describe('normalizeGuestName', () => {
  it.each([
    ['  ADA   LOVELACE ', 'ada lovelace'],
    ['Lovelace, Ada', 'ada lovelace'],
    ['LOVELACE ,ADA', 'ada lovelace'],
    ['Hopper, Grace, Jr', 'grace jr hopper'],
    ['Cher', 'cher'],
    ['   ', ''],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeGuestName(input)).toBe(expected);
  });
});

describe('isSameGuestName', () => {
  it('matches the same name in any case and spacing', () => {
    expect(isSameGuestName('ADA  LOVELACE', 'Ada Lovelace')).toBe(true);
  });

  it('matches "Last, First" against "First Last"', () => {
    expect(isSameGuestName('Lovelace, Ada', 'Ada Lovelace')).toBe(true);
  });

  it('matches on first and last word when either side has a middle name', () => {
    expect(isSameGuestName('Mary Ann Evans', 'Mary Evans')).toBe(true);
    expect(isSameGuestName('MARY EVANS', 'Mary Ann Evans')).toBe(true);
  });

  it.each([
    ['Ann Evans', 'Mary Ann Evans'],
    ['Jon Smith', 'John Smith'],
    ['Smith', 'John Smith'],
    ['John', 'John Smith'],
    ['John Smith', 'John Smithers'],
    ['', 'John Smith'],
  ])('does not guess: %j vs %j', (a, b) => {
    expect(isSameGuestName(a, b)).toBe(false);
  });

  it('matches a one-word name only to itself', () => {
    expect(isSameGuestName('CHER', 'cher')).toBe(true);
  });
});

describe('isSameFullName', () => {
  it('matches identical full names after normalization', () => {
    expect(isSameFullName('  GRACE   HOPPER ', 'Grace Hopper')).toBe(true);
    expect(isSameFullName('Hopper, Grace', 'Grace Hopper')).toBe(true);
  });

  it.each([
    ['Mary Ann Evans', 'Mary Evans'],
    ['Mary Evans', 'Mary Ann Evans'],
    ['CHER', 'Cher'],
    ['Grace', 'Grace Hopper'],
    ['', ''],
  ])('does not match %j to %j', (a, b) => {
    expect(isSameFullName(a, b)).toBe(false);
  });
});

describe('normalizeRoomNumber', () => {
  it.each([
    ['8', '8'],
    [' 08 ', '8'],
    ['12A', '12a'],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeRoomNumber(input)).toBe(expected);
  });
});

/** One room under one name, with the blank-room fallback on that name. */
function findGuestLockboxes(
  entries: LockboxLogEntry[],
  roomNumber: string,
  guestName: string,
) {
  return findReservationLockboxes(
    entries,
    [{ roomNumber, guestNames: [guestName] }],
    { guestName, roomNumber },
  );
}

describe('findReservationLockboxes for one room and name', () => {
  const entries: LockboxLogEntry[] = [
    entry({
      lockboxNumber: '1',
      guestName: 'ADA LOVELACE',
      rooms: ['7'],
      code: '*4821',
    }),
    entry({
      lockboxNumber: '2',
      guestName: 'GRACE HOPPER',
      rooms: ['7'],
      code: '*5555',
    }),
    entry({
      lockboxNumber: '3',
      guestName: 'OPEN',
      rooms: ['12'],
      code: '905113',
    }),
    entry({ lockboxNumber: '4', guestName: 'OPEN', rooms: ['9'], code: '' }),
    entry({
      lockboxNumber: '5',
      guestName: 'Turing, Alan',
      rooms: ['3', '4'],
      code: '61822',
    }),
    entry({
      lockboxNumber: '6',
      guestName: 'ALAN TURING',
      rooms: ['4'],
      code: '*7777',
    }),
    entry({
      lockboxNumber: '7',
      guestName: 'Kay',
      originalNameText: 'katherine johnson',
      rooms: ['15'],
      code: '*1515',
    }),
    entry({
      lockboxNumber: '8',
      guestName: 'Kay',
      rooms: ['16'],
      code: '*1616',
    }),
  ];

  it('returns only the lockbox, room and code of the guest whose room and name match', () => {
    expect(findGuestLockboxes(entries, '7', 'Ada Lovelace')).toEqual({
      matchedBy: 'room',
      lockboxes: [{ lockbox_number: '1', room_number: '7', code: '*4821' }],
    });
  });

  it('never returns another guest in the same room', () => {
    expect(findGuestLockboxes(entries, '7', 'Katherine Johnson')).toBeNull();
  });

  it('requires the room to match even when the name does', () => {
    expect(findGuestLockboxes(entries, '8', 'Ada Lovelace')).toBeNull();
  });

  it("uses the room's one OPEN box when no box has the guest's name (a booking made after hours)", () => {
    expect(findGuestLockboxes(entries, '12', 'Someone Else')).toEqual({
      matchedBy: 'open_room',
      lockboxes: [{ lockbox_number: '3', room_number: '12', code: '905113' }],
    });
  });

  // The Marlo, Oct 30: OPEN lockbox 9 kept room 2 from earlier while the
  // guest's named lockbox 1 also had room 2, and both codes were read out.
  it('uses only the named box when the room is also on an OPEN box', () => {
    const duplicate = [
      entry({
        lockboxNumber: '1',
        guestName: 'Ada Lovelace',
        rooms: ['2', '1'],
        code: '*1111',
      }),
      entry({
        lockboxNumber: '9',
        guestName: 'OPEN',
        rooms: ['2'],
        code: '*9999',
      }),
    ];
    expect(findGuestLockboxes(duplicate, '2', 'Ada Lovelace')).toEqual({
      matchedBy: 'room',
      lockboxes: [{ lockbox_number: '1', room_number: '2', code: '*1111' }],
    });
  });

  it("never uses an OPEN box for a room that another name's box also lists", () => {
    const taken = [
      entry({
        lockboxNumber: '1',
        guestName: 'Grace Hopper',
        rooms: ['2'],
        code: '*1111',
      }),
      entry({
        lockboxNumber: '9',
        guestName: 'OPEN',
        rooms: ['2'],
        code: '*9999',
      }),
    ];
    expect(findGuestLockboxes(taken, '2', 'Ada Lovelace')).toBeNull();
  });

  it('never guesses between two OPEN boxes for the same room', () => {
    const twoOpen = [
      entry({
        lockboxNumber: '8',
        guestName: 'OPEN',
        rooms: ['2'],
        code: '*8888',
      }),
      entry({
        lockboxNumber: '9',
        guestName: 'OPEN',
        rooms: ['2'],
        code: '*9999',
      }),
    ];
    expect(findGuestLockboxes(twoOpen, '2', 'Ada Lovelace')).toBeNull();
  });

  it('never uses an OPEN box beside a NO KEY or blank-name box for the same room', () => {
    for (const guestName of ['NO KEY', '  ']) {
      expect(
        findGuestLockboxes(
          [
            entry({
              lockboxNumber: '7',
              guestName,
              rooms: ['2'],
              code: '*7777',
            }),
            entry({
              lockboxNumber: '9',
              guestName: 'OPEN',
              rooms: ['2'],
              code: '*9999',
            }),
          ],
          '2',
          'Ada Lovelace',
        ),
      ).toBeNull();
    }
  });

  it('skips a box that has no code', () => {
    expect(findGuestLockboxes(entries, '9', 'Someone Else')).toBeNull();
  });

  it('matches ROOM 2 and returns every box the guest holds', () => {
    expect(findGuestLockboxes(entries, '4', 'Alan Turing')).toEqual({
      matchedBy: 'room',
      lockboxes: [
        { lockbox_number: '5', room_number: '4', code: '61822' },
        { lockbox_number: '6', room_number: '4', code: '*7777' },
      ],
    });
  });

  it('matches ORIGINAL NAME TEXT when GUEST NAME differs', () => {
    expect(findGuestLockboxes(entries, '15', 'Katherine Johnson')).toEqual({
      matchedBy: 'room',
      lockboxes: [{ lockbox_number: '7', room_number: '15', code: '*1515' }],
    });
    expect(findGuestLockboxes(entries, '16', 'Katherine Johnson')).toBeNull();
  });

  it('compares room numbers as numbers', () => {
    expect(
      findGuestLockboxes(entries, '07', 'ada lovelace')?.lockboxes,
    ).toHaveLength(1);
  });

  it('returns nothing for a blank room, and only an OPEN box for a blank name', () => {
    expect(findGuestLockboxes(entries, ' ', 'Ada Lovelace')).toBeNull();
    expect(findGuestLockboxes(entries, '7', '  ')).toBeNull();
    expect(findGuestLockboxes(entries, '12', '  ')?.lockboxes).toEqual([
      { lockbox_number: '3', room_number: '12', code: '905113' },
    ]);
  });
});

// Staff often leave ROOM and ROOM 2 blank on named rows. Those boxes can only
// match on an exact full name, and only when nothing matches on the room.
describe('isSameGuestInRoom', () => {
  it.each([
    ['JAQUELINE BARILLAS', 'Jacqueline Barillas'],
    ['Jacqueline Barilas', 'Jacqueline Barillas'],
    ['Barillas, Jaqueline', 'Jacqueline Barillas'],
    ['Steven Turing', 'Stephen Turing'],
    ['Mary Evans', 'Mary Ann Evans'],
  ])('allows a few typos: %j vs %j', (boxName, guestName) => {
    expect(isSameGuestInRoom(boxName, guestName)).toBe(true);
  });

  it.each([
    ['Maria Barillas', 'Jacqueline Barillas'],
    ['Jaqueline Smith', 'Jacqueline Barillas'],
    ['BARILLAS', 'Jacqueline Barillas'],
    ['Jacqueline', 'Jacqueline Barillas'],
    ['Jon Smith', 'John Smith'],
    ['Cher', 'Chef'],
    ['', 'Jacqueline Barillas'],
  ])('still refuses: %j vs %j', (boxName, guestName) => {
    expect(isSameGuestInRoom(boxName, guestName)).toBe(false);
  });
});

describe('findReservationLockboxes with a typo in the box name', () => {
  const entries: LockboxLogEntry[] = [
    entry({
      lockboxNumber: '11',
      guestName: 'JAQUELINE BARILLAS',
      rooms: ['18'],
      code: '*1818',
    }),
    entry({
      lockboxNumber: '12',
      guestName: 'OPEN',
      rooms: ['18'],
      code: '*1800',
    }),
    entry({
      lockboxNumber: '13',
      guestName: 'Barilas, Jacqueline',
      rooms: ['19'],
      code: '*1919',
    }),
    entry({
      lockboxNumber: '14',
      guestName: 'MARIA BARILLAS',
      rooms: ['20'],
      code: '*2020',
    }),
    entry({
      lockboxNumber: '15',
      guestName: 'BARILLAS',
      rooms: ['21'],
      code: '*2121',
    }),
    entry({
      lockboxNumber: '16',
      guestName: 'Jaqueline Barillas',
      rooms: [],
      code: '*1616',
    }),
  ];

  it("matches the guest's room box when staff left a letter out of the first name, ahead of the room's OPEN box", () => {
    expect(findGuestLockboxes(entries, '18', 'Jacqueline Barillas')).toEqual({
      matchedBy: 'room',
      lockboxes: [{ lockbox_number: '11', room_number: '18', code: '*1818' }],
    });
  });

  it('matches a "Last, First" box with a typo in the last name', () => {
    expect(findGuestLockboxes(entries, '19', 'Jacqueline Barillas')).toEqual({
      matchedBy: 'room',
      lockboxes: [{ lockbox_number: '13', room_number: '19', code: '*1919' }],
    });
  });

  it("never gives the room's box to a different first name, or on the last name alone", () => {
    expect(findGuestLockboxes(entries, '20', 'Jacqueline Barillas')).toBeNull();
    expect(findGuestLockboxes(entries, '21', 'Jacqueline Barillas')).toBeNull();
  });

  it('keeps the blank-room fallback exact: no typo allowance without a room', () => {
    expect(findGuestLockboxes(entries, '22', 'Jacqueline Barillas')).toBeNull();
  });
});

describe('findReservationLockboxes keeps typo matches safe', () => {
  const entries: LockboxLogEntry[] = [
    entry({
      lockboxNumber: '30',
      guestName: 'STEVEN TURING',
      rooms: ['30', '31'],
      code: '*3031',
    }),
    entry({
      lockboxNumber: '32',
      guestName: 'JAQUELINE BARILLAS',
      rooms: ['32'],
      code: '*3201',
    }),
    entry({
      lockboxNumber: '33',
      guestName: 'JACQUELYN BARILLAS',
      rooms: ['32'],
      code: '*3202',
    }),
    entry({
      lockboxNumber: '34',
      guestName: 'JACQUELINE BARILLAS',
      rooms: ['34'],
      code: '*3401',
    }),
    entry({
      lockboxNumber: '35',
      guestName: 'JAQUELINE BARILLAS',
      rooms: ['34'],
      code: '*3402',
    }),
    entry({
      lockboxNumber: '36',
      guestName: 'Alice',
      rooms: ['36'],
      code: '*3600',
    }),
  ];

  it("never gives a typo-matched box that also lists a room outside the guest's reservation", () => {
    expect(findGuestLockboxes(entries, '30', 'Stephen Turing')).toBeNull();
  });

  it("gives it when every room the box lists is on the guest's reservation", () => {
    expect(
      findReservationLockboxes(entries, [
        { roomNumber: '30', guestNames: ['Stephen Turing'] },
        { roomNumber: '31', guestNames: ['Stephen Turing'] },
      ]),
    ).toEqual({
      matchedBy: 'room',
      lockboxes: [{ lockbox_number: '30', room_number: '30', code: '*3031' }],
    });
  });

  it('never guesses between two typo-matched boxes for the same room', () => {
    expect(findGuestLockboxes(entries, '32', 'Jacqueline Barillas')).toBeNull();
  });

  it('uses only the exact-name box when the room also has a typo-matched one', () => {
    expect(findGuestLockboxes(entries, '34', 'Jacqueline Barillas')).toEqual({
      matchedBy: 'room',
      lockboxes: [{ lockbox_number: '34', room_number: '34', code: '*3401' }],
    });
  });

  it('never matches a one-word box on typos, such as a first name alone', () => {
    expect(isSameGuestInRoom('Alice', 'Alice E')).toBe(false);
    expect(findGuestLockboxes(entries, '36', 'Alice E')).toBeNull();
  });
});

describe('findReservationLockboxes blank-room fallback', () => {
  const entries: LockboxLogEntry[] = [
    entry({
      lockboxNumber: '1',
      guestName: 'GRACE HOPPER',
      rooms: [],
      code: '*1001',
    }),
    entry({
      lockboxNumber: '2',
      guestName: 'Hopper, Grace',
      rooms: [],
      code: '*1002',
    }),
    entry({
      lockboxNumber: '3',
      guestName: 'OPEN',
      originalNameText: 'Ada Lovelace',
      rooms: [],
      code: '*1003',
    }),
    entry({ lockboxNumber: '4', guestName: 'CHER', rooms: [], code: '*1004' }),
    entry({
      lockboxNumber: '5',
      guestName: 'MARY ANN EVANS',
      rooms: [],
      code: '*1005',
    }),
    entry({
      lockboxNumber: '6',
      guestName: 'K. JOHNSON',
      originalNameText: 'Katherine Johnson',
      rooms: [],
      code: '*1006',
    }),
    entry({
      lockboxNumber: '7',
      guestName: 'ALAN TURING',
      rooms: [],
      code: '',
    }),
    entry({
      lockboxNumber: '8',
      guestName: 'ALAN TURING',
      rooms: ['5'],
      code: '*1008',
    }),
  ];

  it("returns every blank-room box with the guest's exact full name, with the guest's room", () => {
    expect(findGuestLockboxes(entries, '9', 'Grace Hopper')).toEqual({
      matchedBy: 'name_only',
      lockboxes: [
        { lockbox_number: '1', room_number: '9', code: '*1001' },
        { lockbox_number: '2', room_number: '9', code: '*1002' },
      ],
    });
  });

  it('matches ORIGINAL NAME TEXT exactly', () => {
    expect(findGuestLockboxes(entries, '9', 'Katherine Johnson')).toEqual({
      matchedBy: 'name_only',
      lockboxes: [{ lockbox_number: '6', room_number: '9', code: '*1006' }],
    });
  });

  it('never matches an OPEN box with a blank room, whatever its other name', () => {
    expect(findGuestLockboxes(entries, '9', 'Ada Lovelace')).toBeNull();
    expect(findGuestLockboxes(entries, '9', 'Someone Else')).toBeNull();
  });

  it('never matches a single-word name', () => {
    expect(findGuestLockboxes(entries, '9', 'Cher')).toBeNull();
    expect(findGuestLockboxes(entries, '9', 'Grace')).toBeNull();
  });

  it('never matches a partial name, such as a middle name on one side only', () => {
    expect(findGuestLockboxes(entries, '9', 'Mary Evans')).toBeNull();
    expect(findGuestLockboxes(entries, '9', 'Mary Ann Evans')).toEqual({
      matchedBy: 'name_only',
      lockboxes: [{ lockbox_number: '5', room_number: '9', code: '*1005' }],
    });
  });

  it('skips a blank-room box without a code, and never a box filed under another room', () => {
    expect(findGuestLockboxes(entries, '9', 'Alan Turing')).toBeNull();
  });

  it('lets a room match win over blank-room boxes with the same name', () => {
    const withRoomMatch = [
      ...entries,
      entry({
        lockboxNumber: '9',
        guestName: 'GRACE HOPPER',
        rooms: ['9'],
        code: '*1009',
      }),
    ];

    expect(findGuestLockboxes(withRoomMatch, '9', 'Grace Hopper')).toEqual({
      matchedBy: 'room',
      lockboxes: [{ lockbox_number: '9', room_number: '9', code: '*1009' }],
    });
  });
});

describe('findReservationLockboxes for a reservation with several rooms', () => {
  const entries: LockboxLogEntry[] = [
    entry({
      lockboxNumber: '1',
      guestName: 'ALAN TURING',
      rooms: ['3'],
      code: '61822',
    }),
    entry({
      lockboxNumber: '2',
      guestName: 'ALAN TURING',
      rooms: ['4', '3'],
      code: '*2222',
    }),
    entry({
      lockboxNumber: '3',
      guestName: 'OPEN',
      rooms: ['5'],
      code: '*3333',
    }),
    entry({ lockboxNumber: '4', guestName: 'ALAN TURING', code: '*4444' }),
    entry({
      lockboxNumber: '5',
      guestName: 'GRACE HOPPER',
      rooms: ['6'],
      code: '*5555',
    }),
  ];
  const alanIn = (...rooms: string[]) =>
    rooms.map((roomNumber) => ({ roomNumber, guestNames: ['Alan Turing'] }));

  it("returns each room's boxes, room by room in the order given, each box once", () => {
    expect(findReservationLockboxes(entries, alanIn('4', '3'))).toEqual({
      matchedBy: 'room',
      lockboxes: [
        { lockbox_number: '2', room_number: '4', code: '*2222' },
        { lockbox_number: '1', room_number: '3', code: '61822' },
      ],
    });
  });

  it("matches a room's boxes on any of the names given for it", () => {
    expect(
      findReservationLockboxes(entries, [
        { roomNumber: '6', guestNames: ['Alan Turing', 'Grace Hopper'] },
      ]),
    ).toEqual({
      matchedBy: 'room',
      lockboxes: [{ lockbox_number: '5', room_number: '6', code: '*5555' }],
    });
    expect(findReservationLockboxes(entries, alanIn('6'))).toBeNull();
  });

  it('uses the blank-room fallback only when no room has a box', () => {
    expect(
      findReservationLockboxes(entries, alanIn('3', '8'), {
        guestName: 'Alan Turing',
        roomNumber: '8',
      }),
    ).toEqual({
      matchedBy: 'room',
      lockboxes: [
        { lockbox_number: '1', room_number: '3', code: '61822' },
        { lockbox_number: '2', room_number: '3', code: '*2222' },
      ],
    });
    expect(
      findReservationLockboxes(entries, alanIn('8'), {
        guestName: 'Alan Turing',
        roomNumber: '8',
      }),
    ).toEqual({
      matchedBy: 'name_only',
      lockboxes: [{ lockbox_number: '4', room_number: '8', code: '*4444' }],
    });
  });

  it('never uses the blank-room fallback unless asked to', () => {
    expect(findReservationLockboxes(entries, alanIn('8', '9'))).toBeNull();
  });

  it('returns nothing for a reservation without rooms', () => {
    expect(findReservationLockboxes(entries, [])).toBeNull();
  });

  it("returns a box's NOTES as its note, and no note when NOTES is blank", () => {
    expect(
      findReservationLockboxes(
        [
          entry({
            lockboxNumber: '4',
            guestName: 'ADA LOVELACE',
            rooms: ['8'],
            code: '*4821',
            notes: 'Balance due at checkout',
          }),
          entry({
            lockboxNumber: '5',
            guestName: 'ADA LOVELACE',
            rooms: ['8'],
            code: '*5555',
          }),
        ],
        [{ roomNumber: '8', guestNames: ['Ada Lovelace'] }],
      ),
    ).toEqual({
      matchedBy: 'room',
      lockboxes: [
        {
          lockbox_number: '4',
          room_number: '8',
          code: '*4821',
          note: 'Balance due at checkout',
        },
        { lockbox_number: '5', room_number: '8', code: '*5555' },
      ],
    });
  });
});
