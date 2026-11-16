/* global afterEach, beforeEach, describe, expect, it, jest */
import { CloudbedsReservationService } from '@/cloudbeds/services/reservationService';
import { CloudbedsGetReservationResponseData } from '@/cloudbeds/types';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import {
  lockboxStayFromCloudbeds,
  LockboxStayService,
} from '@/lockbox/services/lockboxStayService';
import { LockboxStay } from '@/lockbox/types';
import { Hotel } from '@/models/Hotel';
import { ReservationRepository } from '@/repositories/ReservationRepository';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import { seedReservation } from '@/test/fixtures/reservationSeedFixture';

const PROPERTY_ID = '312345';

const HOTEL = {
  id: RESERVATION_FLOW_FIXTURE_IDS.hotelId,
  business_id: PROPERTY_ID,
  pms_provider: 'cloudbeds',
  timezone: 'America/Los_Angeles',
} as Hotel;

/**
 * Ada Lovelace (the main guest) in room 12, checking in Oct 28. The main
 * guest has the higher guest id, so `Object.values(guestList)` lists Grace
 * first and only `isMainGuest` picks Ada.
 */
function cloudbedsReservation(
  overrides: Partial<CloudbedsGetReservationResponseData> = {},
): CloudbedsGetReservationResponseData {
  return {
    reservationID: '6098484913491',
    propertyID: PROPERTY_ID,
    status: 'confirmed',
    startDate: '2026-10-28',
    endDate: '2026-10-30',
    guestList: {
      '900': {
        guestID: '900',
        guestFirstName: 'Grace',
        guestLastName: 'Hopper',
        guestCellPhone: '555-444-9999',
        isMainGuest: false,
        roomName: 'Queen 14',
      },
      '901': {
        guestID: '901',
        guestFirstName: ' Ada ',
        guestLastName: 'Lovelace ',
        guestPhone: ' +1 (555) 222-3333 ',
        guestCellPhone: ' ',
        isMainGuest: true,
        roomName: 'King 12',
      },
    },
    assigned: [{ roomName: 'King 12', startDate: '2026-10-28' }],
    unassigned: [],
    balance: 0,
    ...overrides,
  };
}

describe('lockboxStayFromCloudbeds', () => {
  it("reads the stay the way the reservation lookup reports it, with the main guest's name", () => {
    expect(lockboxStayFromCloudbeds(cloudbedsReservation())).toEqual({
      reservationId: '6098484913491',
      status: ReservationStatus.ACTIVE,
      checkedOut: false,
      checkIn: '2026-10-28',
      rooms: ['12'],
      guestName: 'Ada Lovelace',
      guestLastName: 'Lovelace',
      guestPhones: ['+1 (555) 222-3333'],
      otherGuests: [],
      balance: 0,
    });
  });

  it.each([
    ['canceled', ReservationStatus.CANCELLED, false],
    ['no_show', ReservationStatus.NO_SHOW, false],
    ['not_confirmed', ReservationStatus.INACTIVE, false],
    ['checked_in', ReservationStatus.ACTIVE, false],
    ['checked_out', ReservationStatus.ACTIVE, true],
  ])(
    'normalizes the status %s like the lookup, and flags check-outs',
    (status, expected, checkedOut) => {
      expect(
        lockboxStayFromCloudbeds(cloudbedsReservation({ status })),
      ).toMatchObject({ status: expected, checkedOut });
    },
  );

  it('lists every room assigned from the check-in date', () => {
    const stay = lockboxStayFromCloudbeds(
      cloudbedsReservation({
        assigned: [
          { roomName: 'King 12', startDate: '2026-10-28' },
          { roomName: 'Solstice King . 025', startDate: '2026-10-28' },
          { roomName: 'Garden Cottage' },
          { roomName: 'King 12', startDate: '2026-10-28' },
          { roomName: 'Queen 16', startDate: '2026-10-29' },
          { roomName: '' },
        ],
      }),
    );

    expect(stay.rooms).toEqual(['12', '025', 'Garden Cottage']);
  });

  it('has no room while Cloudbeds lists none as assigned, whatever the guest entries say', () => {
    expect(
      lockboxStayFromCloudbeds(
        cloudbedsReservation({
          assigned: [],
          unassigned: [{ roomTypeName: 'King' }],
        }),
      ).rooms,
    ).toEqual([]);
    expect(
      lockboxStayFromCloudbeds(cloudbedsReservation({ assigned: undefined }))
        .rooms,
    ).toEqual([]);
  });

  it('lists the other guests the PMS puts in the stay rooms, with only those rooms', () => {
    const stay = lockboxStayFromCloudbeds(
      cloudbedsReservation({
        assigned: [
          { roomName: 'King 12', startDate: '2026-10-28' },
          { roomName: 'Queen 14', startDate: '2026-10-28' },
        ],
        guestList: {
          ...cloudbedsReservation().guestList,
          '902': {
            guestID: '902',
            guestFirstName: 'Alan',
            guestLastName: 'Turing',
            isMainGuest: false,
            roomName: 'Queen 16',
            rooms: [{ roomName: 'Queen 16' }, { roomName: 'King 12' }],
          },
          '903': {
            guestID: '903',
            guestFirstName: 'Mary',
            guestLastName: 'Shelley',
            isMainGuest: false,
          },
        },
      }),
    );

    expect(stay.rooms).toEqual(['12', '14']);
    expect(stay.guestName).toBe('Ada Lovelace');
    expect(stay.otherGuests).toEqual([
      {
        name: 'Grace Hopper',
        lastName: 'Hopper',
        phones: ['555-444-9999'],
        rooms: ['14'],
      },
      { name: 'Alan Turing', lastName: 'Turing', phones: [], rooms: ['12'] },
    ]);
  });

  describe("with the hotel's room_number_overrides", () => {
    const FREYA = 'Freya Accessible King Retreat';
    const overrides = { [FREYA]: '19' };

    function freyaReservation(roomName = FREYA) {
      return cloudbedsReservation({
        assigned: [{ roomName, startDate: '2026-10-28' }],
      });
    }

    it('reads a room with no number in its name as the number the hotel set', () => {
      expect(
        lockboxStayFromCloudbeds(freyaReservation(), overrides).rooms,
      ).toEqual(['19']);
    });

    it('keeps the whole name as the room without an override, as before', () => {
      expect(lockboxStayFromCloudbeds(freyaReservation()).rooms).toEqual([
        FREYA,
      ]);
      expect(lockboxStayFromCloudbeds(freyaReservation(), {}).rooms).toEqual([
        FREYA,
      ]);
    });

    it.each([
      ['  freya accessible king retreat '],
      ['FREYA ACCESSIBLE KING RETREAT'],
    ])(
      'matches the Cloudbeds name %j ignoring case and surrounding spaces',
      (roomName) => {
        expect(
          lockboxStayFromCloudbeds(freyaReservation(roomName), overrides).rooms,
        ).toEqual(['19']);
      },
    );

    it('reads rooms the hotel did not name exactly as before', () => {
      const multiRoom = cloudbedsReservation({
        assigned: [
          { roomName: 'King 12', startDate: '2026-10-28' },
          { roomName: 'Solstice King . 025', startDate: '2026-10-28' },
          { roomName: 'Garden Cottage' },
          { roomName: 'Freya Accessible King', startDate: '2026-10-28' },
        ],
      });

      expect(lockboxStayFromCloudbeds(multiRoom, overrides)).toEqual(
        lockboxStayFromCloudbeds(multiRoom),
      );
      expect(
        lockboxStayFromCloudbeds(cloudbedsReservation(), overrides),
      ).toEqual(lockboxStayFromCloudbeds(cloudbedsReservation()));
    });

    it('takes the override over the number at the end of a name', () => {
      expect(
        lockboxStayFromCloudbeds(
          cloudbedsReservation({
            assigned: [
              { roomName: 'Suite 2', startDate: '2026-10-28' },
              { roomName: 'King 12', startDate: '2026-10-28' },
            ],
          }),
          { 'Suite 2': '202' },
        ).rooms,
      ).toEqual(['202', '12']);
    });

    it('gives other guests in that room the same number', () => {
      const stay = lockboxStayFromCloudbeds(
        cloudbedsReservation({
          assigned: [
            { roomName: FREYA, startDate: '2026-10-28' },
            { roomName: 'Queen 14', startDate: '2026-10-28' },
          ],
          guestList: {
            '900': {
              guestID: '900',
              guestFirstName: 'Grace',
              guestLastName: 'Hopper',
              isMainGuest: false,
              roomName: 'freya accessible king retreat',
            },
            '901': {
              guestID: '901',
              guestFirstName: 'Ada',
              guestLastName: 'Lovelace',
              isMainGuest: true,
              roomName: FREYA,
            },
          },
        }),
        overrides,
      );

      expect(stay.rooms).toEqual(['19', '14']);
      expect(stay.otherGuests).toEqual([
        { name: 'Grace Hopper', lastName: 'Hopper', phones: [], rooms: ['19'] },
      ]);
    });
  });

  it('reads the date part of the check-in, and nothing from an unreadable one', () => {
    expect(
      lockboxStayFromCloudbeds(
        cloudbedsReservation({ startDate: '2026-10-28 15:00:00' }),
      ).checkIn,
    ).toBe('2026-10-28');
    expect(
      lockboxStayFromCloudbeds(cloudbedsReservation({ startDate: undefined }))
        .checkIn,
    ).toBe('');
  });

  // Typed as a number, but a string from Cloudbeds must not read as paid.
  it.each([
    [0, 0],
    [25.5, 25.5],
    [-10, -10],
    ['0.00', 0],
    [' 25.50 ', 25.5],
    ['-10.00', -10],
    [undefined, null],
    [null, null],
    ['', null],
    ['abc', null],
    ['1,250.00', null],
    [Number.NaN, null],
  ])('reads a balance of %j as %j', (balance, expected) => {
    expect(
      lockboxStayFromCloudbeds(
        cloudbedsReservation({ balance: balance as unknown as number }),
      ).balance,
    ).toBe(expected);
  });

  it('has an empty guest name when the reservation has no guests', () => {
    expect(
      lockboxStayFromCloudbeds(cloudbedsReservation({ guestList: undefined })),
    ).toMatchObject({
      guestName: '',
      guestLastName: '',
      guestPhones: [],
      otherGuests: [],
    });
  });
});

describe('LockboxStayService', () => {
  let getReservationByIdOrThrow: jest.Mock;
  let getArrivalsByLastNameOrThrow: jest.Mock;
  let getArrivalsOrThrow: jest.Mock;
  let findReservationWithDetails: jest.Mock;
  let service: LockboxStayService;

  function cloudbedsService() {
    return {
      getReservationByIdOrThrow,
      getArrivalsByLastNameOrThrow,
      getArrivalsOrThrow,
    } as unknown as CloudbedsReservationService;
  }

  beforeEach(() => {
    getReservationByIdOrThrow = jest
      .fn()
      .mockResolvedValue(cloudbedsReservation());
    getArrivalsByLastNameOrThrow = jest.fn().mockResolvedValue([]);
    getArrivalsOrThrow = jest.fn().mockResolvedValue([]);
    findReservationWithDetails = jest.fn();
    service = new LockboxStayService(
      { findReservationWithDetails } as unknown as ReservationRepository,
      cloudbedsService(),
    );
  });

  it('supports Cloudbeds hotels only', () => {
    expect(service.supports(HOTEL)).toBe(true);
    expect(service.supports({ ...HOTEL, pms_provider: 'resnexus' })).toBe(
      false,
    );
  });

  it('reads a PMS reservation id straight from Cloudbeds', async () => {
    await expect(service.getStay(HOTEL, '6098484913491')).resolves.toEqual(
      lockboxStayFromCloudbeds(cloudbedsReservation()),
    );
    expect(getReservationByIdOrThrow).toHaveBeenCalledWith(
      HOTEL,
      '6098484913491',
    );
    expect(findReservationWithDetails).not.toHaveBeenCalled();
  });

  it("reads the rooms with the hotel's room_number_overrides", async () => {
    getReservationByIdOrThrow.mockResolvedValue(
      cloudbedsReservation({
        assigned: [
          {
            roomName: 'Freya Accessible King Retreat',
            startDate: '2026-10-28',
          },
        ],
      }),
    );

    await expect(
      service.getStay(HOTEL, '6098484913491', {
        'Freya Accessible King Retreat': '19',
      }),
    ).resolves.toMatchObject({ rooms: ['19'] });
  });

  it('reads the balance from the reservation it already loads, as a string too', async () => {
    getReservationByIdOrThrow.mockResolvedValue(
      cloudbedsReservation({ balance: '0.00' as unknown as number }),
    );

    await expect(
      service.getStay(HOTEL, '6098484913491'),
    ).resolves.toMatchObject({ balance: 0 });
    expect(getReservationByIdOrThrow).toHaveBeenCalledTimes(1);
  });

  it('returns null when Cloudbeds has no such reservation', async () => {
    getReservationByIdOrThrow.mockResolvedValue(null);

    await expect(service.getStay(HOTEL, '404')).resolves.toBeNull();
  });

  it("returns null for another property's reservation", async () => {
    getReservationByIdOrThrow.mockResolvedValue(
      cloudbedsReservation({ propertyID: '999999' }),
    );

    await expect(service.getStay(HOTEL, '6098484913491')).resolves.toBeNull();
  });

  it('lets a failed Cloudbeds lookup throw', async () => {
    getReservationByIdOrThrow.mockRejectedValue(new Error('timed out'));

    await expect(service.getStay(HOTEL, '6098484913491')).rejects.toThrow(
      'timed out',
    );
  });

  describe('findStaysByPhone', () => {
    const TONIGHT = ['2026-10-28'];
    /** Ada's number, as the session holds the caller ID. */
    const ADA_CALLER_ID = '15552223333';

    /** A getReservations row for tonight, with the fixture's guests. */
    function arrival(
      overrides: Partial<CloudbedsGetReservationResponseData> = {},
    ): CloudbedsGetReservationResponseData {
      const {
        assigned: _assigned,
        unassigned: _unassigned,
        ...row
      } = cloudbedsReservation(overrides);
      return row;
    }

    function readAgain(...reservations: CloudbedsGetReservationResponseData[]) {
      getReservationByIdOrThrow.mockImplementation(
        async (_hotel: Hotel, id: string) =>
          reservations.find(
            (reservation) => reservation.reservationID === id,
          ) ?? null,
      );
    }

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("lists the arrivals of the assignment dates, and reads the guest's reservation again", async () => {
      getArrivalsOrThrow.mockResolvedValue([arrival()]);

      await expect(
        service.findStaysByPhone(HOTEL, ADA_CALLER_ID, [
          '2026-10-28',
          '2026-10-27',
        ]),
      ).resolves.toEqual([lockboxStayFromCloudbeds(cloudbedsReservation())]);
      expect(getArrivalsOrThrow).toHaveBeenCalledWith(
        HOTEL,
        '2026-10-27',
        '2026-10-28',
        8000,
      );
      expect(getReservationByIdOrThrow).toHaveBeenCalledWith(
        HOTEL,
        '6098484913491',
        expect.any(Number),
      );
    });

    it.each([
      ["the main guest's phone", { guestPhone: '+1 (555) 222-3333' }],
      ["the main guest's cell phone", { guestCellPhone: '555.222.3333' }],
      ['a number with the country code', { guestPhone: '+15552223333' }],
    ])('finds the stay by %s', async (_case, phones) => {
      const reservation = cloudbedsReservation({
        guestList: {
          '901': {
            guestID: '901',
            guestFirstName: 'Ada',
            guestLastName: 'Lovelace',
            isMainGuest: true,
            ...phones,
          },
        },
      });
      getArrivalsOrThrow.mockResolvedValue([arrival(reservation)]);
      readAgain(reservation);

      await expect(
        service.findStaysByPhone(HOTEL, ADA_CALLER_ID, TONIGHT),
      ).resolves.toHaveLength(1);
    });

    it("finds the stay by another guest's phone", async () => {
      getArrivalsOrThrow.mockResolvedValue([arrival()]);

      await expect(
        service.findStaysByPhone(HOTEL, '+1 555 444 9999', TONIGHT),
      ).resolves.toEqual([lockboxStayFromCloudbeds(cloudbedsReservation())]);
    });

    it.each([['canceled'], ['no_show'], ['not_confirmed'], ['checked_out']])(
      'ignores a %s arrival without reading it',
      async (status) => {
        getArrivalsOrThrow.mockResolvedValue([arrival({ status })]);

        await expect(
          service.findStaysByPhone(HOTEL, ADA_CALLER_ID, TONIGHT),
        ).resolves.toEqual([]);
        expect(getReservationByIdOrThrow).not.toHaveBeenCalled();
      },
    );

    it('keeps a checked-in arrival', async () => {
      getArrivalsOrThrow.mockResolvedValue([arrival({ status: 'checked_in' })]);

      await expect(
        service.findStaysByPhone(HOTEL, ADA_CALLER_ID, TONIGHT),
      ).resolves.toHaveLength(1);
    });

    it("ignores another property's reservation and another check-in date", async () => {
      getArrivalsOrThrow.mockResolvedValue([
        arrival({ propertyID: '999999' }),
        arrival({ reservationID: '222', startDate: '2026-10-29' }),
      ]);

      await expect(
        service.findStaysByPhone(HOTEL, ADA_CALLER_ID, TONIGHT),
      ).resolves.toEqual([]);
      expect(getReservationByIdOrThrow).not.toHaveBeenCalled();
    });

    it('returns every stay with the phone', async () => {
      const first = cloudbedsReservation();
      const second = cloudbedsReservation({
        reservationID: '7000000000002',
        assigned: [{ roomName: 'Queen 16', startDate: '2026-10-28' }],
      });
      getArrivalsOrThrow.mockResolvedValue([arrival(first), arrival(second)]);
      readAgain(first, second);

      const stays = await service.findStaysByPhone(
        HOTEL,
        ADA_CALLER_ID,
        TONIGHT,
      );

      expect(stays.map((stay) => [stay.reservationId, stay.rooms])).toEqual([
        ['6098484913491', ['12']],
        ['7000000000002', ['16']],
      ]);
    });

    it('returns nothing when no guest has the phone, without reading any reservation', async () => {
      getArrivalsOrThrow.mockResolvedValue([arrival()]);

      await expect(
        service.findStaysByPhone(HOTEL, '+15550000000', TONIGHT),
      ).resolves.toEqual([]);
      expect(getReservationByIdOrThrow).not.toHaveBeenCalled();
    });

    it.each([[''], ['   '], ['555-12']])(
      'returns nothing for %j without asking Cloudbeds',
      async (phone) => {
        await expect(
          service.findStaysByPhone(HOTEL, phone, TONIGHT),
        ).resolves.toEqual([]);
        expect(getArrivalsOrThrow).not.toHaveBeenCalled();
      },
    );

    it('drops a match whose fresh copy no longer has the phone, or that Cloudbeds no longer has', async () => {
      getArrivalsOrThrow.mockResolvedValue([
        arrival(),
        arrival({ reservationID: '222' }),
      ]);
      readAgain(
        cloudbedsReservation({
          guestList: {
            '901': {
              guestFirstName: 'Ada',
              guestLastName: 'Lovelace',
              guestPhone: '+15559990000',
              isMainGuest: true,
            },
          },
        }),
      );

      await expect(
        service.findStaysByPhone(HOTEL, ADA_CALLER_ID, TONIGHT),
      ).resolves.toEqual([]);
    });

    it("reads the rooms with the hotel's room_number_overrides", async () => {
      const freya = cloudbedsReservation({
        assigned: [
          {
            roomName: 'Freya Accessible King Retreat',
            startDate: '2026-10-28',
          },
        ],
      });
      getArrivalsOrThrow.mockResolvedValue([arrival(freya)]);
      readAgain(freya);

      await expect(
        service.findStaysByPhone(HOTEL, ADA_CALLER_ID, TONIGHT, {
          'Freya Accessible King Retreat': '19',
        }),
      ).resolves.toMatchObject([{ rooms: ['19'] }]);
    });

    it('gives the second reads only the time the listing left', async () => {
      const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000);
      getArrivalsOrThrow.mockImplementation(async () => {
        clock.mockReturnValue(4_000);
        return [arrival()];
      });

      await service.findStaysByPhone(HOTEL, ADA_CALLER_ID, TONIGHT);

      expect(getReservationByIdOrThrow).toHaveBeenCalledWith(
        HOTEL,
        '6098484913491',
        5_000,
      );
    });

    it('throws once the listing used up the time limit', async () => {
      const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000);
      getArrivalsOrThrow.mockImplementation(async () => {
        clock.mockReturnValue(9_000);
        return [arrival()];
      });

      await expect(
        service.findStaysByPhone(HOTEL, ADA_CALLER_ID, TONIGHT),
      ).rejects.toThrow('timed out');
      expect(getReservationByIdOrThrow).not.toHaveBeenCalled();
    });

    it.each([
      ['listing the arrivals', () => getArrivalsOrThrow],
      ['reading a reservation again', () => getReservationByIdOrThrow],
    ])('lets a Cloudbeds failure %s throw', async (_case, lookup) => {
      getArrivalsOrThrow.mockResolvedValue([arrival()]);
      lookup().mockRejectedValue(new Error('rate limited'));

      await expect(
        service.findStaysByPhone(HOTEL, ADA_CALLER_ID, TONIGHT),
      ).rejects.toThrow('rate limited');
    });
  });

  describe('isOnlyArrivalWithGuestName', () => {
    const stay: LockboxStay = lockboxStayFromCloudbeds(cloudbedsReservation());

    function arrival(
      reservationID: string,
      firstName: string,
      lastName: string,
      status = 'confirmed',
    ): CloudbedsGetReservationResponseData {
      return {
        reservationID,
        status,
        guestName: `${firstName} ${lastName}`,
        guestList: {
          [`g${reservationID}`]: {
            guestFirstName: firstName,
            guestLastName: lastName,
            isMainGuest: true,
          },
        },
      };
    }

    it("searches tonight's arrivals by the main guest's last name", async () => {
      await service.isOnlyArrivalWithGuestName(HOTEL, stay);

      expect(getArrivalsByLastNameOrThrow).toHaveBeenCalledWith(
        HOTEL,
        'Lovelace',
        '2026-10-28',
      );
    });

    it('is true when no other live arrival has the full name', async () => {
      getArrivalsByLastNameOrThrow.mockResolvedValue([
        arrival('6098484913491', 'Ada', 'Lovelace'),
        arrival('111', 'Ada', 'Lovelace', 'canceled'),
        arrival('222', 'Byron', 'Lovelace'),
        arrival('333', 'Ada King', 'Lovelace'),
      ]);

      await expect(
        service.isOnlyArrivalWithGuestName(HOTEL, stay),
      ).resolves.toBe(true);
    });

    it.each([['confirmed'], ['not_confirmed'], ['checked_in'], ['no_show']])(
      'is false when another %s arrival has the same full name',
      async (status) => {
        getArrivalsByLastNameOrThrow.mockResolvedValue([
          arrival('6098484913491', 'Ada', 'Lovelace'),
          arrival('444', 'ADA', 'LOVELACE', status),
        ]);

        await expect(
          service.isOnlyArrivalWithGuestName(HOTEL, stay),
        ).resolves.toBe(false);
      },
    );

    it('reads the main guest from the row name when the row has no guest list', async () => {
      getArrivalsByLastNameOrThrow.mockResolvedValue([
        {
          reservationID: '444',
          status: 'confirmed',
          guestName: 'Ada Lovelace',
        },
      ]);

      await expect(
        service.isOnlyArrivalWithGuestName(HOTEL, stay),
      ).resolves.toBe(false);
    });

    it('is false without asking Cloudbeds when the main guest has no last name', async () => {
      await expect(
        service.isOnlyArrivalWithGuestName(HOTEL, {
          ...stay,
          guestLastName: '',
        }),
      ).resolves.toBe(false);
      expect(getArrivalsByLastNameOrThrow).not.toHaveBeenCalled();
    });

    it('lets a failed Cloudbeds search throw', async () => {
      getArrivalsByLastNameOrThrow.mockRejectedValue(new Error('timed out'));

      await expect(
        service.isOnlyArrivalWithGuestName(HOTEL, stay),
      ).rejects.toThrow('timed out');
    });
  });

  describe("Daisy's own BK ids (pg-mem)", () => {
    const ctx = installPgMemTestContext();

    beforeEach(() => {
      service = new LockboxStayService(
        new ReservationRepository(ctx.knex),
        cloudbedsService(),
      );
    });

    async function seedDaisyBooking(externalId?: string) {
      return seedReservation(ctx.knex, {
        checkIn: '2026-10-28',
        checkOut: '2026-10-30',
        firstName: 'Ada',
        lastName: 'Lovelace',
        externalId,
      });
    }

    it('reads the booking from Cloudbeds by the reservation id stored with it', async () => {
      const seeded = await seedDaisyBooking('6098484913491');

      await expect(
        service.getStay(HOTEL, seeded.bookingId),
      ).resolves.toMatchObject({ guestName: 'Ada Lovelace', rooms: ['12'] });
      expect(getReservationByIdOrThrow).toHaveBeenCalledWith(
        HOTEL,
        '6098484913491',
      );
    });

    it('returns null without asking Cloudbeds when the booking never reached it', async () => {
      const seeded = await seedDaisyBooking();

      await expect(
        service.getStay(HOTEL, seeded.bookingId),
      ).resolves.toBeNull();
      expect(getReservationByIdOrThrow).not.toHaveBeenCalled();
    });

    it('returns null for an unknown BK id', async () => {
      await expect(service.getStay(HOTEL, 'BK00000')).resolves.toBeNull();
      expect(getReservationByIdOrThrow).not.toHaveBeenCalled();
    });

    it("never resolves another hotel's BK id", async () => {
      const seeded = await seedDaisyBooking('6098484913491');

      await expect(
        service.getStay(
          { ...HOTEL, id: '44444444-4444-4444-4444-444444444444' },
          seeded.bookingId,
        ),
      ).resolves.toBeNull();
      expect(getReservationByIdOrThrow).not.toHaveBeenCalled();
    });
  });
});
