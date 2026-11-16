/**
 * Cloudbeds has no dedicated "room number" field — `roomName` is a free-text
 * label hotel staff configure per physical room (e.g. "Solstice King . 025",
 * "King 3", "001", "DK(3)", or purely descriptive names like "Freya
 * Accessible King Retreat" with no number at all). This pulls the trailing
 * digit run as the room number, preserving leading zeros, and returns null
 * rather than guessing when the name doesn't end in a number. Trailing
 * punctuation (e.g. a closing parenthesis in "DK(3)") is stripped first so
 * a number wrapped at the very end of the label is still found.
 */
export function extractRoomNumber(
  roomName: string | null | undefined,
): string | null {
  if (typeof roomName !== 'string') return null;
  const trimmed = roomName.trim().replace(/[^0-9a-zA-Z]+$/, '');
  const match = trimmed.match(/(\d+)$/);
  return match ? match[1] : null;
}
