/**
 * A Cloudbeds door code is whatever text the hotel or its lock vendor put in
 * the reservation, so it can be a bare PIN ("5732") or carry a label ("The
 * 1850 Hotel Room 202: 5732"). When the text ends in a colon and a 3–10 digit
 * PIN, that PIN is what the guest keys in; otherwise the whole trimmed text is
 * returned as the PIN rather than guessing. `door_code_text` always keeps the
 * full text, because the label (which room, which door) is part of what the
 * guest needs to hear. Returns null for a missing or blank value.
 */
export function parseDoorCodeText(
  value: string | null | undefined,
): { pin: string; door_code_text: string } | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const trailingPin = text.match(/:\s*(\d{3,10})$/);
  return { pin: trailingPin ? trailingPin[1] : text, door_code_text: text };
}
