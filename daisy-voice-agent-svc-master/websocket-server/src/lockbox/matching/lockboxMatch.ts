import { LockboxCodeMatch, LockboxLogEntry } from '../types';
import { isSimilarFullName } from './callerMatch';

/** What GUEST NAME says until staff type a guest's name over it. */
const OPEN_GUEST_NAME = 'open';

/**
 * Lowercased, trimmed, whitespace collapsed, and "Last, First" turned into
 * "first last". Commas after the first are read as spaces.
 */
export function normalizeGuestName(name: string): string {
  const collapsed = name.trim().replace(/\s+/g, ' ');
  const comma = collapsed.indexOf(',');
  const ordered =
    comma === -1
      ? collapsed
      : `${collapsed.slice(comma + 1)} ${collapsed.slice(0, comma)}`;
  return ordered.replace(/,/g, ' ').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The same guest when the normalized names are equal, or when both have two or
 * more words and agree on the first and the last (a middle name on either
 * side is fine). Nothing looser: a one-word name only matches itself.
 */
export function isSameGuestName(a: string, b: string): boolean {
  const left = normalizeGuestName(a);
  const right = normalizeGuestName(b);
  if (!left || !right) return false;
  if (left === right) return true;

  const leftWords = left.split(' ');
  const rightWords = right.split(' ');
  return (
    leftWords.length >= 2 &&
    rightWords.length >= 2 &&
    leftWords[0] === rightWords[0] &&
    leftWords[leftWords.length - 1] === rightWords[rightWords.length - 1]
  );
}

/**
 * For a box that already lists the guest's room: {@link isSameGuestName}, or
 * the box's name a few typos off the guest's, with the same allowance as a
 * caller's spoken name ({@link isSimilarFullName}: the last name, and the
 * first name or its first word, each a few letters off). Staff type names by
 * hand ("Jaqueline" for Cloudbeds' "Jacqueline", The Marlo, Nov 1), and the
 * room already ties the box to the stay. A box or guest name of one word
 * (including a first name alone, "Alice" for "Alice E") still needs
 * {@link isSameGuestName}. {@link findReservationLockboxes} only uses a typo
 * match when nothing else is in doubt.
 */
export function isSameGuestInRoom(boxName: string, guestName: string): boolean {
  if (isSameGuestName(boxName, guestName)) return true;
  const boxWords = normalizeGuestName(boxName).split(' ');
  const guestWords = normalizeGuestName(guestName).split(' ');
  if (boxWords.length < 2 || guestWords.length < 2) return false;
  return isSimilarFullName(
    boxWords.join(' '),
    guestWords.slice(0, -1).join(' '),
    guestWords[guestWords.length - 1],
  );
}

/**
 * Stricter than {@link isSameGuestName}, for boxes matched without a room:
 * the normalized names must be identical and have at least a first and a last
 * word. A middle name on one side only, or a single word, never matches.
 */
export function isSameFullName(a: string, b: string): boolean {
  const left = normalizeGuestName(a);
  return left.includes(' ') && left === normalizeGuestName(b);
}

/** Digits compare as numbers ("08" is room 8); anything else as case-insensitive text. */
export function normalizeRoomNumber(room: string): string {
  const trimmed = room.trim().toLowerCase();
  return /^\d+$/.test(trimmed) ? String(Number(trimmed)) : trimmed;
}

/** One of a reservation's rooms, with the names its boxes may be filed under. */
export interface ReservationRoom {
  roomNumber: string;
  guestNames: string[];
}

export interface ReservationLockboxes {
  /**
   * `room`: at least one box carries a guest's name and the room.
   * `open_room`: only unnamed OPEN boxes, each the one OPEN box for its room.
   * `name_only`: found by the blank-room fallback, without any room check.
   */
  matchedBy: 'room' | 'open_room' | 'name_only';
  lockboxes: LockboxCodeMatch[];
}

/**
 * A reservation's lockboxes, or null when there are none.
 *
 * 1. Room by room, in the order given, among boxes whose ROOM or ROOM 2 is
 *    the room:
 *    - boxes whose GUEST NAME (or, in the Archive, ORIGINAL NAME TEXT) is one
 *      of the room's names ({@link isSameGuestName});
 *    - only when there are none, a box whose name is a few typos off one of
 *      them ({@link isSameGuestInRoom}), when it is the only such box for the
 *      room and every room it lists is one of the reservation's, so a typo
 *      never hands over another room's key (Nov 1);
 *    - only when there are none, and no other non-OPEN box lists the room
 *      either, the box still marked "OPEN" for it, when it is the only one.
 *      Staff stage a key in an OPEN box under its room for a booking made
 *      after hours, when nobody can add the name (The Marlo, Oct 30). A room
 *      on a named box as well as on an OPEN box is the named box's (an OPEN
 *      row keeping an earlier room read lockbox 9's code to a room-2 guest
 *      whose named box was lockbox 1), and two OPEN boxes for one room are
 *      never guessed between.
 *    Each box is returned once.
 * 2. Only when rule 1 finds nothing for any room, and `blankRoom` is given: a
 *    box with ROOM and ROOM 2 both blank, on an exact full-name match of
 *    `blankRoom.guestName` ({@link isSameFullName}), since staff often leave
 *    the room out on named rows too. Never an OPEN box. Its `room_number` is
 *    `blankRoom.roomNumber`, as the log has none.
 *
 * A box without a code is never returned, and nothing but the lockbox, room,
 * code and NOTES (as `note`, when not blank) leaves this function.
 */
export function findReservationLockboxes(
  entries: LockboxLogEntry[],
  rooms: ReservationRoom[],
  blankRoom?: { guestName: string; roomNumber: string },
): ReservationLockboxes | null {
  const byRoom = new Map<string, LockboxCodeMatch>();
  const reservationRooms = new Set(
    rooms.map(({ roomNumber }) => normalizeRoomNumber(roomNumber)),
  );
  let named = false;
  for (const { roomNumber, guestNames } of rooms) {
    const room = normalizeRoomNumber(roomNumber);
    if (!room) continue;
    const forRoom = entries.flatMap((entry) => {
      const matchedRoom = entry.rooms.find(
        (candidate) => normalizeRoomNumber(candidate) === room,
      );
      return matchedRoom ? [{ entry, matchedRoom }] : [];
    });
    const namedBoxes = (sameName: (a: string, b: string) => boolean) =>
      forRoom.filter(
        ({ entry }) =>
          !isOpen(entry) &&
          guestNames.some((name) => isNamed(entry, name, sameName)),
      );
    const exact = namedBoxes(isSameGuestName);
    const typos =
      exact.length > 0
        ? []
        : namedBoxes(isSameGuestInRoom).filter(({ entry }) =>
            entry.rooms.every((listed) =>
              reservationRooms.has(normalizeRoomNumber(listed)),
            ),
          );
    const guests = exact.length > 0 ? exact : typos.length === 1 ? typos : [];
    const open = forRoom.filter(({ entry }) => isOpen(entry));
    const picked =
      guests.length > 0
        ? guests
        : forRoom.length === open.length && open.length === 1
          ? open
          : [];
    named ||= guests.length > 0;
    for (const { entry, matchedRoom } of picked) {
      if (entry.code && !byRoom.has(entry.lockboxNumber)) {
        byRoom.set(entry.lockboxNumber, toMatch(entry, matchedRoom));
      }
    }
  }
  if (byRoom.size > 0) {
    return {
      matchedBy: named ? 'room' : 'open_room',
      lockboxes: [...byRoom.values()],
    };
  }
  if (!blankRoom) return null;

  const byNameOnly = entries
    .filter(
      (entry) =>
        entry.code &&
        entry.rooms.length === 0 &&
        !isOpen(entry) &&
        isNamed(entry, blankRoom.guestName, isSameFullName),
    )
    .map((entry) => toMatch(entry, blankRoom.roomNumber.trim()));
  return byNameOnly.length > 0
    ? { matchedBy: 'name_only', lockboxes: byNameOnly }
    : null;
}

function isOpen(entry: LockboxLogEntry): boolean {
  return normalizeGuestName(entry.guestName) === OPEN_GUEST_NAME;
}

function isNamed(
  entry: LockboxLogEntry,
  name: string,
  sameName: (a: string, b: string) => boolean,
): boolean {
  return (
    sameName(entry.guestName, name) || sameName(entry.originalNameText, name)
  );
}

function toMatch(entry: LockboxLogEntry, roomNumber: string): LockboxCodeMatch {
  return {
    lockbox_number: entry.lockboxNumber,
    room_number: roomNumber,
    code: entry.code,
    ...(entry.notes ? { note: entry.notes } : {}),
  };
}
