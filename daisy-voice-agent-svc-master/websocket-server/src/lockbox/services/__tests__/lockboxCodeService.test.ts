/* global beforeEach, describe, expect, it, jest */
import { CloudbedsReservationService } from '@/cloudbeds/services/reservationService';
import { CloudbedsGetReservationResponseData } from '@/cloudbeds/types';
import { DropboxClient } from '@/dropbox/client/DropboxClient';
import { DropboxAPIError } from '@/dropbox/errors';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { LockboxCodeService } from '@/lockbox/services/lockboxCodeService';
import { LockboxStayService } from '@/lockbox/services/lockboxStayService';
import {
  LockboxCodeFailureReason,
  LockboxCodeQuery,
  LockboxPhoneQuery,
  LockboxStay,
} from '@/lockbox/types';
import { ReservationRepository } from '@/repositories/ReservationRepository';
import { HotelService } from '@/services/hotel/hotelService';
import { HotelConfigurationService } from '@/services/hotelConfiguration/hotelConfigurationService';
import {
  ArchiveRowFixture,
  buildLockboxWorkbook,
  excelDate,
  LockboxRowFixture,
  openLockboxRows,
} from '@/test/fixtures/lockboxWorkbookFixture';
import {
  DoorLockConfig,
  LockboxBalancePolicy,
  LockboxLogProvider,
} from '@/types/hotelConfiguration';
import { KpiStat, logKpi } from '@/utils/kpiLogger';
import logger from '@/utils/logger';

jest.mock('@/utils/kpiLogger', () => {
  const actual = jest.requireActual('@/utils/kpiLogger');
  return { ...actual, logKpi: jest.fn() };
});

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const HOTEL_ID = 'hotel-1';
const ASSISTANT_PHONE = '15550001111';
const BOOKING_ID = '6098484913491';
/** Ada's mobile, as Cloudbeds holds it; the session's caller ID is its digits. */
const CALLER_PHONE = '+1 (555) 222-3333';
const GRACE_PHONE = '555-444-9999';
const SHARED_LINK =
  'https://www.dropbox.com/scl/fi/abc123/Lockbox%20Log.xlsm?rlkey=k&dl=0';
const HOTEL = {
  id: HOTEL_ID,
  assistant_phone_number: ASSISTANT_PHONE,
  timezone: 'America/Los_Angeles',
  pms_provider: 'cloudbeds',
};
/** 9 PM on Oct 28 at a Los Angeles hotel. */
const NOW = new Date('2026-10-28T21:00:00-07:00');

const LOCKBOX_LOG: DoorLockConfig = {
  lockbox_log: {
    provider: LockboxLogProvider.DROPBOX_EXCEL,
    shared_link: SHARED_LINK,
  },
};

/** A wall-clock time at the hotel; October 2026 in Los Angeles is UTC-7. */
function pacific(isoLocal: string): Date {
  return new Date(`${isoLocal}-07:00`);
}

function todayRows(rows: LockboxRowFixture[]): LockboxRowFixture[] {
  const filled = new Map(rows.map((row) => [row.lockbox, row]));
  return openLockboxRows().map((row) => filled.get(row.lockbox) ?? row);
}

/** Ada Lovelace in room 8, checking in tonight (Oct 28). */
function stay(overrides: Partial<LockboxStay> = {}): LockboxStay {
  return {
    reservationId: BOOKING_ID,
    status: ReservationStatus.ACTIVE,
    checkedOut: false,
    checkIn: '2026-10-28',
    rooms: ['8'],
    guestName: 'Ada Lovelace',
    guestLastName: 'Lovelace',
    guestPhones: [CALLER_PHONE],
    otherGuests: [],
    balance: 0,
    ...overrides,
  };
}

/** Ada calling about her own booking. */
function query(overrides: Partial<LockboxCodeQuery> = {}): LockboxCodeQuery {
  return { bookingId: BOOKING_ID, customerName: 'Ada Lovelace', ...overrides };
}

/** Ada in room 8 and Grace in room 9, plus an OPEN box staged for room 12. */
function tonightsLog(): Promise<Buffer> {
  return buildLockboxWorkbook({
    todayDate: excelDate('2026-10-28'),
    todayRows: todayRows([
      {
        lockbox: 4,
        guestName: 'ADA LOVELACE',
        room: 8,
        code: '*4821',
        notes: 'spare key is in the office',
      },
      {
        lockbox: 5,
        guestName: 'GRACE HOPPER',
        room: 9,
        code: '*5555',
        notes: 'owes $40 for parking',
      },
      { lockbox: 9, guestName: 'OPEN', room: 12, code: '*1212' },
    ]),
  });
}

function makeService(
  options: {
    doorLockConfig?: DoorLockConfig | null;
    workbook?: Promise<Buffer>;
    download?: jest.Mock;
    now?: Date;
    stay?: LockboxStay | null;
    getStay?: jest.Mock;
    supports?: boolean;
    isOnlyArrivalWithGuestName?: jest.Mock;
    /** What the phone lookup finds; Ada's stay by default. */
    phoneStays?: LockboxStay[];
    findStaysByPhone?: jest.Mock;
  } = {},
) {
  const getHotelById = jest.fn().mockResolvedValue(HOTEL);
  const getHotelConfigurationByHotelId = jest.fn().mockResolvedValue({
    hotel_id: HOTEL_ID,
    door_lock_config:
      options.doorLockConfig === undefined
        ? LOCKBOX_LOG
        : options.doorLockConfig,
  });
  const getSharedLinkFile =
    options.download ??
    jest.fn().mockImplementation(async () => {
      return options.workbook ?? tonightsLog();
    });
  const getStay =
    options.getStay ??
    jest
      .fn()
      .mockResolvedValue(options.stay === undefined ? stay() : options.stay);
  const supports = jest.fn().mockReturnValue(options.supports ?? true);
  const isOnlyArrivalWithGuestName =
    options.isOnlyArrivalWithGuestName ?? jest.fn().mockResolvedValue(true);
  const findStaysByPhone =
    options.findStaysByPhone ??
    jest.fn().mockResolvedValue(options.phoneStays ?? [stay()]);

  const service = new LockboxCodeService(
    { getHotelById } as unknown as HotelService,
    { getHotelConfigurationByHotelId } as unknown as HotelConfigurationService,
    { getSharedLinkFile } as unknown as DropboxClient,
    {
      supports,
      getStay,
      findStaysByPhone,
      isOnlyArrivalWithGuestName,
    } as unknown as LockboxStayService,
    () => options.now ?? NOW,
  );
  return {
    service,
    getSharedLinkFile,
    getStay,
    supports,
    findStaysByPhone,
    isOnlyArrivalWithGuestName,
  };
}

/** Ada calling from her own mobile, the number on her booking. */
function phoneQuery(
  overrides: Partial<LockboxPhoneQuery> = {},
): LockboxPhoneQuery {
  return { callerPhone: '15552223333', ...overrides };
}

function expectKpis(...stats: string[]) {
  expect((logKpi as jest.Mock).mock.calls.map(([call]) => call.stat)).toEqual(
    stats,
  );
}

function expectKpi(stat: string) {
  expect(logKpi).toHaveBeenCalledTimes(1);
  expect(logKpi).toHaveBeenCalledWith({
    stat,
    value: 1,
    contextName: 'LockboxCodeService.getLockboxCode',
    clientId: ASSISTANT_PHONE,
  });
}

function loggedText(): string {
  return JSON.stringify([
    (logger.info as jest.Mock).mock.calls,
    (logger.warn as jest.Mock).mock.calls,
    (logger.error as jest.Mock).mock.calls,
  ]);
}

describe('LockboxCodeService.getLockboxCode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the reservation guest's lockbox and code, and the first match at the top level", async () => {
    const { service, getSharedLinkFile, getStay } = makeService();

    const result = await service.getLockboxCode(HOTEL_ID, query());

    expect(result).toEqual({
      success: true,
      lockbox_number: '4',
      code: '*4821',
      note: 'spare key is in the office',
      lockboxes: [
        {
          lockbox_number: '4',
          room_number: '8',
          code: '*4821',
          note: 'spare key is in the office',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/parking|5555|HOPPER|1212/);
    expect(getStay).toHaveBeenCalledWith(HOTEL, BOOKING_ID, undefined);
    expect(getSharedLinkFile).toHaveBeenCalledWith(SHARED_LINK);
    expectKpi(KpiStat.LockboxCodeResolved);
  });

  it('accepts a room and name that agree with the reservation', async () => {
    const { service } = makeService();

    await expect(
      service.getLockboxCode(
        HOTEL_ID,
        query({ roomNumber: '08', customerName: 'Lovelace, Ada' }),
      ),
    ).resolves.toMatchObject({ success: true, code: '*4821' });
  });

  it('returns every box the guest holds', async () => {
    const { service } = makeService({
      stay: stay({ rooms: ['3'], guestName: 'Alan Turing' }),
      workbook: buildLockboxWorkbook({
        todayRows: todayRows([
          { lockbox: 2, guestName: 'ALAN TURING', room: 3, code: '61822' },
          { lockbox: 7, guestName: 'Turing, Alan', room2: 3, code: 905113 },
        ]),
      }),
    });

    const result = await service.getLockboxCode(
      HOTEL_ID,
      query({ customerName: 'Alan Turing' }),
    );

    expect(result).toMatchObject({
      success: true,
      lockbox_number: '2',
      code: '61822',
      lockboxes: [
        { lockbox_number: '2', room_number: '3', code: '61822' },
        { lockbox_number: '7', room_number: '3', code: '905113' },
      ],
    });
  });

  it('gives the main guest the boxes for every room of a multi-room reservation', async () => {
    const { service } = makeService({
      stay: stay({ rooms: ['3', '9'], guestName: 'Alan Turing' }),
      workbook: buildLockboxWorkbook({
        todayRows: todayRows([
          { lockbox: 2, guestName: 'ALAN TURING', room: 3, code: '61822' },
          { lockbox: 5, guestName: 'ALAN TURING', room: 9, code: '*9009' },
          { lockbox: 6, guestName: 'OPEN', room: 10, code: '*1010' },
        ]),
      }),
    });

    await expect(
      service.getLockboxCode(HOTEL_ID, query({ customerName: 'Alan Turing' })),
    ).resolves.toEqual({
      success: true,
      lockbox_number: '2',
      code: '61822',
      lockboxes: [
        { lockbox_number: '2', room_number: '3', code: '61822' },
        { lockbox_number: '5', room_number: '9', code: '*9009' },
      ],
    });
  });

  describe('a reservation with rooms 12 and 14, and Grace Hopper in room 14', () => {
    const twoRooms = () =>
      stay({
        rooms: ['12', '14'],
        otherGuests: [
          {
            name: 'Grace Hopper',
            lastName: 'Hopper',
            phones: [GRACE_PHONE],
            rooms: ['14'],
          },
        ],
      });
    const twoBoxes = () =>
      buildLockboxWorkbook({
        todayRows: todayRows([
          { lockbox: 4, guestName: 'ADA LOVELACE', room: 12, code: '*1212' },
          { lockbox: 7, guestName: 'GRACE HOPPER', room: 14, code: '*1414' },
        ]),
      });

    it('answers for the room sent only, at the top level too', async () => {
      const { service } = makeService({
        stay: twoRooms(),
        workbook: twoBoxes(),
      });

      await expect(
        service.getLockboxCode(HOTEL_ID, query({ roomNumber: '14' })),
      ).resolves.toEqual({
        success: true,
        lockbox_number: '7',
        code: '*1414',
        lockboxes: [{ lockbox_number: '7', room_number: '14', code: '*1414' }],
      });
    });

    it('gives a guest the PMS puts in room 14 only that room', async () => {
      const { service } = makeService({
        stay: twoRooms(),
        workbook: twoBoxes(),
      });

      await expect(
        service.getLockboxCode(
          HOTEL_ID,
          query({ customerName: 'Grace Hopper' }),
        ),
      ).resolves.toEqual({
        success: true,
        lockbox_number: '7',
        code: '*1414',
        lockboxes: [{ lockbox_number: '7', room_number: '14', code: '*1414' }],
      });
    });

    it('refuses that guest the other room', async () => {
      const { service, getSharedLinkFile } = makeService({
        stay: twoRooms(),
        workbook: twoBoxes(),
      });

      await expect(
        service.getLockboxCode(
          HOTEL_ID,
          query({ customerName: 'Grace Hopper', roomNumber: '12' }),
        ),
      ).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.RESERVATION_MISMATCH,
      });
      expect(getSharedLinkFile).not.toHaveBeenCalled();
    });

    it("matches a room's named box under any guest the PMS puts in it", async () => {
      const { service } = makeService({
        stay: twoRooms(),
        workbook: buildLockboxWorkbook({
          todayRows: todayRows([
            { lockbox: 4, guestName: 'ADA LOVELACE', room: 12, code: '*1212' },
            { lockbox: 7, guestName: 'GRACE HOPPER', room: 14, code: '*1414' },
          ]),
        }),
      });

      await expect(
        service.getLockboxCode(HOTEL_ID, query()),
      ).resolves.toMatchObject({
        success: true,
        lockboxes: [
          { lockbox_number: '4', room_number: '12', code: '*1212' },
          { lockbox_number: '7', room_number: '14', code: '*1414' },
        ],
      });
    });
  });

  // The Marlo: Cloudbeds names the accessible room "Freya Accessible King
  // Retreat" while staff file its box under room 19 (reproduced on DEV).
  describe('a room whose Cloudbeds name has no number (room_number_overrides)', () => {
    const FREYA = 'Freya Accessible King Retreat';
    const FREYA_BOOKING_ID = '4478445805292';
    const OVERRIDES = { [FREYA]: '19' };
    const WITH_OVERRIDES: DoorLockConfig = {
      ...LOCKBOX_LOG,
      room_number_overrides: OVERRIDES,
    };

    /** Freya Tester in the Freya room, checking in tonight, nothing owed. */
    function freyaReservation(): CloudbedsGetReservationResponseData {
      return {
        reservationID: FREYA_BOOKING_ID,
        status: 'confirmed',
        startDate: '2026-10-28',
        endDate: '2026-10-29',
        guestList: {
          '700': {
            guestID: '700',
            guestFirstName: 'Freya',
            guestLastName: 'Tester',
            isMainGuest: true,
            roomName: FREYA,
          },
        },
        assigned: [{ roomName: FREYA, startDate: '2026-10-28' }],
        balance: 0,
      };
    }

    function freyaLog(room19Name = 'FREYA TESTER'): Promise<Buffer> {
      return buildLockboxWorkbook({
        todayRows: todayRows([
          { lockbox: 4, guestName: 'ADA LOVELACE', room: 8, code: '*4821' },
          { lockbox: 7, guestName: room19Name, room: 19, code: '*1919' },
          { lockbox: 9, guestName: 'OPEN', room: 12, code: '*1212' },
        ]),
      });
    }

    /** The lockbox service over the real stay service, with Cloudbeds stubbed. */
    function freyaService(
      doorLockConfig: DoorLockConfig,
      workbook = freyaLog(),
    ) {
      const stays = new LockboxStayService(
        {
          findReservationWithDetails: jest.fn(),
        } as unknown as ReservationRepository,
        {
          getReservationByIdOrThrow: jest
            .fn()
            .mockResolvedValue(freyaReservation()),
          getArrivalsByLastNameOrThrow: jest.fn().mockResolvedValue([]),
        } as unknown as CloudbedsReservationService,
      );
      return makeService({
        doorLockConfig,
        workbook,
        getStay: jest.fn((...args: Parameters<LockboxStayService['getStay']>) =>
          stays.getStay(...args),
        ),
      });
    }

    function freyaQuery(
      overrides: Partial<LockboxCodeQuery> = {},
    ): LockboxCodeQuery {
      return query({
        bookingId: FREYA_BOOKING_ID,
        customerName: 'Freya Tester',
        ...overrides,
      });
    }

    it('finds the box filed under the room number the hotel set for the room', async () => {
      const { service, getStay } = freyaService(WITH_OVERRIDES);

      await expect(
        service.getLockboxCode(HOTEL_ID, freyaQuery()),
      ).resolves.toEqual({
        success: true,
        lockbox_number: '7',
        code: '*1919',
        lockboxes: [{ lockbox_number: '7', room_number: '19', code: '*1919' }],
      });
      expect(getStay).toHaveBeenCalledWith(HOTEL, FREYA_BOOKING_ID, OVERRIDES);
      expectKpi(KpiStat.LockboxCodeResolved);
    });

    it('finds nothing without the override, as before', async () => {
      const { service } = freyaService(LOCKBOX_LOG);

      await expect(
        service.getLockboxCode(HOTEL_ID, freyaQuery()),
      ).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.NOT_FOUND,
      });
      expectKpi(KpiStat.LockboxCodeNotFound);
    });

    it.each([
      [FREYA],
      ['  freya accessible king retreat '],
      ['19'],
      ['Room 19'],
    ])('accepts the room sent as %j', async (roomNumber) => {
      const { service } = freyaService(WITH_OVERRIDES);

      await expect(
        service.getLockboxCode(HOTEL_ID, freyaQuery({ roomNumber })),
      ).resolves.toMatchObject({ success: true, code: '*1919' });
    });

    it("keeps a room sent that is already the reservation's, even when another room's name maps elsewhere", async () => {
      const { service } = freyaService({
        ...LOCKBOX_LOG,
        room_number_overrides: { ...OVERRIDES, '19': '42' },
      });

      await expect(
        service.getLockboxCode(HOTEL_ID, freyaQuery({ roomNumber: '19' })),
      ).resolves.toMatchObject({ success: true, code: '*1919' });
    });

    it.each([['8'], ['12'], ['Freya']])(
      "still refuses the room %j, which isn't the reservation's, without downloading the log",
      async (roomNumber) => {
        const { service, getSharedLinkFile } = freyaService(WITH_OVERRIDES);

        await expect(
          service.getLockboxCode(HOTEL_ID, freyaQuery({ roomNumber })),
        ).resolves.toEqual({
          success: false,
          reason: LockboxCodeFailureReason.RESERVATION_MISMATCH,
        });
        expect(getSharedLinkFile).not.toHaveBeenCalled();
      },
    );

    it("still needs the box's name to be a guest's on the reservation", async () => {
      const { service } = freyaService(
        WITH_OVERRIDES,
        freyaLog('GRACE HOPPER'),
      );

      await expect(
        service.getLockboxCode(HOTEL_ID, freyaQuery()),
      ).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.NOT_FOUND,
      });
    });
  });

  // A key staged in an OPEN box under its room, for a booking made after hours.
  it("gives the room's one OPEN box when no box has the guest's name", async () => {
    const { service } = makeService({
      stay: stay({ rooms: ['12'], guestName: 'Grace Hopper' }),
    });

    await expect(
      service.getLockboxCode(HOTEL_ID, query({ customerName: 'Grace Hopper' })),
    ).resolves.toMatchObject({ success: true, lockbox_number: '9' });
  });

  it("never gives an OPEN box for a room that isn't the reservation's", async () => {
    const { service } = makeService({
      stay: stay({ rooms: ['10'], guestName: 'Any Guest' }),
    });

    await expect(
      service.getLockboxCode(HOTEL_ID, query({ customerName: 'Any Guest' })),
    ).resolves.toEqual({
      success: false,
      reason: LockboxCodeFailureReason.NOT_FOUND,
    });
    expectKpi(KpiStat.LockboxCodeNotFound);
  });

  // The DEV red-team call: room 12 + "Any Guest" read the OPEN box's code.
  // A last name alone is how a relative got a code in the prompt tests.
  it.each([
    [{ roomNumber: '12', customerName: 'Any Guest' }],
    [{ roomNumber: '12' }],
    [{ customerName: 'Grace Hopper' }],
    [{ customerName: 'Lovelace' }],
  ])(
    'refuses %j when it contradicts the reservation, without downloading the log',
    async (claimed) => {
      const { service, getSharedLinkFile } = makeService();

      await expect(
        service.getLockboxCode(HOTEL_ID, query(claimed)),
      ).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.RESERVATION_MISMATCH,
      });
      expect(getSharedLinkFile).not.toHaveBeenCalled();
      expectKpi(KpiStat.LockboxReservationMismatch);
      expect(logger.warn).toHaveBeenCalledWith(
        'LockboxCodeService: the request contradicts the reservation',
        expect.objectContaining({ hotelId: HOTEL_ID, bookingId: BOOKING_ID }),
      );
    },
  );

  it('reports reservation_not_found when the PMS has no such reservation', async () => {
    const { service, getSharedLinkFile } = makeService({ stay: null });

    await expect(service.getLockboxCode(HOTEL_ID, query())).resolves.toEqual({
      success: false,
      reason: LockboxCodeFailureReason.RESERVATION_NOT_FOUND,
    });
    expect(getSharedLinkFile).not.toHaveBeenCalled();
    expectKpi(KpiStat.LockboxReservationNotVerified);
  });

  it.each([
    ['cancelled', { status: ReservationStatus.CANCELLED }],
    ['a no-show', { status: ReservationStatus.NO_SHOW }],
    ['not confirmed', { status: ReservationStatus.INACTIVE }],
    ['checked out', { checkedOut: true }],
  ])(
    'reports reservation_not_active for a stay that is %s',
    async (_case, overrides) => {
      const { service, getSharedLinkFile } = makeService({
        stay: stay(overrides),
      });

      await expect(service.getLockboxCode(HOTEL_ID, query())).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.RESERVATION_NOT_ACTIVE,
      });
      expect(getSharedLinkFile).not.toHaveBeenCalled();
      expectKpi(KpiStat.LockboxReservationNotVerified);
    },
  );

  it.each([
    ['six days out', '2026-11-03'],
    ['tomorrow', '2026-10-29'],
    ['yesterday, after noon', '2026-10-27'],
  ])(
    'reports not_arriving_tonight for a check-in %s',
    async (_case, checkIn) => {
      const { service, getSharedLinkFile } = makeService({
        stay: stay({ checkIn }),
      });

      await expect(service.getLockboxCode(HOTEL_ID, query())).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.NOT_ARRIVING_TONIGHT,
      });
      expect(getSharedLinkFile).not.toHaveBeenCalled();
      expectKpi(KpiStat.LockboxReservationNotVerified);
    },
  );

  it('reports no_room_assigned for a reservation without a room', async () => {
    const { service, getSharedLinkFile } = makeService({
      stay: stay({ rooms: [] }),
    });

    await expect(service.getLockboxCode(HOTEL_ID, query())).resolves.toEqual({
      success: false,
      reason: LockboxCodeFailureReason.NO_ROOM_ASSIGNED,
    });
    expect(getSharedLinkFile).not.toHaveBeenCalled();
    expectKpi(KpiStat.LockboxReservationNotVerified);
  });

  describe('balance owed on the reservation', () => {
    it.each([[0], [-20]])(
      'gives the code when the balance is %j',
      async (balance) => {
        const { service } = makeService({ stay: stay({ balance }) });

        await expect(
          service.getLockboxCode(HOTEL_ID, query()),
        ).resolves.toMatchObject({ success: true, code: '*4821' });
        expectKpi(KpiStat.LockboxCodeResolved);
      },
    );

    it('reports balance_due while a balance is owed, without downloading the log', async () => {
      const { service, getSharedLinkFile } = makeService({
        stay: stay({ balance: 25.5 }),
      });

      await expect(service.getLockboxCode(HOTEL_ID, query())).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.BALANCE_DUE,
      });
      expect(getSharedLinkFile).not.toHaveBeenCalled();
      expectKpi(KpiStat.LockboxReservationBalanceDue);
      expect(logger.info).toHaveBeenCalledWith(
        'LockboxCodeService: the reservation has a balance due',
        expect.objectContaining({
          hotelId: HOTEL_ID,
          bookingId: BOOKING_ID,
          reason: LockboxCodeFailureReason.BALANCE_DUE,
          balance: 25.5,
        }),
      );
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('reports balance_due when the PMS gave no readable balance, with a warning', async () => {
      const { service, getSharedLinkFile } = makeService({
        stay: stay({ balance: null }),
      });

      await expect(service.getLockboxCode(HOTEL_ID, query())).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.BALANCE_DUE,
      });
      expect(getSharedLinkFile).not.toHaveBeenCalled();
      expectKpi(KpiStat.LockboxReservationBalanceDue);
      expect(logger.warn).toHaveBeenCalledWith(
        'LockboxCodeService: the PMS gave no readable balance for the reservation, so it counts as owed',
        expect.objectContaining({
          hotelId: HOTEL_ID,
          bookingId: BOOKING_ID,
          reason: LockboxCodeFailureReason.BALANCE_DUE,
        }),
      );
    });

    it('reports reservation_mismatch, not balance_due, to a caller who is not on the reservation', async () => {
      const { service } = makeService({ stay: stay({ balance: 25.5 }) });

      await expect(
        service.getLockboxCode(
          HOTEL_ID,
          query({ customerName: 'Grace Hopper' }),
        ),
      ).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.RESERVATION_MISMATCH,
      });
      expectKpi(KpiStat.LockboxReservationMismatch);
    });
  });

  it('reports reservation_lookup_failed when the PMS lookup fails', async () => {
    const { service, getSharedLinkFile } = makeService({
      getStay: jest
        .fn()
        .mockRejectedValue(new Error('Cloudbeds lookup timed out')),
    });

    await expect(service.getLockboxCode(HOTEL_ID, query())).resolves.toEqual({
      success: false,
      reason: LockboxCodeFailureReason.RESERVATION_LOOKUP_FAILED,
    });
    expect(getSharedLinkFile).not.toHaveBeenCalled();
    expectKpi(KpiStat.LockboxReservationLookupFailed);
  });

  it("reports reservation_lookup_unsupported when the hotel's PMS can't load a reservation by id", async () => {
    const { service, getStay, getSharedLinkFile } = makeService({
      supports: false,
    });

    await expect(service.getLockboxCode(HOTEL_ID, query())).resolves.toEqual({
      success: false,
      reason: LockboxCodeFailureReason.RESERVATION_LOOKUP_UNSUPPORTED,
    });
    expect(getStay).not.toHaveBeenCalled();
    expect(getSharedLinkFile).not.toHaveBeenCalled();
    expectKpi(KpiStat.LockboxReservationLookupFailed);
  });

  describe('arrival date, in the hotel timezone', () => {
    const lateArrival = () =>
      buildLockboxWorkbook({
        todayDate: excelDate('2026-10-28'),
        todayRows: todayRows([
          { lockbox: 1, guestName: 'ADA LOVELACE', room: 11, code: '*1111' },
        ]),
      });
    const lastNightsStay = stay({ checkIn: '2026-10-28', rooms: ['11'] });

    it("serves last night's arrival from last evening's Today tab after midnight", async () => {
      const { service } = makeService({
        now: pacific('2026-10-29T01:30:00'),
        stay: lastNightsStay,
        workbook: lateArrival(),
      });

      await expect(
        service.getLockboxCode(HOTEL_ID, query()),
      ).resolves.toMatchObject({ success: true, code: '*1111' });
    });

    it("still serves last night's arrival at 11:59", async () => {
      const { service } = makeService({
        now: pacific('2026-10-29T11:59:00'),
        stay: lastNightsStay,
        workbook: lateArrival(),
      });

      await expect(
        service.getLockboxCode(HOTEL_ID, query()),
      ).resolves.toMatchObject({ success: true, code: '*1111' });
    });

    it("refuses last night's arrival from noon, without downloading the log", async () => {
      const { service, getSharedLinkFile } = makeService({
        now: pacific('2026-10-29T12:00:00'),
        stay: lastNightsStay,
        workbook: lateArrival(),
      });

      await expect(service.getLockboxCode(HOTEL_ID, query())).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.NOT_ARRIVING_TONIGHT,
      });
      expect(getSharedLinkFile).not.toHaveBeenCalled();
    });

    it("refuses tonight's arrival while last evening's assignment is still in force", async () => {
      const { service, getSharedLinkFile } = makeService({
        now: pacific('2026-10-29T10:00:00'),
        stay: stay({ checkIn: '2026-10-29', rooms: ['11'] }),
        workbook: lateArrival(),
      });

      await expect(service.getLockboxCode(HOTEL_ID, query())).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.NOT_ARRIVING_TONIGHT,
      });
      expect(getSharedLinkFile).toHaveBeenCalledTimes(1);
      expectKpi(KpiStat.LockboxReservationNotVerified);
    });

    it("decides 'tonight' in the hotel's timezone, not UTC", async () => {
      // 05:30 UTC on Oct 29 is 22:30 on Oct 28 in Los Angeles.
      const now = new Date('2026-10-29T05:30:00Z');

      await expect(
        makeService({
          now,
          stay: lastNightsStay,
          workbook: lateArrival(),
        }).service.getLockboxCode(HOTEL_ID, query()),
      ).resolves.toMatchObject({ success: true, code: '*1111' });
      await expect(
        makeService({
          now,
          stay: stay({ checkIn: '2026-10-29', rooms: ['11'] }),
          workbook: lateArrival(),
        }).service.getLockboxCode(HOTEL_ID, query()),
      ).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.NOT_ARRIVING_TONIGHT,
      });
    });
  });

  it("falls back to today's Archive rows when the Today tab is for another date", async () => {
    const archiveRows: ArchiveRowFixture[] = [
      {
        date: excelDate('2026-10-28'),
        lockbox: 3,
        guestName: 'GRACE HOPPER',
        room: 6,
        code: '*6006',
        originalNameText: 'Grace Hopper',
      },
    ];
    const { service } = makeService({
      stay: stay({ rooms: ['6'], guestName: 'Grace Hopper' }),
      workbook: buildLockboxWorkbook({
        todayDate: excelDate('2026-10-29'),
        archiveRows,
      }),
    });

    await expect(
      service.getLockboxCode(HOTEL_ID, query({ customerName: 'Grace Hopper' })),
    ).resolves.toMatchObject({ success: true, lockbox_number: '3' });
  });

  describe('a box with both rooms blank', () => {
    const graceInRoom9 = () =>
      stay({
        rooms: ['9'],
        guestName: 'Grace Hopper',
        guestLastName: 'Hopper',
      });
    const blankRoomBox = () =>
      buildLockboxWorkbook({
        todayRows: todayRows([
          { lockbox: 6, guestName: 'HOPPER, GRACE ', code: '*6006' },
          { lockbox: 7, guestName: 'OPEN', code: '*7007' },
        ]),
      });
    const asGrace = () => query({ customerName: 'Grace Hopper' });

    it("goes to the only arrival with the main guest's exact name", async () => {
      const guest = graceInRoom9();
      const { service, isOnlyArrivalWithGuestName } = makeService({
        stay: guest,
        workbook: blankRoomBox(),
      });

      await expect(
        service.getLockboxCode(HOTEL_ID, asGrace()),
      ).resolves.toEqual({
        success: true,
        lockbox_number: '6',
        code: '*6006',
        lockboxes: [{ lockbox_number: '6', room_number: '9', code: '*6006' }],
      });
      expect(isOnlyArrivalWithGuestName).toHaveBeenCalledWith(HOTEL, guest);
      expectKpi(KpiStat.LockboxCodeResolved);
    });

    // Two "John Smith"s arriving the same night, or a cheap booking made
    // under a victim's name: the box can't be tied to either reservation.
    it('is refused when another arrival has the same name', async () => {
      const { service } = makeService({
        stay: stay({
          rooms: ['9'],
          guestName: 'John Smith',
          guestLastName: 'Smith',
        }),
        workbook: buildLockboxWorkbook({
          todayRows: todayRows([
            { lockbox: 3, guestName: 'JOHN SMITH', code: '*3333' },
          ]),
        }),
        isOnlyArrivalWithGuestName: jest.fn().mockResolvedValue(false),
      });

      const result = await service.getLockboxCode(
        HOTEL_ID,
        query({ customerName: 'John Smith' }),
      );

      expect(result).toEqual({
        success: false,
        reason: LockboxCodeFailureReason.NOT_FOUND,
      });
      expect(JSON.stringify(result)).not.toContain('3333');
      expectKpi(KpiStat.LockboxCodeNotFound);
    });

    it('reports reservation_lookup_failed when the same-name check fails', async () => {
      const { service } = makeService({
        stay: graceInRoom9(),
        workbook: blankRoomBox(),
        isOnlyArrivalWithGuestName: jest
          .fn()
          .mockRejectedValue(new Error('Cloudbeds search timed out')),
      });

      await expect(
        service.getLockboxCode(HOTEL_ID, asGrace()),
      ).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.RESERVATION_LOOKUP_FAILED,
      });
      expectKpi(KpiStat.LockboxReservationLookupFailed);
    });

    it('is never used once a box matches by room', async () => {
      const { service, isOnlyArrivalWithGuestName } = makeService({
        stay: graceInRoom9(),
        workbook: buildLockboxWorkbook({
          todayRows: todayRows([
            { lockbox: 5, guestName: 'GRACE HOPPER', room: 9, code: '*9009' },
            { lockbox: 6, guestName: 'GRACE HOPPER', code: '*6006' },
          ]),
        }),
      });

      await expect(
        service.getLockboxCode(HOTEL_ID, asGrace()),
      ).resolves.toEqual({
        success: true,
        lockbox_number: '5',
        code: '*9009',
        lockboxes: [{ lockbox_number: '5', room_number: '9', code: '*9009' }],
      });
      expect(isOnlyArrivalWithGuestName).not.toHaveBeenCalled();
    });

    it('is never used for a reservation with several rooms', async () => {
      const { service, isOnlyArrivalWithGuestName } = makeService({
        stay: stay({
          rooms: ['9', '10'],
          guestName: 'Grace Hopper',
          guestLastName: 'Hopper',
        }),
        workbook: blankRoomBox(),
      });

      await expect(
        service.getLockboxCode(HOTEL_ID, asGrace()),
      ).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.NOT_FOUND,
      });
      expect(isOnlyArrivalWithGuestName).not.toHaveBeenCalled();
    });
  });

  it("reports not_found when no box matches the reservation's rooms and guests", async () => {
    const { service } = makeService({
      stay: stay({ guestName: 'Mary Shelley' }),
    });

    await expect(
      service.getLockboxCode(HOTEL_ID, query({ customerName: 'Mary Shelley' })),
    ).resolves.toEqual({
      success: false,
      reason: LockboxCodeFailureReason.NOT_FOUND,
    });
    expectKpi(KpiStat.LockboxCodeNotFound);
  });

  it('reports no_assignment_today when the log was not kept up to date', async () => {
    const { service } = makeService({
      workbook: buildLockboxWorkbook({ todayDate: excelDate('2026-10-25') }),
    });

    await expect(service.getLockboxCode(HOTEL_ID, query())).resolves.toEqual({
      success: false,
      reason: LockboxCodeFailureReason.NO_ASSIGNMENT_TODAY,
    });
    expectKpi(KpiStat.LockboxLogNoAssignment);
  });

  it.each([
    ['no hotel configuration', null],
    ['no lockbox_log', { source_of_truth: 'daisy' }],
    [
      'an unknown provider',
      { lockbox_log: { provider: 'onedrive', shared_link: SHARED_LINK } },
    ],
  ])(
    'reports not_configured for %s without looking anything up',
    async (_case, doorLockConfig) => {
      const { service, getSharedLinkFile, getStay } = makeService({
        doorLockConfig: doorLockConfig as DoorLockConfig | null,
      });

      await expect(service.getLockboxCode(HOTEL_ID, query())).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.NOT_CONFIGURED,
      });
      expect(getStay).not.toHaveBeenCalled();
      expect(getSharedLinkFile).not.toHaveBeenCalled();
      expect(logKpi).not.toHaveBeenCalled();
    },
  );

  it('reports log_unavailable when Dropbox fails', async () => {
    const { service } = makeService({
      download: jest
        .fn()
        .mockRejectedValue(
          new DropboxAPIError(
            'Dropbox get_shared_link_file failed (409): shared_link_not_found/..',
            409,
          ),
        ),
    });

    await expect(service.getLockboxCode(HOTEL_ID, query())).resolves.toEqual({
      success: false,
      reason: LockboxCodeFailureReason.LOG_UNAVAILABLE,
    });
    expectKpi(KpiStat.LockboxLogFetchFailed);
  });

  it('reports log_unavailable when the file is not a lockbox log', async () => {
    const { service } = makeService({
      workbook: buildLockboxWorkbook({ omitSheets: ['Today'] }),
    });

    await expect(service.getLockboxCode(HOTEL_ID, query())).resolves.toEqual({
      success: false,
      reason: LockboxCodeFailureReason.LOG_UNAVAILABLE,
    });
    expectKpi(KpiStat.LockboxLogParseFailed);
  });

  it('never logs a guest name or a code', async () => {
    await makeService().service.getLockboxCode(HOTEL_ID, query());
    await makeService().service.getLockboxCode(
      HOTEL_ID,
      query({ roomNumber: '12', customerName: 'Grace Hopper' }),
    );
    await makeService({
      stay: stay({ checkIn: '2026-11-03' }),
    }).service.getLockboxCode(HOTEL_ID, query());
    await makeService({
      stay: stay({ rooms: ['9'] }),
      workbook: buildLockboxWorkbook({
        todayRows: todayRows([
          { lockbox: 3, guestName: 'ADA LOVELACE', code: '*3333' },
        ]),
      }),
      isOnlyArrivalWithGuestName: jest.fn().mockResolvedValue(false),
    }).service.getLockboxCode(HOTEL_ID, query());
    await makeService({
      stay: stay({ balance: 25.5 }),
    }).service.getLockboxCode(HOTEL_ID, query());
    await makeService({
      stay: stay({ balance: null }),
    }).service.getLockboxCode(HOTEL_ID, query());

    expect(loggedText()).not.toMatch(/lovelace|hopper|4821|5555|1212|3333/i);
  });

  describe('without a booking id: by phone', () => {
    const SPARE_KEY = 'spare key is in the office';
    const ADA_BOX = {
      lockbox_number: '4',
      room_number: '8',
      code: '*4821',
      note: SPARE_KEY,
    };

    it("finds tonight's reservation by the caller ID and gives its box, no name needed", async () => {
      const { service, findStaysByPhone, getStay } = makeService();

      await expect(
        service.getLockboxCode(HOTEL_ID, phoneQuery()),
      ).resolves.toEqual({
        success: true,
        lockbox_number: '4',
        code: '*4821',
        note: SPARE_KEY,
        lockboxes: [ADA_BOX],
      });
      expect(findStaysByPhone).toHaveBeenCalledWith(
        HOTEL,
        '15552223333',
        ['2026-10-28'],
        undefined,
      );
      expect(getStay).not.toHaveBeenCalled();
      expectKpis(
        KpiStat.LockboxPhoneLookupCallerIdMatched,
        KpiStat.LockboxCodeResolved,
      );
    });

    it("looks among last night's arrivals too before noon", async () => {
      const { service, findStaysByPhone } = makeService({
        now: pacific('2026-10-29T01:30:00'),
      });

      await expect(
        service.getLockboxCode(HOTEL_ID, phoneQuery()),
      ).resolves.toMatchObject({ success: true, code: '*4821' });
      expect(findStaysByPhone).toHaveBeenCalledWith(
        HOTEL,
        '15552223333',
        ['2026-10-29', '2026-10-28'],
        undefined,
      );
    });

    it('takes a booking_phone that is the caller ID as the caller ID, with no last name', async () => {
      const { service, findStaysByPhone } = makeService();

      await expect(
        service.getLockboxCode(
          HOTEL_ID,
          phoneQuery({ bookingPhone: '+1 (555) 222-3333' }),
        ),
      ).resolves.toMatchObject({ success: true, code: '*4821' });
      expect(findStaysByPhone).toHaveBeenCalledWith(
        HOTEL,
        '15552223333',
        ['2026-10-28'],
        undefined,
      );
      expectKpis(
        KpiStat.LockboxPhoneLookupCallerIdMatched,
        KpiStat.LockboxCodeResolved,
      );
    });

    it.each([['Lovelace'], ['lovelace'], ['Lovelase']])(
      'finds the reservation by the number the caller gives and their last name %j',
      async (lastName) => {
        const { service, findStaysByPhone } = makeService();

        await expect(
          service.getLockboxCode(
            HOTEL_ID,
            phoneQuery({
              callerPhone: '15557778888',
              bookingPhone: '555-222-3333',
              lastName,
            }),
          ),
        ).resolves.toMatchObject({ success: true, code: '*4821' });
        expect(findStaysByPhone).toHaveBeenCalledWith(
          HOTEL,
          '555-222-3333',
          ['2026-10-28'],
          undefined,
        );
        expectKpis(
          KpiStat.LockboxPhoneLookupBookingPhoneMatched,
          KpiStat.LockboxCodeResolved,
        );
      },
    );

    it('asks for the last name with a number that is not the caller ID, before asking the PMS', async () => {
      const { service, findStaysByPhone, getSharedLinkFile } = makeService();

      await expect(
        service.getLockboxCode(
          HOTEL_ID,
          phoneQuery({
            callerPhone: '15557778888',
            bookingPhone: '5552223333',
          }),
        ),
      ).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.LAST_NAME_REQUIRED,
      });
      expect(findStaysByPhone).not.toHaveBeenCalled();
      expect(getSharedLinkFile).not.toHaveBeenCalled();
      expect(logKpi).not.toHaveBeenCalled();
    });

    it('needs the last name too when the session has no caller ID (web chat)', async () => {
      const { service, findStaysByPhone } = makeService();

      await expect(
        service.getLockboxCode(
          HOTEL_ID,
          phoneQuery({ callerPhone: '', bookingPhone: '5552223333' }),
        ),
      ).resolves.toMatchObject({
        reason: LockboxCodeFailureReason.LAST_NAME_REQUIRED,
      });
      expect(findStaysByPhone).not.toHaveBeenCalled();
    });

    it('answers a wrong last name like an unknown number, telling nothing about the booking', async () => {
      const { service, getSharedLinkFile } = makeService({
        phoneStays: [stay({ balance: 25.5, rooms: [] })],
      });

      await expect(
        service.getLockboxCode(
          HOTEL_ID,
          phoneQuery({
            callerPhone: '15557778888',
            bookingPhone: '5552223333',
            lastName: 'Hopper',
          }),
        ),
      ).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.RESERVATION_NOT_FOUND,
      });
      expect(getSharedLinkFile).not.toHaveBeenCalled();
      expectKpis(
        KpiStat.LockboxPhoneLookupNotFound,
        KpiStat.LockboxReservationNotVerified,
      );
    });

    it('reports reservation_not_found when no arrival tonight has the number', async () => {
      const { service, getSharedLinkFile } = makeService({ phoneStays: [] });

      await expect(
        service.getLockboxCode(HOTEL_ID, phoneQuery()),
      ).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.RESERVATION_NOT_FOUND,
      });
      expect(getSharedLinkFile).not.toHaveBeenCalled();
      expectKpis(
        KpiStat.LockboxPhoneLookupNotFound,
        KpiStat.LockboxReservationNotVerified,
      );
    });

    it('looks up nothing usable for a session without a caller ID and no number given', async () => {
      const { service, findStaysByPhone } = makeService({ phoneStays: [] });

      await expect(
        service.getLockboxCode(HOTEL_ID, phoneQuery({ callerPhone: '' })),
      ).resolves.toMatchObject({
        reason: LockboxCodeFailureReason.RESERVATION_NOT_FOUND,
      });
      expect(findStaysByPhone).toHaveBeenCalledWith(
        HOTEL,
        '',
        ['2026-10-28'],
        undefined,
      );
    });

    it('reports reservation_lookup_failed when the PMS lookup fails', async () => {
      const { service, getSharedLinkFile } = makeService({
        findStaysByPhone: jest.fn().mockRejectedValue(new Error('timed out')),
      });

      await expect(
        service.getLockboxCode(HOTEL_ID, phoneQuery()),
      ).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.RESERVATION_LOOKUP_FAILED,
      });
      expect(getSharedLinkFile).not.toHaveBeenCalled();
      expectKpis(KpiStat.LockboxReservationLookupFailed);
    });

    it("reports reservation_lookup_unsupported when the hotel's PMS can't be asked", async () => {
      const { service, findStaysByPhone } = makeService({ supports: false });

      await expect(
        service.getLockboxCode(HOTEL_ID, phoneQuery({ bookingPhone: '555' })),
      ).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.RESERVATION_LOOKUP_UNSUPPORTED,
      });
      expect(findStaysByPhone).not.toHaveBeenCalled();
    });

    describe('a reservation with rooms 12 and 14, and Grace Hopper in room 14', () => {
      const twoRooms = () =>
        stay({
          rooms: ['12', '14'],
          otherGuests: [
            {
              name: 'Grace Hopper',
              lastName: 'Hopper',
              phones: [GRACE_PHONE],
              rooms: ['14'],
            },
          ],
        });
      const twoBoxes = () =>
        buildLockboxWorkbook({
          todayRows: todayRows([
            { lockbox: 4, guestName: 'ADA LOVELACE', room: 12, code: '*1212' },
            { lockbox: 7, guestName: 'GRACE HOPPER', room: 14, code: '*1414' },
          ]),
        });

      it('gives the main guest, found by caller ID, both rooms', async () => {
        const { service } = makeService({
          phoneStays: [twoRooms()],
          workbook: twoBoxes(),
        });

        await expect(
          service.getLockboxCode(HOTEL_ID, phoneQuery()),
        ).resolves.toMatchObject({
          lockboxes: [
            { lockbox_number: '4', room_number: '12', code: '*1212' },
            { lockbox_number: '7', room_number: '14', code: '*1414' },
          ],
        });
      });

      it('gives Grace, found by her own number, only her room', async () => {
        const { service } = makeService({
          phoneStays: [twoRooms()],
          workbook: twoBoxes(),
        });

        await expect(
          service.getLockboxCode(
            HOTEL_ID,
            phoneQuery({ callerPhone: '15554449999' }),
          ),
        ).resolves.toEqual({
          success: true,
          lockbox_number: '7',
          code: '*1414',
          lockboxes: [
            { lockbox_number: '7', room_number: '14', code: '*1414' },
          ],
        });
      });

      it("gives Grace, calling with Ada's number and her own last name, only her room", async () => {
        const { service } = makeService({
          phoneStays: [twoRooms()],
          workbook: twoBoxes(),
        });

        await expect(
          service.getLockboxCode(
            HOTEL_ID,
            phoneQuery({
              callerPhone: '15557778888',
              bookingPhone: '5552223333',
              lastName: 'Hopper',
            }),
          ),
        ).resolves.toMatchObject({
          lockboxes: [
            { lockbox_number: '7', room_number: '14', code: '*1414' },
          ],
        });
      });

      it('answers for the room sent only', async () => {
        const { service } = makeService({
          phoneStays: [twoRooms()],
          workbook: twoBoxes(),
        });

        await expect(
          service.getLockboxCode(HOTEL_ID, phoneQuery({ roomNumber: '14' })),
        ).resolves.toMatchObject({
          lockboxes: [
            { lockbox_number: '7', room_number: '14', code: '*1414' },
          ],
        });
      });
    });

    describe('a caller with several reservations tonight', () => {
      const roomEight = () => stay();
      const roomNine = (overrides: Partial<LockboxStay> = {}) =>
        stay({ reservationId: '7000000000002', rooms: ['9'], ...overrides });
      const boxes = () =>
        buildLockboxWorkbook({
          todayRows: todayRows([
            {
              lockbox: 4,
              guestName: 'ADA LOVELACE',
              room: 8,
              code: '*4821',
              notes: SPARE_KEY,
            },
            { lockbox: 6, guestName: 'ADA LOVELACE', room: 9, code: '*9009' },
          ]),
        });

      it('gets every box across them', async () => {
        const { service } = makeService({
          phoneStays: [roomEight(), roomNine()],
          workbook: boxes(),
        });

        await expect(
          service.getLockboxCode(HOTEL_ID, phoneQuery()),
        ).resolves.toEqual({
          success: true,
          lockbox_number: '4',
          code: '*4821',
          note: SPARE_KEY,
          lockboxes: [
            ADA_BOX,
            { lockbox_number: '6', room_number: '9', code: '*9009' },
          ],
        });
        expectKpis(
          KpiStat.LockboxPhoneLookupCallerIdMatched,
          KpiStat.LockboxCodeResolved,
        );
      });

      it('gets the boxes of those that pass, and none of one that owes a balance', async () => {
        const { service } = makeService({
          phoneStays: [roomEight(), roomNine({ balance: 50 })],
          workbook: boxes(),
        });

        await expect(
          service.getLockboxCode(HOTEL_ID, phoneQuery()),
        ).resolves.toMatchObject({ lockboxes: [ADA_BOX] });
      });

      it('is told the refusal of the one that got furthest when none passes', async () => {
        const { service, getSharedLinkFile } = makeService({
          phoneStays: [stay({ rooms: [] }), roomNine({ balance: 50 })],
          workbook: boxes(),
        });

        await expect(
          service.getLockboxCode(HOTEL_ID, phoneQuery()),
        ).resolves.toEqual({
          success: false,
          reason: LockboxCodeFailureReason.BALANCE_DUE,
        });
        expect(getSharedLinkFile).not.toHaveBeenCalled();
        expectKpis(
          KpiStat.LockboxPhoneLookupCallerIdMatched,
          KpiStat.LockboxReservationBalanceDue,
        );
      });
    });

    it('never logs a phone number, a last name or a code', async () => {
      await makeService().service.getLockboxCode(HOTEL_ID, phoneQuery());
      await makeService().service.getLockboxCode(
        HOTEL_ID,
        phoneQuery({
          callerPhone: '15557778888',
          bookingPhone: '5552223333',
          lastName: 'Lovelace',
        }),
      );
      await makeService().service.getLockboxCode(
        HOTEL_ID,
        phoneQuery({
          callerPhone: '15557778888',
          bookingPhone: '5552223333',
          lastName: 'Hopper',
        }),
      );
      await makeService().service.getLockboxCode(
        HOTEL_ID,
        phoneQuery({ callerPhone: '15557778888', bookingPhone: '5552223333' }),
      );
      await makeService({ phoneStays: [] }).service.getLockboxCode(
        HOTEL_ID,
        phoneQuery(),
      );
      await makeService({
        phoneStays: [stay({ balance: 25.5 })],
      }).service.getLockboxCode(HOTEL_ID, phoneQuery());

      expect(loggedText()).not.toMatch(
        /2223333|7778888|lovelace|hopper|4821|spare key/i,
      );
    });
  });

  describe("the hotel's lockbox_balance_policy", () => {
    const withPolicy = (policy: unknown): DoorLockConfig => ({
      ...LOCKBOX_LOG,
      lockbox_balance_policy: policy as LockboxBalancePolicy,
    });

    it.each([[25.5], [null]])(
      'gives the code under allow_with_note though a balance of %j is owed, with the NOTES',
      async (balance) => {
        const { service } = makeService({
          stay: stay({ balance }),
          doorLockConfig: withPolicy(LockboxBalancePolicy.ALLOW_WITH_NOTE),
        });

        await expect(
          service.getLockboxCode(HOTEL_ID, query()),
        ).resolves.toEqual({
          success: true,
          lockbox_number: '4',
          code: '*4821',
          note: 'spare key is in the office',
          lockboxes: [
            {
              lockbox_number: '4',
              room_number: '8',
              code: '*4821',
              note: 'spare key is in the office',
            },
          ],
        });
        expectKpi(KpiStat.LockboxCodeResolved);
        expect(logger.info).toHaveBeenCalledWith(
          'LockboxCodeService: code given while a balance is owed (lockbox_balance_policy allow_with_note)',
          expect.objectContaining({ hotelId: HOTEL_ID, balance }),
        );
      },
    );

    it('gives the code under allow_with_note to a caller found by phone', async () => {
      const { service } = makeService({
        phoneStays: [stay({ balance: 120 })],
        doorLockConfig: withPolicy(LockboxBalancePolicy.ALLOW_WITH_NOTE),
      });

      await expect(
        service.getLockboxCode(HOTEL_ID, phoneQuery()),
      ).resolves.toMatchObject({
        success: true,
        code: '*4821',
        note: 'spare key is in the office',
      });
    });

    it('still checks the caller under allow_with_note', async () => {
      const { service } = makeService({
        stay: stay({ balance: 25.5 }),
        doorLockConfig: withPolicy(LockboxBalancePolicy.ALLOW_WITH_NOTE),
      });

      await expect(
        service.getLockboxCode(
          HOTEL_ID,
          query({ customerName: 'Grace Hopper' }),
        ),
      ).resolves.toEqual({
        success: false,
        reason: LockboxCodeFailureReason.RESERVATION_MISMATCH,
      });
    });

    it.each([[LockboxBalancePolicy.REFUSE], [null], ['allow'], [true]])(
      'refuses with balance_due under %j',
      async (policy) => {
        const { service } = makeService({
          stay: stay({ balance: 25.5 }),
          doorLockConfig: withPolicy(policy),
        });

        await expect(
          service.getLockboxCode(HOTEL_ID, query()),
        ).resolves.toEqual({
          success: false,
          reason: LockboxCodeFailureReason.BALANCE_DUE,
        });
      },
    );
  });

  it('returns no note for a box whose NOTES is blank', async () => {
    const { service } = makeService({
      stay: stay({ rooms: ['3'], guestName: 'Alan Turing' }),
      workbook: buildLockboxWorkbook({
        todayRows: todayRows([
          { lockbox: 2, guestName: 'ALAN TURING', room: 3, code: '61822' },
          {
            lockbox: 7,
            guestName: 'ALAN TURING',
            room: 3,
            code: '905113',
            notes: 'Balance $40 to be collected at checkout',
          },
        ]),
      }),
    });

    const result = await service.getLockboxCode(
      HOTEL_ID,
      query({ customerName: 'Alan Turing' }),
    );

    expect(result).toEqual({
      success: true,
      lockbox_number: '2',
      code: '61822',
      lockboxes: [
        { lockbox_number: '2', room_number: '3', code: '61822' },
        {
          lockbox_number: '7',
          room_number: '3',
          code: '905113',
          note: 'Balance $40 to be collected at checkout',
        },
      ],
    });
  });
});
