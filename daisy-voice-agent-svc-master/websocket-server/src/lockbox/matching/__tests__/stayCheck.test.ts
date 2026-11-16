/* global describe, expect, it */
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import {
  checkLockboxStay,
  guestNamesInRoom,
  hasCaller,
} from '@/lockbox/matching/stayCheck';
import {
  LockboxCodeFailureReason,
  LockboxCodeQuery,
  LockboxStay,
} from '@/lockbox/types';
import { LockboxBalancePolicy } from '@/types/hotelConfiguration';

const TONIGHT = ['2026-10-28'];
const BOOKING_ID = '6098484913491';

/** Ada Lovelace, the main guest, in room 12, checking in tonight. */
function stay(overrides: Partial<LockboxStay> = {}): LockboxStay {
  return {
    reservationId: BOOKING_ID,
    status: ReservationStatus.ACTIVE,
    checkedOut: false,
    checkIn: '2026-10-28',
    rooms: ['12'],
    guestName: 'Ada Lovelace',
    guestLastName: 'Lovelace',
    guestPhones: ['+1 (555) 222-3333'],
    otherGuests: [],
    balance: 0,
    ...overrides,
  };
}

/** Rooms 12 and 14 for Ada, with Grace Hopper in room 14. */
function twoRoomStay(): LockboxStay {
  return stay({
    rooms: ['12', '14'],
    otherGuests: [
      {
        name: 'Grace Hopper',
        lastName: 'Hopper',
        phones: ['555-444-9999'],
        rooms: ['14'],
      },
    ],
  });
}

function query(overrides: Partial<LockboxCodeQuery> = {}): LockboxCodeQuery {
  return { bookingId: BOOKING_ID, customerName: 'Ada Lovelace', ...overrides };
}

function mismatch(...mismatched: string[]) {
  return {
    refusal: {
      reason: LockboxCodeFailureReason.RESERVATION_MISMATCH,
      mismatched,
    },
  };
}

describe('checkLockboxStay', () => {
  it("lets an active stay checking in on an assignment date through, with the main guest's rooms", () => {
    expect(checkLockboxStay(stay(), query(), TONIGHT)).toEqual({
      rooms: ['12'],
    });
  });

  it('accepts any of the assignment dates, e.g. yesterday before noon', () => {
    expect(
      checkLockboxStay(stay({ checkIn: '2026-10-27' }), query(), [
        '2026-10-28',
        '2026-10-27',
      ]),
    ).toEqual({ rooms: ['12'] });
  });

  it.each([
    ['cancelled', { status: ReservationStatus.CANCELLED }],
    ['a no-show', { status: ReservationStatus.NO_SHOW }],
    ['inactive', { status: ReservationStatus.INACTIVE }],
    ['failed', { status: ReservationStatus.FAILED }],
    ['checked out', { checkedOut: true }],
  ])('refuses a stay that is %s', (_case, overrides) => {
    expect(checkLockboxStay(stay(overrides), query(), TONIGHT)).toEqual({
      refusal: { reason: LockboxCodeFailureReason.RESERVATION_NOT_ACTIVE },
    });
  });

  it.each([['2026-11-03'], ['2026-10-27'], ['']])(
    'refuses a check-in of %j',
    (checkIn) => {
      expect(checkLockboxStay(stay({ checkIn }), query(), TONIGHT)).toEqual({
        refusal: { reason: LockboxCodeFailureReason.NOT_ARRIVING_TONIGHT },
      });
    },
  );

  it('refuses a stay without a room', () => {
    expect(checkLockboxStay(stay({ rooms: [] }), query(), TONIGHT)).toEqual({
      refusal: { reason: LockboxCodeFailureReason.NO_ROOM_ASSIGNED },
    });
  });

  it('reports the first failing check, in order', () => {
    expect(
      checkLockboxStay(
        stay({
          status: ReservationStatus.CANCELLED,
          checkIn: '2026-11-03',
          rooms: [],
        }),
        query({ roomNumber: '7', customerName: 'Grace Hopper' }),
        TONIGHT,
      ),
    ).toEqual({
      refusal: { reason: LockboxCodeFailureReason.RESERVATION_NOT_ACTIVE },
    });
  });

  describe('balance owed on the reservation', () => {
    function balanceDue(balance: number | null) {
      return {
        refusal: { reason: LockboxCodeFailureReason.BALANCE_DUE, balance },
      };
    }

    it.each([[0], [0.004], [-12.5]])(
      'lets a balance of %j through',
      (balance) => {
        expect(checkLockboxStay(stay({ balance }), query(), TONIGHT)).toEqual({
          rooms: ['12'],
        });
      },
    );

    it.each([[25.5], [0.01]])('refuses a balance of %j', (balance) => {
      expect(checkLockboxStay(stay({ balance }), query(), TONIGHT)).toEqual(
        balanceDue(balance),
      );
    });

    it('refuses a balance the PMS gave none of, or none that can be read', () => {
      expect(
        checkLockboxStay(stay({ balance: null }), query(), TONIGHT),
      ).toEqual(balanceDue(null));
    });

    it('checks the balance after the stay checks', () => {
      expect(
        checkLockboxStay(
          stay({ balance: 25.5, checkIn: '2026-11-03' }),
          query(),
          TONIGHT,
        ),
      ).toEqual({
        refusal: { reason: LockboxCodeFailureReason.NOT_ARRIVING_TONIGHT },
      });
    });

    it("never tells a caller who isn't on the reservation that it owes a balance", () => {
      expect(
        checkLockboxStay(
          stay({ balance: 25.5 }),
          query({ customerName: 'Grace Hopper' }),
          TONIGHT,
        ),
      ).toEqual(mismatch('customer_name'));
    });

    it('refuses under the refuse policy, as by default', () => {
      expect(
        checkLockboxStay(
          stay({ balance: 25.5 }),
          query(),
          TONIGHT,
          LockboxBalancePolicy.REFUSE,
        ),
      ).toEqual(balanceDue(25.5));
    });

    it.each([[25.5], [null]])(
      'lets a balance of %j through under allow_with_note',
      (balance) => {
        expect(
          checkLockboxStay(
            stay({ balance }),
            query(),
            TONIGHT,
            LockboxBalancePolicy.ALLOW_WITH_NOTE,
          ),
        ).toEqual({ rooms: ['12'] });
      },
    );

    it('still checks the caller under allow_with_note', () => {
      expect(
        checkLockboxStay(
          stay({ balance: 25.5 }),
          query({ customerName: 'Grace Hopper' }),
          TONIGHT,
          LockboxBalancePolicy.ALLOW_WITH_NOTE,
        ),
      ).toEqual(mismatch('customer_name'));
    });
  });

  describe('a caller identified by the number they call from', () => {
    it.each([['+15552223333'], ['15552223333'], ['(555) 222-3333']])(
      'gives the main guest, whose number %j is, every room',
      (callerPhone) => {
        expect(
          checkLockboxStay(twoRoomStay(), { callerPhone }, TONIGHT),
        ).toEqual({ rooms: ['12', '14'] });
      },
    );

    it('gives another guest only the rooms the PMS puts them in', () => {
      expect(
        checkLockboxStay(
          twoRoomStay(),
          { callerPhone: '+1 555 444 9999' },
          TONIGHT,
        ),
      ).toEqual({ rooms: ['14'] });
    });

    it('refuses a number no guest in the rooms has, naming the caller number', () => {
      expect(
        checkLockboxStay(
          twoRoomStay(),
          { callerPhone: '+15550000000' },
          TONIGHT,
        ),
      ).toEqual(mismatch('caller_phone_number'));
    });

    it('narrows the answer to the room sent', () => {
      expect(
        checkLockboxStay(
          twoRoomStay(),
          { callerPhone: '+15552223333', roomNumber: '14' },
          TONIGHT,
        ),
      ).toEqual({ rooms: ['14'] });
    });

    it('checks the balance after the caller', () => {
      expect(
        checkLockboxStay(
          stay({ balance: 25.5 }),
          { callerPhone: '+15552223333' },
          TONIGHT,
        ),
      ).toEqual({
        refusal: {
          reason: LockboxCodeFailureReason.BALANCE_DUE,
          balance: 25.5,
        },
      });
    });
  });

  describe('a caller identified by their last name', () => {
    it.each([['Lovelace'], ['LOVELACE'], ['Lovelase']])(
      'gives the main guest (%j) every room',
      (lastName) => {
        expect(checkLockboxStay(twoRoomStay(), { lastName }, TONIGHT)).toEqual({
          rooms: ['12', '14'],
        });
      },
    );

    it('gives another guest only the rooms the PMS puts them in', () => {
      expect(
        checkLockboxStay(twoRoomStay(), { lastName: 'Hopper' }, TONIGHT),
      ).toEqual({ rooms: ['14'] });
    });

    it('refuses a last name no guest in the rooms has, naming the last name', () => {
      expect(
        checkLockboxStay(twoRoomStay(), { lastName: 'Turing' }, TONIGHT),
      ).toEqual(mismatch('last_name'));
    });
  });

  describe('room and name sent by the agent', () => {
    it.each([['12'], ['012'], [' 12 '], ['Room 12'], ['King 12']])(
      'accepts room %j for room 12',
      (roomNumber) => {
        expect(
          checkLockboxStay(stay(), query({ roomNumber }), TONIGHT),
        ).toEqual({ rooms: ['12'] });
      },
    );

    it('accepts a room the PMS names without a number', () => {
      expect(
        checkLockboxStay(
          stay({ rooms: ['Garden Cottage'] }),
          query({ roomNumber: ' garden cottage ' }),
          TONIGHT,
        ),
      ).toEqual({ rooms: ['Garden Cottage'] });
    });

    it.each([
      ['Ada Lovelace'],
      ['LOVELACE, ADA'],
      ['Ada King Lovelace'],
      ['Ada Lovlace'],
      ['Adalovelace Lovelace'],
      ['AdaLovelace'],
    ])('accepts the name %j for Ada Lovelace', (customerName) => {
      expect(
        checkLockboxStay(stay(), query({ customerName }), TONIGHT),
      ).toEqual({ rooms: ['12'] });
    });

    it.each([
      [{ roomNumber: '7' }, ['room_number']],
      [{ roomNumber: '120' }, ['room_number']],
      [{ customerName: 'Grace Hopper' }, ['customer_name']],
      [{ customerName: 'Lovelace' }, ['customer_name']],
      [{ customerName: 'Ada' }, ['customer_name']],
      [{ customerName: 'Ana Lovelace' }, ['customer_name']],
      [{ customerName: 'Ada Hopper' }, ['customer_name']],
      [
        { customerName: 'Any Guest', roomNumber: '7' },
        ['room_number', 'customer_name'],
      ],
    ])('refuses %j', (claimed, mismatched) => {
      expect(checkLockboxStay(stay(), query(claimed), TONIGHT)).toEqual(
        mismatch(...mismatched),
      );
    });
  });

  describe('a stay with several rooms', () => {
    it('gives the main guest every room, in the stay order', () => {
      expect(checkLockboxStay(twoRoomStay(), query(), TONIGHT)).toEqual({
        rooms: ['12', '14'],
      });
    });

    it('narrows the answer to the room sent', () => {
      expect(
        checkLockboxStay(twoRoomStay(), query({ roomNumber: '14' }), TONIGHT),
      ).toEqual({ rooms: ['14'] });
    });

    it('gives another guest only the rooms the PMS puts them in', () => {
      expect(
        checkLockboxStay(
          twoRoomStay(),
          query({ customerName: 'Grace Hopper' }),
          TONIGHT,
        ),
      ).toEqual({ rooms: ['14'] });
      expect(
        checkLockboxStay(
          twoRoomStay(),
          query({ customerName: 'Hopper, Grace', roomNumber: '14' }),
          TONIGHT,
        ),
      ).toEqual({ rooms: ['14'] });
    });

    it("refuses another guest asking for a room the PMS doesn't put them in", () => {
      expect(
        checkLockboxStay(
          twoRoomStay(),
          query({ customerName: 'Grace Hopper', roomNumber: '12' }),
          TONIGHT,
        ),
      ).toEqual(mismatch('customer_name'));
    });

    it('refuses a name the PMS lists in none of the rooms', () => {
      expect(
        checkLockboxStay(
          twoRoomStay(),
          query({ customerName: 'Alan Turing', roomNumber: '14' }),
          TONIGHT,
        ),
      ).toEqual(mismatch('customer_name'));
    });
  });
});

describe('hasCaller', () => {
  it('finds the main guest or another guest by number or last name', () => {
    expect(hasCaller(twoRoomStay(), { callerPhone: '+15552223333' })).toBe(
      true,
    );
    expect(hasCaller(twoRoomStay(), { callerPhone: '5554449999' })).toBe(true);
    expect(hasCaller(twoRoomStay(), { lastName: 'hoper' })).toBe(true);
    expect(hasCaller(twoRoomStay(), { customerName: 'Ada Lovelace' })).toBe(
      true,
    );
  });

  it('finds the main guest of a stay without a room yet', () => {
    expect(hasCaller(stay({ rooms: [] }), { lastName: 'Lovelace' })).toBe(true);
  });

  it('finds no one with another number or last name', () => {
    expect(hasCaller(twoRoomStay(), { callerPhone: '+15550000000' })).toBe(
      false,
    );
    expect(hasCaller(twoRoomStay(), { lastName: 'Turing' })).toBe(false);
  });
});

describe('guestNamesInRoom', () => {
  it('lists the main guest for every room, and other guests for their own rooms', () => {
    expect(guestNamesInRoom(twoRoomStay(), '12')).toEqual(['Ada Lovelace']);
    expect(guestNamesInRoom(twoRoomStay(), '14')).toEqual([
      'Ada Lovelace',
      'Grace Hopper',
    ]);
  });
});
