import cloudbedsReservationService, {
  CloudbedsReservationService,
} from '../../cloudbeds/services/reservationService';
import {
  CloudbedsGetReservationGuestEntry,
  CloudbedsGetReservationResponseData,
} from '../../cloudbeds/types';
import { extractRoomNumber } from '../../cloudbeds/utils/extractRoomNumber';
import {
  findMainGuest,
  mapCloudbedsStatus,
} from '../../cloudbeds/utils/mapGetReservationToReservationDTO';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { Hotel } from '../../models/Hotel';
import reservationRepository, {
  ReservationRepository,
} from '../../repositories/ReservationRepository';
import { PmsProvider } from '../../types/enums';
import { isSamePhone, phoneMatchKey } from '../matching/callerMatch';
import { isSameFullName } from '../matching/lockboxMatch';
import { overriddenRoomNumber } from '../matching/roomNumberOverride';
import { LockboxStay } from '../types';

/** The whole phone lookup (tonight's arrivals, then each match read again) must answer within this. */
const PHONE_LOOKUP_TIMEOUT_MS = 8 * 1000;

/**
 * Reads the reservation behind a lockbox request live from the hotel's PMS.
 * Daisy's stored copy is only used to map Daisy's own `BK…` ids to the PMS
 * id: its dates and status aren't synced on every PMS change (Cloudbeds date
 * changes, no-shows and check-outs aren't), and the agent's reservation
 * lookup falls back to it when the PMS fails. Cloudbeds hotels only, so far.
 */
export class LockboxStayService {
  constructor(
    private readonly reservations: Pick<
      ReservationRepository,
      'findReservationWithDetails'
    > = reservationRepository,
    private readonly cloudbeds: Pick<
      CloudbedsReservationService,
      | 'getReservationByIdOrThrow'
      | 'getArrivalsByLastNameOrThrow'
      | 'getArrivalsOrThrow'
    > = cloudbedsReservationService,
  ) {}

  /** Whether this hotel's reservations can be read live by id. */
  supports(hotel: Hotel): boolean {
    return hotel.pms_provider === PmsProvider.CLOUDBEDS;
  }

  /**
   * The stay behind `bookingId`, or null when the hotel's PMS has no such
   * reservation for this property. Throws when the PMS couldn't be asked.
   * `roomNumberOverrides` is the hotel's
   * `door_lock_config.room_number_overrides`.
   */
  async getStay(
    hotel: Hotel,
    bookingId: string,
    roomNumberOverrides?: Record<string, string> | null,
  ): Promise<LockboxStay | null> {
    const reservationId = await this.pmsReservationId(hotel, bookingId);
    if (!reservationId) return null;

    const reservation = await this.cloudbeds.getReservationByIdOrThrow(
      hotel,
      reservationId,
    );
    if (!reservation || !isHotelProperty(reservation, hotel)) return null;
    return lockboxStayFromCloudbeds(reservation, roomNumberOverrides);
  }

  /**
   * The stays checking in on one of `checkInDates` that have a guest, the
   * main guest or any other, whose phone or cell phone is `phone`
   * ({@link isSamePhone}): tonight's arrivals are listed with their guests,
   * and those with the phone whose status can have a code (not cancelled, a
   * no-show, unconfirmed or checked out) are read again one by one, as
   * {@link getStay} reads one, for their dated rooms and balance. A match is
   * kept only while the fresh copy still has the phone. Empty when no stay
   * has it, or `phone` can't identify anyone. Throws when Cloudbeds couldn't
   * be asked, or the lookup as a whole took longer than `timeoutMs`.
   */
  async findStaysByPhone(
    hotel: Hotel,
    phone: string,
    checkInDates: string[],
    roomNumberOverrides?: Record<string, string> | null,
    timeoutMs: number = PHONE_LOOKUP_TIMEOUT_MS,
  ): Promise<LockboxStay[]> {
    const dates = [...checkInDates].sort();
    if (dates.length === 0 || phoneMatchKey(phone) === null) return [];

    const deadline = Date.now() + timeoutMs;
    const arrivals = await this.cloudbeds.getArrivalsOrThrow(
      hotel,
      dates[0],
      dates[dates.length - 1],
      timeoutMs,
    );
    const matches = arrivals.filter(
      (arrival) =>
        isHotelProperty(arrival, hotel) &&
        dates.includes(calendarDate(arrival.startDate)) &&
        canHaveCode(arrival.status) &&
        hasGuestWithPhone(arrival, phone),
    );
    if (matches.length === 0) return [];

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        `findStaysByPhone: timed out after ${timeoutMs}ms listing the arrivals`,
      );
    }
    const reservations = await Promise.all(
      matches.map((match) =>
        this.cloudbeds.getReservationByIdOrThrow(
          hotel,
          String(match.reservationID),
          remainingMs,
        ),
      ),
    );
    return reservations
      .filter(
        (reservation): reservation is CloudbedsGetReservationResponseData =>
          reservation !== null,
      )
      .filter(
        (reservation) =>
          isHotelProperty(reservation, hotel) &&
          hasGuestWithPhone(reservation, phone),
      )
      .map((reservation) =>
        lockboxStayFromCloudbeds(reservation, roomNumberOverrides),
      );
  }

  /**
   * Whether no other reservation checking in on the stay's check-in date has
   * a main guest with exactly the stay's main guest's full name
   * ({@link isSameFullName}). Cancelled reservations don't count. False when
   * the stay has no last name to search by. Throws when the PMS couldn't be
   * asked.
   */
  async isOnlyArrivalWithGuestName(
    hotel: Hotel,
    stay: LockboxStay,
  ): Promise<boolean> {
    if (!stay.guestLastName) return false;
    const arrivals = await this.cloudbeds.getArrivalsByLastNameOrThrow(
      hotel,
      stay.guestLastName,
      stay.checkIn,
    );
    return !arrivals.some(
      (arrival) =>
        String(arrival.reservationID) !== stay.reservationId &&
        mapCloudbedsStatus(arrival.status) !== ReservationStatus.CANCELLED &&
        isSameFullName(
          guestFullName(findMainGuest(arrival.guestList)) ||
            (arrival.guestName ?? ''),
          stay.guestName,
        ),
    );
  }

  private async pmsReservationId(
    hotel: Hotel,
    bookingId: string,
  ): Promise<string | null> {
    if (!bookingId.toUpperCase().startsWith('BK')) return bookingId;
    const stored = await this.reservations.findReservationWithDetails(
      bookingId,
      hotel.id,
    );
    return stored?.external_id ?? null;
  }
}

export const lockboxStayService = new LockboxStayService();

export function isHotelProperty(
  reservation: CloudbedsGetReservationResponseData,
  hotel: Hotel,
): boolean {
  return (
    !reservation.propertyID ||
    String(reservation.propertyID) === String(hotel.business_id)
  );
}

export function calendarDate(value: string | undefined): string {
  return /^\d{4}-\d{2}-\d{2}/.exec(value?.trim() ?? '')?.[0] ?? '';
}

/** The stay check's status rule (`checkLockboxStay`): active and not checked out. */
export function canHaveCode(status: string | undefined): boolean {
  return (
    mapCloudbedsStatus(status) === ReservationStatus.ACTIVE &&
    status?.toLowerCase() !== 'checked_out'
  );
}

export function hasGuestWithPhone(
  reservation: CloudbedsGetReservationResponseData,
  phone: string,
): boolean {
  return Object.values(reservation.guestList ?? {}).some((guest) =>
    guestPhones(guest).some((guestPhone) => isSamePhone(guestPhone, phone)),
  );
}

function guestPhones(
  guest: CloudbedsGetReservationGuestEntry | undefined,
): string[] {
  return [guest?.guestPhone, guest?.guestCellPhone]
    .map((phone) => (typeof phone === 'string' ? phone.trim() : ''))
    .filter(Boolean);
}

export function guestFullName(
  guest: CloudbedsGetReservationGuestEntry | undefined,
): string {
  return [guest?.guestFirstName, guest?.guestLastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Cloudbeds' `balance` (what is still owed), typed as a number but read
 * defensively: a numeric string such as `"0.00"` is parsed, and anything
 * else (missing, blank, not a number) is null, which the stay check treats
 * as owed.
 */
function balanceOwed(balance: unknown): number | null {
  if (typeof balance === 'number') {
    return Number.isFinite(balance) ? balance : null;
  }
  if (typeof balance === 'string' && /^-?\d+(\.\d+)?$/.test(balance.trim())) {
    return Number(balance.trim());
  }
  return null;
}

function roomNumbers(
  roomNames: (string | undefined)[],
  overrides: Record<string, string> | null | undefined,
): string[] {
  const rooms = roomNames
    .map(
      (name) =>
        overriddenRoomNumber(name, overrides) ??
        extractRoomNumber(name) ??
        name?.trim(),
    )
    .filter((room): room is string => Boolean(room));
  return [...new Set(rooms)];
}

/**
 * A Cloudbeds reservation (`getReservation`) as the lockbox check reads it,
 * by the reservation lookup's own rules: Daisy's status normalization
 * (`mapCloudbedsStatus`, which reports `checked_out` as ACTIVE), the main
 * guest, and room numbers from `extractRoomNumber`, except for a room the
 * hotel's `roomNumberOverrides` names, which takes the number staff write in
 * the log ({@link overriddenRoomNumber}). Rooms come from the `assigned`
 * list only, leaving out a room the booking only holds from a later date.
 * Other guests keep only the stay's rooms the PMS puts them in. Each guest
 * keeps their last name and phone numbers, which can identify a caller. The
 * balance is the one `getReservation` returns, so no extra call is made.
 */
export function lockboxStayFromCloudbeds(
  reservation: CloudbedsGetReservationResponseData,
  roomNumberOverrides?: Record<string, string> | null,
): LockboxStay {
  const mainGuest = findMainGuest(reservation.guestList);
  const checkIn = calendarDate(reservation.startDate);
  const rooms = roomNumbers(
    (reservation.assigned ?? [])
      .filter(
        (room) => !room.startDate || calendarDate(room.startDate) === checkIn,
      )
      .map((room) => room.roomName),
    roomNumberOverrides,
  );

  return {
    reservationId: String(reservation.reservationID),
    status: mapCloudbedsStatus(reservation.status),
    checkedOut: reservation.status?.toLowerCase() === 'checked_out',
    checkIn,
    rooms,
    guestName: guestFullName(mainGuest),
    guestLastName: mainGuest?.guestLastName?.trim() ?? '',
    guestPhones: guestPhones(mainGuest),
    otherGuests: Object.values(reservation.guestList ?? {})
      .filter((guest) => guest !== mainGuest)
      .map((guest) => ({
        name: guestFullName(guest),
        lastName: guest.guestLastName?.trim() ?? '',
        phones: guestPhones(guest),
        rooms: roomNumbers(
          [guest.roomName, ...(guest.rooms ?? []).map((room) => room.roomName)],
          roomNumberOverrides,
        ).filter((room) => rooms.includes(room)),
      }))
      .filter((guest) => guest.name && guest.rooms.length > 0),
    balance: balanceOwed(reservation.balance),
  };
}
