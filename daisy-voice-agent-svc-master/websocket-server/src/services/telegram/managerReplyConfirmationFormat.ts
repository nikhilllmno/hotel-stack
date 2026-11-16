import { ChatAction } from '../notification/types';

/** Delimiter lines — reply text lives between these in the confirmation message. */
export const MANAGER_CONFIRM_MSG_DELIM = '────────MESSAGE────────';

/** Inline confirmation callbacks (fixed strings; guest/reply live in message body). */
export const MGR_CALLBACK = {
  AI_SEND: 'mgr_send',
  TAKE_CONTROL: 'mgr_barge',
  DIRECT_SEND: 'mgr_direct_send',
  DIRECT_RELEASE: 'mgr_direct_handback',
} as const;

export type ManagerReplyConfirmAction =
  (typeof MGR_CALLBACK)[keyof typeof MGR_CALLBACK];

/** Guest on AI routing — send via Daisy or take DIRECT control. */
export function managerReplyKeyboardAiMode(): ChatAction[][] {
  return [
    [{ text: '💬 Send via Danny', data: MGR_CALLBACK.AI_SEND }],
    [{ text: '🎛️ Send & Take Control', data: MGR_CALLBACK.TAKE_CONTROL }],
  ];
}

/** Guest already in DIRECT — send only, or send and hand back to Daisy AI. */
export function managerReplyKeyboardDirectMode(): ChatAction[][] {
  return [
    [{ text: '📤 Send', data: MGR_CALLBACK.DIRECT_SEND }],
    [
      {
        text: '💬 Send & switch to Danny',
        data: MGR_CALLBACK.DIRECT_RELEASE,
      },
    ],
  ];
}

export function isManagerReplyConfirmCallback(
  data: string,
): data is ManagerReplyConfirmAction {
  return (
    data === MGR_CALLBACK.AI_SEND ||
    data === MGR_CALLBACK.TAKE_CONTROL ||
    data === MGR_CALLBACK.DIRECT_SEND ||
    data === MGR_CALLBACK.DIRECT_RELEASE
  );
}

export function formatManagerReplyConfirmation(
  guestPhone: string,
  replyText: string,
): string {
  return (
    'Confirm your message:\n\n' +
    `Guest: ${guestPhone}\n` +
    `${MANAGER_CONFIRM_MSG_DELIM}\n` +
    `${replyText}\n` +
    `${MANAGER_CONFIRM_MSG_DELIM}`
  );
}

export function parseManagerReplyConfirmation(
  text: string,
): { guestPhone: string; replyText: string } | null {
  const guestMatch = text.match(/^Guest:\s*(.+)$/m);
  if (!guestMatch) {
    return null;
  }
  const guestPhone = guestMatch[1].trim();

  const first = text.indexOf(MANAGER_CONFIRM_MSG_DELIM);
  const second = text.indexOf(
    MANAGER_CONFIRM_MSG_DELIM,
    first + MANAGER_CONFIRM_MSG_DELIM.length,
  );
  if (first !== -1 && second !== -1) {
    const replyText = text
      .slice(first + MANAGER_CONFIRM_MSG_DELIM.length, second)
      .trim();
    if (replyText) {
      return { guestPhone, replyText };
    }
  }

  // Legacy quoted format (older confirmations)
  const legacyMatch = text.match(
    /Confirm your message:\s*\n\n"([\s\S]*)"\n\nGuest:\s*(.+)/,
  );
  if (legacyMatch) {
    return {
      guestPhone: legacyMatch[2].trim(),
      replyText: legacyMatch[1].trim(),
    };
  }

  return null;
}
