import axios from 'axios';
import { randomUUID as uuidv4 } from 'node:crypto';
import config from '../../config';
import { ChatRoutingMode } from '../../dtos/enum/ChatRoutingMode';
import { ConversationMessageRole } from '../../dtos/enum/ConversationMessageRole';
import { EscalationStatus } from '../../dtos/enum/EscalationStatus';
import { SessionType } from '../../dtos/enum/SessionType';
import { AWSError } from '../../errors/AWSError';
import { BadRequestError } from '../../errors/BadRequestError';
import { TokenError } from '../../errors/TokenError';
import { Hotel } from '../../models/Hotel';
import { Session } from '../../models/Session';
import { HotelRepository } from '../../repositories/HotelRepository';
import { uploadToS3 } from '../../utils/aws';
import { validatePhoneWithTwilio } from '../../utils/helper';
import { createHttpClient } from '../../utils/httpClient';
import { KpiStat, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import { triggerHandbackWorkflow } from '../../utils/smsAgentUtils';
import ConversationService from '../conversation/ConversationService';
import { EscalationService } from '../escalation/escalationService';
import { HotelConfigurationService } from '../hotelConfiguration/hotelConfigurationService';
import { ChatAction } from '../notification/types';
import sessionService from '../session/SessionService';
import {
  formatManagerReplyConfirmation,
  ManagerReplyConfirmAction,
  managerReplyKeyboardAiMode,
  managerReplyKeyboardDirectMode,
  MGR_CALLBACK,
} from '../telegram/managerReplyConfirmationFormat';

const escalationResponseHttpClient = createHttpClient('escalation-response', {
  timeout: 10000,
});

export interface ManagerReplyConfirmation {
  message: string;
  actions: ChatAction[][];
}

export interface ChatUiUpdate {
  text: string;
  actions?: ChatAction[][];
}

/**
 * Provider-neutral handling of what hotel managers do in their chat app
 * (reply to an escalation, react to it, answer a transcript, click a button).
 * Telegram and Teams webhook services parse their own payloads, resolve the
 * hotel, and call into this service.
 */
export class ChatInteractionService {
  constructor(
    private hotelRepository: HotelRepository,
    private hotelConfigurationService: HotelConfigurationService,
    private escalationService: EscalationService,
  ) {}

  /**
   * Forward a manager's reply to the escalation agent so the guest receives it.
   * `resolveMediaUrl` runs after the phone and agent URL checks so providers
   * only download an attachment when the reply will actually be sent.
   */
  public async handleEscalationReply(params: {
    hotel: Hotel;
    extractedPhone: string;
    managerResponse: string;
    resolveMediaUrl?: () => Promise<string | undefined>;
  }): Promise<void> {
    const { hotel, extractedPhone, managerResponse } = params;

    const hotelConfig =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        hotel.id,
      );

    await validatePhoneWithTwilio(
      extractedPhone,
      hotelConfig?.twilio_configuration,
      hotel.country,
    );

    logger.info(
      `handleEscalationReply: Phone number validated: ${extractedPhone}`,
    );

    const escalationAgentUrl = hotelConfig?.escalation_agent_url ?? undefined;

    if (!escalationAgentUrl) {
      logger.error(
        `handleEscalationReply: No escalation agent URL configured for hotel_id ${hotel.id}`,
      );
      throw new BadRequestError(
        `No escalation agent URL configured for hotel ${hotel.name}`,
      );
    }

    const mediaUrl = (await params.resolveMediaUrl?.()) ?? '';

    const payload = {
      customer_phone_number: extractedPhone.startsWith('+')
        ? extractedPhone
        : `+${extractedPhone}`, // n8n agent is built such that it needs the + symbol to accurately store the conversation in the memory
      assistant_phone_number: `+${hotel.assistant_phone_number}`,
      assistant_sms_number: `+${hotel.sms_number}`,
      manager_response: managerResponse,
      hotel_name: hotel.name,
      ...(mediaUrl && { mediaUrl }),
    };

    logger.info(
      `handleEscalationReply: Sending escalation response to ${escalationAgentUrl}`,
    );

    await this.sendEscalationResponse(
      escalationAgentUrl,
      payload,
      hotel.assistant_phone_number,
    );

    logger.info(
      `handleEscalationReply: Successfully sent escalation response for phone ${extractedPhone}`,
    );
  }

  /**
   * Upload an attachment from a manager's reply to S3.
   * @returns pre-signed URL valid for 7 days
   */
  public async uploadEscalationImage(
    imageBuffer: Buffer,
    extension: string,
    contentType: string,
    hotelId: string,
  ): Promise<string> {
    try {
      const s3Key = `escalation-responses/${hotelId}_${uuidv4()}.${extension}`;
      const sevenDaysInSeconds = 7 * 24 * 60 * 60;
      const presignedUrl = await uploadToS3(
        imageBuffer,
        s3Key,
        contentType,
        config.S3_BUCKET,
        sevenDaysInSeconds,
      );

      if (!presignedUrl) {
        throw new AWSError('Failed to upload image to S3');
      }

      logger.info(
        `uploadEscalationImage: Successfully uploaded to S3: ${presignedUrl}`,
      );
      return presignedUrl;
    } catch (error) {
      const err = error as Error;
      logger.error(
        `uploadEscalationImage: Error uploading to S3: ${err.message}`,
      );
      throw error;
    }
  }

  /**
   * Mark an escalation DONE when a manager reacts to its notification with one
   * of the hotel's allowed emojis.
   */
  public async handleEscalationReaction(params: {
    hotel: Hotel;
    externalMessageId: string;
    addedEmojis: Array<string | undefined>;
    user: string;
  }): Promise<void> {
    const { hotel, externalMessageId, addedEmojis, user } = params;

    const hotelConfig =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        hotel.id,
      );
    const allowedEmojis =
      hotelConfig?.escalation_report_configuration?.allowed_emojis;
    if (!allowedEmojis || allowedEmojis.length === 0) {
      logger.info(
        `handleEscalationReaction: No allowed_emojis configured for hotel ${hotel.id}, skipping`,
      );
      return;
    }

    const matchedEmoji = addedEmojis.find(
      (emoji) => emoji && allowedEmojis.includes(emoji),
    );
    if (!matchedEmoji) {
      logger.info(
        `handleEscalationReaction: Reaction [${addedEmojis.join(', ')}] not in allowed_emojis [${allowedEmojis.join(', ')}], ignoring`,
      );
      return;
    }

    const escalation =
      await this.escalationService.findEscalationByExternalMessageId(
        externalMessageId,
        hotel.id,
      );
    if (!escalation) {
      logger.warn(
        `handleEscalationReaction: No escalation found for external_message_id ${externalMessageId} and hotel_id ${hotel.id}`,
      );
      return;
    }

    if (escalation.status === EscalationStatus.DONE) {
      logger.info(
        `handleEscalationReaction: Escalation ${escalation.id} is already DONE, skipping`,
      );
      return;
    }

    await this.escalationService.updateEscalation(escalation.id, {
      status: EscalationStatus.DONE,
    });
    logger.info(
      `handleEscalationReaction: Marked escalation ${escalation.id} as DONE via ${matchedEmoji} reaction from ${user}`,
    );
  }

  /**
   * Manager barge-in must be enabled per hotel before transcript replies are
   * turned into confirmations.
   */
  public async isManagerBargeInEnabled(hotel: Hotel): Promise<boolean> {
    const hotelConfig =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        hotel.id,
      );
    return hotelConfig?.enable_manager_barge_in === true;
  }

  /**
   * Build the "Confirm your message" prompt (text and buttons) for a manager's
   * reply to a transcript. Buttons depend on whether the guest is already in
   * DIRECT mode.
   */
  public async buildManagerReplyConfirmation(params: {
    hotel: Hotel;
    guestPhone: string;
    replyText: string;
  }): Promise<ManagerReplyConfirmation> {
    const { hotel, guestPhone, replyText } = params;
    const hotelConfig =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        hotel.id,
      );

    await validatePhoneWithTwilio(
      guestPhone,
      hotelConfig?.twilio_configuration,
      hotel.country,
    );
    logger.info(
      `buildManagerReplyConfirmation: Phone validated: ${guestPhone}`,
    );

    const activeSession = await sessionService.getInProgressSmsSessionForHotel(
      hotel.id,
      guestPhone,
    );
    const inDirectMode =
      activeSession !== null &&
      sessionService.isSessionInEffectiveDirectMode(activeSession, hotelConfig);

    return {
      message: formatManagerReplyConfirmation(guestPhone, replyText),
      actions: inDirectMode
        ? managerReplyKeyboardDirectMode()
        : managerReplyKeyboardAiMode(),
    };
  }

  /** Send a confirmed manager reply to the guest by SMS. Throws if sending fails. */
  public async sendManagerReply(params: {
    hotel: Hotel;
    guestPhone: string;
    replyText: string;
    action: ManagerReplyConfirmAction;
  }): Promise<void> {
    const { hotel, guestPhone, replyText, action } = params;

    if (action === MGR_CALLBACK.DIRECT_RELEASE) {
      await sessionService.sendManagerReplyAndReleaseToAi(
        hotel,
        guestPhone,
        replyText,
      );
      logger.info(
        `sendManagerReply: Sent and released to AI for ${guestPhone}`,
      );
      return;
    }

    const setDirect = action === MGR_CALLBACK.TAKE_CONTROL;
    await sessionService.sendManagerReplySmsForPhone(
      hotel,
      guestPhone,
      replyText,
      { setDirect },
    );
    if (action === MGR_CALLBACK.DIRECT_SEND) {
      const session = await sessionService.getInProgressSmsSessionForHotel(
        hotel.id,
        guestPhone,
      );
      if (session) {
        await sessionService.setChatRoutingMode(
          session.id,
          ChatRoutingMode.DIRECT,
        );
      }
    }
    logger.info(`sendManagerReply: Sent to ${guestPhone} (action=${action})`);
  }

  /** What the confirmation message should show after the reply was sent. */
  public async buildManagerReplySentUi(params: {
    hotel: Hotel;
    guestPhone: string;
    action: ManagerReplyConfirmAction;
  }): Promise<ChatUiUpdate> {
    const { hotel, guestPhone, action } = params;
    const session = await sessionService.getInProgressSmsSessionForHotel(
      hotel.id,
      guestPhone,
    );

    if (action === MGR_CALLBACK.TAKE_CONTROL) {
      const text =
        '✅ Message sent and you have taken control.\n\n' +
        'Danny AI is paused for this guest until you switch back.';
      if (session) {
        return {
          text,
          actions: [
            [
              {
                text: '🔄 Switch back to Danny',
                data: `resume_ai:${session.caller_phone_number}:${session.assistant_phone_number}`,
              },
            ],
          ],
        };
      }
      return { text };
    }
    if (action === MGR_CALLBACK.DIRECT_SEND) {
      return {
        text: '✅ Message sent.\n\nYou remain in control of this guest.',
      };
    }
    if (action === MGR_CALLBACK.DIRECT_RELEASE) {
      return {
        text:
          '✅ Message sent and switched back to Danny AI.\n\n' +
          'Danny AI will handle future messages from this guest.',
      };
    }
    return {
      text: '✅ Message sent.\n\nDanny AI will continue handling future replies.',
    };
  }

  /**
   * Find the hotel and active SMS session for handback / resume buttons.
   * `hotelFromChat` is the hotel the provider resolved from the chat the click
   * came from (most reliable); otherwise fall back to the assistant phone in the button data.
   */
  private async resolveHandbackHotelAndSession(
    hotelFromChat: Hotel | null,
    guestPhone: string,
    assistantPhoneHint: string,
  ): Promise<{ hotel: Hotel; session: Session } | null> {
    const hotel =
      hotelFromChat ??
      (await this.findHotelByAssistantPhoneFromCallback(assistantPhoneHint));
    if (!hotel) {
      logger.error(
        `resolveHandbackHotelAndSession: No hotel (assistant=${assistantPhoneHint})`,
      );
      return null;
    }

    let session = null;
    try {
      session = await sessionService.getLatestActiveSession(
        hotel.assistant_phone_number,
        guestPhone,
        SessionType.SMS,
      );
    } catch (error) {
      logger.error(
        `resolveHandbackHotelAndSession: Session lookup failed: ${(error as Error).message}`,
      );
    }
    if (!session) {
      logger.error(
        `resolveHandbackHotelAndSession: No active SMS session for guest ${guestPhone} at hotel ${hotel.id}`,
      );
      return null;
    }
    return { hotel, session };
  }

  /**
   * Handback buttons embed assistant phone from the session; try common E.164 variants
   * only when the chat lookup is unavailable.
   */
  private async findHotelByAssistantPhoneFromCallback(
    assistantPhoneHint: string,
  ): Promise<Hotel | null> {
    const digits = assistantPhoneHint.replace(/\D/g, '');
    const candidates = [
      assistantPhoneHint,
      ...(digits ? [`+${digits}`, digits] : []),
    ];
    for (const candidate of [...new Set(candidates)]) {
      const hotel =
        await this.hotelRepository.findByAssistantPhoneNumber(candidate);
      if (hotel) {
        return hotel;
      }
    }
    return null;
  }

  /** "Switch to Danny AI" — set AI routing and re-trigger the n8n handback workflow. */
  public async handleHandback(params: {
    hotelFromChat: Hotel | null;
    guestPhone: string;
    assistantPhone: string;
  }): Promise<void> {
    const { hotelFromChat, guestPhone, assistantPhone } = params;
    try {
      const ctx = await this.resolveHandbackHotelAndSession(
        hotelFromChat,
        guestPhone,
        assistantPhone,
      );
      if (!ctx) {
        return;
      }
      const { hotel, session } = ctx;

      try {
        await sessionService.sendManagerHandbackNotificationToGuest(
          session,
          hotel,
        );
        logger.info(
          `handleHandback: Stepping-out SMS sent for session ${session.id}`,
        );
      } catch (smsError) {
        logger.error(
          `handleHandback: Failed to send guest handback SMS for session ${session.id}: ${(smsError as Error).message}`,
        );
      }

      // Find the last USER message to re-trigger the n8n AI agent
      const conversation =
        await ConversationService.findConversationRowBySessionId(session.id);
      if (!conversation) {
        logger.error(
          `handleHandback: No conversation found for session ${session.id}`,
        );
        return;
      }

      const lastMessages =
        await ConversationService.findMessagesPaginatedUserAndAi(
          conversation.id,
          0,
          10,
        );
      // Messages are returned newest-first; first USER is the latest guest message.
      const lastUserMessage = lastMessages.find(
        (m) => m.role === ConversationMessageRole.USER,
      );

      if (!lastUserMessage?.message) {
        logger.warn(
          `handleHandback: No last USER message found for session ${session.id}`,
        );
        return;
      }

      // Re-trigger the AI agent with the last guest message via the dedicated
      // handback webhook (JSON, no Twilio signature needed).
      await triggerHandbackWorkflow(hotel.id, {
        customer_phone_number: guestPhone,
        assistant_sms_number: hotel.sms_number,
        sms_body: lastUserMessage.message,
      });
      logger.info(
        `handleHandback: Re-triggered n8n main workflow for session ${session.id}`,
      );
    } catch (error) {
      logger.error(`handleHandback: Error: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Switch routing back to AI only — does not re-trigger the n8n handback workflow.
   * @returns true when a session was found and the guest was told Danny is back
   */
  public async handleResumeAi(params: {
    hotelFromChat: Hotel | null;
    guestPhone: string;
    assistantPhone: string;
  }): Promise<boolean> {
    const { hotelFromChat, guestPhone, assistantPhone } = params;
    try {
      const ctx = await this.resolveHandbackHotelAndSession(
        hotelFromChat,
        guestPhone,
        assistantPhone,
      );
      if (!ctx) {
        return false;
      }
      const { hotel, session } = ctx;

      try {
        await sessionService.sendManagerHandbackNotificationToGuest(
          session,
          hotel,
        );
        logger.info(
          `handleResumeAi: Stepping-out SMS sent for session ${session.id}`,
        );
      } catch (smsError) {
        logger.error(
          `handleResumeAi: Failed to send guest handback SMS: ${(smsError as Error).message}`,
        );
      }
      return true;
    } catch (error) {
      logger.error(`handleResumeAi: Error: ${(error as Error).message}`);
      throw error;
    }
  }

  /** Text shown on the confirmation message after "Switch back to Danny". */
  public resumeAiUi(): ChatUiUpdate {
    return {
      text:
        '✅ Switched to Danny AI mode.\n\n' +
        'Danny AI will handle future messages from this guest.',
    };
  }

  /** Send escalation response to the agent URL */
  private async sendEscalationResponse(
    url: string,
    payload: {
      customer_phone_number: string;
      assistant_phone_number: string;
      manager_response: string;
      hotel_name: string;
      media_urls?: string[];
    },
    clientId: string,
  ): Promise<void> {
    const contextName = 'ChatInteractionService.sendEscalationResponse';
    try {
      const token = config.SUPPORT_OPS_API_KEY;
      if (!token) {
        throw new TokenError('SUPPORT_OPS_API_KEY not found');
      }
      const response = await escalationResponseHttpClient.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          token: token,
        },
      });

      logger.info(
        `sendEscalationResponse: Successfully sent to ${url}, status: ${response.status}`,
      );
      logKpi({
        stat: KpiStat.EscalationResponseSent,
        value: 1,
        contextName,
        clientId,
      });
    } catch (error) {
      logKpi({
        stat: KpiStat.EscalationResponseFailed,
        value: 1,
        contextName,
        clientId,
      });
      if (axios.isAxiosError(error)) {
        const status = error.response?.status || 'unknown';
        const data = error.response?.data || error.message;
        logger.error(
          `sendEscalationResponse: Failed to send to ${url}, status: ${status}, response: ${JSON.stringify(data)}`,
        );
        throw new Error(`HTTP ${status}: ${JSON.stringify(data)}`);
      }
      logger.error(
        `sendEscalationResponse: Request error: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
