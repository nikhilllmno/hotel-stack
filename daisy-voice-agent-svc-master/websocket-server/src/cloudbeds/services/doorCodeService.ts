import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { phoneMatchKey } from '../../lockbox/matching/callerMatch';
import { isSameFullName } from '../../lockbox/matching/lockboxMatch';
import {
  calendarDate,
  canHaveCode,
  guestFullName,
  hasGuestWithPhone,
  isHotelProperty,
} from '../../lockbox/services/lockboxStayService';
import { Hotel } from '../../models/Hotel';
import reservationRepository, {
  ReservationRepository,
} from '../../repositories/ReservationRepository';
import { DoorLockConfig } from '../../types/hotelConfiguration';
import { withTimeoutWithFallback } from '../../utils/async';
import { KpiStat, KpiStatValue, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import { CloudbedsGetReservationResponseData } from '../types';
import { extractRoomNumber } from '../utils/extractRoomNumber';
import { findMainGuest } from '../utils/mapGetReservationToReservationDTO';
import { parseDoorCodeText } from '../utils/parseDoorCodeText';
import cloudbedsReservationService, {
  CloudbedsReservationService,
} from './reservationService';

dayjs.extend(utc);
dayjs.extend(timezone);

const KPI_CONTEXT = 'CloudbedsDoorCodeService.getDoorCodes';

/** The whole request (reservation reads and door code reads) must answer within this. */
const DOOR_CODE_LOOKUP_TIMEOUT_MS = 10 * 1000;

/**
 * Without a booking id, stays that checked in up to this many nights ago are
 * searched. A longer stay is still served by its booking id.
 */
const STAY_LOOKBACK_NIGHTS = 30;

export enum CloudbedsDoorCodeFailureReason {
  /** The session has no phone number the caller holds (not a call or SMS, or a blank number). */
  CALLER_ID_UNAVAILABLE = 'caller_id_unavailable',
  /**
   * With a booking id: Cloudbeds has no such reservation for this property.
   * Without one: no live stay covering today has a guest with the caller ID.
   */
  RESERVATION_NOT_FOUND = 'reservation_not_found',
  /** The booking id's reservation has no guest whose phone or cell phone is the caller ID. */
  CALLER_NOT_ON_RESERVATION = 'caller_not_on_reservation',
  /**
   * Without a booking id: the caller ID is on stays of different guests, as
   * a shared or placeholder number can be, so it identifies no one.
   */
  AMBIGUOUS_CALLER = 'ambiguous_caller',
  /** The reservation is cancelled, a no-show, not confirmed or checked out. */
  RESERVATION_NOT_ACTIVE = 'reservation_not_active',
  /** Today, in the hotel's timezone, is before the check-in date or after the check-out date. */
  NOT_IN_STAY_WINDOW = 'not_in_stay_window',
  /** The stay is verified, but Cloudbeds holds no door code for it. */
  NO_DOOR_CODE = 'no_door_code',
  /** Cloudbeds or Daisy's booking lookup failed or timed out. */
  RESERVATION_LOOKUP_FAILED = 'reservation_lookup_failed',
}

/** One verified stay's code. Never a guest's name or phone. */
export interface CloudbedsDoorCode {
  /** The Cloudbeds reservation id. */
  booking_id: string;
  /** The assigned room(s), as the reservation lookup reports `room_number`; null when none is assigned. */
  room: string | null;
  /** The PIN the guest keys in ({@link parseDoorCodeText}). */
  code: string;
  /** The stored text, which can name the room or door the code is for. */
  door_code_text: string;
  /** YYYY-MM-DD. */
  check_in: string;
  /** YYYY-MM-DD. */
  check_out: string;
}

export type CloudbedsDoorCodeResult =
  | { success: true; door_codes: CloudbedsDoorCode[] }
  | { success: false; reason: CloudbedsDoorCodeFailureReason };

export interface CloudbedsDoorCodeQuery {
  /**
   * The reservation the agent found: the Cloudbeds reservation id, an OTA
   * confirmation number Cloudbeds holds, or Daisy's own `BK…` id. Without
   * it, the caller's stays are found by the caller ID.
   */
  bookingId?: string;
  /**
   * The session's caller number: a call's caller ID or an SMS sender. ''
   * when the session has no phone number the caller holds.
   */
  callerPhone: string;
}

type Outcome =
  | { doorCodes: CloudbedsDoorCode[]; reservationIds: string[] }
  | { reason: CloudbedsDoorCodeFailureReason; reservationIds: string[] };

/** Ids, counts and reasons only, never a guest name, phone number or code. */
type LogContext = Record<string, unknown>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Door codes for Cloudbeds hotels whose codes live in Cloudbeds
 * (`door_lock_config.source_of_truth = daisy`), read live from Cloudbeds and
 * given only to a caller verified on the stay:
 * - the caller ID must be a guest's phone or cell phone on the reservation
 *   (any guest, compared as the lockbox compares numbers);
 * - the reservation must be confirmed or checked in;
 * - today, in the hotel's timezone, must fall from its check-in date to its
 *   check-out date, both included.
 *
 * With a booking id, that one reservation is checked. Without one, the live
 * stays covering today with a guest whose phone is the caller ID are found,
 * and each gets its code, as long as they are all the same main guest's.
 *
 * Everything the agent can act on is a 200 result (`success: false` with a
 * reason). Any Cloudbeds failure or timeout refuses. Logs carry ids, counts
 * and reasons only.
 */
export class CloudbedsDoorCodeService {
  constructor(
    private readonly reservations: Pick<
      ReservationRepository,
      'findReservationWithDetails'
    > = reservationRepository,
    private readonly cloudbeds: Pick<
      CloudbedsReservationService,
      'getReservationByIdOrThrow' | 'getStaysOnDateOrThrow' | 'resolveDoorCode'
    > = cloudbedsReservationService,
    private readonly now: () => Date = () => new Date(),
    private readonly timeoutMs: number = DOOR_CODE_LOOKUP_TIMEOUT_MS,
  ) {}

  async getDoorCodes(
    hotel: Hotel,
    doorLockConfig: DoorLockConfig,
    query: CloudbedsDoorCodeQuery,
  ): Promise<CloudbedsDoorCodeResult> {
    const context: LogContext =
      query.bookingId !== undefined
        ? {
            hotelId: hotel.id,
            lookup: 'booking_id',
            bookingId: query.bookingId,
          }
        : { hotelId: hotel.id, lookup: 'caller_id' };

    if (phoneMatchKey(query.callerPhone) === null) {
      return this.refuse(hotel, context, {
        reason: CloudbedsDoorCodeFailureReason.CALLER_ID_UNAVAILABLE,
        reservationIds: [],
      });
    }

    const today = dayjs(this.now()).tz(hotel.timezone).format('YYYY-MM-DD');
    let outcome: Outcome | null;
    try {
      outcome = await withTimeoutWithFallback<Outcome | null>(
        () =>
          this.lookUp(
            hotel,
            query.callerPhone,
            query.bookingId,
            today,
            doorLockConfig.door_lock_custom_field,
          ),
        this.timeoutMs,
        null,
      );
    } catch (error) {
      logger.error(
        'CloudbedsDoorCodeService: could not read the reservation from Cloudbeds',
        { ...context, error: errorMessage(error) },
      );
      return this.lookupFailed(hotel);
    }
    if (!outcome) {
      logger.error('CloudbedsDoorCodeService: the door code lookup timed out', {
        ...context,
        timeoutMs: this.timeoutMs,
      });
      return this.lookupFailed(hotel);
    }

    if ('reason' in outcome) return this.refuse(hotel, context, outcome);

    logger.info('CloudbedsDoorCodeService: door code resolved', {
      ...context,
      reservationIds: outcome.reservationIds,
      codeCount: outcome.doorCodes.length,
    });
    this.emitKpi(KpiStat.CloudbedsDoorCodeResolved, hotel);
    return { success: true, door_codes: outcome.doorCodes };
  }

  private async lookUp(
    hotel: Hotel,
    callerPhone: string,
    bookingId: string | undefined,
    today: string,
    customFieldShortcode: string | undefined,
  ): Promise<Outcome> {
    const reservations =
      bookingId !== undefined
        ? await this.reservationByBookingId(hotel, bookingId)
        : await this.staysByCallerId(hotel, callerPhone, today);
    const reservationIds = reservations.map((reservation) =>
      String(reservation.reservationID),
    );
    if (reservations.length === 0) {
      return {
        reason: CloudbedsDoorCodeFailureReason.RESERVATION_NOT_FOUND,
        reservationIds,
      };
    }

    const checked = reservations.map((reservation) => ({
      reservation,
      refusal: stayRefusal(reservation, callerPhone, today),
    }));
    const verified = checked
      .filter(({ refusal }) => refusal === null)
      .map(({ reservation }) => reservation);
    if (verified.length === 0) {
      // By caller ID, a stay that changed since it was listed is just not found.
      return {
        reason:
          bookingId !== undefined && checked[0].refusal
            ? checked[0].refusal
            : CloudbedsDoorCodeFailureReason.RESERVATION_NOT_FOUND,
        reservationIds,
      };
    }
    if (bookingId === undefined && !haveOneMainGuest(verified)) {
      return {
        reason: CloudbedsDoorCodeFailureReason.AMBIGUOUS_CALLER,
        reservationIds,
      };
    }

    const doorCodes = (
      await Promise.all(
        verified.map((reservation) =>
          this.doorCode(hotel, reservation, customFieldShortcode),
        ),
      )
    ).filter((doorCode): doorCode is CloudbedsDoorCode => doorCode !== null);
    if (doorCodes.length === 0) {
      return {
        reason: CloudbedsDoorCodeFailureReason.NO_DOOR_CODE,
        reservationIds,
      };
    }
    return { doorCodes, reservationIds };
  }

  /** The reservation behind the booking id, if it is this hotel's. Throws when it couldn't be asked. */
  private async reservationByBookingId(
    hotel: Hotel,
    bookingId: string,
  ): Promise<CloudbedsGetReservationResponseData[]> {
    const reservationId = bookingId.toUpperCase().startsWith('BK')
      ? (
          await this.reservations.findReservationWithDetails(
            bookingId,
            hotel.id,
          )
        )?.external_id
      : bookingId;
    if (!reservationId) return [];

    const reservation = await this.cloudbeds.getReservationByIdOrThrow(
      hotel,
      reservationId,
    );
    return reservation && isHotelProperty(reservation, hotel)
      ? [reservation]
      : [];
  }

  /**
   * The stays covering today with a guest whose phone is the caller ID, each
   * read again by id: list rows have no assigned rooms, and the fresh copy is
   * what gets checked. Throws when Cloudbeds couldn't be asked.
   */
  private async staysByCallerId(
    hotel: Hotel,
    callerPhone: string,
    today: string,
  ): Promise<CloudbedsGetReservationResponseData[]> {
    const checkInFrom = dayjs
      .utc(today)
      .subtract(STAY_LOOKBACK_NIGHTS, 'day')
      .format('YYYY-MM-DD');
    const stays = await this.cloudbeds.getStaysOnDateOrThrow(
      hotel,
      checkInFrom,
      today,
    );
    const matches = stays.filter(
      (stay) =>
        isHotelProperty(stay, hotel) &&
        stayRefusal(stay, callerPhone, today) === null,
    );
    const reservations = await Promise.all(
      matches.map((match) =>
        this.cloudbeds.getReservationByIdOrThrow(
          hotel,
          String(match.reservationID),
        ),
      ),
    );
    return reservations.filter(
      (reservation): reservation is CloudbedsGetReservationResponseData =>
        reservation !== null && isHotelProperty(reservation, hotel),
    );
  }

  /**
   * The stay's code from `resolveDoorCode` (the Door Lock API, then the
   * custom field), or null when it has none. `resolveDoorCode` logs its own
   * failures and answers them as no code.
   */
  private async doorCode(
    hotel: Hotel,
    reservation: CloudbedsGetReservationResponseData,
    customFieldShortcode: string | undefined,
  ): Promise<CloudbedsDoorCode | null> {
    const bookingId = String(reservation.reservationID);
    const doorCode = parseDoorCodeText(
      await this.cloudbeds.resolveDoorCode(
        hotel,
        bookingId,
        customFieldShortcode,
      ),
    );
    if (!doorCode) return null;
    return {
      booking_id: bookingId,
      room: assignedRooms(reservation),
      code: doorCode.pin,
      door_code_text: doorCode.door_code_text,
      check_in: calendarDate(reservation.startDate),
      check_out: calendarDate(reservation.endDate),
    };
  }

  private refuse(
    hotel: Hotel,
    context: LogContext,
    outcome: {
      reason: CloudbedsDoorCodeFailureReason;
      reservationIds: string[];
    },
  ): CloudbedsDoorCodeResult {
    const details = {
      ...context,
      reason: outcome.reason,
      reservationIds: outcome.reservationIds,
    };
    if (outcome.reason === CloudbedsDoorCodeFailureReason.NO_DOOR_CODE) {
      logger.info(
        'CloudbedsDoorCodeService: the stay is verified but Cloudbeds holds no door code for it',
        details,
      );
      this.emitKpi(KpiStat.CloudbedsDoorCodeNotFound, hotel);
    } else if (
      outcome.reason ===
        CloudbedsDoorCodeFailureReason.CALLER_NOT_ON_RESERVATION ||
      outcome.reason === CloudbedsDoorCodeFailureReason.AMBIGUOUS_CALLER
    ) {
      logger.warn(
        'CloudbedsDoorCodeService: the caller ID does not identify one guest on the stay',
        details,
      );
      this.emitKpi(KpiStat.CloudbedsDoorCodeRefused, hotel);
    } else {
      logger.info(
        'CloudbedsDoorCodeService: the request cannot have a door code',
        details,
      );
      this.emitKpi(KpiStat.CloudbedsDoorCodeRefused, hotel);
    }
    return { success: false, reason: outcome.reason };
  }

  private lookupFailed(hotel: Hotel): CloudbedsDoorCodeResult {
    this.emitKpi(KpiStat.CloudbedsDoorCodeLookupFailed, hotel);
    return {
      success: false,
      reason: CloudbedsDoorCodeFailureReason.RESERVATION_LOOKUP_FAILED,
    };
  }

  private emitKpi(stat: KpiStatValue, hotel: Hotel): void {
    logKpi({
      stat,
      value: 1,
      contextName: KPI_CONTEXT,
      clientId: hotel.assistant_phone_number,
    });
  }
}

/**
 * Why the stay can't have its code, or null when it can. The caller check
 * comes first, so a caller who isn't on the reservation learns nothing about
 * its status or dates.
 */
function stayRefusal(
  reservation: CloudbedsGetReservationResponseData,
  callerPhone: string,
  today: string,
): CloudbedsDoorCodeFailureReason | null {
  if (!hasGuestWithPhone(reservation, callerPhone)) {
    return CloudbedsDoorCodeFailureReason.CALLER_NOT_ON_RESERVATION;
  }
  if (!canHaveCode(reservation.status)) {
    return CloudbedsDoorCodeFailureReason.RESERVATION_NOT_ACTIVE;
  }
  const checkIn = calendarDate(reservation.startDate);
  const checkOut = calendarDate(reservation.endDate);
  if (!checkIn || !checkOut || today < checkIn || today > checkOut) {
    return CloudbedsDoorCodeFailureReason.NOT_IN_STAY_WINDOW;
  }
  return null;
}

/** Whether every stay's main guest has the same full name ({@link isSameFullName}). */
function haveOneMainGuest(
  reservations: CloudbedsGetReservationResponseData[],
): boolean {
  const [first, ...others] = reservations.map(
    (reservation) =>
      guestFullName(findMainGuest(reservation.guestList)) ||
      (reservation.guestName ?? ''),
  );
  return others.every((name) => isSameFullName(first, name));
}

function assignedRooms(
  reservation: CloudbedsGetReservationResponseData,
): string | null {
  const rooms = (reservation.assigned ?? [])
    .map((room) => room.roomName?.trim())
    .filter((name): name is string => Boolean(name))
    .map((name) => extractRoomNumber(name) ?? name);
  return rooms.length > 0 ? [...new Set(rooms)].join(', ') : null;
}

export const cloudbedsDoorCodeService = new CloudbedsDoorCodeService();
