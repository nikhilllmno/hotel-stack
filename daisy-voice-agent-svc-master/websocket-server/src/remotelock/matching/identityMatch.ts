import { AccessGuest } from '../types';

/**
 * Minimal guest identity as known from the reservation side. Email/phone are
 * optional because RemoteLock guests and reservation customer records
 * frequently lack one or the other.
 */
export interface ReservationIdentity {
  name: string;
  email?: string | null;
  phone?: string | null;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function firstName(name: string): string {
  return normalizeName(name).split(' ')[0] ?? '';
}

// function normalizePhone(phone: string): string {
//   return phone.replace(/\D/g, '');
// }

export interface IdentityMatchOptions {
  /**
   * Set to false for PMSs whose guest email reaches RemoteLock rewritten —
   * Hostaway sub-addresses it (`ann@x.com` -> `ann+12345@x.com`), so the two
   * sides never compare equal even for the same guest.
   */
  compareEmail?: boolean;
}

/**
 * First name is the only thing compared. Email and phone are left commented
 * out rather than deleted: the values RemoteLock holds and the ones the PMS
 * holds disagree often enough in production that the checks rejected valid
 * matches. Date-range overlap is the other half of the gate and lives in the
 * caller.
 */
export function isIdentityMatch(
  guest: AccessGuest,
  reservation: ReservationIdentity,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  { compareEmail = true }: IdentityMatchOptions = {},
): boolean {
  const guestName = guest.attributes.name?.trim();
  const reservationName = reservation.name?.trim();
  if (!guestName || !reservationName) return false;
  if (firstName(guestName) !== firstName(reservationName)) {
    return false;
  }

  // const guestEmail = guest.attributes.email?.trim();
  // const reservationEmail = reservation.email?.trim();
  // if (
  //   compareEmail &&
  //   guestEmail &&
  //   reservationEmail &&
  //   guestEmail.toLowerCase() !== reservationEmail.toLowerCase()
  // ) {
  //   return false;
  // }

  // const guestPhone = guest.attributes.phone?.trim();
  // const reservationPhone = reservation.phone?.trim();
  // if (
  //   guestPhone &&
  //   reservationPhone &&
  //   normalizePhone(guestPhone) !== normalizePhone(reservationPhone)
  // ) {
  //   return false;
  // }

  return true;
}
