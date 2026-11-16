import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Knex } from 'knex';
import _ from 'lodash';
import config from '../../config';
import { Reservation } from '../../dtos/Reservation';
import {
  HotelAnalyticsSummary,
  SessionCreateDto,
  SessionMetadata,
} from '../../dtos/Session';
import { BookingSummaryV2 } from '../../dtos/dashboard/bookingSummary';
import {
  CallKpiSummary,
  KpiTrendPoint,
  KpiTrendRateRow,
  KpiTrendResponse,
  KpiTrendRevenueRow,
  KpiTrendSeries,
} from '../../dtos/dashboard/callKpiSummary';
import {
  ConversationSummary as CallAnalyticsSummary,
  CallSummary,
} from '../../dtos/dashboard/callSummary';
import { ConversationIntentSummary } from '../../dtos/dashboard/conversationIntentSummary';
import { ConversationSummary } from '../../dtos/dashboard/conversationSummary';
import { Transcript } from '../../dtos/dashboard/transcript';
import {
  ChatRoutingMode,
  ChatRoutingResult,
} from '../../dtos/enum/ChatRoutingMode';
import { ConversationMessageRole } from '../../dtos/enum/ConversationMessageRole';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { SessionType } from '../../dtos/enum/SessionType';
import { BadRequestError } from '../../errors/BadRequestError';
import { NoDataError } from '../../errors/NoDataError';
import { smsEvents } from '../../events/smsEvents';
import { ConversationMessage } from '../../models/ConversationMessage';
import { Escalation } from '../../models/Escalations';
import { Hotel } from '../../models/Hotel';
import { HotelConfiguration } from '../../models/HotelConfiguration';
import { Session } from '../../models/Session';
import { GuestIntent } from '../../models/request/EndOfCallReport';
import { StatusUpdateType } from '../../models/request/StatusUpdate';
import { PaginationQueryParams } from '../../models/request/common';
import { Pagination } from '../../models/response/common';
import { SessionRepository } from '../../repositories/SessionRepository';
import { getPaginationUrls, GetRequestForPagination } from '../../utils/common';
import { convertToPhoneNumber } from '../../utils/helper';
import logger from '../../utils/logger';
import { sanitizeTelegramHTML } from '../../utils/sanitizeTelegramHTML';
import ConversationService from '../conversation/ConversationService';
import escalationService from '../escalation/escalationService';
import { HotelService, hotelService } from '../hotel/hotelService';
import { hotelConfigurationService } from '../hotelConfiguration/hotelConfigurationService';
import {
  managerSteppingInSmsTemplate,
  managerSteppingOutSmsTemplate,
} from '../messaging/messageTemplates';
import { notificationFactory } from '../notification/notificationFactory';
import smsNotificationService from '../notification/smsNotificationService';
import roomReservationService, {
  RoomReservationService,
} from '../roomReservation/roomReservationService';

dayjs.extend(utc);
dayjs.extend(timezone);

interface GetCallLogListParams extends PaginationQueryParams {
  phone_number?: string;
  session_type?: SessionType;
  start_date?: string;
  end_date?: string;
  intent?: string;
  hotel_id: string;
}

export interface AnalyticsSummaryParams {
  hotel_ids?: string[];
  start_date?: string;
  end_date?: string;
  notification_time?: string;
  cron_window_minutes?: number;
}

export interface AnalyticsHotelResult {
  hotel_id: string;
  hotel_name: string;
  status: 'sent' | 'skipped';
  total_calls: number;
  total_duration_seconds: number;
  total_revenue: number;
  total_amount_collected: number;
  availability_enquired_calls: number;
  payment_link_sent_calls: number;
  successful_reservation_calls: number;
  avg_satisfaction_score?: number | null;
  high_frustration_calls: number;
  skip_reason?: string;
}

export interface GetCallLogListResponse {
  pagination: Pagination;
  data: CallLog[];
}

export interface CallLog {
  id: string;
  caller_phone_number: string;
  created_at: Date;
  updated_at: Date;
  started_at: Date;
  ended_at: Date;
  duration_seconds: number;
  booking_amount: number;
  intent: GuestIntent[];
  payment_status: string;
}

/**
 * Resolve DIRECT-mode expiry seconds from hotel configuration.
 * A positive hotel override wins; otherwise the global env default is used.
 * @example
 * resolveManagerRoutingTimeoutSeconds({ manager_routing_timeout_seconds: 90 }) // 90
 * resolveManagerRoutingTimeoutSeconds(null) // config.MANAGER_ROUTING_TIMEOUT_SECONDS
 */
export function resolveManagerRoutingTimeoutSeconds(
  hotelConfig: HotelConfiguration | null | undefined,
): number {
  const hotelTimeoutSeconds = hotelConfig?.manager_routing_timeout_seconds;
  if (
    hotelTimeoutSeconds == null ||
    !Number.isFinite(hotelTimeoutSeconds) ||
    hotelTimeoutSeconds <= 0
  ) {
    return config.MANAGER_ROUTING_TIMEOUT_SECONDS;
  }
  return hotelTimeoutSeconds;
}

export class SessionService {
  private sessionRepository: SessionRepository;
  private hotelService: HotelService;
  private roomReservationService: RoomReservationService;
  constructor({
    hotelService,
    roomReservationService,
  }: {
    hotelService: HotelService;
    roomReservationService: RoomReservationService;
  }) {
    this.sessionRepository = new SessionRepository();
    this.hotelService = hotelService;
    this.roomReservationService = roomReservationService;
  }

  /** Delegates to SessionRepository; use from ConversationService instead of touching the repo directly. */
  async updateSessionAfterMessaging(
    sessionId: string,
    messageRole: ConversationMessageRole,
    extras?: { hasUserMessageInBatch?: boolean },
  ): Promise<void> {
    await this.sessionRepository.updateSessionAfterMessaging(
      sessionId,
      messageRole,
      extras,
    );
  }

  /** Creates a session when the caller already resolved the hotel and raw session payload. */
  async createExternalSession(
    session: Partial<Session>,
    transaction?: Knex.Transaction,
  ): Promise<Session> {
    return this.sessionRepository.insertSession(session, transaction);
  }

  async updateSessionMetadata(
    sessionId: string,
    patch: SessionMetadata,
  ): Promise<void> {
    await this.sessionRepository.updateSessionMetadata(sessionId, patch);
  }

  private getValidatedStartDate(date?: string): Date {
    if (!date) {
      const now = new Date();
      const yesterday = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() - 1,
          0,
          0,
          0,
        ),
      );
      logger.warn('No start date provided, defaulting to yesterday');
      return yesterday;
    }

    const parsedDate = new Date(date);
    const UTCDate = new Date(
      Date.UTC(
        parsedDate.getUTCFullYear(),
        parsedDate.getUTCMonth(),
        parsedDate.getUTCDate(),
        parsedDate.getUTCHours(),
        parsedDate.getUTCMinutes(),
        parsedDate.getUTCSeconds(),
      ),
    );

    if (isNaN(parsedDate.getTime()) || isNaN(UTCDate.getTime())) {
      logger.error('Failed to parse the start date');
      throw new Error('Failed to parse the start date');
    }

    return UTCDate;
  }

  private getValidatedEndDate(date?: string): Date {
    const now = new Date();
    if (!date) {
      logger.warn('No end date provided, defaulting to current time');
      return new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          now.getUTCHours(),
          now.getUTCMinutes(),
          now.getUTCSeconds(),
        ),
      );
    }

    const parsedDate = new Date(date);
    const UTCDate = new Date(
      Date.UTC(
        parsedDate.getUTCFullYear(),
        parsedDate.getUTCMonth(),
        parsedDate.getUTCDate(),
        parsedDate.getUTCHours(),
        parsedDate.getUTCMinutes(),
        parsedDate.getUTCSeconds(),
      ),
    );

    if (isNaN(parsedDate.getTime()) || isNaN(UTCDate.getTime())) {
      logger.error('Failed to parse the end date');
      throw new Error('Failed to parse the end date');
    }

    return UTCDate;
  }

  async getLatestActiveSession(
    hotelPhoneNumber: string,
    customerPhoneNumber: string,
    sessionType: SessionType,
  ): Promise<Session | null> {
    const hotel =
      await this.hotelService.getHotelByAssistantPhoneNumber(hotelPhoneNumber);
    if (!hotel) {
      logger.error(
        'getLatestActiveSession: No hotel found for assistant phone number',
      );
      throw new NoDataError(
        `No hotel found for assistant phone number ${hotelPhoneNumber}`,
      );
    }
    return this.sessionRepository.findSessionByHotelIdStatusType(
      hotel.id,
      customerPhoneNumber,
      StatusUpdateType.InProgress,
      sessionType,
    );
  }

  async getSessionByExternalProviderId(
    call_id: string,
  ): Promise<Session | null> {
    return this.sessionRepository.findSessionByExternalId(call_id);
  }

  async getSessionById(id: string): Promise<Session | null> {
    return this.sessionRepository.findSessionById(id);
  }

  /**
   * Upsert session data based on external_provider_id and session status.
   * - If the session does not exist, insert a new session.
   * - If the session exists and is already ended, throw an error.
   * - If the session exists and is in progress, update the session.
   */
  async upsertSessionData(
    sessionData: Partial<Session>,
  ): Promise<Session | null> {
    const processedSessionData: Partial<Session> = {
      ...sessionData,
      assistant_phone_number:
        convertToPhoneNumber(sessionData.assistant_phone_number) ||
        sessionData.assistant_phone_number,
    };
    if (!processedSessionData.external_provider_id) {
      throw new BadRequestError('External Provider Id is required');
    }
    const session = await this.getSessionByExternalProviderId(
      processedSessionData.external_provider_id,
    );

    const sessionType =
      processedSessionData.session_type || session?.session_type;
    if (sessionType === SessionType.CHAT) {
      processedSessionData.caller_phone_number =
        sessionData.caller_phone_number || session?.caller_phone_number;
    } else {
      processedSessionData.caller_phone_number =
        convertToPhoneNumber(sessionData.caller_phone_number) ||
        sessionData.caller_phone_number ||
        session?.caller_phone_number;
    }

    if (!session) {
      if (
        !processedSessionData.caller_phone_number ||
        !processedSessionData.assistant_phone_number
      ) {
        const errorMessage = `upsertSessionData: Session creation failed. Invalid caller or assistant phone number: ${processedSessionData.caller_phone_number} / ${processedSessionData.assistant_phone_number}`;
        logger.error(errorMessage);
        throw new BadRequestError(errorMessage);
      }
      const hotel = await this.hotelService.getHotelByAssistantPhoneNumber(
        processedSessionData.assistant_phone_number,
      );
      if (!hotel) {
        logger.error(
          'upsertSessionData: No hotel found for assistant phone number',
        );
        throw new NoDataError(
          `upsertSessionData: Session creation failed. No hotel found for assistant phone number ${processedSessionData.assistant_phone_number}`,
        );
      }
      processedSessionData.hotel_id = hotel.id;

      // Insert new session if it doesn't exist
      logger.info(
        `upsertSessionData: Begin new session: ${JSON.stringify(processedSessionData)}`,
      );
      return this.sessionRepository.insertSession(processedSessionData);
    }

    if (session.session_status === StatusUpdateType.Ended) {
      const errorMessage = `upsertSessionData: Failed to update: session has already ended ID: ${session.id}, external_id: ${session.external_provider_id}`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Session exists and is in progress, update it
    logger.info(
      `upsertSessionData: Updating session: ${JSON.stringify(processedSessionData)}`,
    );
    return this.sessionRepository.updateSession(
      session.id,
      processedSessionData,
    );
  }

  async createSession(
    sessionData: SessionCreateDto,
    transaction?: Knex.Transaction,
  ): Promise<{ session: Session; status: number }> {
    const caller_phone_number =
      sessionData.session_type === SessionType.CHAT
        ? sessionData.caller_phone_number
        : convertToPhoneNumber(sessionData.caller_phone_number);

    const session_type = sessionData.session_type;
    if (!session_type) {
      throw new BadRequestError(
        `Session creation failed. Missing session type for session with phone number ${caller_phone_number}`,
      );
    }

    const assistant_phone_number = convertToPhoneNumber(
      sessionData.assistant_phone_number,
    );

    if (!caller_phone_number || !assistant_phone_number) {
      const errorMessage = `Invalid caller or assistant phone number: ${sessionData.caller_phone_number} / ${assistant_phone_number}`;
      logger.error(errorMessage);
      throw new BadRequestError(errorMessage);
    }

    const hotel = await this.hotelService.getHotelByAssistantPhoneNumber(
      assistant_phone_number,
    );
    if (!hotel) {
      logger.error('createSession: No hotel found for assistant phone number');
      throw new NoDataError(
        `No hotel found for assistant phone number ${assistant_phone_number}`,
      );
    }
    const existingSession =
      await this.sessionRepository.findSessionByHotelIdStatusType(
        hotel.id,
        caller_phone_number,
        StatusUpdateType.InProgress,
        session_type,
      );
    if (existingSession) {
      logger.warn('Active session already exists for this phone number');
      return { session: existingSession, status: 200 };
    }

    const createdSession = await this.sessionRepository.insertSession(
      {
        ...sessionData,
        caller_phone_number,
        assistant_phone_number,
        hotel_id: hotel.id,
      },
      transaction,
    );
    return { session: createdSession, status: 201 };
  }

  async updateSession(sessionData: Partial<Session>): Promise<Session | null> {
    const processedSessionData: Partial<Session> = {
      ...sessionData,
      assistant_phone_number:
        convertToPhoneNumber(sessionData.assistant_phone_number) ||
        sessionData.assistant_phone_number,
    };
    if (
      !processedSessionData.assistant_phone_number ||
      !processedSessionData.caller_phone_number ||
      !processedSessionData.session_type
    ) {
      throw new BadRequestError(
        `updateSession: assistant phone number, caller phone number, session type are all required values`,
      );
    }

    const hotel = await this.hotelService.getHotelByAssistantPhoneNumber(
      processedSessionData.assistant_phone_number!,
    );
    if (!hotel) {
      logger.error('updateSession: No hotel found for assistant phone number');
      throw new NoDataError(
        `No hotel found for assistant phone number ${processedSessionData.assistant_phone_number}`,
      );
    }
    const session = await this.sessionRepository.findSessionByHotelIdStatusType(
      hotel.id,
      processedSessionData.caller_phone_number!,
      StatusUpdateType.InProgress,
      sessionData.session_type!,
    );
    if (!session) {
      logger.error('updateSession: No active session exists');
      throw new NoDataError(`No active session exists`);
    }
    const sessionType =
      processedSessionData.session_type || session.session_type;
    if (sessionType === SessionType.CHAT) {
      processedSessionData.caller_phone_number =
        sessionData.caller_phone_number || session.caller_phone_number;
    } else {
      processedSessionData.caller_phone_number =
        convertToPhoneNumber(sessionData.caller_phone_number) ||
        sessionData.caller_phone_number ||
        session.caller_phone_number;
    }

    // Session exists and is in progress, update it
    logger.info(`Updating session: ${JSON.stringify(processedSessionData)}`);
    return this.sessionRepository.updateSession(
      session.id,
      processedSessionData,
    );
  }

  async getCallSummary(
    hotel_id: string,
    start_date?: Date,
    end_date?: Date,
    session_type?: SessionType,
  ): Promise<CallSummary> {
    const conversations =
      await this.sessionRepository.getSessionsSummaryByHotelId(
        hotel_id,
        start_date,
        end_date,
        session_type,
      );

    const summary: CallSummary = {
      calls: {
        total: conversations.total_conversations,
        duration_seconds: conversations.total_duration,
      },
    };
    logger.info(
      `Returned total_calls: ${summary.calls.total} and total_duration: ${summary.calls.duration_seconds}`,
    );
    return summary;
  }

  async getConversationIntentSummary(
    hotel_id: string,
    start_date?: Date,
    end_date?: Date,
    session_type?: SessionType,
  ): Promise<ConversationIntentSummary> {
    try {
      const conversationIntentSummary =
        await ConversationService.getConversationIntentSummary(
          hotel_id,
          start_date,
          end_date,
          session_type,
        );
      return conversationIntentSummary;
    } catch (error) {
      logger.error(
        `Error in sessionService: Could not fetch conversation intents: ${error}`,
      );
      throw error;
    }
  }

  async getReservationsBySessionId(session_id: string): Promise<Reservation[]> {
    const reservations =
      await roomReservationService.getReservationDetailsBySessionId(session_id);
    logger.info(
      `Returned ${reservations.length} reservations for session ${session_id}`,
    );
    return reservations;
  }

  async getEscalationsBySesionId(session_id: string): Promise<Escalation[]> {
    const escalations =
      await escalationService.getEscalationsBySessionId(session_id);
    logger.info(
      `Returned ${escalations.length} escalations for session ${session_id}`,
    );
    return escalations;
  }

  async getConversationSummaryBySessionId(
    session_id: string,
  ): Promise<ConversationSummary> {
    const conversation =
      await ConversationService.getConversationSummaryBySessionid(session_id);
    logger.info(`Returned conversations summary for session ${session_id}`);
    return conversation;
  }

  async getConversationTranscriptBySessionId(
    session_id: string,
    hotel_id: string,
    page: number = 1,
    limit: number = 10,
    req: GetRequestForPagination,
  ): Promise<Transcript | []> {
    // Fetch session to get session_type
    const session = await this.sessionRepository.findSessionById(session_id);

    if (!session) {
      throw new NoDataError(`No session found for session ID: ${session_id}`);
    }

    // Verify session belongs to the authenticated user's hotel
    if (session.hotel_id !== hotel_id) {
      throw new BadRequestError('Session does not belong to your hotel');
    }

    const channelType = session.session_type;

    const transcripts =
      await ConversationService.getPaginatedConversationTranscriptBySessionId(
        session_id,
        channelType,
        page,
        limit,
        req,
      );
    logger.info(`Returned conversations transcript for session ${session_id}`);
    return transcripts || [];
  }

  async getCallLogList(
    params: GetCallLogListParams,
    req: GetRequestForPagination,
  ): Promise<GetCallLogListResponse> {
    try {
      const startDate = this.getValidatedStartDate(params.start_date);
      const endDate = this.getValidatedEndDate(params.end_date);
      if (Number(params?.page) <= 0) {
        throw new BadRequestError('Page Number should be greater than 0');
      }

      if (Number(params?.limit) <= 0) {
        throw new BadRequestError('Limit must by greater than 0');
      }

      const page = Number(params.page || 1);
      const limit = Number(params.limit) || 10;
      const offset = (page - 1) * limit;

      const callLogCount = await this.sessionRepository.getTotalCallLogCount(
        params.hotel_id,
        startDate,
        endDate,
        params.phone_number,
        params.session_type,
        params.intent,
      );

      const callLogs = await this.sessionRepository.getPaginatedSessionData(
        params.hotel_id,
        startDate,
        endDate,
        offset,
        limit,
        params.phone_number,
        params.session_type,
        params.intent,
      );

      const sessionIds = callLogs?.map((log) => log.id);
      let reservations: Reservation[] = [];
      let sessionIdTotalAmountMap: Record<string, number> = {};
      if (sessionIds?.length) {
        reservations =
          await this.roomReservationService.getReservationsBySessionIds(
            sessionIds,
          );
        for (const reservation of reservations) {
          if (
            ![ReservationStatus.INACTIVE, ReservationStatus.CANCELLED].includes(
              reservation.status,
            ) &&
            !_.isEmpty(reservation.quote)
          ) {
            if (!reservation.session_id) {
              throw new NoDataError(
                `Reservation ${reservation.id} does not have a session id`,
              );
            }
            let totalAmount =
              sessionIdTotalAmountMap[reservation.session_id] ?? 0;
            totalAmount +=
              reservation.quote.base_rate +
              reservation.quote.taxes +
              reservation.quote.fees;
            sessionIdTotalAmountMap[reservation.session_id] = totalAmount;
          }
        }
      }

      logger.info(`Call log count: ${callLogCount}`);
      logger.info(`Call logs: ${JSON.stringify(callLogs)}`);

      const total_pages = Math.ceil(callLogCount / limit) || 0;
      return {
        data:
          callLogs?.map(
            (log): CallLog => ({
              id: log.id,
              caller_phone_number: log.caller_phone_number,
              created_at: log.created_at,
              updated_at: log.updated_at,
              started_at: log.started_at,
              ended_at: log.ended_at,
              duration_seconds: Math.max(
                (log.ended_at.getTime() - log.started_at.getTime()) / 1000,
                0,
              ),
              booking_amount: sessionIdTotalAmountMap[log.id],
              intent: log.intent
                ? log.intent
                    .split(',')
                    .map((item) => item.trim())
                    .filter((item): item is GuestIntent =>
                      Object.values(GuestIntent).includes(item as GuestIntent),
                    )
                : [],
              payment_status: log.payment_status,
            }),
          ) || [],
        pagination: {
          current_page: page,
          limit: limit,
          total: callLogCount,
          total_pages: total_pages,
          ...getPaginationUrls(
            req.base_path,
            req.query_params,
            page,
            limit,
            total_pages,
          ),
        },
      };
    } catch (error) {
      logger.error(
        `Error in sessionService::Failed to fetch call logs: ${JSON.stringify(
          error,
        )}`,
      );
      throw error;
    }
  }

  /** SMS operator inbox: distinct active SMS threads for a hotel. */
  async listActiveSmsSessions(
    hotelId: string,
    page: number,
    limit: number,
    req: GetRequestForPagination,
    search?: string | null,
  ): Promise<{
    data: Array<{
      session_id: string;
      caller_phone_number: string;
      assistant_phone_number: string;
      session_status: string;
      created_at: Date;
      updated_at: Date;
      last_messaged_at: Date | null;
      has_unread_messages: boolean;
    }>;
    pagination: Pagination;
  }> {
    await this.hotelService.getHotelById(hotelId);
    const total =
      await this.sessionRepository.countDistinctActiveSmsSessionsByHotelId(
        hotelId,
        search,
      );
    const offset = (page - 1) * limit;
    const sessions =
      await this.sessionRepository.findDistinctActiveSmsSessionsPaginated(
        hotelId,
        limit,
        offset,
        search,
      );
    const total_pages = limit > 0 ? Math.ceil(total / limit) : 0;
    const pagination: Pagination = {
      current_page: page,
      limit,
      total,
      total_pages,
      ...getPaginationUrls(
        req.base_path,
        req.query_params,
        page,
        limit,
        total_pages,
      ),
    };
    const data = sessions.map((s) => this.mapSmsInboxSessionRow(s));
    return { data, pagination };
  }

  async listSmsInboxMessages(
    hotelId: string,
    sessionId: string,
    page: number,
    limit: number,
    req: GetRequestForPagination,
  ): Promise<{
    data: Array<{
      id: string;
      role: ConversationMessageRole;
      message: string;
      timestamp: Date;
      created_at: Date;
    }>;
    pagination: Pagination;
  }> {
    await this.hotelService.getHotelById(hotelId);
    const session = await this.requireActiveSmsSessionForInbox(
      hotelId,
      sessionId,
    );
    return this.listUserAndAiMessagesForSession(session, page, limit, req);
  }

  /**
   * API-key channel history: resolve latest non-ended session for hotel + caller + type,
   * then return paginated messages. Defaults to including SYSTEM/tool-call rows.
   */
  async getChannelHistoryByCallerPhone(
    hotelId: string,
    callerPhoneNumber: string,
    sessionType: SessionType,
    page: number,
    limit: number,
    req: GetRequestForPagination,
    includeToolCalls = true,
  ): Promise<{
    data: Array<{
      id: string;
      role: ConversationMessageRole;
      message: string;
      timestamp: Date;
      created_at: Date;
      tool_calls?: ConversationMessage['tool_calls'] | null;
      tool_call_name?: string | null;
      tool_call_results?: ConversationMessage['tool_call_results'] | null;
    }>;
    pagination: Pagination;
  }> {
    const session =
      await this.sessionRepository.findLatestNonEndedSessionByHotelAndCaller(
        hotelId,
        callerPhoneNumber,
        sessionType,
      );
    if (!session) {
      throw new NoDataError(
        `No active ${sessionType} session found for this phone number`,
      );
    }
    await this.hotelService.getHotelById(hotelId);
    return this.listUserAndAiMessagesForSession(
      session,
      page,
      limit,
      req,
      includeToolCalls,
    );
  }

  private async listUserAndAiMessagesForSession(
    session: Session,
    page: number,
    limit: number,
    req: GetRequestForPagination,
    includeToolCalls = false,
  ): Promise<{
    data: Array<{
      id: string;
      role: ConversationMessageRole;
      message: string;
      timestamp: Date;
      created_at: Date;
      tool_calls?: ConversationMessage['tool_calls'] | null;
      tool_call_name?: string | null;
      tool_call_results?: ConversationMessage['tool_call_results'] | null;
    }>;
    pagination: Pagination;
  }> {
    const conversation =
      await ConversationService.findConversationRowBySessionId(session.id);
    if (!conversation) {
      throw new NoDataError('No conversation found for this session');
    }
    const roles = includeToolCalls
      ? [
          ConversationMessageRole.USER,
          ConversationMessageRole.AI,
          ConversationMessageRole.SYSTEM,
          ConversationMessageRole.TOOL_CALLS,
          ConversationMessageRole.TOOL_CALL_RESULT,
        ]
      : undefined;
    const total =
      await ConversationService.countMessagesUserAndAiForConversation(
        conversation.id,
        roles,
      );
    const offset = (page - 1) * limit;
    const messages = await ConversationService.findMessagesPaginatedUserAndAi(
      conversation.id,
      offset,
      limit,
      roles,
    );
    const total_pages = limit > 0 ? Math.ceil(total / limit) : 0;
    const pagination: Pagination = {
      current_page: page,
      limit,
      total,
      total_pages,
      ...getPaginationUrls(
        req.base_path,
        req.query_params,
        page,
        limit,
        total_pages,
      ),
    };
    return {
      data: messages.map((message) =>
        this.mapSmsInboxMessageRow(message, includeToolCalls),
      ),
      pagination,
    };
  }

  async sendSmsInboxManagerReply(
    hotelId: string,
    sessionId: string,
    body: string,
  ): Promise<void> {
    const { hotel, configuration } =
      await this.hotelService.getHotelWithConfigurationsAndChannels(hotelId);
    const session = await this.requireActiveSmsSessionForInbox(
      hotelId,
      sessionId,
    );
    if (!hotel.sms_number?.trim()) {
      throw new BadRequestError('Hotel does not have an SMS number configured');
    }
    const conversation =
      await ConversationService.findConversationRowBySessionId(session.id);
    if (!conversation) {
      throw new NoDataError('No conversation found for this session');
    }
    await this.coreManagerSmsSend(session, hotel, configuration, body);
  }

  /**
   * Send a manager reply SMS initiated from the Telegram transcript group.
   * When setDirect (Take Control): sends stepping-in notice + manager reply (2 SMS).
   * Otherwise: sends the manager reply only (1 SMS). All messages are stored in history.
   */
  /** Active in-progress SMS session for a hotel + guest (hotel_id lookup; ignores assistant phone format). */
  async getInProgressSmsSessionForHotel(
    hotelId: string,
    guestPhone: string,
  ): Promise<Session | null> {
    return this.sessionRepository.findSessionByHotelIdStatusType(
      hotelId,
      guestPhone,
      StatusUpdateType.InProgress,
      SessionType.SMS,
    );
  }

  /** True when session is DIRECT and the manager routing timeout has not expired. */
  isSessionInEffectiveDirectMode(
    session: Session,
    hotelConfig?: HotelConfiguration | null,
  ): boolean {
    const storedMode = session.chat_routing_mode ?? ChatRoutingMode.AI;
    if (storedMode !== ChatRoutingMode.DIRECT) {
      return false;
    }
    const timeoutMs = resolveManagerRoutingTimeoutSeconds(hotelConfig) * 1000;
    const updatedAt = session.chat_routing_updated_at;
    if (updatedAt && Date.now() - new Date(updatedAt).getTime() > timeoutMs) {
      return false;
    }
    return true;
  }

  async sendManagerReplySmsForPhone(
    hotel: Hotel,
    guestPhone: string,
    body: string,
    options: { setDirect?: boolean } = {},
  ): Promise<void> {
    const { setDirect = false } = options;
    if (!hotel.sms_number?.trim()) {
      throw new BadRequestError('Hotel does not have an SMS number configured');
    }
    const session = await this.sessionRepository.findSessionByHotelIdStatusType(
      hotel.id,
      guestPhone,
      StatusUpdateType.InProgress,
      SessionType.SMS,
    );
    if (!session) {
      throw new NoDataError(
        `No active SMS session found for phone ${guestPhone} at hotel ${hotel.id}`,
      );
    }
    const { configuration } =
      await this.hotelService.getHotelWithConfigurationsAndChannels(hotel.id);
    if (setDirect) {
      await this.setChatRoutingMode(session.id, ChatRoutingMode.DIRECT);
      await this.sendManagerSmsToGuest(
        session,
        hotel,
        configuration,
        managerSteppingInSmsTemplate(),
      );
    }
    await this.sendManagerSmsToGuest(session, hotel, configuration, body, {
      historyMessage: `Response from Manager: ${body}`,
    });
  }

  /**
   * DIRECT-mode manager reply: send the draft to the guest, then stepping-out SMS and AI routing.
   */
  async sendManagerReplyAndReleaseToAi(
    hotel: Hotel,
    guestPhone: string,
    body: string,
  ): Promise<void> {
    await this.sendManagerReplySmsForPhone(hotel, guestPhone, body);
    const session = await this.getInProgressSmsSessionForHotel(
      hotel.id,
      guestPhone,
    );
    if (!session) {
      throw new NoDataError(
        `No active SMS session found for phone ${guestPhone} at hotel ${hotel.id}`,
      );
    }
    await this.sendManagerHandbackNotificationToGuest(session, hotel);
  }

  /**
   * Notify the guest that the manager has handed back to Daisy (Switch to Daisy button).
   * Sends SMS and records the message in conversation history.
   */
  async sendManagerHandbackNotificationToGuest(
    session: Session,
    hotel: Hotel,
  ): Promise<void> {
    await this.setChatRoutingMode(session.id, ChatRoutingMode.AI);
    const updatedSession = await this.getSessionById(session.id);
    if (!updatedSession) {
      throw new NoDataError(`Session ${session.id} not found after handback`);
    }
    const { configuration } =
      await this.hotelService.getHotelWithConfigurationsAndChannels(hotel.id);
    await this.sendManagerSmsToGuest(
      updatedSession,
      hotel,
      configuration,
      managerSteppingOutSmsTemplate(),
    );
  }

  /**
   * Send one outbound SMS to the guest and record it in conversation history (sms:sent handler).
   */
  private async sendManagerSmsToGuest(
    session: Session,
    hotel: Hotel,
    configuration: HotelConfiguration | null,
    smsMessage: string,
    options: { historyMessage?: string } = {},
  ): Promise<void> {
    const skipTelegramNotification = true;
    const historyMessage = options?.historyMessage ?? smsMessage;
    if (!hotel.sms_number?.trim()) {
      throw new BadRequestError('Hotel does not have an SMS number configured');
    }

    await smsNotificationService.sendMessage({
      recipient: session.caller_phone_number,
      content: {
        message: smsMessage,
        from: hotel.sms_number,
        twilioConfiguration: configuration?.twilio_configuration,
      },
    });

    logger.info(
      `sendManagerSmsToGuest: Sent to ${session.caller_phone_number}: "${smsMessage.slice(0, 80)}${smsMessage.length > 80 ? '...' : ''}"`,
    );

    await this.updateSessionAfterMessaging(
      session.id,
      ConversationMessageRole.AI,
    );

    await smsEvents.emitSmsSentAndAwait({
      sessionId: session.id,
      message: historyMessage,
      from: hotel.sms_number,
      to: session.caller_phone_number,
      callerPhoneNumber: session.caller_phone_number,
      assistantPhoneNumber: session.assistant_phone_number,
      timestamp: new Date(),
      hotelSmsNumber: hotel.sms_number,
      smsAgentEnabled: configuration?.sms_agent_enabled ?? false,
      hotelId: hotel.id,
      skipTelegramNotification,
    });
  }

  /**
   * Shared core: build the outbound message, send via Twilio, bump session activity,
   * and emit sms:sent (which stores the AI message in conversation history via the event handler,
   * sends the Telegram transcript, and syncs n8n memory).
   */
  private async coreManagerSmsSend(
    session: Session,
    hotel: Hotel,
    configuration: HotelConfiguration | null,
    body: string,
  ): Promise<void> {
    const hotelLabel = hotel.name?.trim() || 'the hotel';
    const outboundMessage = `Response from the manager at ${hotelLabel}: ${body}`;
    await this.sendManagerSmsToGuest(
      session,
      hotel,
      configuration,
      outboundMessage,
    );
  }

  /** Set AI or DIRECT routing mode for a session. */
  async setChatRoutingMode(
    sessionId: string,
    mode: ChatRoutingMode,
  ): Promise<void> {
    await this.sessionRepository.setChatRouting(sessionId, mode);
  }

  /**
   * Return the effective routing mode for a session.
   * If the session is in DIRECT mode but the last manager activity is older than
   * the effective manager routing timeout (hotel override or global default),
   * the session is considered to have timed out back to AI.
   */
  async getEffectiveRoutingMode(
    callerPhoneNumber: string,
    assistantPhoneNumber: string,
  ): Promise<ChatRoutingResult> {
    console.log(
      `getEffectiveRoutingMode: callerPhoneNumber:${callerPhoneNumber} assistantPhoneNumber:${assistantPhoneNumber}`,
    );
    const hotel =
      await this.hotelService.getHotelByAssistantPhoneNumber(
        assistantPhoneNumber,
      );
    if (!hotel) {
      return { mode: ChatRoutingMode.AI, agent_may_reply: true };
    }
    const session = await this.sessionRepository.findSessionByHotelIdStatusType(
      hotel.id,
      callerPhoneNumber,
      StatusUpdateType.InProgress,
      SessionType.SMS,
    );
    if (!session) {
      console.log(`getEffectiveRoutingMode: no session`);
      return { mode: ChatRoutingMode.AI, agent_may_reply: true };
    }

    const storedMode = session.chat_routing_mode ?? ChatRoutingMode.AI;
    if (storedMode !== ChatRoutingMode.DIRECT) {
      return { mode: ChatRoutingMode.AI, agent_may_reply: true };
    }

    const hotelConfig =
      await hotelConfigurationService.getHotelConfigurationByHotelId(hotel.id);
    const timeoutMs = resolveManagerRoutingTimeoutSeconds(hotelConfig) * 1000;
    const updatedAt = session.chat_routing_updated_at;
    if (updatedAt && Date.now() - new Date(updatedAt).getTime() > timeoutMs) {
      console.log(
        `getEffectiveRoutingMode: DIRECT mode expired after ${timeoutMs}ms`,
      );
      // Auto-expire back to AI (fire-and-forget update)
      this.sessionRepository
        .setChatRouting(session.id, ChatRoutingMode.AI)
        .catch((err) => {
          logger.warn(
            `getEffectiveRoutingMode: failed to auto-expire routing mode: ${err}`,
          );
        });
      return { mode: ChatRoutingMode.AI, agent_may_reply: true };
    }

    return { mode: ChatRoutingMode.DIRECT, agent_may_reply: false };
  }

  /**
   * Combined routing-check + message storage for n8n's main SMS workflow.
   *
   * n8n calls this instead of separate GET /routing + POST /conversations.
   * - Always returns `{ mode, agent_may_reply }`.
   * - When mode is DIRECT: stores the guest message in conversation history
   *   and sends it to the Telegram transcript channel (fire-and-forget).
   * - When mode is AI: does nothing extra — n8n proceeds to the AI agent.
   */
  async handleIncomingGuestMessage(
    callerPhoneNumber: string,
    assistantPhoneNumber: string,
    message: string,
    timestamp: Date,
  ): Promise<ChatRoutingResult> {
    const routing = await this.getEffectiveRoutingMode(
      callerPhoneNumber,
      assistantPhoneNumber,
    );

    if (routing.mode === ChatRoutingMode.DIRECT) {
      // Find session + hotel for conversation storage
      const hotel =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          assistantPhoneNumber,
        );
      if (hotel) {
        const session =
          await this.sessionRepository.findSessionByHotelIdStatusType(
            hotel.id,
            callerPhoneNumber,
            StatusUpdateType.InProgress,
            SessionType.SMS,
          );
        if (session) {
          // Store USER message and send Telegram transcript (fire-and-forget).
          ConversationService.createConversationMessages(
            session.id,
            callerPhoneNumber,
            [{ role: ConversationMessageRole.USER, message, timestamp }],
            assistantPhoneNumber,
            SessionType.SMS,
            hotel.id,
            true,
            session.chat_routing_mode,
          ).catch((err: unknown) => {
            logger.error(
              `handleIncomingGuestMessage: failed to store message: ${err}`,
            );
          });
        } else {
          logger.warn(
            `handleIncomingGuestMessage: no active session for ${callerPhoneNumber} — message not stored`,
          );
        }
      }
    }

    return routing;
  }

  /** Mark SMS inbox thread as read (clears has_unread_messages for polling UI). */
  async markSmsInboxSessionRead(
    hotelId: string,
    sessionId: string,
  ): Promise<void> {
    await this.hotelService.getHotelById(hotelId);
    await this.requireActiveSmsSessionForInbox(hotelId, sessionId);
    const updated =
      await this.sessionRepository.clearSmsInboxUnreadFlag(sessionId);
    if (!updated) {
      throw new NoDataError('Session not found');
    }
  }

  private async requireActiveSmsSessionForInbox(
    hotelId: string,
    sessionId: string,
  ): Promise<Session> {
    const session = await this.sessionRepository.findSessionById(sessionId);
    if (!session || session.hotel_id !== hotelId) {
      throw new NoDataError('Session not found');
    }
    if (session.session_type !== SessionType.SMS) {
      throw new BadRequestError('Session is not an SMS session');
    }
    if (session.session_status === StatusUpdateType.Ended) {
      throw new BadRequestError('Session has ended');
    }
    return session;
  }

  private mapSmsInboxSessionRow(s: Session) {
    return {
      session_id: s.id,
      caller_phone_number: s.caller_phone_number,
      assistant_phone_number: s.assistant_phone_number,
      session_status: s.session_status,
      created_at: s.created_at,
      updated_at: s.updated_at,
      last_messaged_at: s.last_messaged_at ?? null,
      has_unread_messages: Boolean(s.has_unread_messages),
    };
  }

  private mapSmsInboxMessageRow(
    message: ConversationMessage,
    includeToolCalls = false,
  ) {
    const row = {
      id: message.id,
      role: message.role,
      message: message.message ?? '',
      timestamp: message.timestamp,
      created_at: message.created_at,
    };
    if (!includeToolCalls) {
      return row;
    }
    return {
      ...row,
      tool_calls: message.tool_calls ?? null,
      tool_call_name: message.tool_call_name ?? null,
      tool_call_results: message.tool_call_results ?? null,
    };
  }

  /**
   * Aggregate call stats per hotel, check each hotel's timezone against
   * the notification window, and send a Telegram summary to qualifying hotels.
   */
  async sendAnalyticsSummary(
    params: AnalyticsSummaryParams,
  ): Promise<AnalyticsHotelResult[]> {
    const notificationTime = params.notification_time || '21:00';
    const cronWindowMinutes = params.cron_window_minutes ?? 30;
    const now = dayjs.utc();

    const startDate = params.start_date
      ? new Date(params.start_date)
      : new Date(now.subtract(24, 'hour').toISOString());
    const endDate = params.end_date
      ? new Date(params.end_date)
      : new Date(now.toISOString());

    const summaries = await this.sessionRepository.getAnalyticsSummaryByHotel(
      startDate,
      endDate,
      params.hotel_ids,
    );

    const summaryHotelIds = summaries.map((s) => s.hotel_id);
    const idsToFetch =
      params.hotel_ids && params.hotel_ids.length > 0
        ? params.hotel_ids
        : summaryHotelIds;
    const hotels = await this.hotelService.getHotelsByIds(idsToFetch);

    const hotelMap = new Map(
      hotels.filter((h): h is Hotel => !!h).map((h) => [h.id, h]),
    );
    const results: AnalyticsHotelResult[] = [];

    for (const summary of summaries) {
      const hotel = hotelMap.get(summary.hotel_id);
      const bookingSummary =
        await this.roomReservationService.getBookingDashboardSummaryV2(
          hotel!.id,
          startDate,
          endDate,
          [
            SessionType.CALL,
            SessionType.CHAT,
            SessionType.SMS,
            SessionType.WEB,
          ],
        );
      const callSummary =
        await this.sessionRepository.getSessionsSummaryByHotelId(
          hotel!.id,
          startDate,
          endDate,
          SessionType.CALL,
        );
      const baseCounts = {
        total_calls: summary.total_calls,
        total_duration_seconds: callSummary.total_duration || 0,
        total_revenue: bookingSummary.reservations.total_revenue,
        total_amount_collected:
          bookingSummary.reservations.total_amount_collected,
        availability_enquired_calls: summary.availability_enquired_calls,
        payment_link_sent_calls: summary.payment_link_sent_calls,
        successful_reservation_calls: summary.successful_reservation_calls,
        avg_satisfaction_score: summary.avg_satisfaction_score ?? null,
        high_frustration_calls: summary.high_frustration_calls,
      };

      let skip_reason = '';
      if (!hotel) {
        skip_reason = 'hotel not found';
      } else if (!hotel.timezone) {
        skip_reason = 'no timezone configured';
      } else if (!hotel.telegram_check_in_group_id) {
        skip_reason = 'no telegram check-in group configured';
      }
      if (skip_reason) {
        results.push({
          hotel_id: hotel ? hotel.id : summary.hotel_id,
          hotel_name: hotel ? hotel.name : 'unknown',
          status: 'skipped',
          ...baseCounts,
          skip_reason,
        });
        continue;
      }

      const [targetHour, targetMinute] = notificationTime
        .split(':')
        .map(Number);
      const todayInHotelTz = now.tz(hotel!.timezone);
      const targetMoment = todayInHotelTz
        .hour(targetHour)
        .minute(targetMinute)
        .second(0)
        .millisecond(0);
      const windowStart = targetMoment.subtract(cronWindowMinutes, 'minute');
      const hotelNow = dayjs().tz(hotel!.timezone);

      const isInWindow =
        hotelNow.isAfter(windowStart) && !hotelNow.isAfter(targetMoment);

      if (!isInWindow) {
        results.push({
          hotel_id: hotel!.id,
          hotel_name: hotel!.name,
          status: 'skipped',
          ...baseCounts,
          skip_reason: `notification time ${notificationTime} not within cron window (hotel local time: ${hotelNow.format('HH:mm')})`,
        });
        continue;
      }

      const message = this.buildAnalyticsSummaryTelegramMessage(
        hotel!,
        summary,
        bookingSummary,
        callSummary,
        startDate,
        endDate,
      );

      try {
        await notificationFactory
          .getChatService(hotel!.notification_type)
          .sendMessage({
            recipient: hotel!.telegram_check_in_group_id,
            content: { message, parseMode: 'HTML' },
          });
        results.push({
          hotel_id: hotel!.id,
          hotel_name: hotel!.name,
          status: 'sent',
          ...baseCounts,
        });
      } catch (error) {
        logger.error(
          `Failed to send analytics summary Telegram for hotel ${hotel!.id}: ${error}`,
        );
        results.push({
          hotel_id: hotel!.id,
          hotel_name: hotel!.name,
          status: 'skipped',
          ...baseCounts,
          skip_reason: `telegram summary send failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        });
      }
    }

    return results;
  }

  private buildAnalyticsSummaryTelegramMessage(
    hotel: Hotel,
    summary: HotelAnalyticsSummary,
    bookingSummary: BookingSummaryV2,
    callSummary: CallAnalyticsSummary,
    startDate: Date,
    endDate: Date,
  ): string {
    const hotelName = sanitizeTelegramHTML(hotel.name);
    const start = dayjs(startDate)
      .tz(hotel.timezone)
      .format('DD/MM/YYYY HH:mm');
    const end = dayjs(endDate).tz(hotel.timezone).format('DD/MM/YYYY HH:mm');
    const pct = (count: number) =>
      summary.total_calls > 0
        ? ((count / summary.total_calls) * 100).toFixed(1)
        : '0.0';

    const avgScore =
      summary.avg_satisfaction_score != null
        ? `${Number(summary.avg_satisfaction_score).toFixed(1)}/5`
        : 'N/A';

    return [
      `Hotel: ${hotelName}`,
      `Period: ${sanitizeTelegramHTML(start)} - ${sanitizeTelegramHTML(end)}`,
      ``,
      `<b>Daily Booking Summary</b>`,
      `Total Bookings: ${bookingSummary.reservations.total}`,
      `Total Revenue: ${bookingSummary.reservations.total_revenue}`,
      `Total Amount Collected: ${bookingSummary.reservations.total_amount_collected}`,
      ``,
      `<b>Daily Calls Summary</b>`,
      `Total Calls: ${summary.total_calls}`,
      `Total Time Saved: ${Math.floor(callSummary.total_duration / 60)} min ${Math.floor(callSummary.total_duration % 60)} seconds`,
      ``,
      `Availability Enquiries: ${summary.availability_enquired_calls} (${pct(summary.availability_enquired_calls)}%)`,
      `Payment Link Sent: ${summary.payment_link_sent_calls} (${pct(summary.payment_link_sent_calls)}%)`,
      `Successful Reservations: ${summary.successful_reservation_calls} (${pct(summary.successful_reservation_calls)}%)`,
      `Frustrated Calls: ${summary.high_frustration_calls} (${pct(summary.high_frustration_calls)}%)`,
      `Avg Customer Satisfaction: ${avgScore}`,
    ].join('\n');
  }

  // ---------------------------------------------------------------------------
  // KPI metrics
  // ---------------------------------------------------------------------------

  /** GET /api/sessions/kpis — compute all 7 KPI card values for a date range. */
  async getCallKpiSummary(
    hotelId: string,
    startDate: Date,
    endDate: Date,
    reservationStatuses: ReservationStatus[] = [
      ReservationStatus.ACTIVE,
      ReservationStatus.NO_SHOW,
    ],
  ): Promise<CallKpiSummary> {
    const raw = await this.sessionRepository.getKpiSummary(
      hotelId,
      startDate,
      endDate,
      reservationStatuses,
    );

    const pct = (num: number, den: number) =>
      den > 0 ? Math.round((num / den) * 1000) / 10 : 0;

    return {
      conversion_booking_intent: pct(
        raw.booking_intent_conversions,
        raw.booking_intent_calls,
      ),
      conversion_all_calls: pct(raw.total_conversions, raw.total_calls),
      resolution_rate_meaningful_intent: pct(
        raw.resolved_meaningful,
        raw.meaningful_calls,
      ),
      resolution_rate_all_calls: pct(
        raw.total_calls - raw.total_escalated,
        raw.total_calls,
      ),
      resolution_rate_meaningful_forwarding: pct(
        raw.resolved_meaningful_fwd,
        raw.meaningful_calls,
      ),
      resolution_rate_all_forwarding: pct(
        raw.total_calls - raw.forwarded_calls,
        raw.total_calls,
      ),
      agent_adr:
        raw.room_nights > 0
          ? Math.round((raw.total_revenue / raw.room_nights) * 100) / 100
          : 0,
      escalation_rate: pct(raw.total_escalated, raw.total_calls),
      escalation_rate_forwarding: pct(raw.forwarded_calls, raw.total_calls),
      room_nights: raw.room_nights,
      forwarded_calls: raw.forwarded_calls,
      booking_intent_calls: raw.booking_intent_calls,
    };
  }

  /** GET /api/sessions/kpis/trend — chart series for revenue, resolution, and conversion. */
  async getKpiTrend(
    hotelId: string,
    startDate: Date,
    endDate: Date,
    reservationStatuses: ReservationStatus[] = [
      ReservationStatus.ACTIVE,
      ReservationStatus.NO_SHOW,
    ],
  ): Promise<KpiTrendResponse> {
    const hotel = await this.hotelService.getHotelById(hotelId);
    const [rateRows, revenueRows] = await Promise.all([
      this.sessionRepository.getKpiTrendRates(hotelId, startDate, endDate),
      this.sessionRepository.getKpiTrendRevenue(
        hotelId,
        startDate,
        endDate,
        reservationStatuses,
      ),
    ]);

    const days = generateDaySequence(startDate, endDate, hotel.timezone);
    const callsByDay = new Map<string, number>(
      rateRows.map((r) => [r.day, r.total_calls]),
    );

    return [
      ...buildBookingRevenueSeries(days, revenueRows, callsByDay),
      ...buildResolutionRateSeries(days, rateRows, callsByDay),
      ...buildConversionRateSeries(days, rateRows, revenueRows, callsByDay),
    ];
  }
}

// ---------------------------------------------------------------------------
// KPI trend helpers (module-level, not on the class)
// ---------------------------------------------------------------------------

/** Returns every hotel-local calendar day in the range as "YYYY-MM-DD" strings (inclusive). */
function generateDaySequence(
  startDate: Date,
  endDate: Date,
  timezone: string,
): string[] {
  const days: string[] = [];
  let cursor = dayjs(startDate).tz(timezone).startOf('day');
  const last = dayjs(endDate).tz(timezone).startOf('day');
  while (cursor.isBefore(last) || cursor.isSame(last, 'day')) {
    days.push(cursor.format('YYYY-MM-DD'));
    cursor = cursor.add(1, 'day');
  }
  return days;
}

function pctRound(num: number, den: number): number {
  return den > 0 ? Math.round((num / den) * 1000) / 10 : 0;
}

function makeRateSeries(
  metric: string,
  label: string,
  days: string[],
  valueByDay: Map<string, number>,
  numeratorByDay: Map<string, number>,
  denominatorByDay: Map<string, number>,
  callsByDay: Map<string, number>,
): KpiTrendSeries {
  return {
    metric,
    label,
    unit: 'percent',
    data: days.map(
      (date): KpiTrendPoint => ({
        date,
        value: valueByDay.get(date) ?? 0,
        num_of_calls: callsByDay.get(date) ?? 0,
        numerator: numeratorByDay.get(date) ?? 0,
        denominator: denominatorByDay.get(date) ?? 0,
      }),
    ),
  };
}

function makeSeries(
  metric: string,
  label: string,
  unit: 'percent' | 'currency',
  days: string[],
  valueByDay: Map<string, number>,
  callsByDay: Map<string, number>,
): KpiTrendSeries {
  return {
    metric,
    label,
    unit,
    data: days.map(
      (date): KpiTrendPoint => ({
        date,
        value: valueByDay.get(date) ?? 0,
        num_of_calls: callsByDay.get(date) ?? 0,
      }),
    ),
  };
}

function buildBookingRevenueSeries(
  days: string[],
  revenueRows: KpiTrendRevenueRow[],
  callsByDay: Map<string, number>,
): KpiTrendSeries[] {
  const totalByDay = new Map<string, number>();
  const advanceByDay = new Map<string, number>();
  for (const row of revenueRows) {
    totalByDay.set(row.day, row.total_revenue);
    advanceByDay.set(row.day, row.advance_collected);
  }
  return [
    makeSeries(
      'booking_revenue_total',
      'Booking Revenue',
      'currency',
      days,
      totalByDay,
      callsByDay,
    ),
    makeSeries(
      'booking_revenue_advance',
      'Advance Collected',
      'currency',
      days,
      advanceByDay,
      callsByDay,
    ),
  ];
}

function buildResolutionRateSeries(
  days: string[],
  rateRows: KpiTrendRateRow[],
  callsByDay: Map<string, number>,
): KpiTrendSeries[] {
  const allByDay = new Map<string, number>();
  const allForwardingByDay = new Map<string, number>();
  const allNumByDay = new Map<string, number>();
  const allForwardingNumByDay = new Map<string, number>();

  for (const row of rateRows) {
    const resolvedAll = row.total_calls - row.escalated_calls;
    const resolvedAllForwarding = row.total_calls - row.forwarded_calls;

    allNumByDay.set(row.day, resolvedAll);
    allByDay.set(row.day, pctRound(resolvedAll, row.total_calls));

    allForwardingNumByDay.set(row.day, resolvedAllForwarding);
    allForwardingByDay.set(
      row.day,
      pctRound(resolvedAllForwarding, row.total_calls),
    );
  }

  return [
    makeRateSeries(
      'resolution_rate_all_calls',
      'Resolution Rate (All Calls)',
      days,
      allByDay,
      allNumByDay,
      callsByDay,
      callsByDay,
    ),
    makeRateSeries(
      'resolution_rate_all_forwarding',
      'Resolution Rate (All Calls, Forwarding Only)',
      days,
      allForwardingByDay,
      allForwardingNumByDay,
      callsByDay,
      callsByDay,
    ),
  ];
}

function buildConversionRateSeries(
  days: string[],
  rateRows: KpiTrendRateRow[],
  revenueRows: KpiTrendRevenueRow[],
  callsByDay: Map<string, number>,
): KpiTrendSeries[] {
  const convertedCallsByDay = new Map<string, number>(
    revenueRows.map((r) => [r.day, r.converted_calls]),
  );
  const intentConversionsByDay = new Map<string, number>(
    revenueRows.map((r) => [r.day, r.booking_intent_conversions]),
  );
  const intentByDay = new Map<string, number>();
  const allByDay = new Map<string, number>();
  const intentNumByDay = new Map<string, number>();
  const intentDenByDay = new Map<string, number>();
  const allNumByDay = new Map<string, number>();

  for (const row of rateRows) {
    const convertedCalls = convertedCallsByDay.get(row.day) ?? 0;
    const intentConversions = intentConversionsByDay.get(row.day) ?? 0;

    intentNumByDay.set(row.day, intentConversions);
    intentDenByDay.set(row.day, row.new_reservation_calls);
    intentByDay.set(
      row.day,
      pctRound(intentConversions, row.new_reservation_calls),
    );

    allNumByDay.set(row.day, convertedCalls);
    allByDay.set(row.day, pctRound(convertedCalls, row.total_calls));
  }
  return [
    makeRateSeries(
      'conversion_rate_booking_intent',
      'Conversion Rate (Booking Intent)',
      days,
      intentByDay,
      intentNumByDay,
      intentDenByDay,
      callsByDay,
    ),
    makeRateSeries(
      'conversion_rate_all_calls',
      'Conversion Rate (All Calls)',
      days,
      allByDay,
      allNumByDay,
      callsByDay,
      callsByDay,
    ),
  ];
}

const getSessionService = () => {
  return new SessionService({
    hotelService: hotelService,
    roomReservationService: roomReservationService,
  });
};
export default getSessionService();
