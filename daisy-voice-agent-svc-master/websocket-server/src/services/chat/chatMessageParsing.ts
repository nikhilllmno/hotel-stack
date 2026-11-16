/** Extract guest phone from a transcript or escalation bot message (HTML or plain text). */
export function extractGuestPhoneFromTranscriptText(
  text: string,
): string | null {
  const patterns = [
    /<b>\s*(?:📞\s*)?(?:Guest Phone|Customer Phone)\s*:<\/b>\s*([^\n<]+)/i,
    /(?:📞\s*)?(?:Guest Phone|Customer Phone)\s*:(?:<\/b>)?\s*([^\n<]+)/i,
    /(?:Guest Phone|Customer Phone)\s*:\s*([+\d][\d\s().-]+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const phone = match[1].replace(/<[^>]+>/g, '').trim();
      if (phone) {
        return phone;
      }
    }
  }
  return null;
}

/** Parse `handback:+guest:+assistant` or `resume_ai:+guest:+assistant` callback data. */
export function parseHandbackCallbackData(
  data: string,
): { guestPhone: string; assistantPhone: string } | null {
  const prefixes = ['handback:', 'resume_ai:'];
  const prefix = prefixes.find((p) => data.startsWith(p));
  if (!prefix) {
    return null;
  }
  const rest = data.slice(prefix.length);
  const sep = rest.lastIndexOf(':');
  if (sep <= 0) {
    return null;
  }
  const guestPhone = rest.slice(0, sep).trim();
  const assistantPhone = rest.slice(sep + 1).trim();
  if (!guestPhone || !assistantPhone) {
    return null;
  }
  return { guestPhone, assistantPhone };
}

/** True when the text looks like a Daisy transcript or escalation message. */
export function looksLikeTranscriptText(rawText: string): boolean {
  const text = rawText.replace(/<[^>]+>/g, '');
  return (
    text.includes('Guest Phone:') ||
    text.includes('Customer Phone:') ||
    text.includes('New Conversation Transcript') ||
    text.includes('Response needed (Danny AI paused')
  );
}
