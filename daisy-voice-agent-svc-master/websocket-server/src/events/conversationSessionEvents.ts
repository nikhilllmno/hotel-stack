/**
 * Conversation → session activity (last_messaged_at, unread flags).
 * SessionService subscribes via conversationSessionEventHandlers; avoids ConversationService
 * importing SessionService (circular dependency).
 */

import { EventEmitter } from 'events';
import { ConversationMessageRole } from '../dtos/enum/ConversationMessageRole';
import logger from '../utils/logger';

export interface SessionAfterMessagingPayload {
  sessionId: string;
  messageRole: ConversationMessageRole;
  /** Bulk inserts: true if any message was USER (sets has_unread_messages). Omit for single-message semantics from messageRole. */
  hasUserMessageInBatch?: boolean;
}

class ConversationSessionEventEmitter extends EventEmitter {
  /** Awaits all listeners. Emit after the conversation DB transaction has committed (see ConversationService). */
  async emitSessionAfterMessaging(
    payload: SessionAfterMessagingPayload,
  ): Promise<void> {
    const listeners = this.listeners('session:afterMessaging') as Array<
      (p: SessionAfterMessagingPayload) => void | Promise<void>
    >;
    if (listeners.length === 0) {
      logger.warn(
        'emitSessionAfterMessaging: no listeners (initializeConversationSessionEventHandlers not run?)',
      );
    }
    for (const fn of listeners) {
      await Promise.resolve(fn(payload));
    }
  }

  onSessionAfterMessaging(
    handler: (data: SessionAfterMessagingPayload) => void | Promise<void>,
  ): void {
    this.on('session:afterMessaging', handler);
  }
}

export const conversationSessionEvents = new ConversationSessionEventEmitter();
