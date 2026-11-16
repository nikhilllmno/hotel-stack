/* global beforeEach, describe, expect, it, jest */
import { CloudbedsAPIError } from '@/cloudbeds/errors';
import {
  CloudbedsDoorCodeFailureReason,
  CloudbedsDoorCodeService,
} from '@/cloudbeds/services/doorCodeService';
import { CloudbedsReservationService } from '@/cloudbeds/services/reservationService';
import { CloudbedsGetReservationResponseData } from '@/cloudbeds/types';
import { Hotel } from '@/models/Hotel';
import { ReservationRepository } from '@/repositories/ReservationRepository';
import {
  DoorLockConfig,
  DoorLockSourceOfTruth,
} from '@/types/hotelConfiguration';
import { KpiStat, logKpi } from '@/utils/kpiLogger';
import logger from '@/utils/logger';

jest.mock('@/utils/kpiLogger', () => ({
  ...jest.requireActual('@/utils/kpiLogger'),
  logKpi: jest.fn(),
}));

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const PROPERTY_ID = '312345';
const ASSISTANT_PHONE = '15550001111';
const HOTEL = {
  id: 'hotel-1',
  business_id: PROPERTY_ID,
  assistant_phone_number: ASSISTANT_PHONE,
  pms_provider: 'cloudbeds',
  timezone: 'America/Los_Angeles',
} as Hotel;
const DOOR_LOCK_CONFIG: DoorLockConfig = {
  source_of_truth: DoorLockSourceOfTruth.DAISY,
  door_lock_custom_field: 'check_in_code',
};
const RESERVATION_ID = '6098484913491';
/** The session's caller ID: Ada's phone, as the session holds it. */
const CALLER_PHONE = '+15552223333';
const GRACE_PHONE = '555-444-9999';
const CODE_TEXT = 'The 1850 Hotel Room 202: 5732';
/** 9 PM on Oct 30 at a Los Angeles hotel, already Oct 31 in UTC. */
const NOW = new Date('2026-10-30T21:00:00-07:00');
const TODAY = '2026-10-30';

/**
 * Ada Lovelace (the main guest) in Queen 202, Oct 29 to Nov 1, with Grace
 * Hopper as a second guest.
 */
function reservation(
  overrides: Partial<CloudbedsGetReservationResponseData> = {},
): CloudbedsGetReservationResponseData {
  return {
    reservationID: RESERVATION_ID,
    propertyID: PROPERTY_ID,
    status: 'confirmed',
    startDate: '2026-10-29',
    endDate: '2026-11-01',
    guestName: 'Ada Lovelace',
    guestList: {
      '900': {
        guestID: '900',
        guestFirstName: 'Grace',
        guestLastName: 'Hopper',
        guestCellPhone: GRACE_PHONE,
        isMainGuest: false,
      },
      '901': {
        guestID: '901',
        guestFirstName: 'Ada',
        guestLastName: 'Lovelace',
        guestPhone: '+1 (555) 222-3333',
        isMainGuest: true,
      },
    },
    assigned: [{ roomName: 'Queen 202', startDate: '2026-10-29' }],
    balance: 0,
    ...overrides,
  };
}

/** Another guest's stay, with no phone in common with Ada's. */
function otherStay(
  overrides: Partial<CloudbedsGetReservationResponseData> = {},
): CloudbedsGetReservationResponseData {
  return reservation({
    reservationID: '7000000000001',
    guestName: 'Alan Turing',
    guestList: {
      '950': {
        guestID: '950',
        guestFirstName: 'Alan',
        guestLastName: 'Turing',
        guestPhone: '555-777-8888',
        isMainGuest: true,
      },
    },
    assigned: [{ roomName: 'King 301' }],
    ...overrides,
  });
}

describe('CloudbedsDoorCodeService', () => {
  let getReservationByIdOrThrow: jest.Mock;
  let getStaysOnDateOrThrow: jest.Mock;
  let resolveDoorCode: jest.Mock;
  let findReservationWithDetails: jest.Mock;
  let service: CloudbedsDoorCodeService;

  function build(timeoutMs?: number): CloudbedsDoorCodeService {
    return new CloudbedsDoorCodeService(
      {
        findReservationWithDetails,
      } as unknown as Pick<ReservationRepository, 'findReservationWithDetails'>,
      {
        getReservationByIdOrThrow,
        getStaysOnDateOrThrow,
        resolveDoorCode,
      } as unknown as Pick<
        CloudbedsReservationService,
        | 'getReservationByIdOrThrow'
        | 'getStaysOnDateOrThrow'
        | 'resolveDoorCode'
      >,
      () => NOW,
      timeoutMs,
    );
  }

  function byBookingId(bookingId = RESERVATION_ID, callerPhone = CALLER_PHONE) {
    return service.getDoorCodes(HOTEL, DOOR_LOCK_CONFIG, {
      bookingId,
      callerPhone,
    });
  }

  function byCallerId(callerPhone = CALLER_PHONE) {
    return service.getDoorCodes(HOTEL, DOOR_LOCK_CONFIG, { callerPhone });
  }

  function kpiStats(): string[] {
    return (logKpi as jest.Mock).mock.calls.map(([args]) => args.stat);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    getReservationByIdOrThrow = jest.fn().mockResolvedValue(reservation());
    getStaysOnDateOrThrow = jest.fn().mockResolvedValue([]);
    resolveDoorCode = jest.fn().mockResolvedValue(CODE_TEXT);
    findReservationWithDetails = jest.fn().mockResolvedValue(null);
    service = build();
  });

  describe('with a booking id', () => {
    it("gives the code, room and dates when the caller ID is the main guest's phone", async () => {
      await expect(byBookingId()).resolves.toEqual({
        success: true,
        door_codes: [
          {
            booking_id: RESERVATION_ID,
            room: '202',
            code: '5732',
            door_code_text: CODE_TEXT,
            check_in: '2026-10-29',
            check_out: '2026-11-01',
          },
        ],
      });
      expect(getReservationByIdOrThrow).toHaveBeenCalledWith(
        HOTEL,
        RESERVATION_ID,
      );
      expect(resolveDoorCode).toHaveBeenCalledWith(
        HOTEL,
        RESERVATION_ID,
        'check_in_code',
      );
      expect(kpiStats()).toEqual([KpiStat.CloudbedsDoorCodeResolved]);
    });

    it("never returns a guest's name or phone", async () => {
      const result = JSON.stringify(await byBookingId());

      expect(result).not.toMatch(/Ada|Lovelace|Grace|Hopper/);
      expect(result).not.toMatch(/2223333|4449999/);
    });

    it("gives the code when the caller ID is another guest's cell phone", async () => {
      await expect(
        byBookingId(RESERVATION_ID, '15554449999'),
      ).resolves.toMatchObject({ success: true });
    });

    it('refuses a caller ID that is no guest phone on the reservation, without reading the code', async () => {
      await expect(
        byBookingId(RESERVATION_ID, '+15559990000'),
      ).resolves.toEqual({
        success: false,
        reason: CloudbedsDoorCodeFailureReason.CALLER_NOT_ON_RESERVATION,
      });
      expect(resolveDoorCode).not.toHaveBeenCalled();
      expect(kpiStats()).toEqual([KpiStat.CloudbedsDoorCodeRefused]);
    });

    it("tells a caller who isn't on the reservation nothing about its status or dates", async () => {
      getReservationByIdOrThrow.mockResolvedValue(
        reservation({ status: 'canceled', startDate: '2026-12-01' }),
      );

      await expect(
        byBookingId(RESERVATION_ID, '+15559990000'),
      ).resolves.toMatchObject({
        reason: CloudbedsDoorCodeFailureReason.CALLER_NOT_ON_RESERVATION,
      });
    });

    it('refuses before the check-in date', async () => {
      getReservationByIdOrThrow.mockResolvedValue(
        reservation({ startDate: '2026-10-31', endDate: '2026-11-02' }),
      );

      await expect(byBookingId()).resolves.toEqual({
        success: false,
        reason: CloudbedsDoorCodeFailureReason.NOT_IN_STAY_WINDOW,
      });
      expect(resolveDoorCode).not.toHaveBeenCalled();
    });

    it('refuses after the check-out date', async () => {
      getReservationByIdOrThrow.mockResolvedValue(
        reservation({ startDate: '2026-10-27', endDate: '2026-10-29' }),
      );

      await expect(byBookingId()).resolves.toMatchObject({
        reason: CloudbedsDoorCodeFailureReason.NOT_IN_STAY_WINDOW,
      });
    });

    it('refuses a stay with no dates', async () => {
      getReservationByIdOrThrow.mockResolvedValue(
        reservation({ startDate: undefined, endDate: undefined }),
      );

      await expect(byBookingId()).resolves.toMatchObject({
        reason: CloudbedsDoorCodeFailureReason.NOT_IN_STAY_WINDOW,
      });
    });

    it.each([
      ['on its check-in day', '2026-10-30', '2026-11-02'],
      ['on its check-out day', '2026-10-27', '2026-10-30'],
    ])(
      "serves a stay %s, by the hotel's own date",
      async (_case, startDate, endDate) => {
        getReservationByIdOrThrow.mockResolvedValue(
          reservation({ startDate, endDate }),
        );

        await expect(byBookingId()).resolves.toMatchObject({ success: true });
      },
    );

    it.each(['canceled', 'no_show', 'not_confirmed', 'checked_out'])(
      'refuses a %s reservation',
      async (status) => {
        getReservationByIdOrThrow.mockResolvedValue(reservation({ status }));

        await expect(byBookingId()).resolves.toEqual({
          success: false,
          reason: CloudbedsDoorCodeFailureReason.RESERVATION_NOT_ACTIVE,
        });
        expect(resolveDoorCode).not.toHaveBeenCalled();
      },
    );

    it('serves a checked-in reservation', async () => {
      getReservationByIdOrThrow.mockResolvedValue(
        reservation({ status: 'checked_in' }),
      );

      await expect(byBookingId()).resolves.toMatchObject({ success: true });
    });

    it('answers no_door_code when Cloudbeds holds no code for a verified stay', async () => {
      resolveDoorCode.mockResolvedValue(null);

      await expect(byBookingId()).resolves.toEqual({
        success: false,
        reason: CloudbedsDoorCodeFailureReason.NO_DOOR_CODE,
      });
      expect(kpiStats()).toEqual([KpiStat.CloudbedsDoorCodeNotFound]);
    });

    it('answers reservation_not_found when Cloudbeds has no such reservation', async () => {
      getReservationByIdOrThrow.mockResolvedValue(null);

      await expect(byBookingId()).resolves.toEqual({
        success: false,
        reason: CloudbedsDoorCodeFailureReason.RESERVATION_NOT_FOUND,
      });
    });

    it("answers reservation_not_found for another property's reservation", async () => {
      getReservationByIdOrThrow.mockResolvedValue(
        reservation({ propertyID: '999999' }),
      );

      await expect(byBookingId()).resolves.toMatchObject({
        reason: CloudbedsDoorCodeFailureReason.RESERVATION_NOT_FOUND,
      });
      expect(resolveDoorCode).not.toHaveBeenCalled();
    });

    it("reads a Daisy BK id's stay by the Cloudbeds id stored with it", async () => {
      findReservationWithDetails.mockResolvedValue({
        external_id: RESERVATION_ID,
      });

      await expect(byBookingId('BK123')).resolves.toMatchObject({
        success: true,
      });
      expect(findReservationWithDetails).toHaveBeenCalledWith(
        'BK123',
        HOTEL.id,
      );
      expect(getReservationByIdOrThrow).toHaveBeenCalledWith(
        HOTEL,
        RESERVATION_ID,
      );
    });

    it('answers reservation_not_found for a BK id that never reached Cloudbeds, without asking it', async () => {
      findReservationWithDetails.mockResolvedValue({ external_id: null });

      await expect(byBookingId('BK123')).resolves.toMatchObject({
        reason: CloudbedsDoorCodeFailureReason.RESERVATION_NOT_FOUND,
      });
      expect(getReservationByIdOrThrow).not.toHaveBeenCalled();
    });

    it('refuses and logs when Cloudbeds fails', async () => {
      getReservationByIdOrThrow.mockRejectedValue(
        new CloudbedsAPIError('getReservationByIdOrThrow: rate limited', 429),
      );

      await expect(byBookingId()).resolves.toEqual({
        success: false,
        reason: CloudbedsDoorCodeFailureReason.RESERVATION_LOOKUP_FAILED,
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('could not read the reservation'),
        expect.objectContaining({
          hotelId: HOTEL.id,
          bookingId: RESERVATION_ID,
        }),
      );
      expect(resolveDoorCode).not.toHaveBeenCalled();
      expect(kpiStats()).toEqual([KpiStat.CloudbedsDoorCodeLookupFailed]);
    });

    it('refuses when Cloudbeds does not answer in time', async () => {
      service = build(20);
      resolveDoorCode.mockImplementation(() => new Promise(() => {}));

      await expect(byBookingId()).resolves.toEqual({
        success: false,
        reason: CloudbedsDoorCodeFailureReason.RESERVATION_LOOKUP_FAILED,
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('timed out'),
        expect.objectContaining({ timeoutMs: 20 }),
      );
    });
  });

  describe('without a booking id', () => {
    it('lists the stays on today, from 30 nights back, and reads the match again', async () => {
      getStaysOnDateOrThrow.mockResolvedValue([
        reservation({ assigned: undefined }),
      ]);

      await expect(byCallerId()).resolves.toEqual({
        success: true,
        door_codes: [
          {
            booking_id: RESERVATION_ID,
            room: '202',
            code: '5732',
            door_code_text: CODE_TEXT,
            check_in: '2026-10-29',
            check_out: '2026-11-01',
          },
        ],
      });
      expect(getStaysOnDateOrThrow).toHaveBeenCalledWith(
        HOTEL,
        '2026-09-30',
        TODAY,
      );
      expect(getReservationByIdOrThrow).toHaveBeenCalledWith(
        HOTEL,
        RESERVATION_ID,
      );
    });

    it("finds the stay by another guest's phone", async () => {
      getStaysOnDateOrThrow.mockResolvedValue([reservation()]);

      await expect(byCallerId('+1 555 444 9999')).resolves.toMatchObject({
        success: true,
      });
    });

    it('reads again only the live stays covering today that have the caller ID', async () => {
      getStaysOnDateOrThrow.mockResolvedValue([
        otherStay(),
        reservation({ reservationID: 'CB-CANCELLED', status: 'canceled' }),
        reservation({ reservationID: 'CB-CHECKED-OUT', status: 'checked_out' }),
        reservation({ reservationID: 'CB-ENDED', endDate: '2026-10-29' }),
        reservation({ reservationID: 'CB-FUTURE', startDate: '2026-10-31' }),
        reservation({ reservationID: 'CB-OTHER-PROPERTY', propertyID: '1' }),
        reservation(),
      ]);

      await byCallerId();

      expect(getReservationByIdOrThrow).toHaveBeenCalledTimes(1);
      expect(getReservationByIdOrThrow).toHaveBeenCalledWith(
        HOTEL,
        RESERVATION_ID,
      );
    });

    it('answers reservation_not_found when no stay has the caller ID', async () => {
      getStaysOnDateOrThrow.mockResolvedValue([otherStay()]);

      await expect(byCallerId()).resolves.toEqual({
        success: false,
        reason: CloudbedsDoorCodeFailureReason.RESERVATION_NOT_FOUND,
      });
      expect(getReservationByIdOrThrow).not.toHaveBeenCalled();
      expect(resolveDoorCode).not.toHaveBeenCalled();
      expect(kpiStats()).toEqual([KpiStat.CloudbedsDoorCodeRefused]);
    });

    it("returns each room's code when the caller has several stays", async () => {
      const second = reservation({
        reservationID: '6098484913492',
        assigned: [{ roomName: 'Queen 203' }],
      });
      getStaysOnDateOrThrow.mockResolvedValue([reservation(), second]);
      getReservationByIdOrThrow.mockImplementation(
        async (_hotel: Hotel, id: string) =>
          id === RESERVATION_ID ? reservation() : second,
      );
      resolveDoorCode.mockImplementation(async (_hotel: Hotel, id: string) =>
        id === RESERVATION_ID ? CODE_TEXT : 'Room 203: 8841',
      );

      const result = await byCallerId();

      expect(result).toMatchObject({
        success: true,
        door_codes: [
          { booking_id: RESERVATION_ID, room: '202', code: '5732' },
          { booking_id: '6098484913492', room: '203', code: '8841' },
        ],
      });
    });

    it('leaves out a stay that has no code', async () => {
      const second = reservation({ reservationID: '6098484913492' });
      getStaysOnDateOrThrow.mockResolvedValue([reservation(), second]);
      getReservationByIdOrThrow.mockImplementation(
        async (_hotel: Hotel, id: string) =>
          id === RESERVATION_ID ? reservation() : second,
      );
      resolveDoorCode.mockImplementation(async (_hotel: Hotel, id: string) =>
        id === RESERVATION_ID ? CODE_TEXT : null,
      );

      const result = await byCallerId();

      expect(result.success && result.door_codes).toHaveLength(1);
    });

    it('refuses when the caller ID is on stays of different guests', async () => {
      const shared = otherStay({
        guestList: {
          '950': {
            guestFirstName: 'Alan',
            guestLastName: 'Turing',
            guestPhone: CALLER_PHONE,
            isMainGuest: true,
          },
        },
      });
      getStaysOnDateOrThrow.mockResolvedValue([reservation(), shared]);
      getReservationByIdOrThrow.mockImplementation(
        async (_hotel: Hotel, id: string) =>
          id === RESERVATION_ID ? reservation() : shared,
      );

      await expect(byCallerId()).resolves.toEqual({
        success: false,
        reason: CloudbedsDoorCodeFailureReason.AMBIGUOUS_CALLER,
      });
      expect(resolveDoorCode).not.toHaveBeenCalled();
    });

    it('answers reservation_not_found when the fresh copy no longer qualifies', async () => {
      getStaysOnDateOrThrow.mockResolvedValue([reservation()]);
      getReservationByIdOrThrow.mockResolvedValue(
        reservation({ status: 'canceled' }),
      );

      await expect(byCallerId()).resolves.toMatchObject({
        reason: CloudbedsDoorCodeFailureReason.RESERVATION_NOT_FOUND,
      });
      expect(resolveDoorCode).not.toHaveBeenCalled();
    });

    it('refuses and logs when listing the stays fails', async () => {
      getStaysOnDateOrThrow.mockRejectedValue(
        new CloudbedsAPIError(
          'getStaysOnDateOrThrow: timed out after 8000ms',
          504,
        ),
      );

      await expect(byCallerId()).resolves.toEqual({
        success: false,
        reason: CloudbedsDoorCodeFailureReason.RESERVATION_LOOKUP_FAILED,
      });
      expect(logger.error).toHaveBeenCalled();
      expect(kpiStats()).toEqual([KpiStat.CloudbedsDoorCodeLookupFailed]);
    });

    it('refuses when reading a match again fails', async () => {
      getStaysOnDateOrThrow.mockResolvedValue([reservation()]);
      getReservationByIdOrThrow.mockRejectedValue(new Error('socket hang up'));

      await expect(byCallerId()).resolves.toMatchObject({
        reason: CloudbedsDoorCodeFailureReason.RESERVATION_LOOKUP_FAILED,
      });
    });
  });

  it.each([
    ['no caller ID', ''],
    ['a caller number too short to identify anyone', '12345'],
  ])('refuses %s without asking Cloudbeds', async (_case, callerPhone) => {
    await expect(byBookingId(RESERVATION_ID, callerPhone)).resolves.toEqual({
      success: false,
      reason: CloudbedsDoorCodeFailureReason.CALLER_ID_UNAVAILABLE,
    });
    await expect(byCallerId(callerPhone)).resolves.toMatchObject({
      reason: CloudbedsDoorCodeFailureReason.CALLER_ID_UNAVAILABLE,
    });
    expect(getReservationByIdOrThrow).not.toHaveBeenCalled();
    expect(getStaysOnDateOrThrow).not.toHaveBeenCalled();
  });

  it('never logs a phone number, guest name or code', async () => {
    getStaysOnDateOrThrow.mockResolvedValue([reservation()]);
    await byCallerId();
    await byBookingId(RESERVATION_ID, '+15559990000');
    resolveDoorCode.mockResolvedValue(null);
    await byBookingId();

    const logged = JSON.stringify([
      (logger.info as jest.Mock).mock.calls,
      (logger.warn as jest.Mock).mock.calls,
      (logger.error as jest.Mock).mock.calls,
    ]);
    expect(logged).not.toMatch(/2223333|9990000|4449999/);
    expect(logged).not.toMatch(/Ada|Lovelace|Grace|Hopper/);
    expect(logged).not.toMatch(/5732/);
  });
});
