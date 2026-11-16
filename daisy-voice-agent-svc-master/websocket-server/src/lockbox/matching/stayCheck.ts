import { extractRoomNumber } from '../../cloudbeds/utils/extractRoomNumber';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { LockboxBalancePolicy } from '../../types/hotelConfiguration';
import { LockboxCodeFailureReason, LockboxStay } from '../types';
import {
  isSamePhone,
  isSimilarFullName,
  isSimilarLastName,
} from './callerMatch';
import { isSameGuestName, normalizeRoomNumber } from './lockboxMatch';

export type LockboxRequestField =
  | 'room_number'
  | 'customer_name'
  | 'caller_phone_number'
  | 'last_name';

/** A balance at or below this counts as paid; it only absorbs float noise. */
const BALANCE_TOLERANCE = 0.005;

/**
 * Who the caller is among a stay's guests:
 * - `customerName`: the guest with that name, under the log's own rule
 *   ({@link isSameGuestName}), or as speech-to-text may have heard it
 *   ({@link isSimilarFullName}), so a last name alone never agrees;
 * - `callerPhone`: a guest with the number the caller calls from
 *   ({@link isSamePhone});
 * - `lastName`: a guest with the caller's last name ({@link isSimilarLastName}),
 *   once a phone number the caller gave has found the stay.
 */
export type LockboxCaller =
  | { customerName: string }
  | { callerPhone: string }
  | { lastName: string };

/** The caller, and optionally one of the stay's rooms to answer for. */
export type LockboxStayRequest = LockboxCaller & { roomNumber?: string };

export interface LockboxStayRefusal {
  reason: LockboxCodeFailureReason;
  /** `reservation_mismatch` only: the request fields that disagree with the reservation. */
  mismatched?: LockboxRequestField[];
  /** `balance_due` only: the amount owed, or null when the PMS gave none that can be read. */
  balance?: number | null;
}

export type LockboxStayCheck =
  | { refusal: LockboxStayRefusal }
  /** The stay's rooms whose boxes the caller may have, in the stay's order. */
  | { rooms: string[] };

interface StayGuest {
  name: string;
  lastName: string;
  phones: string[];
}

/**
 * Why a stay can't have a lockbox code, or the rooms whose boxes the caller
 * may have. The stay must be active, check in on one of `assignmentDates`
 * (`lockboxAssignmentDates`) and have a room. The request must then agree
 * with it:
 * - the caller ({@link LockboxCaller}) must be one of its guests. The main
 *   guest may have every room; another guest only the rooms the PMS puts them
 *   in.
 * - `roomNumber`, when sent, must be one of the stay's rooms, read the way
 *   the reservation lookup reads room numbers, and narrows the answer to it.
 *
 * Last, under the hotel's default `balancePolicy` (`refuse`), nothing may be
 * owed on the reservation: the hotel collects a balance before a self
 * check-in. An unreadable balance counts as owed. It comes after the caller
 * check so a caller who isn't on the reservation never learns whether it is
 * paid. `allow_with_note` skips it.
 */
export function checkLockboxStay(
  stay: LockboxStay,
  request: LockboxStayRequest,
  assignmentDates: string[],
  balancePolicy: LockboxBalancePolicy = LockboxBalancePolicy.REFUSE,
): LockboxStayCheck {
  if (stay.status !== ReservationStatus.ACTIVE || stay.checkedOut) {
    return {
      refusal: { reason: LockboxCodeFailureReason.RESERVATION_NOT_ACTIVE },
    };
  }
  if (!assignmentDates.includes(stay.checkIn)) {
    return {
      refusal: { reason: LockboxCodeFailureReason.NOT_ARRIVING_TONIGHT },
    };
  }
  if (stay.rooms.length === 0) {
    return { refusal: { reason: LockboxCodeFailureReason.NO_ROOM_ASSIGNED } };
  }

  const { roomNumber } = request;
  const isCaller = callerMatcher(request);
  const requested = roomNumber
    ? stay.rooms.filter((room) => isSameRoom(room, roomNumber))
    : [];
  const rooms = (requested.length > 0 ? requested : stay.rooms).filter((room) =>
    guestsInRoom(stay, room).some(isCaller),
  );

  const mismatched: LockboxRequestField[] = [];
  if (roomNumber && requested.length === 0) {
    mismatched.push('room_number');
  }
  if (rooms.length === 0) {
    mismatched.push(callerField(request));
  }
  if (mismatched.length > 0) {
    return {
      refusal: {
        reason: LockboxCodeFailureReason.RESERVATION_MISMATCH,
        mismatched,
      },
    };
  }
  if (
    balancePolicy !== LockboxBalancePolicy.ALLOW_WITH_NOTE &&
    owesBalance(stay)
  ) {
    return {
      refusal: {
        reason: LockboxCodeFailureReason.BALANCE_DUE,
        balance: stay.balance,
      },
    };
  }
  return { rooms };
}

/** Whether the PMS says something is still owed, or gave no balance that can be read. */
export function owesBalance(stay: LockboxStay): boolean {
  return stay.balance === null || stay.balance > BALANCE_TOLERANCE;
}

/**
 * Whether the caller is the main guest, or another guest the PMS puts in one
 * of the stay's rooms, whether or not the stay has a room yet.
 */
export function hasCaller(stay: LockboxStay, caller: LockboxCaller): boolean {
  return [mainGuest(stay), ...stay.otherGuests].some(callerMatcher(caller));
}

/**
 * The names a room's boxes may be filed under: the main guest's, and those of
 * the other guests the PMS puts in that room.
 */
export function guestNamesInRoom(stay: LockboxStay, room: string): string[] {
  return guestsInRoom(stay, room).map((guest) => guest.name);
}

export function isSameRoom(room: string, roomNumber: string): boolean {
  const claimed = [roomNumber, extractRoomNumber(roomNumber)]
    .filter((candidate): candidate is string => Boolean(candidate))
    .map(normalizeRoomNumber);
  return claimed.includes(normalizeRoomNumber(room));
}

function mainGuest(stay: LockboxStay): StayGuest {
  return {
    name: stay.guestName,
    lastName: stay.guestLastName,
    phones: stay.guestPhones,
  };
}

function guestsInRoom(stay: LockboxStay, room: string): StayGuest[] {
  return [
    mainGuest(stay),
    ...stay.otherGuests.filter((guest) => guest.rooms.includes(room)),
  ];
}

function callerMatcher(caller: LockboxCaller): (guest: StayGuest) => boolean {
  if ('customerName' in caller) {
    const { customerName } = caller;
    return (guest) =>
      isSameGuestName(customerName, guest.name) ||
      isSimilarFullName(customerName, firstName(guest), guest.lastName);
  }
  if ('callerPhone' in caller) {
    const { callerPhone } = caller;
    return (guest) =>
      guest.phones.some((phone) => isSamePhone(phone, callerPhone));
  }
  const { lastName } = caller;
  return (guest) => isSimilarLastName(lastName, guest.lastName);
}

/** The guest's first name: their full name without the last name, or without its last word. */
function firstName(guest: StayGuest): string {
  const name = guest.name.trim();
  const last = guest.lastName.trim();
  if (last && name.toLowerCase().endsWith(last.toLowerCase())) {
    return name.slice(0, name.length - last.length).trim();
  }
  return name.split(/\s+/).slice(0, -1).join(' ');
}

function callerField(caller: LockboxCaller): LockboxRequestField {
  if ('customerName' in caller) return 'customer_name';
  return 'callerPhone' in caller ? 'caller_phone_number' : 'last_name';
}
