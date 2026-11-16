import config from '../../config';
import { TranscriptQueryMetadata } from '../../dtos/ConversationMessage';
import { ConversationIntentSummary } from '../../dtos/dashboard/conversationIntentSummary';
import { ConversationSummary } from '../../dtos/dashboard/conversationSummary';
import { Transcript } from '../../dtos/dashboard/transcript';
import { ChatRoutingMode } from '../../dtos/enum/ChatRoutingMode';
import { ConversationMessageRole } from '../../dtos/enum/ConversationMessageRole';
import { SessionType } from '../../dtos/enum/SessionType';
import { NoDataError } from '../../errors/NoDataError';
import { conversationSessionEvents } from '../../events/conversationSessionEvents';
import {
  Conversation,
  ConversationWithMessages,
} from '../../models/Conversation';
import { ConversationMessage } from '../../models/ConversationMessage';
import { ConversationMessageRepository } from '../../repositories/ConversationMessageRepository';
import { ConversationRepository } from '../../repositories/ConversationRepository';
import { HotelRepository } from '../../repositories/HotelRepository';
import { SortOrder } from '../../types/enums';
import { getPaginationUrls, GetRequestForPagination } from '../../utils/common';
import logger from '../../utils/logger';
import { hotelConfigurationService } from '../hotelConfiguration/hotelConfigurationService';
import { notificationFactory } from '../notification/notificationFactory';
import { TelegramNotificationService } from '../notification/telegramNotificationService';
import { enrichConversationSummaryWithRecordingPresignedUrl } from '../roomReservation/helper';

export class ConversationService {
  // Time buffer for SMS channel transcript filtering (6 hours in milliseconds)
  private static readonly SMS_LOG_TIME_BUFFER_MS = 6 * 60 * 60 * 1000;

  private conversationRepository: ConversationRepository;
  private conversationMessageRepository: ConversationMessageRepository;
  private telegramService: TelegramNotificationService;
  private hotelRepository: HotelRepository;

  constructor() {
    this.conversationRepository = new ConversationRepository();
    this.conversationMessageRepository = new ConversationMessageRepository();
    this.telegramService = new TelegramNotificationService();
    this.hotelRepository = new HotelRepository();
  }

  /** Most recent by timestamp (single session row update after bulk inserts). */
  private pickLatestMessageByTimestamp(
    messages: ConversationMessage[],
  ): ConversationMessage | undefined {
    if (messages.length === 0) {
      return undefined;
    }
    return messages.reduce((latest, m) =>
      new Date(m.timestamp).getTime() > new Date(latest.timestamp).getTime()
        ? m
        : latest,
    );
  }

  private batchIncludesUserRole(messages: ConversationMessage[]): boolean {
    return messages.some(
      (m) =>
        (m.role as ConversationMessageRole) === ConversationMessageRole.USER,
    );
  }

  private async notifySessionAfterMessage(
    conversationId: string,
    messageRole: ConversationMessageRole,
  ): Promise<void> {
    const conv = await this.conversationRepository.findById(conversationId);
    const sessionId = conv?.conversation_session_id;
    if (!sessionId) {
      return;
    }
    await conversationSessionEvents.emitSessionAfterMessaging({
      sessionId,
      messageRole,
    });
  }

  async createConversationWithMessages(
    conversationData: Omit<
      ConversationWithMessages,
      'id' | 'created_at' | 'updated_at'
    >,
  ): Promise<ConversationWithMessages> {
    const trx = await this.conversationRepository.startTransaction();
    const { messages, ...conversationDataWithoutMessages } = conversationData;
    try {
      const createdConversation = await this.conversationRepository.create(
        {
          ...conversationDataWithoutMessages,
          started_at: new Date(
            conversationDataWithoutMessages.started_at.toISOString(),
          ),
          ended_at: conversationDataWithoutMessages.ended_at
            ? new Date(conversationDataWithoutMessages.ended_at.toISOString())
            : new Date(),
          cost: Number(conversationDataWithoutMessages.cost),
        },
        trx,
      );
      const conversationId = createdConversation.id;

      const messagesToInsert = (conversationData.messages || []).map((msg) => ({
        ...msg,
        timestamp: new Date(msg.timestamp.toISOString()),
        conversation_id: conversationId,
      }));
      const insertedMessages =
        await this.conversationMessageRepository.insertMany(
          messagesToInsert,
          trx,
        );

      const sessionId = createdConversation.conversation_session_id;
      const sessionTouchPayload =
        sessionId && insertedMessages.length > 0
          ? (() => {
              const latest =
                this.pickLatestMessageByTimestamp(insertedMessages);
              if (!latest) return null;
              return {
                sessionId,
                messageRole: latest.role as ConversationMessageRole,
                hasUserMessageInBatch:
                  this.batchIncludesUserRole(insertedMessages),
              };
            })()
          : null;

      await trx.commit();

      if (sessionTouchPayload) {
        try {
          await conversationSessionEvents.emitSessionAfterMessaging(
            sessionTouchPayload,
          );
        } catch (err) {
          logger.error(
            `createConversationWithMessages: session activity event failed: ${err}`,
          );
        }
      }

      return { ...createdConversation, messages: insertedMessages };
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  async updateConversationBySessionId(
    conversation_session_id: string,
    conversationData: Partial<
      Omit<Conversation, 'id' | 'created_at' | 'updated_at'>
    >,
  ): Promise<Conversation | null> {
    try {
      const conversation =
        await this.conversationRepository.getConversationBySessionId(
          conversation_session_id,
        );
      if (!conversation) {
        throw new NoDataError(
          `Did not find any conversation for session: ${conversation_session_id}`,
        );
      }
      const updatedConversation = await this.conversationRepository.update(
        conversation.id,
        conversationData,
      );
      if (!updatedConversation) {
        throw new NoDataError('Could not update Conversation');
      }
      return updatedConversation;
    } catch (error) {
      logger.error(
        `Failed to update conversation for session ${conversation_session_id}: ${error}`,
      );
      throw error;
    }
  }

  async getConversationBySessionId(
    conversation_session_id: string,
  ): Promise<ConversationWithMessages | null> {
    const conversation =
      await this.conversationRepository.getConversationBySessionId(
        conversation_session_id,
      );
    if (!conversation) {
      return null;
    }
    const messages =
      await this.conversationMessageRepository.findByConversationId(
        conversation.id,
      );
    return { ...conversation, messages };
  }

  /** Conversation row only (no messages). Used by SMS operator inbox and similar. */
  async findConversationRowBySessionId(
    conversation_session_id: string,
  ): Promise<Conversation | null> {
    return this.conversationRepository.getConversationBySessionId(
      conversation_session_id,
    );
  }

  async countMessagesAllRolesForConversation(
    conversationId: string,
  ): Promise<number> {
    return this.conversationMessageRepository.countByConversationIdAllRoles(
      conversationId,
    );
  }

  async countMessagesUserAndAiForConversation(
    conversationId: string,
    roles?: ConversationMessageRole[],
  ): Promise<number> {
    if (roles) {
      return this.conversationMessageRepository.countByConversationIdUserAndAi(
        conversationId,
        roles,
      );
    }
    return this.conversationMessageRepository.countByConversationIdUserAndAi(
      conversationId,
    );
  }

  async findMessagesPaginatedAllRoles(
    conversationId: string,
    offset: number,
    limit: number,
  ): Promise<ConversationMessage[]> {
    return this.conversationMessageRepository.findByConversationIdPaginatedAllRoles(
      conversationId,
      offset,
      limit,
    );
  }

  async findMessagesPaginatedUserAndAi(
    conversationId: string,
    offset: number,
    limit: number,
    roles?: ConversationMessageRole[],
  ): Promise<ConversationMessage[]> {
    if (roles) {
      return this.conversationMessageRepository.findByConversationIdPaginatedUserAndAi(
        conversationId,
        offset,
        limit,
        roles,
      );
    }
    return this.conversationMessageRepository.findByConversationIdPaginatedUserAndAi(
      conversationId,
      offset,
      limit,
    );
  }

  async createConversationMessage(
    data: Omit<ConversationMessage, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<ConversationMessage> {
    const created = await this.conversationMessageRepository.create(data);
    try {
      await this.notifySessionAfterMessage(data.conversation_id, data.role);
    } catch (err) {
      logger.error(
        `createConversationMessage: notifySessionAfterMessage failed: ${err}`,
      );
    }
    return created;
  }

  async getTranscriptsByPhoneNumber(
    phoneNumber: string,
    limit: number,
    sortOrder = SortOrder.DESC,
  ): Promise<ConversationMessage[]> {
    return await this.conversationMessageRepository.findTranscriptsByPhoneNumberWithLimitAndSort(
      phoneNumber,
      limit,
      sortOrder,
    );
  }

  async getConversationHistory(
    phoneNumber: string,
    hotelId: string,
    limit: number,
    sortOrder = SortOrder.ASC,
  ): Promise<ConversationMessage[]> {
    return this.conversationMessageRepository.findHistoryByPhoneNumber(
      phoneNumber,
      hotelId,
      limit,
      sortOrder,
    );
  }

  async createConversationMessages(
    conversation_session_id: string,
    caller_phone_number: string,
    messages: Omit<
      ConversationMessage,
      'id' | 'created_at' | 'updated_at' | 'conversation_id'
    >[],
    assistant_phone_number: string,
    sessionType: SessionType,
    hotelId: string,
    sendTelegramNotification: boolean = true,
    chatRoutingMode?: ChatRoutingMode,
  ): Promise<ConversationWithMessages> {
    const trx = await this.conversationRepository.startTransaction();
    try {
      let conversation =
        await this.conversationRepository.getConversationBySessionId(
          conversation_session_id,
        );
      let conversation_id: string;
      if (conversation && conversation.ended_at == null) {
        conversation_id = conversation.id;
      } else {
        const conversationInsertData = {
          conversation_session_id,
          phone_number: caller_phone_number,
          started_at: new Date(),
          hotel_id: hotelId,
        };
        conversation = await this.conversationRepository.create(
          conversationInsertData,
          trx,
        );
        conversation_id = conversation.id;
      }
      const conversationMessages: ConversationMessage[] = [];
      for (const message of messages) {
        const conversationMessage =
          await this.conversationMessageRepository.create(
            {
              ...message,
              conversation_id,
            },
            trx,
          );
        conversationMessages.push(conversationMessage);
      }

      const sessionTouchPayload =
        conversationMessages.length > 0
          ? (() => {
              const latest =
                this.pickLatestMessageByTimestamp(conversationMessages);
              if (!latest) return null;
              return {
                sessionId: conversation_session_id,
                messageRole: latest.role as ConversationMessageRole,
                hasUserMessageInBatch:
                  this.batchIncludesUserRole(conversationMessages),
              };
            })()
          : null;

      await trx.commit();

      if (sessionTouchPayload) {
        try {
          await conversationSessionEvents.emitSessionAfterMessaging(
            sessionTouchPayload,
          );
        } catch (err) {
          logger.error(
            `createConversationMessages: session activity event failed: ${err}`,
          );
        }
      }

      const conversationWithMessages: ConversationWithMessages = {
        ...conversation,
        messages: conversationMessages,
      };

      // Send Telegram notification with transcript (after transaction commits)
      if (sendTelegramNotification) {
        this.sendTranscriptToTelegram(
          conversationMessages,
          assistant_phone_number,
          caller_phone_number,
          sessionType,
          chatRoutingMode,
        ).catch((error) => {
          logger.error(
            `createConversationMessages: Failed to send Telegram notification: ${error}`,
          );
        });
      }

      return conversationWithMessages;
    } catch (error) {
      if (trx) {
        await trx.rollback();
      }
      logger.error(`Error creating messages for conversation: ${error}`);
      throw error;
    }
  }

  private async sendTranscriptToTelegram(
    messages: ConversationMessage[],
    assistant_phone_number: string,
    caller_phone_number: string,
    sessionType: SessionType,
    chatRoutingMode?: ChatRoutingMode,
  ): Promise<void> {
    try {
      const hotel = await this.hotelRepository.findByAssistantPhoneNumber(
        assistant_phone_number,
      );

      if (!hotel) {
        logger.warn(
          `sendTranscriptToTelegram: No Telegram alerts group configured for hotel with assistant phone ${assistant_phone_number}`,
        );
        return;
      }

      const mode = 'Daisy';
      const batchHasGuestMessage = messages.some(
        (m) => m.role === ConversationMessageRole.USER,
      );
      const directPaused =
        batchHasGuestMessage && chatRoutingMode === ChatRoutingMode.DIRECT;
      const hotelConfig =
        await hotelConfigurationService.getHotelConfigurationByHotelId(
          hotel.id,
        );
      const managerBargeInEnabled =
        hotelConfig?.enable_manager_barge_in === true;
      const transcriptMessage = this.formatTranscriptForTelegram(
        messages,
        caller_phone_number,
        mode,
        sessionType,
        { directPaused, managerBargeInEnabled },
      );

      if ([SessionType.SMS, SessionType.CHAT].includes(sessionType)) {
        // Send to the hotel's transcript group if configured
        if (hotel.telegram_transcript_group_id) {
          const actions =
            directPaused && managerBargeInEnabled
              ? [
                  [
                    {
                      text: '🔄 Switch to Danny',
                      data: `handback:${caller_phone_number}:${assistant_phone_number}`,
                    },
                  ],
                ]
              : undefined;
          await notificationFactory
            .getChatService(hotel.notification_type)
            .sendMessage({
              recipient: hotel.telegram_transcript_group_id,
              content: {
                message: transcriptMessage,
                parseMode: 'HTML',
                actions,
              },
            });
          logger.info(
            `sendTranscriptToTelegram: Sent transcript to Telegram for hotel ${hotel.name}`,
          );
        }

        // send to generic transcripts group for the tech team to monitor (no button)
        const telegramTranscriptsGroupId = config.TELEGRAM_TRANSCRIPTS_GROUP_ID;
        if (telegramTranscriptsGroupId) {
          this.telegramService
            .sendMessage({
              recipient: telegramTranscriptsGroupId,
              content: {
                message: transcriptMessage,
                parseMode: 'HTML',
              },
            })
            .catch((error) => {
              logger.warn(
                `sendTranscriptToTelegram: Failed to send Telegram notification to the generic transcripts group: ${error}`,
              );
            });
        }
      }
    } catch (error) {
      logger.error(
        `sendTranscriptToTelegram: Error in sendTranscriptToTelegram: ${error}`,
      );
      throw error;
    }
  }

  private formatTranscriptForTelegram(
    messages: ConversationMessage[],
    guestPhone: string,
    mode: string,
    sessionType: SessionType,
    options?: { directPaused?: boolean; managerBargeInEnabled?: boolean },
  ): string {
    const sessionTypeString =
      sessionType === SessionType.CHAT ? 'Webchat' : sessionType;
    const directPaused = options?.directPaused ?? false;
    const managerBargeInEnabled = options?.managerBargeInEnabled ?? false;

    const header = directPaused
      ? `<b>Response needed (Danny AI paused for guest)</b>\n\n` +
        `<b>Guest Phone:</b> ${guestPhone}\n` +
        `<b>Mode:</b> ${mode}\n` +
        `<b>Session Type:</b> ${sessionTypeString}\n` +
        `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n`
      : `<b>📝 New Conversation Transcript</b>\n\n` +
        `<b>Guest Phone:</b> ${guestPhone}\n` +
        `<b>Mode:</b> ${mode}\n` +
        `<b>Session Type:</b> ${sessionTypeString}\n` +
        `<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n`;

    const transcript = messages
      .map((msg) => {
        let content = '';
        if (msg.message) {
          content = msg.message;
        } else if (msg.tool_call_name) {
          content = `[Tool Call: ${msg.tool_call_name}]`;
        } else if (msg.tool_calls && msg.tool_calls.length > 0) {
          content = `[Tool Calls: ${msg.tool_calls.map((tc) => tc.function?.name || 'unknown').join(', ')}]`;
        }

        return `<b>${msg.role}:</b>\n${content}\n`;
      })
      .join('\n');

    const footer = managerBargeInEnabled
      ? directPaused
        ? `\n-------\n<i>Reply to this message to follow up with the guest, or switch back to Danny AI for auto response.</i>`
        : `\n-------\n<i>Reply to this log message to follow up with the guest.</i>`
      : '';

    return header + transcript + footer;
  }

  async getConversationSummaryBySessionid(
    conversation_session_id: string,
  ): Promise<ConversationSummary> {
    const conversationSummary =
      await this.conversationRepository.getConversationSummaryBySessionId(
        conversation_session_id,
      );
    const enriched =
      await enrichConversationSummaryWithRecordingPresignedUrl(
        conversationSummary,
      );
    return enriched ?? { summary: conversationSummary?.summary ?? '' };
  }

  async getPaginatedConversationTranscriptBySessionId(
    conversation_session_id: string,
    channelType: SessionType,
    page: number = 1,
    limit: number = 10,
    req: GetRequestForPagination,
    reservationCreatedDate?: Date,
  ): Promise<Transcript | null> {
    const conversation =
      await this.conversationRepository.getConversationBySessionId(
        conversation_session_id,
      );
    if (!conversation) {
      return null;
    }

    // Calculate time window for SMS channel if reservationCreatedDate is provided
    let metadata: TranscriptQueryMetadata | undefined;
    if (channelType === SessionType.SMS && reservationCreatedDate) {
      metadata = {
        startTime: new Date(
          reservationCreatedDate.getTime() -
            ConversationService.SMS_LOG_TIME_BUFFER_MS,
        ),
        endTime: new Date(
          reservationCreatedDate.getTime() +
            ConversationService.SMS_LOG_TIME_BUFFER_MS,
        ),
      };
    }

    const offset = (page - 1) * limit;
    const messages =
      await this.conversationMessageRepository.findTranscriptsByConversationId(
        conversation.id,
        offset,
        limit,
        metadata,
      );
    const total_count =
      await this.conversationMessageRepository.getTotalTranscriptCount(
        conversation.id,
        metadata,
      );
    const total_page = Math.ceil(total_count / limit);

    const transcripts: Transcript = {
      data: messages,
      pagination: {
        current_page: page,
        limit: limit,
        total: total_count,
        total_pages: total_page,
        ...getPaginationUrls(
          req.base_path,
          req.query_params,
          page,
          limit,
          total_page,
        ),
      },
    };
    return transcripts;
  }

  async getConversationIntentSummary(
    hotel_id: string,
    start_date?: Date,
    end_date?: Date,
    session_type?: SessionType,
  ): Promise<ConversationIntentSummary> {
    try {
      const conversationIntents =
        await this.conversationRepository.getConversationIntentByHotelId(
          hotel_id,
          start_date,
          end_date,
          session_type,
        );
      const total_count =
        await this.conversationRepository.getTotalSessionCountByHotelId(
          hotel_id,
          start_date,
          end_date,
          session_type,
        );
      const intentSummary: ConversationIntentSummary = {
        CALLBACK: { count: 0, percentage: 0 },
        ENQUIRY: { count: 0, percentage: 0 },
        UNSUCCESSFUL_RESERVATION_DUE_TO_PRICE: { count: 0, percentage: 0 },
        NEW_RESERVATION: { count: 0, percentage: 0 },
        CANCEL_RESERVATION: { count: 0, percentage: 0 },
        MODIFY_RESERVATION: { count: 0, percentage: 0 },
        UNKNOWN: { count: 0, percentage: 0 },
      };
      for (const intents of conversationIntents) {
        const intent = intents.split(',');
        for (const eachIntent of intent) {
          const key = eachIntent.trim() as keyof ConversationIntentSummary;
          if (key in intentSummary) {
            intentSummary[key].count += 1;
          }
        }
      }
      for (const [key, value] of Object.entries(intentSummary)) {
        value.percentage =
          total_count === 0
            ? 0
            : parseFloat(((value.count / total_count) * 100).toFixed(2));
      }
      return intentSummary;
    } catch (error) {
      logger.error(
        `Error in conversationService: Could not fetch conversation intents: ${error}`,
      );
      throw error;
    }
  }
}

export default new ConversationService();
