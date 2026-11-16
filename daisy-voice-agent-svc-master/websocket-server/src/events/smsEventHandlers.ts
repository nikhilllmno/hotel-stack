/**
 * SMS Event Handlers
 *
 * Listens to SMS events and handles conversation tracking.
 * This is completely decoupled from RoomReservationService.
 */

import { ConversationMessageRole } from '../dtos/enum/ConversationMessageRole';
import { SessionType } from '../dtos/enum/SessionType';
import { BadRequestError } from '../errors/BadRequestError';
import { ConversationMessage } from '../models/ConversationMessage';
import { StatusUpdateType } from '../models/request/StatusUpdate';
import conversationService from '../services/conversation/ConversationService';
import sessionService from '../services/session/SessionService';
import logger from '../utils/logger';
import { appendSmsToSmsAgentTranscript } from '../utils/smsAgentUtils';
import { smsEvents, SmsMessageSentEvent } from './smsEvents';

/**
 * Handles SMS sent events by tracking them in conversations
 */
async function handleSmsSent(event: SmsMessageSentEvent): Promise<void> {
  try {
    logger.debug(
      `handleSmsSent: Handling SMS sent event for session ${event.sessionId}`,
    );

    const conversationMessages: Omit<
      ConversationMessage,
      'id' | 'conversation_id' | 'created_at' | 'updated_at'
    >[] = [
      {
        role: ConversationMessageRole.AI,
        message: event.message,
        timestamp: event.timestamp,
      },
    ];

    const session = event.sessionId
      ? await sessionService.getSessionById(event.sessionId)
      : null;

    if (session?.session_type === SessionType.SMS) {
      // Add message to existing conversation
      const sessionHotelId = session.hotel_id;
      if (sessionHotelId !== event.hotelId) {
        throw new BadRequestError(
          `handleSmsSent: Hotel ID mismatch. Event hotel ID ${event.hotelId}, session hotel ID ${sessionHotelId}`,
        );
      }
      await conversationService.createConversationMessages(
        session.id,
        event.callerPhoneNumber,
        conversationMessages,
        event.assistantPhoneNumber,
        SessionType.SMS,
        sessionHotelId,
        !event.skipTelegramNotification,
        session.chat_routing_mode,
      );
      logger.info(
        `handleSmsSent: Added SMS message to existing conversation for session ${event.sessionId}`,
      );
    } else {
      // Create new SMS session
      const sessionResult = await sessionService.createSession({
        caller_phone_number: event.callerPhoneNumber,
        assistant_phone_number: event.assistantPhoneNumber,
        session_type: SessionType.SMS,
        session_status: StatusUpdateType.InProgress,
      });

      const sessionHotelId = sessionResult.session.hotel_id;
      if (sessionHotelId !== event.hotelId) {
        throw new BadRequestError(
          `handleSmsSent: Hotel ID mismatch. Event hotel ID ${event.hotelId}, session hotel ID ${sessionHotelId}`,
        );
      }

      // Create new conversation with the SMS message
      await conversationService.createConversationMessages(
        sessionResult.session.id,
        event.callerPhoneNumber,
        conversationMessages,
        event.assistantPhoneNumber,
        SessionType.SMS,
        sessionHotelId,
        !event.skipTelegramNotification,
      );
      logger.info(
        `handleSmsSent: Created new SMS session and conversation for session ${event.sessionId}`,
      );
    }

    // If the SMS agent exists, append the SMS sent by the voice agent to the transcript of the SMS agent
    if (event.smsAgentEnabled) {
      await appendSmsToSmsAgentTranscript(event.hotelId, {
        customer_phone_number: event.callerPhoneNumber,
        assistant_phone_number: event.assistantPhoneNumber,
        assistant_sms_number: event.hotelSmsNumber,
        sms_body: event.message,
      });
    }
  } catch (error) {
    // Log but don't fail - SMS was already sent successfully
    logger.error(
      `handleSmsSent: Failed to track SMS in conversation for session ${event.sessionId}:`,
      error,
    );
  }
}

/**
 * Initialize all SMS event listeners
 * Call this once during application startup
 */
export function initializeSmsEventHandlers(): void {
  smsEvents.onSmsSent(handleSmsSent);
  logger.info('SMS event handlers initialized');
}
