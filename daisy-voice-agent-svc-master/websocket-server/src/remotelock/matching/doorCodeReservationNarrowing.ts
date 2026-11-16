import { isSameCalendarDate } from './dateOverlap';

/** The only fields narrowing reads off a reservation row. */
export interface NarrowableReservation {
  id?: string;
  booking_id?: string;
  external_id?: string;
  external_public_id?: string;
  check_out?: string | Date;
}

export type NarrowResult<T> =
  | { status: 'ok'; reservations: T[] }
  | { status: 'ambiguous'; bookingCount: number }
  | { status: 'no_match' };

/**
 * `booking_id` is only populated for reservations Daisy created; a PMS-sourced
 * row carries its confirmation number on `external_id`/`external_public_id`
 * instead. Any of them identifies one booking, so fall through in that order.
 */
function bookingKey(reservation: NarrowableReservation): string {
  return String(
    reservation.booking_id ??
      reservation.external_id ??
      reservation.external_public_id ??
      reservation.id,
  );
}

/**
 * Narrows a guest-name lookup down to a single booking using the check-out date
 * the guest supplied.
 *
 * A booking covering several rooms yields one reservation row per room; those
 * are one guest, not an ambiguity, and must stay batched so `resolveDoorCodes`
 * can return a PIN per room. Only rows belonging to *different* bookings make
 * the lookup ambiguous, and then no PIN is released — a PIN opens a physical
 * door, so a best guess is worse than asking for the booking ID.
 */
export function narrowReservationsForDoorCode<T extends NarrowableReservation>(
  reservations: T[],
  checkOutDate: string,
): NarrowResult<T> {
  const onDate = reservations.filter(
    (reservation) =>
      reservation.check_out &&
      isSameCalendarDate(reservation.check_out, checkOutDate),
  );

  if (onDate.length === 0) {
    return { status: 'no_match' };
  }

  const bookingCount = new Set(onDate.map(bookingKey)).size;
  if (bookingCount > 1) {
    return { status: 'ambiguous', bookingCount };
  }

  return { status: 'ok', reservations: onDate };
}
