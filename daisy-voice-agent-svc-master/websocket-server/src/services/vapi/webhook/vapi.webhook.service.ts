import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import config from '../../../config';
import { Reservation as ReservationDTO } from '../../../dtos/Reservation';
import { ConversationMessageRole } from '../../../dtos/enum/ConversationMessageRole';
import { SessionType } from '../../../dtos/enum/SessionType';
import { NoDataError } from '../../../errors/NoDataError';
import { VapiError } from '../../../errors/VapiError';
import { smsEvents } from '../../../events/smsEvents';
import { ConversationWithMessages as ConversationWithMessagesModel } from '../../../models/Conversation';
import { Hotel as HotelModel } from '../../../models/Hotel';
import { HotelConfiguration } from '../../../models/HotelConfiguration';
import { Session as SessionModel } from '../../../models/Session';
import {
  CallTransferRequest,
  CustomerSentiment,
  EndOfCallStatus,
  GuestIntent,
  MessageObject,
  MessageRole,
} from '../../../models/request/EndOfCallReport';
import {
  StatusUpdateObject,
  StatusUpdateType,
} from '../../../models/request/StatusUpdate';
import { VapiSessionCreatedPayload } from '../../../models/request/sessionCreated';
import { DiscountType } from '../../../types/discount';
import {
  convertToPhoneNumber,
  formatCurrencyAmount,
} from '../../../utils/helper';
import { createHttpClient } from '../../../utils/httpClient';
import { KpiStat, logKpi } from '../../../utils/kpiLogger';
import logger from '../../../utils/logger';
import { appendSmsToSmsAgentTranscript } from '../../../utils/smsAgentUtils';
import { callForwardingHelper } from '../../callForwarding/callForwardingHelper';
import conversationService, {
  ConversationService,
} from '../../conversation/ConversationService';
import {
  discountService,
  DiscountService,
} from '../../discount/discountService';
import escalationService, {
  EscalationService,
} from '../../escalation/escalationService';
import { FollowupPaymentLinkService } from '../../followupPaymentLink/followupPaymentLinkService';
import { hotelService, HotelService } from '../../hotel/hotelService';
import {
  hotelConfigurationService,
  HotelConfigurationService,
} from '../../hotelConfiguration/hotelConfigurationService';
import { discountSMSTemplate } from '../../messaging/messageTemplates';
import {
  ChatServiceResolver,
  notificationFactory,
} from '../../notification/notificationFactory';
import { SMSNotificationService } from '../../notification/smsNotificationService';
import {
  NotificationPayload,
  NotificationSMSContent,
} from '../../notification/types';
import roomReservationService, {
  RoomReservationService,
} from '../../roomReservation/roomReservationService';
import sessionService, { SessionService } from '../../session/SessionService';
import {
  CallCompletionMessage,
  callCompletionTemplate,
} from '../constants/telegramTemplates/callCompletionTemplate';
import {
  persistCallRecordingToS3,
  resolveRecordingUrlFromVapiPayload,
} from '../recordingUpload';

dayjs.extend(utc);
dayjs.extend(timezone);
interface VapiWebhookServiceProps {
  assistantServerToken: string;
  conversationService: ConversationService;
  sessionService: SessionService;
  roomReservationService: RoomReservationService;
  escalationService: EscalationService;
  hotelService: HotelService;
  notificationFactory: ChatServiceResolver;
  smsService: SMSNotificationService;
  discountService: DiscountService;
  hotelConfigurationService: HotelConfigurationService;
  followupPaymentLinkService: FollowupPaymentLinkService;
}
const vapiHttpClient = createHttpClient('vapi', {
  headers: { 'Content-Type': 'application/json' },
});

const CALLER_INTENT_OUTPUT_NAME = 'Caller Intent';
const CUSTOMER_SATISFACTION_OUTPUT_NAME = 'Customer Satisfaction';
const CUSTOMER_FRUSTRATION_SCORE_OUTPUT_NAME = 'Customer Frustration Score';
const AVAILABILITY_ENQUIRED_OUTPUT_NAME = 'Availability Enquired';
const PAYMENT_LINK_SENT_OUTPUT_NAME = 'Payment Link Sent';
const FOLLOWUP_AVAILABILITY_OUTPUT_NAME = 'Followup Availability';

/**
 * Structured outputs expected on every call regardless of hotel config, used
 * to determine whether a hotel's full expected set is present; see
 * `expectedOutputNames` in `handleEndOfCallReport`.
 */
const UNIVERSAL_STRUCTURED_OUTPUT_NAMES = [
  CUSTOMER_SATISFACTION_OUTPUT_NAME,
  CUSTOMER_FRUSTRATION_SCORE_OUTPUT_NAME,
  CALLER_INTENT_OUTPUT_NAME,
];

/**
 * Structured outputs only enabled on a hotel's Vapi assistant when
 * `followup_payment_link_configuration.enabled` is set — see
 * `STRUCTURED_OUTPUT_REGISTRY` in vapiAssistantService.ts, which is the
 * source of truth for this gating and must stay in sync with this list.
 */
const FOLLOWUP_PAYMENT_LINK_STRUCTURED_OUTPUT_NAMES = [
  AVAILABILITY_ENQUIRED_OUTPUT_NAME,
  PAYMENT_LINK_SENT_OUTPUT_NAME,
  FOLLOWUP_AVAILABILITY_OUTPUT_NAME,
];

/** Prefer VAPI artifact structuredOutputs "Caller Intent"; fall back to analysis.structuredData.intent. */
function resolveGuestIntentFromVapiPayload(
  structuredOutputs:
    | Record<string, { name?: string; result?: unknown }>
    | undefined,
  legacyIntent: GuestIntent[] | string | undefined,
): string {
  const callerIntentOutput = structuredOutputs
    ? Object.values(structuredOutputs).find(
        (output) => output?.name === CALLER_INTENT_OUTPUT_NAME,
      )
    : undefined;

  const result = callerIntentOutput?.result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const intents = Object.entries(result as Record<string, unknown>)
      .filter(
        ([key, value]) =>
          (value === true || value === 'true') &&
          (Object.values(GuestIntent) as string[]).includes(key),
      )
      .map(([key]) => key);
    return intents.join(',');
  }

  if (!legacyIntent) {
    return '';
  }
  if (Array.isArray(legacyIntent)) {
    return legacyIntent.join(',');
  }
  return legacyIntent;
}

export class VapiWebhookService {
  private assistantServerToken: string;
  private conversationService: ConversationService;
  private sessionService: SessionService;
  private roomReservationService: RoomReservationService;
  private escalationService: EscalationService;
  private hotelService: HotelService;
  private notificationFactory: ChatServiceResolver;
  private smsService: SMSNotificationService;
  private roleMap: Record<MessageRole, ConversationMessageRole>;
  private discountService: DiscountService;
  private hotelConfigurationService: HotelConfigurationService;
  private followupPaymentLinkService: FollowupPaymentLinkService;

  constructor({
    assistantServerToken,
    conversationService,
    sessionService,
    roomReservationService,
    escalationService,
    hotelService,
    notificationFactory,
    smsService,
    discountService,
    hotelConfigurationService,
    followupPaymentLinkService,
  }: VapiWebhookServiceProps) {
    if (!assistantServerToken) {
      throw new Error('VAPI_ASSISTANT_SERVER_TOKEN is required');
    }
    this.assistantServerToken = assistantServerToken;
    this.conversationService = conversationService;
    this.sessionService = sessionService;
    this.roomReservationService = roomReservationService;
    this.escalationService = escalationService;
    this.hotelService = hotelService;
    this.notificationFactory = notificationFactory;
    this.smsService = smsService;
    this.discountService = discountService;
    this.hotelConfigurationService = hotelConfigurationService;
    this.followupPaymentLinkService = followupPaymentLinkService;
    this.roleMap = {
      [MessageRole.User]: ConversationMessageRole.USER,
      [MessageRole.Bot]: ConversationMessageRole.AI,
      [MessageRole.System]: ConversationMessageRole.SYSTEM,
      [MessageRole.ToolCallResult]: ConversationMessageRole.TOOL_CALL_RESULT,
      [MessageRole.ToolCalls]: ConversationMessageRole.TOOL_CALLS,
    };
  }

  private getCallStatusType(status: string): StatusUpdateType {
    switch (status) {
      case 'in-progress':
        return StatusUpdateType.InProgress;
      case 'ended':
        return StatusUpdateType.Ended;
      default:
        logger.warn(`Unknown Vapi call status: ${status}`);
        return StatusUpdateType.InProgress;
    }
  }

  // Using the common utility function instead of a class method

  /**
   * Handles incoming Vapi webhook events
   */
  public async handleWebhookEvent(
    payload: any,
    signature: string,
  ): Promise<void> {
    if (signature !== this.assistantServerToken) {
      logger.warn(`Invalid Vapi webhook signature: ${signature}`);
      return;
    }

    try {
      const event = payload;
      await this.processVapiEvent(event);
    } catch (error) {
      const err = error as Error;
      logger.error(`Vapi webhook processing failed: ${err.message}`);
      throw error;
    }
  }

  private getRole(msgRole: string): ConversationMessageRole {
    const role = this.roleMap[msgRole as MessageRole];
    if (role) return role;

    logger.warn(`Unknown Vapi message role: ${msgRole}`);
    return ConversationMessageRole.SYSTEM;
  }

  /**
   * Processes different types of Vapi events
   */
  private async processVapiEvent(event: any): Promise<void> {
    logger.debug(`Processing Vapi event: ${JSON.stringify(event)}`);

    const eventType = event.message.type;
    logger.info(`Received Vapi event type: ${eventType}`);

    switch (eventType) {
      case 'status-update':
        await this.handleStatusUpdate(event);
        break;
      case 'transcript':
        await this.handleTranscript(event);
        break;
      case 'end-of-call-report':
        await this.handleEndOfCallReport(event);
        break;
      case 'transfer-destination-request':
        await this.handleTransferDestinationRequest(event);
        break;
      case 'session.created':
        await this.handleSessionCreated(event);
        break;
      default:
        logger.warn(`Unhandled Vapi event type: ${eventType}`);
    }
  }

  /**
   * Handles session.created event.
   */
  private async handleSessionCreated(
    eventData: VapiSessionCreatedPayload,
  ): Promise<void> {
    const variableValues = eventData?.message?.assistant?.variableValues || {};
    const customerNumber = variableValues?.customer?.number || '';
    const assistantPhoneNumber = variableValues?.assistant_phone_number || '';
    const sessionType = variableValues?.session_type || '';
    const isChatSession = sessionType === SessionType.CHAT;

    logger.info('Vapi session.created event received', {
      session_type: sessionType,
      has_customer_number: !!customerNumber,
      has_assistant_phone: !!assistantPhoneNumber,
    });

    if (!customerNumber) {
      logger.info(
        'session.created: customer_number / customer.number not provided in variableValues, skipping session creation',
      );
      return;
    }
    if (!assistantPhoneNumber) {
      logger.info(
        'session.created: assistant_phone_number not provided in variableValues, skipping session creation',
      );
      return;
    }
    if (!isChatSession) {
      logger.info(
        `session.created: session_type is not CHAT (got: ${sessionType || ''}), skipping session creation`,
      );
      return;
    }

    const assistantPhone = convertToPhoneNumber(
      typeof assistantPhoneNumber === 'string'
        ? assistantPhoneNumber
        : String(assistantPhoneNumber),
    );
    if (!assistantPhone) {
      logger.info(
        'session.created: assistant_phone_number could not be normalized, skipping session creation',
      );
      return;
    }

    try {
      const { session, status } = await this.sessionService.createSession({
        caller_phone_number:
          typeof customerNumber === 'string'
            ? customerNumber
            : String(customerNumber),
        assistant_phone_number: assistantPhone,
        session_type: SessionType.CALL,
        session_status: StatusUpdateType.InProgress,
      });
      logger.info(`session.created: session created`, {
        sessionId: session.id,
        status,
      });
    } catch (error) {
      logger.error('session.created: failed to create session', {
        error,
        eventData,
      });
      throw error;
    }
  }

  /**
   * Handles a status update event
   */
  private async handleStatusUpdate(
    eventData: StatusUpdateObject,
  ): Promise<void> {
    const rawStatus = eventData?.message?.status;
    logger.info('Vapi status update received', {
      status: rawStatus,
      call_id: eventData?.message?.call?.id,
    });
    const status = this.getCallStatusType(rawStatus || '');
    const assistantPhoneNumber = eventData?.message?.phoneNumber?.number || '';

    try {
      const sessionData = {
        external_provider_id: eventData?.message?.call?.id || '',
        caller_phone_number: eventData?.message?.call?.customer?.number || '',
        assistant_phone_number: assistantPhoneNumber,
        session_status: status,
        session_type: SessionType.CALL,
      };
      await this.sessionService.upsertSessionData(sessionData);

      // Gate on the raw Vapi status, not getCallStatusType's return value:
      // that helper narrows every pre-answer status (queued, ringing) to
      // InProgress because a session is only ever alive-or-ended, which is
      // right for persistence but would emit call.started once per
      // pre-answer event instead of once per call.
      // Logged after the upsert because upsertSessionData throws for a
      // redelivered "ended" update, which should not double-count.
      if (rawStatus === StatusUpdateType.InProgress) {
        logKpi({
          stat: KpiStat.CallStarted,
          value: 1,
          contextName: 'VapiWebhookService.handleStatusUpdate',
          clientId: assistantPhoneNumber,
        });
      } else if (rawStatus === StatusUpdateType.Ended) {
        logKpi({
          stat: KpiStat.CallEnded,
          value: 1,
          contextName: 'VapiWebhookService.handleStatusUpdate',
          clientId: assistantPhoneNumber,
        });
      }
    } catch (error) {
      logger.error('Failed to process status update for session storage', {
        error,
      });
      throw error;
    }
  }

  /**
   * Handles a transcript event
   */
  private async handleTranscript(eventData: any): Promise<void> {
    logger.debug('Vapi transcript received', { eventData });

    const transcript = eventData?.message?.transcript;
    const role = eventData?.message?.role;

    if (transcript) {
      logger.debug(`Vapi live transcript`, { role, transcript });
    }
  }

  /**
   * Handles a completed call event
   */
  private async handleEndOfCallReport(
    eventData: EndOfCallStatus,
  ): Promise<void> {
    try {
      const eventMessage = eventData?.message;
      const messagesRaw = eventMessage?.messages || [];
      logger.info('Vapi end of call report received', {
        call_id: eventMessage?.call?.id,
        message_count: messagesRaw.length,
        cost: eventMessage?.cost,
        phone_suffix: eventMessage?.customer?.number?.slice(-4),
      });
      const phone_number = convertToPhoneNumber(
        eventMessage?.customer?.number || '',
      );
      const call_session_id = eventMessage?.call?.id || '';
      const call_metadata = eventMessage?.call || undefined;
      const cost_details = eventMessage?.costBreakdown || undefined;
      const started_at = eventMessage?.startedAt
        ? new Date(eventMessage.startedAt)
        : messagesRaw.length > 0
          ? new Date(messagesRaw[0].time)
          : new Date();
      const ended_at = eventMessage?.endedAt
        ? new Date(eventMessage.endedAt)
        : messagesRaw.length > 1
          ? new Date(
              messagesRaw[messagesRaw.length - 1].endTime ||
                messagesRaw[messagesRaw.length - 1].time,
            )
          : started_at;
      const cost = eventMessage?.cost || 0;
      const vapiRecordingUrl = resolveRecordingUrlFromVapiPayload(eventMessage);
      const summary = eventMessage?.analysis?.summary;
      const structuredOutputs = eventMessage?.artifact?.structuredOutputs as
        | Record<string, any>
        | undefined;
      const rawSatisfactionScore = structuredOutputs
        ? Object.values(structuredOutputs).find(
            (output) => output?.name === CUSTOMER_SATISFACTION_OUTPUT_NAME,
          )?.result
        : undefined;
      const guest_satisfaction_score: number | undefined =
        typeof rawSatisfactionScore === 'number'
          ? rawSatisfactionScore
          : undefined;
      const rawSentiment = structuredOutputs
        ? Object.values(structuredOutputs).find(
            (output) => output?.name === 'Customer Sentiment',
          )?.result
        : undefined;
      const customerSentiment: CustomerSentiment =
        Object.values(CustomerSentiment).find((s) => s === rawSentiment) ??
        CustomerSentiment.UNKNOWN;

      const rawFrustrationScore = structuredOutputs
        ? Object.values(structuredOutputs).find(
            (output) => output?.name === CUSTOMER_FRUSTRATION_SCORE_OUTPUT_NAME,
          )?.result
        : undefined;
      const scoreValue =
        typeof rawFrustrationScore === 'string' &&
        rawFrustrationScore.trim() !== ''
          ? Number(rawFrustrationScore)
          : rawFrustrationScore;
      const parsedFrustrationScore =
        typeof scoreValue === 'number' && !isNaN(scoreValue)
          ? scoreValue
          : undefined;
      const customerFrustrationScore: number | undefined =
        parsedFrustrationScore !== undefined &&
        parsedFrustrationScore >= 1 &&
        parsedFrustrationScore <= 10
          ? parsedFrustrationScore
          : undefined;

      const rawAvailabilityEnquired = structuredOutputs
        ? Object.values(structuredOutputs).find(
            (output) => output?.name === AVAILABILITY_ENQUIRED_OUTPUT_NAME,
          )?.result
        : undefined;
      const availabilityEnquired: boolean =
        rawAvailabilityEnquired === true || rawAvailabilityEnquired === 'true';

      const rawPaymentLinkSent = structuredOutputs
        ? Object.values(structuredOutputs).find(
            (output) => output?.name === PAYMENT_LINK_SENT_OUTPUT_NAME,
          )?.result
        : undefined;
      const paymentLinkSent: boolean =
        rawPaymentLinkSent === true || rawPaymentLinkSent === 'true';

      const rawFollowupAvailability = structuredOutputs
        ? Object.values(structuredOutputs).find(
            (output) => output?.name === FOLLOWUP_AVAILABILITY_OUTPUT_NAME,
          )?.result
        : undefined;
      const followupAvailability =
        rawFollowupAvailability &&
        typeof rawFollowupAvailability === 'object' &&
        typeof (rawFollowupAvailability as Record<string, unknown>).check_in ===
          'string' &&
        typeof (rawFollowupAvailability as Record<string, unknown>)
          .check_out === 'string' &&
        typeof (rawFollowupAvailability as Record<string, unknown>)
          .num_adults === 'number'
          ? {
              check_in: (rawFollowupAvailability as Record<string, unknown>)
                .check_in as string,
              check_out: (rawFollowupAvailability as Record<string, unknown>)
                .check_out as string,
              num_adults: (rawFollowupAvailability as Record<string, unknown>)
                .num_adults as number,
              num_children: (typeof (
                rawFollowupAvailability as Record<string, unknown>
              ).num_children === 'number'
                ? (rawFollowupAvailability as Record<string, unknown>)
                    .num_children
                : 0) as number,
              num_pets: (typeof (
                rawFollowupAvailability as Record<string, unknown>
              ).num_pets === 'number'
                ? (rawFollowupAvailability as Record<string, unknown>).num_pets
                : 0) as number,
            }
          : undefined;

      // A named output can be present with no result (e.g. call ended before
      // extraction ran) — that's routine call-to-call variation, not config
      // drift. Check for the name itself so *_Present only stops firing when
      // Vapi's assistant config for this hotel no longer defines the output.
      const hasStructuredOutput = (name: string): boolean =>
        structuredOutputs
          ? Object.values(structuredOutputs).some(
              (output) => output?.name === name,
            )
          : false;
      const guest_intent = resolveGuestIntentFromVapiPayload(
        structuredOutputs,
        eventMessage?.analysis?.structuredData?.intent,
      );

      const messages = messagesRaw?.map((msg: MessageObject) => ({
        role: this.getRole(msg.role),
        message: msg.message,
        tool_calls: msg.toolCalls,
        tool_call_name: msg.name,
        tool_call_results: msg.result,
        timestamp: msg.time ? new Date(msg.time) : new Date(),
      }));

      const session =
        await this.sessionService.getSessionByExternalProviderId(
          call_session_id,
        );
      if (!session) {
        logger.warn(
          `Session not found for external provider id: ${call_session_id}`,
        );
        return;
      }

      const hotel = await this.hotelService.getHotelByAssistantPhoneNumber(
        session.assistant_phone_number,
      );
      if (!hotel) {
        const errorMessage = `Error while processing end of call report: Hotel is not configured for phone number ${session.assistant_phone_number}`;
        logger.error(errorMessage);
        throw new NoDataError(errorMessage);
      }

      // Fetched with a local fallback rather than letting a lookup failure
      // propagate: this result only gates a KPI check and later SMS/discount
      // logic below, none of which should block persisting the call
      // recording, conversation, and session metadata further down.
      let hotelConfiguration: HotelConfiguration | null = null;
      try {
        hotelConfiguration =
          await this.hotelConfigurationService.getHotelConfigurationByHotelId(
            hotel.id,
          );
      } catch (err) {
        logger.error(
          'Failed to fetch hotel configuration for end-of-call-report; continuing without it',
          { hotelId: hotel.id, err },
        );
      }

      // Vapi's structured-output config can be edited per-hotel independently
      // of this code; if an output is removed there, the corresponding flag
      // silently defaults to false/null instead of erroring. Log one
      // presence check across the outputs actually expected for this hotel
      // (universal ones plus followup-payment-link ones, only when that
      // feature is enabled) so a config change shows up as this metric
      // going false, instead of a zeroed digest count noticed days later.
      const expectedOutputNames = hotelConfiguration
        ?.followup_payment_link_configuration?.enabled
        ? [
            ...UNIVERSAL_STRUCTURED_OUTPUT_NAMES,
            ...FOLLOWUP_PAYMENT_LINK_STRUCTURED_OUTPUT_NAMES,
          ]
        : UNIVERSAL_STRUCTURED_OUTPUT_NAMES;
      logKpi({
        stat: KpiStat.VapiStructuredOutputsAllPresent,
        value: expectedOutputNames.every(hasStructuredOutput) ? 1 : 0,
        contextName: 'VapiWebhookService.handleEndOfCallReport',
        clientId: hotel.assistant_phone_number,
      });
      if (guest_intent.trim() === '') {
        logKpi({
          stat: KpiStat.VapiGuestIntentUnresolved,
          value: 1,
          contextName: 'VapiWebhookService.handleEndOfCallReport',
          clientId: hotel.assistant_phone_number,
        });
      }

      let recording_url: string | undefined;
      if (vapiRecordingUrl) {
        try {
          recording_url = await persistCallRecordingToS3(
            vapiRecordingUrl,
            hotel.id,
            session.id,
            call_session_id,
          );
        } catch (err) {
          // Private/HIPAA webhook URLs are not playable anonymously; still
          // persist the URL for audit and rely on authenticated re-download later.
          logger.error('S3 recording upload failed, falling back to VAPI URL', {
            sessionId: session.id,
            callId: call_session_id,
            err,
          });
          recording_url = vapiRecordingUrl;
          logKpi({
            stat: KpiStat.VapiRecordingS3UploadFailed,
            value: 1,
            contextName: 'VapiWebhookService.handleEndOfCallReport',
            clientId: hotel.assistant_phone_number,
            contextId: session.id,
          });
        }
      } else {
        logKpi({
          stat: KpiStat.VapiRecordingUrlMissing,
          value: 1,
          contextName: 'VapiWebhookService.handleEndOfCallReport',
          clientId: hotel.assistant_phone_number,
          contextId: session.id,
        });
      }

      // Prepare conversation object (excluding id, created_at, updated_at)
      const conversation: Omit<
        ConversationWithMessagesModel,
        'id' | 'created_at' | 'updated_at'
      > = {
        phone_number: convertToPhoneNumber(phone_number || '') || '',
        hotel_id: hotel.id,
        started_at,
        ended_at,
        cost,
        recording_url,
        summary,
        messages,
        metadata: call_metadata,
        cost_details,
        intent: guest_intent,
        conversation_session_id: session.id,
      };

      // Insert conversation and messages
      await this.conversationService.createConversationWithMessages(
        conversation,
      );
      logger.info(
        'Conversation and messages inserted from VAPI end-of-call-report',
      );

      const endedReason = eventMessage?.endedReason;
      await this.sessionService.updateSessionMetadata(session.id, {
        availability_enquired: availabilityEnquired,
        payment_link_sent: paymentLinkSent,
        customer_satisfaction_score: guest_satisfaction_score ?? null,
        customer_frustration_score: customerFrustrationScore ?? null,
        call_forwarded: endedReason === 'assistant-forwarded-call',
      });

      if (summary && hotelConfiguration?.sms_agent_enabled) {
        try {
          const { session: smsSession } =
            await this.sessionService.createSession({
              caller_phone_number: phone_number || '',
              assistant_phone_number: session.assistant_phone_number,
              session_type: SessionType.SMS,
              session_status: StatusUpdateType.InProgress,
            });

          await this.conversationService.createConversationMessages(
            smsSession.id,
            phone_number || '',
            [
              {
                role: ConversationMessageRole.AI,
                message: summary,
                timestamp: new Date(),
              },
            ],
            session.assistant_phone_number,
            SessionType.SMS,
            hotel.id,
            false,
          );
          logger.info(
            `SMS session created and conversation summary inserted: smsSessionId=${smsSession.id}`,
          );

          await appendSmsToSmsAgentTranscript(hotel.id, {
            customer_phone_number: phone_number || '',
            assistant_phone_number: session.assistant_phone_number,
            assistant_sms_number: hotel.sms_number,
            sms_body: summary,
          });
        } catch (error) {
          logger.error(
            `Failed to create SMS session or insert conversation summary: ${error}`,
          );
        }

        await this.handleNegativeSentimentFollowup(
          customerSentiment,
          hotelConfiguration,
          phone_number || '',
          hotel,
          session,
        );
      }

      const recordingProxyLink =
        config.PUBLIC_URL +
        '/sessions/' +
        session.id +
        '/conversations/recording';
      // Trigger telegram message after call completion
      const escalations =
        await this.escalationService.getEscalationsBySessionId(session.id);
      const message: CallCompletionMessage = {
        phoneNumber: conversation.phone_number,
        callStartTime: conversation.started_at,
        callEndTime: conversation.ended_at,
        callbackRequest: escalations.map((e) => e.message),
        summary: conversation.summary,
        recordingLink: recordingProxyLink,
        bookingDetails: [],
      };

      let reservations: ReservationDTO[] = [];

      try {
        reservations =
          await this.roomReservationService.getReservationDetailsBySessionId(
            session.id,
          );

        // Filter multi-room reservations: they share the same booking ID prefix (before the underscore)
        // Format: <common-booking-id>_<suffix>
        const multiRoomReservationsMap = new Map<string, ReservationDTO[]>();
        const singleRoomReservations: ReservationDTO[] = [];

        for (const reservation of reservations) {
          const bookingId = reservation.booking_id;
          const underscoreIndex = bookingId.lastIndexOf('_');

          if (underscoreIndex > 0) {
            const prefix = bookingId.substring(0, underscoreIndex);

            // Group by common prefix, regardless of suffix
            if (!multiRoomReservationsMap.has(prefix)) {
              multiRoomReservationsMap.set(prefix, []);
            }
            multiRoomReservationsMap.get(prefix)!.push(reservation);
          } else {
            singleRoomReservations.push(reservation);
          }
        }

        // Process multi-room reservations (groups with more than 1 reservation)
        const multiRoomGroups = Array.from(
          multiRoomReservationsMap.values(),
        ).filter((group) => group.length > 1);

        if (multiRoomGroups?.length > 0) {
          for (const multiRoomReservation of multiRoomGroups) {
            if (multiRoomReservation?.length == 0) continue;

            const firstReservation = multiRoomReservation[0];
            let numAdults = 0;
            let numChildren = 0;
            let numPets = 0;
            let rateTotal = 0;
            let booking_ids = '';
            let external_ids = '';
            let external_public_ids = '';
            let advance = 0;
            for (const reservation of multiRoomReservation) {
              numAdults += reservation.num_adults;
              numChildren += reservation.num_children;
              numPets += reservation.num_pets ?? 0;
              rateTotal +=
                (reservation.quote?.base_rate ?? 0) +
                (reservation.quote?.taxes ?? 0) +
                (reservation.quote?.fees ?? 0);
              booking_ids += reservation.booking_id + ',';
              if (reservation.external_id) {
                external_ids += reservation.external_id + ',';
              }
              if (reservation.external_public_id) {
                external_public_ids += reservation.external_public_id + ',';
              }
              advance += reservation.quote?.amount_charged ?? 0;
            }
            message.bookingDetails!.push({
              id: booking_ids,
              external_id: external_ids,
              external_public_id: external_public_ids,
              guestFirstName: firstReservation.customer?.first_name,
              guestLastName: firstReservation.customer?.last_name,
              noOfAdults: numAdults,
              noOfChildren: numChildren,
              noOfPets: numPets,
              startDate: new Date(firstReservation.check_in),
              endDate: new Date(firstReservation.check_out),
              rateTotal: rateTotal,
              advance: advance,
              paymentStatus: firstReservation.payment_status,
              currency: hotel.currency,
            });
          }
        }
        if (singleRoomReservations?.length > 0) {
          for (const reservationDetails of singleRoomReservations) {
            message.bookingDetails!.push({
              id: reservationDetails.booking_id,
              external_id: reservationDetails.external_id,
              external_public_id: reservationDetails.external_public_id,
              guestFirstName: reservationDetails.customer?.first_name,
              guestLastName: reservationDetails.customer?.last_name,
              noOfAdults: reservationDetails.num_adults,
              noOfChildren: reservationDetails.num_children,
              noOfPets: reservationDetails.num_pets ?? 0,
              startDate: new Date(reservationDetails.check_in),
              endDate: new Date(reservationDetails.check_out),
              rateTotal:
                (reservationDetails.quote?.base_rate ?? 0) +
                (reservationDetails.quote?.taxes ?? 0) +
                (reservationDetails.quote?.fees ?? 0),
              advance: reservationDetails.quote?.amount_charged ?? 0,
              paymentStatus: reservationDetails.payment_status,
              currency: hotel.currency,
            });
          }
        }
      } catch (error) {
        if (error instanceof NoDataError) {
          logger.warn(
            `handleEndOfCallReport:: No reservation found for session id: ${session.id}. Error: ${JSON.stringify(error)}`,
          );
        } else {
          logger.error(
            `handleEndOfCallReport:: Error occurred while getting reservation details for session id: ${session.id}. Error: ${JSON.stringify(error)}`,
          );
          throw error;
        }
      }
      logger.info(
        `handleEndOfCallReport:: Reservation details: ${JSON.stringify(reservations)}`,
      );

      const htmlMessage = callCompletionTemplate(message);
      try {
        // Create payload for the chat notification
        const notificationPayload: NotificationPayload = {
          recipient: hotel.telegram_alerts_group_id,
          content: {
            message: htmlMessage,
            parseMode: 'HTML',
          },
        };

        await this.notificationFactory
          .getChatService(hotel.notification_type)
          .sendMessage(notificationPayload);
        logger.info(
          `Telegram notification message sent successfully: sessionId=${session.id}`,
        );
      } catch (error) {
        logger.error(
          `Failed to send notification message: sessionId=${session.id}, error=${error}`,
        );
      }

      if (session.session_type === SessionType.CALL) {
        try {
          if (
            guest_intent
              .split(',')
              .map((intent) => intent.trim())
              .includes(GuestIntent.UNSUCCESSFUL_RESERVATION_DUE_TO_PRICE)
          ) {
            // Send a discount SMS only if the customer has not dealt with a reservation in the session
            if (!reservations || reservations.length == 0) {
              logger.info(
                `handleEndOfCallReport:: No reservation found for session id. Proceeding to send discount SMS: ${session.id}`,
              );
              await this.handleDiscount(guest_intent, session, hotel, message);
            }
          }
        } catch (error) {
          logger.error(
            `handleEndOfCallReport:: Failed to send discount SMS for session id: ${session.id}, error=${error}`,
          );
        }

        if (
          availabilityEnquired &&
          !paymentLinkSent &&
          (!reservations || reservations.length === 0) &&
          followupAvailability
        ) {
          try {
            await this.followupPaymentLinkService.handleFollowupPaymentLink({
              hotel,
              hotelConfiguration,
              session,
              phoneNumber: phone_number || '',
              followupAvailability,
            });
          } catch (error) {
            logger.error(
              `handleEndOfCallReport:: Followup payment link failed for session id: ${session.id}, error=${error}`,
            );
          }
        }
      }
    } catch (error) {
      logger.error(
        'Failed to process end-of-call-report for conversation storage',
        JSON.stringify(error),
      );
      throw error;
    }
  }

  public async handleTransferDestinationRequest(
    event: CallTransferRequest,
  ): Promise<void> {
    try {
      logger.info(
        `handleTransferDestinationRequest:: Relevant event data: ${JSON.stringify(event.message)}`,
      );

      // Extract control URL from the call monitor
      const controlUrl = event?.message?.call?.monitor?.controlUrl;

      if (!controlUrl) {
        return;
      }

      const assistantPhoneNumber = convertToPhoneNumber(
        event?.message?.phoneNumber?.number,
      );
      if (!assistantPhoneNumber) {
        throw new VapiError(
          'handleTransferDestinationRequest: Assistant phone number not found',
        );
      }

      const hotel =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          assistantPhoneNumber,
        );
      if (!hotel) {
        throw new VapiError(
          'handleTransferDestinationRequest: Hotel not found for assistant phone number',
        );
      }

      const hotelTimezone = hotel.timezone;
      const forwardingNumber = await this.resolveTransferNumber(
        hotel.id,
        hotelTimezone,
        assistantPhoneNumber,
      );

      const destination = {
        type: 'number',
        number: forwardingNumber,
        message: `You have an escalation call.`,
        transferPlan: {
          mode: 'warm-transfer-say-message',
        },
      };

      logger.info(
        `handleTransferDestinationRequest:: Transferring to ${destination.number} (timezone: ${hotelTimezone})`,
      );

      await vapiHttpClient.post(`${controlUrl}/control`, {
        type: 'transfer',
        destination: destination,
        content: 'Transferring your call now.',
      });

      logKpi({
        stat: KpiStat.CallTransferred,
        value: 1,
        contextName: 'VapiWebhookService.handleTransferDestinationRequest',
        clientId: assistantPhoneNumber,
      });

      logger.info(`Transfer executed successfully to ${destination.number}`);
    } catch (error) {
      logger.error(
        `handleTransferDestinationRequest:: Transfer error: ${JSON.stringify(error)}`,
      );
    }
  }

  /**
   * Resolves the transfer number using the DB-driven rule engine.
   * Falls back to the legacy env-based config if no DB config is available.
   */
  private async resolveTransferNumber(
    hotelId: string,
    hotelTimezone: string,
    assistantPhoneNumber: string,
  ): Promise<string> {
    const hotelConfig =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        hotelId,
      );
    const callForwardingConfig = hotelConfig?.call_forwarding_configuration
      ? typeof hotelConfig.call_forwarding_configuration === 'string'
        ? JSON.parse(hotelConfig.call_forwarding_configuration)
        : hotelConfig.call_forwarding_configuration
      : null;

    const resolvedNumber = callForwardingHelper.resolveForwardingNumber(
      callForwardingConfig,
      hotelTimezone,
    );
    if (resolvedNumber) {
      return resolvedNumber;
    }

    // Fallback to legacy env-based config
    logger.info(
      `resolveTransferNumber:: Falling back to legacy env config for ${assistantPhoneNumber}`,
    );
    const multiplePhoneNumberConfig = config.HOTEL_MULTIPLE_PHONE_NUMBER_CONFIG;
    const hotelMultiplePhoneNumberConfig =
      multiplePhoneNumberConfig[assistantPhoneNumber];
    if (!hotelMultiplePhoneNumberConfig) {
      throw new VapiError(
        'resolveTransferNumber: No call forwarding configuration found (DB or env)',
      );
    }

    const primaryNumber = hotelMultiplePhoneNumberConfig.primaryNumber;
    const secondaryNumber = hotelMultiplePhoneNumberConfig.secondaryNumber;
    const businessHourStart =
      Number(hotelMultiplePhoneNumberConfig.businessHourStart) || 8;
    const businessHourEnd =
      Number(hotelMultiplePhoneNumberConfig.businessHourEnd) || 20;
    if (!primaryNumber || !secondaryNumber) {
      throw new VapiError(
        'resolveTransferNumber: Primary or secondary number not found in env config',
      );
    }

    const now = dayjs().tz(hotelTimezone);
    const dayOfWeek = now.day();
    const hourOfDay = now.hour();
    const isBusinessHours =
      dayOfWeek >= 1 &&
      dayOfWeek <= 6 &&
      hourOfDay >= businessHourStart &&
      hourOfDay < businessHourEnd;

    return isBusinessHours ? primaryNumber : secondaryNumber;
  }

  private async handleNegativeSentimentFollowup(
    customerSentiment: CustomerSentiment,
    hotelConfiguration: HotelConfiguration,
    phoneNumber: string,
    hotel: HotelModel,
    session: SessionModel,
  ): Promise<void> {
    if (
      customerSentiment !== CustomerSentiment.NEGATIVE ||
      !hotelConfiguration?.negative_sentiment_followup_enabled
    ) {
      return;
    }
    try {
      const message = `Hey, saw you just reached out. I can help right here with availability, pricing, or any questions. Or just reply CALL if you'd prefer a quick call with our team.`;
      const smsResult = await this.smsService.sendMessage({
        recipient: phoneNumber,
        content: {
          from: hotel.sms_number,
          message: message,
          twilioConfiguration: hotelConfiguration?.twilio_configuration,
        },
      });
      if (smsResult) {
        smsEvents.emitSmsSent({
          sessionId: session.id,
          message: message,
          from: hotel.sms_number,
          to: phoneNumber,
          callerPhoneNumber: phoneNumber,
          assistantPhoneNumber: session.assistant_phone_number,
          timestamp: new Date(),
          hotelSmsNumber: hotel.sms_number,
          smsAgentEnabled: hotelConfiguration?.sms_agent_enabled || false,
          hotelId: hotel.id,
        });
        logger.info(
          `handleNegativeSentimentFollowup:: SMS sent successfully: sessionId=${session.id}`,
        );
      }
    } catch (error) {
      logger.error(
        `handleNegativeSentimentFollowup:: Failed to send negative sentiment SMS: ${error}`,
      );
    }
  }

  private async handleDiscount(
    intent: string,
    session: SessionModel,
    hotel: HotelModel,
    message: CallCompletionMessage,
  ) {
    try {
      if (session.session_type !== SessionType.CALL) {
        return;
      }
      const guestIntent = intent.split(',').map((intent) => intent.trim());
      // If the guest intent is not unsucessful reservation, do not send discount SMS
      if (
        !guestIntent.includes(GuestIntent.UNSUCCESSFUL_RESERVATION_DUE_TO_PRICE)
      ) {
        return;
      }

      const hotelConfiguration =
        await this.hotelConfigurationService.getHotelConfigurationByHotelId(
          hotel.id,
        );
      const hotelDiscountSettings = hotelConfiguration?.discount_settings;
      if (!hotelDiscountSettings) {
        logger.info(
          `handleDiscount:: Hotel ${hotel.name} (${hotel.id}) has no discount settings, skipping`,
        );
        return;
      }

      const callerPhoneNumber =
        convertToPhoneNumber(session.caller_phone_number) || '';

      const existingDiscount =
        await this.discountService.getUnusedDiscountByPhoneNumberAndHotelId(
          callerPhoneNumber,
          hotel.id,
        );
      if (existingDiscount) {
        logger.info(
          `handleDiscount:: Discount already exists for phone number: ${callerPhoneNumber}`,
        );
        return;
      }

      const discountType = hotelDiscountSettings.discount_type;
      const discountValue = hotelDiscountSettings.discount_value;
      const expiryDays = hotelDiscountSettings.expiry_days;
      let note = null;
      if (discountType === DiscountType.PERCENTAGE) {
        note = `${discountValue}% Discount Applied. `;
      } else {
        note = `${formatCurrencyAmount(hotel.currency, discountValue)} Discount Applied. `;
      }
      note += hotelDiscountSettings.note;

      // create a discount for the hotel
      await this.discountService.createDiscount({
        phone_number: callerPhoneNumber,
        hotel_id: hotel.id,
        type: discountType,
        value: discountValue,
        expiry_days: expiryDays,
        note: note,
      });

      const smsNotificationPayload: NotificationPayload = {
        recipient: callerPhoneNumber,
        content: {
          from: hotel.sms_number,
          message: discountSMSTemplate(
            hotel.name,
            hotel.internal_phone_number || hotel.sms_number,
            discountType,
            discountValue,
            expiryDays,
            hotel.country,
            hotel.currency,
            hotelConfiguration?.sms_agent_enabled || false,
          ),
          twilioConfiguration: hotelConfiguration?.twilio_configuration,
        } as NotificationSMSContent,
      };
      const smsResult = await this.smsService.sendMessage(
        smsNotificationPayload,
      );
      if (smsResult) {
        smsEvents.emitSmsSent({
          sessionId: session.id,
          message: (smsNotificationPayload.content as NotificationSMSContent)
            .message,
          from: hotel.sms_number,
          to: callerPhoneNumber,
          callerPhoneNumber: callerPhoneNumber,
          assistantPhoneNumber: hotel.assistant_phone_number,
          timestamp: new Date(),
          hotelSmsNumber: hotel.sms_number,
          smsAgentEnabled: hotelConfiguration?.sms_agent_enabled || false,
          hotelId: hotel.id,
        });
      }
      logger.info(
        `SMS notification message sent successfully: sessionId=${session.id}`,
      );
    } catch (error) {
      logger.error(
        `Failed to send notification message: sessionId=${session.id}, error=${error}`,
      );
    }
  }
}

// Create singleton instances of notification services and followup payment link service
const smsService = new SMSNotificationService();
const followupPaymentLinkService = new FollowupPaymentLinkService(
  roomReservationService,
  smsService,
);

// Create and export the singleton instance
export const vapiWebhookService = new VapiWebhookService({
  assistantServerToken: config.VAPI_ASSISTANT_SERVER_TOKEN,
  conversationService,
  sessionService,
  roomReservationService,
  escalationService,
  hotelService,
  notificationFactory,
  smsService,
  discountService,
  hotelConfigurationService,
  followupPaymentLinkService,
});
