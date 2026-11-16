import {
  ROOM_NUMBER_OVERRIDE_NAME_MAX,
  ROOM_NUMBER_OVERRIDE_VALUE_MAX,
} from '../../types/hotelConfiguration';

/**
 * The room number a hotel's `door_lock_config.room_number_overrides` gives
 * `roomName`, or null when it gives none. Names match after trimming,
 * ignoring case; the number comes back trimmed.
 *
 * The stored config is read defensively, since it can be written without the
 * API's validator: anything but a plain object counts as no overrides, and a
 * blank number, a name or number longer than the validator allows, or a name
 * listed twice with different numbers, counts as no override for that name.
 * The caller then reads the room number from the name as before, so a bad
 * entry can't point a guest at another room's box.
 */
export function overriddenRoomNumber(
  roomName: string | null | undefined,
  overrides: Record<string, string> | null | undefined,
): string | null {
  const name =
    typeof roomName === 'string' ? roomName.trim().toLowerCase() : '';
  // A matching key normalizes to `name`, so this is the validator's key limit.
  if (!name || name.length > ROOM_NUMBER_OVERRIDE_NAME_MAX) return null;
  if (!overrides || typeof overrides !== 'object') return null;
  if (Array.isArray(overrides)) return null;

  const numbers = new Set(
    Object.entries(overrides)
      .filter(([key]) => key.trim().toLowerCase() === name)
      .map(([, value]) => {
        const roomNumber = typeof value === 'string' ? value.trim() : '';
        return roomNumber.length <= ROOM_NUMBER_OVERRIDE_VALUE_MAX
          ? roomNumber
          : '';
      }),
  );
  if (numbers.size !== 1) return null;
  const [roomNumber] = numbers;
  return roomNumber || null;
}
