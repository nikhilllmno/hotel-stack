/**
 * SMS Event Emitter
 *
 * Decouples SMS sending from conversation tracking using events.
 * This avoids circular dependencies between services.
 */

import { EventEmitter } from 'events';
import logger from '../utils/logger';

export interface SmsMessageSentEvent {
  sessionId: string | undefined;
  message: string;
  from: string;
  to: string;
  callerPhoneNumber: string;
  assistantPhoneNumber: string;
  timestamp: Date;
  hotelSmsNumber: string;
  smsAgentEnabled: boolean;
  hotelId: string;
  /**
   * When true, the handler will NOT post the message to the Telegram transcript group.
   * Set by manager-reply flows (Telegram group reply, dashboard reply) where the
   * message is already visible in the thread. All other callers leave this unset (false).
   */
  skipTelegramNotification?: boolean;
}

class SmsEventEmitter extends EventEmitter {
  /**
   * Emit an event when an SMS message is sent
   */
  emitSmsSent(data: SmsMessageSentEvent): void {
    logger.debug(`Emitting SMS sent event for session ${data.sessionId}`);
    this.emit('sms:sent', data);
  }

  /**
   * Emit and await all sms:sent listeners (conversation history, n8n sync).
   * Use when the SMS must be recorded before the caller continues (e.g. manager handback).
   */
  async emitSmsSentAndAwait(data: SmsMessageSentEvent): Promise<void> {
    logger.debug(
      `Emitting SMS sent event (await) for session ${data.sessionId}`,
    );
    const listeners = this.listeners('sms:sent') as Array<
      (event: SmsMessageSentEvent) => void | Promise<void>
    >;
    for (const listener of listeners) {
      await listener(data);
    }
  }

  /**
   * Register a handler for SMS sent events
   */
  onSmsSent(
    handler: (data: SmsMessageSentEvent) => void | Promise<void>,
  ): void {
    this.on('sms:sent', handler);
  }
}

// Export singleton instance
export const smsEvents = new SmsEventEmitter();
