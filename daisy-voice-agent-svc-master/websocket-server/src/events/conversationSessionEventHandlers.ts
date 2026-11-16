import sessionService from '../services/session/SessionService';
import {
  conversationSessionEvents,
  SessionAfterMessagingPayload,
} from './conversationSessionEvents';

async function handleSessionAfterMessaging(
  payload: SessionAfterMessagingPayload,
): Promise<void> {
  const extras =
    payload.hasUserMessageInBatch !== undefined
      ? { hasUserMessageInBatch: payload.hasUserMessageInBatch }
      : undefined;
  await sessionService.updateSessionAfterMessaging(
    payload.sessionId,
    payload.messageRole,
    extras,
  );
}

let initialized = false;

/** Register once at application startup (see server.ts). */
export function initializeConversationSessionEventHandlers(): void {
  if (initialized) {
    return;
  }
  initialized = true;
  conversationSessionEvents.onSessionAfterMessaging(
    handleSessionAfterMessaging,
  );
}
