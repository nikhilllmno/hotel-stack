const mockPost = jest.fn();

jest.mock('@/utils/httpClient', () => ({
  createHttpClient: jest.fn(() => ({
    get: jest.fn(),
    post: mockPost,
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  })),
}));

jest.mock('@/utils/kpiLogger', () => ({
  ...jest.requireActual('@/utils/kpiLogger'),
  logKpi: jest.fn(),
}));

jest.mock('@/config', () => ({
  __esModule: true,
  default: {
    ...jest.requireActual('@/config').default,
    TEAMS_BOT_APP_ID: 'bot-app-id',
    SUPPORT_OPS_API_KEY: 'support-ops-token',
  },
}));

// The SMS to the guest goes out through the session (Twilio, conversation history).
jest.mock('@/services/session/SessionService', () => ({
  __esModule: true,
  default: {
    getInProgressSmsSessionForHotel: jest.fn(),
    isSessionInEffectiveDirectMode: jest.fn(),
    sendManagerReplySmsForPhone: jest.fn(),
    sendManagerReplyAndReleaseToAi: jest.fn(),
    setChatRoutingMode: jest.fn(),
  },
}));

import { EscalationStatus } from '@/dtos/enum/EscalationStatus';
import { ChannelRepository } from '@/repositories/ChannelRepository';
import { ChatOutboundMessageRepository } from '@/repositories/ChatOutboundMessageRepository';
import { EscalationRepository } from '@/repositories/EscalationRepository';
import { HotelConfigurationRepository } from '@/repositories/HotelConfigurationRepository';
import { HotelRepository } from '@/repositories/HotelRepository';
import { TeamsConversationReferenceRepository } from '@/repositories/TeamsConversationReferenceRepository';
import { ChatInteractionService } from '@/services/chat/chatInteractionService';
import { EscalationService } from '@/services/escalation/escalationService';
import { HotelService } from '@/services/hotel/hotelService';
import { HotelConfigurationService } from '@/services/hotelConfiguration/hotelConfigurationService';
import { NotificationType } from '@/services/notification/notificationType';
import { TeamsNotificationService } from '@/services/notification/teamsNotificationService';
import sessionService from '@/services/session/SessionService';
import {
  TeamsInboundActivity,
  TeamsWebhookService,
} from '@/services/teams/teamsWebhookService';
import { MGR_CALLBACK } from '@/services/telegram/managerReplyConfirmationFormat';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import { StubTeamsConnectorProvider } from '@/test/stubs/StubTeamsConnectorProvider';
import { KpiStat, logKpi } from '@/utils/kpiLogger';
import { randomUUID } from 'node:crypto';

const { hotelId, assistantPhoneNumber } = RESERVATION_FLOW_FIXTURE_IDS;

const TENANT = 'tenant-hotel';
const SERVICE_URL = 'https://smba.trafficmanager.net/amer/';
const BOT_ID = '28:bot-app-id';
const ESCALATION_CHANNEL = '19:escalations@thread.tacv2';
const TRANSCRIPT_CHANNEL = '19:transcripts@thread.tacv2';
const ESCALATION_AGENT_URL =
  'https://support-ops.example.com/webhook/sms/manager-escalation-response';
const GUEST_PHONE = '+14155550100';

const sessionMock = jest.mocked(sessionService);

/** pg-mem hands jsonb columns back as text; Postgres returns them parsed. */
class ParsedJsonHotelConfigurationRepository extends HotelConfigurationRepository {
  async findByHotelId(hotelId: string) {
    const configuration = await super.findByHotelId(hotelId);
    if (typeof configuration?.escalation_report_configuration === 'string') {
      configuration.escalation_report_configuration = JSON.parse(
        configuration.escalation_report_configuration,
      );
    }
    return configuration;
  }
}

describe('Teams business flows (pg-mem, stubbed Teams connector)', () => {
  const ctx = installPgMemTestContext();
  let teams: StubTeamsConnectorProvider;
  let notifier: TeamsNotificationService;
  let webhook: TeamsWebhookService;
  let escalations: EscalationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPost.mockResolvedValue({ status: 200 });
    sessionMock.getInProgressSmsSessionForHotel.mockResolvedValue(null);
    sessionMock.sendManagerReplySmsForPhone.mockResolvedValue(undefined);

    const knex = ctx.knex;
    const hotelRepository = new HotelRepository(knex);
    const hotelConfigurationRepository =
      new ParsedJsonHotelConfigurationRepository(knex);
    const references = new TeamsConversationReferenceRepository(knex);
    const outboundMessages = new ChatOutboundMessageRepository(knex);

    teams = new StubTeamsConnectorProvider();
    notifier = new TeamsNotificationService({
      connectors: teams,
      references,
      outboundMessages,
      hotels: hotelRepository,
      sleep: () => Promise.resolve(),
    });

    const hotelConfigurationService = new HotelConfigurationService(
      hotelConfigurationRepository,
      hotelRepository,
      {} as never,
    );
    escalations = new EscalationService(
      new EscalationRepository(knex),
      new HotelService(
        hotelRepository,
        hotelConfigurationRepository,
        new ChannelRepository(knex),
      ),
      {
        getChatService: (type) => {
          if (type !== NotificationType.TEAMS) {
            throw new Error(`Unexpected notification type ${type}`);
          }
          return notifier;
        },
      },
      {} as never,
      hotelConfigurationService,
    );
    webhook = new TeamsWebhookService(
      hotelRepository,
      new ChatInteractionService(
        hotelRepository,
        hotelConfigurationService,
        escalations,
      ),
      references,
      outboundMessages,
      () => notifier,
    );

    await knex('hotels').where({ id: hotelId }).update({
      notification_type: 'teams',
      telegram_check_in_group_id: ESCALATION_CHANNEL,
      telegram_transcript_group_id: TRANSCRIPT_CHANNEL,
    });
    await knex('hotel_configurations')
      .where({ hotel_id: hotelId })
      .update({
        escalation_agent_url: ESCALATION_AGENT_URL,
        enable_manager_barge_in: true,
        escalation_report_configuration: {
          period_hours: 24,
          reporting_time: '19:00',
          cron_window_minutes: 15,
          reminder_delay_minutes: 30,
          reminder_resend_count: 2,
          allowed_emojis: ['👍'],
        },
      });
  });

  function inChannel(
    channelId: string,
    overrides: Partial<TeamsInboundActivity> = {},
  ): TeamsInboundActivity {
    return {
      type: 'message',
      id: '1',
      serviceUrl: SERVICE_URL,
      from: { id: 'user-1', name: 'Manager Mia' },
      recipient: { id: BOT_ID },
      conversation: {
        id: channelId,
        conversationType: 'channel',
        tenantId: TENANT,
      },
      channelData: {
        tenant: { id: TENANT },
        team: { id: 'team-1' },
        channel: { id: channelId },
      },
      ...overrides,
    };
  }

  function install(channelId: string) {
    return webhook.handleActivity(
      inChannel(channelId, { type: 'installationUpdate', action: 'add' }),
    );
  }

  function replyInThread(
    channelId: string,
    rootId: string,
    text: string,
  ): TeamsInboundActivity {
    return inChannel(channelId, {
      text: `<at>Daisy</at> ${text}`,
      replyToId: rootId,
      conversation: {
        id: `${channelId};messageid=${rootId}`,
        conversationType: 'channel',
        tenantId: TENANT,
      },
    });
  }

  function kpiCount(stat: string): number {
    return (logKpi as jest.Mock).mock.calls.filter(
      ([args]) => args.stat === stat,
    ).length;
  }

  describe('installing or linking a channel', () => {
    function savedReference(channelId: string) {
      return ctx
        .knex('teams_conversation_references')
        .where({ channel_id: channelId })
        .first();
    }

    it('saves the channel on install and delivers a later notification there', async () => {
      await expect(
        notifier.sendMessage({
          recipient: ESCALATION_CHANNEL,
          content: { message: 'Too early' },
        }),
      ).rejects.toThrow(/not installed/);

      await install(ESCALATION_CHANNEL);

      expect(await savedReference(ESCALATION_CHANNEL)).toMatchObject({
        channel_id: ESCALATION_CHANNEL,
        tenant_id: TENANT,
        service_url: SERVICE_URL,
        team_id: 'team-1',
        bot_id: BOT_ID,
      });
      const [welcome] = teams.inChannel(ESCALATION_CHANNEL);
      expect(teams.textOf(welcome)).toContain(ESCALATION_CHANNEL);

      await notifier.sendMessage({
        recipient: ESCALATION_CHANNEL,
        content: { message: 'Guest is waiting' },
      });

      const delivered = teams.inChannel(ESCALATION_CHANNEL).at(-1)!;
      expect(teams.textOf(delivered)).toContain('Guest is waiting');
      expect(delivered).toMatchObject({
        serviceUrl: SERVICE_URL,
        tenantId: TENANT,
      });
      expect(kpiCount(KpiStat.TeamsMessageSendFailed)).toBe(1);
      expect(kpiCount(KpiStat.TeamsMessageSent)).toBe(2);
    });

    it('saves the channel when someone writes "@Daisy link" in it and delivers a later notification there', async () => {
      const linkedChannel = '19:another@thread.tacv2';

      await webhook.handleActivity(
        inChannel(linkedChannel, { id: '555', text: '<at>Daisy</at> link' }),
      );

      expect(await savedReference(linkedChannel)).toMatchObject({
        tenant_id: TENANT,
        service_url: SERVICE_URL,
      });
      const [answer] = teams.inChannel(linkedChannel);
      expect(answer.conversationId).toBe(`${linkedChannel};messageid=555`);
      expect(teams.textOf(answer)).toContain(linkedChannel);

      await notifier.sendMessage({
        recipient: linkedChannel,
        content: { message: 'Hello linked channel' },
      });

      expect(teams.textOf(teams.inChannel(linkedChannel).at(-1)!)).toContain(
        'Hello linked channel',
      );
    });

    it('delivers to the new service URL when Teams moves the channel to another region', async () => {
      await install(ESCALATION_CHANNEL);

      await webhook.handleActivity(
        inChannel(ESCALATION_CHANNEL, {
          text: 'hello',
          serviceUrl: 'https://smba.trafficmanager.net/emea/',
        }),
      );
      await notifier.sendMessage({
        recipient: ESCALATION_CHANNEL,
        content: { message: 'After the move' },
      });

      expect(teams.inChannel(ESCALATION_CHANNEL).at(-1)!.serviceUrl).toBe(
        'https://smba.trafficmanager.net/emea/',
      );
    });

    it('keeps the original tenant when another tenant writes in the channel', async () => {
      await install(ESCALATION_CHANNEL);

      await webhook.handleActivity(
        inChannel(ESCALATION_CHANNEL, {
          text: 'hello',
          serviceUrl: 'https://evil.example.com/',
          conversation: {
            id: ESCALATION_CHANNEL,
            conversationType: 'channel',
            tenantId: 'tenant-other',
          },
          channelData: {
            tenant: { id: 'tenant-other' },
            channel: { id: ESCALATION_CHANNEL },
          },
        }),
      );
      await notifier.sendMessage({
        recipient: ESCALATION_CHANNEL,
        content: { message: 'Still ours' },
      });

      expect(await savedReference(ESCALATION_CHANNEL)).toMatchObject({
        tenant_id: TENANT,
        service_url: SERVICE_URL,
      });
      expect(teams.inChannel(ESCALATION_CHANNEL).at(-1)).toMatchObject({
        tenantId: TENANT,
        serviceUrl: SERVICE_URL,
      });
    });
  });

  describe('escalation of a Teams hotel', () => {
    const escalationInput = {
      full_name: 'Jane Guest',
      phone_number: GUEST_PHONE,
      message: 'Needs a towel',
      status: EscalationStatus.OPEN,
      session_id: randomUUID(),
    };

    function findEscalation() {
      return ctx.knex('escalations').where({ hotel_id: hotelId }).first();
    }

    async function raiseEscalation() {
      await install(ESCALATION_CHANNEL);
      const escalation = await escalations.handleEscalation(
        escalationInput,
        assistantPhoneNumber,
      );
      const [, posted] = teams.inChannel(ESCALATION_CHANNEL);
      return { escalation, posted };
    }

    it('posts the escalation to the escalation channel and remembers the Teams message', async () => {
      const { escalation, posted } = await raiseEscalation();

      expect(posted.conversationId).toBe(ESCALATION_CHANNEL);
      expect(teams.textOf(posted)).toContain('Needs a towel');
      expect(teams.textOf(posted)).toContain(`Customer Phone: ${GUEST_PHONE}`);
      expect(await findEscalation()).toMatchObject({
        id: escalation.id,
        status: EscalationStatus.OPEN,
        external_message_id: posted.id,
      });
    });

    it('sends the manager thread reply on to the guest', async () => {
      const { posted } = await raiseEscalation();

      await webhook.handleActivity(
        replyInThread(ESCALATION_CHANNEL, posted.id, 'Towels are on the way'),
      );

      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith(
        ESCALATION_AGENT_URL,
        expect.objectContaining({
          customer_phone_number: GUEST_PHONE,
          manager_response: 'Towels are on the way',
          hotel_name: RESERVATION_FLOW_FIXTURE_IDS.hotelName,
        }),
        expect.objectContaining({
          headers: expect.objectContaining({ token: 'support-ops-token' }),
        }),
      );
      expect(kpiCount(KpiStat.TeamsMessageReceived)).toBe(1);
    });

    it('marks the escalation DONE when a manager reacts with the hotel emoji', async () => {
      const { posted } = await raiseEscalation();

      await webhook.handleActivity(
        inChannel(ESCALATION_CHANNEL, {
          type: 'messageReaction',
          replyToId: posted.id,
          reactionsAdded: [{ type: 'like' }],
        }),
      );

      expect((await findEscalation()).status).toBe(EscalationStatus.DONE);
    });

    it('takes the escalation from posted to replied to DONE', async () => {
      const { posted } = await raiseEscalation();

      await webhook.handleActivity(
        replyInThread(ESCALATION_CHANNEL, posted.id, 'Towels are on the way'),
      );
      expect((await findEscalation()).status).toBe(EscalationStatus.OPEN);

      await webhook.handleActivity(
        inChannel(ESCALATION_CHANNEL, {
          type: 'messageReaction',
          replyToId: posted.id,
          reactionsAdded: [{ type: 'like' }],
        }),
      );

      expect(mockPost).toHaveBeenCalledTimes(1);
      expect((await findEscalation()).status).toBe(EscalationStatus.DONE);
    });

    it('leaves the escalation OPEN for a reaction the hotel did not list', async () => {
      const { posted } = await raiseEscalation();

      await webhook.handleActivity(
        inChannel(ESCALATION_CHANNEL, {
          type: 'messageReaction',
          replyToId: posted.id,
          reactionsAdded: [{ type: 'angry' }],
        }),
      );

      expect((await findEscalation()).status).toBe(EscalationStatus.OPEN);
    });

    it('leaves the escalation OPEN when the reaction is on another message', async () => {
      await raiseEscalation();

      await webhook.handleActivity(
        inChannel(ESCALATION_CHANNEL, {
          type: 'messageReaction',
          replyToId: '999',
          reactionsAdded: [{ type: 'like' }],
        }),
      );

      expect((await findEscalation()).status).toBe(EscalationStatus.OPEN);
    });

    it('fails the escalation when the escalation channel never had the app installed', async () => {
      await expect(
        escalations.handleEscalation(escalationInput, assistantPhoneNumber),
      ).rejects.toThrow(/not installed/);
      expect(teams.messages).toHaveLength(0);
    });
  });

  describe('manager reply to a transcript', () => {
    const REPLY = 'See you at 3';

    async function postTranscript() {
      await install(TRANSCRIPT_CHANNEL);
      const transcriptId = await notifier.sendMessage({
        recipient: TRANSCRIPT_CHANNEL,
        content: {
          message:
            '<b>📝 New Conversation Transcript</b>\n\n' +
            `<b>Guest Phone:</b> ${GUEST_PHONE}\n` +
            '<b>Mode:</b> AI\n\n<b>user:</b>\nWhat time is check-in?\n',
          parseMode: 'HTML',
        },
      });
      return transcriptId;
    }

    function click(
      transcriptId: string,
      confirmationId: string,
      data: string,
    ): TeamsInboundActivity {
      return inChannel(TRANSCRIPT_CHANNEL, {
        text: undefined,
        value: { daisyAction: data },
        replyToId: confirmationId,
        conversation: {
          id: `${TRANSCRIPT_CHANNEL};messageid=${transcriptId}`,
          conversationType: 'channel',
          tenantId: TENANT,
        },
      });
    }

    async function replyAndGetConfirmation() {
      const transcriptId = await postTranscript();
      await webhook.handleActivity(
        replyInThread(TRANSCRIPT_CHANNEL, transcriptId, REPLY),
      );
      const confirmation = teams.inChannel(TRANSCRIPT_CHANNEL).at(-1)!;
      return { transcriptId, confirmation };
    }

    it('posts a confirmation card in the thread of the transcript', async () => {
      const { transcriptId, confirmation } = await replyAndGetConfirmation();

      expect(confirmation.id).not.toBe(transcriptId);
      expect(confirmation.conversationId).toBe(
        `${TRANSCRIPT_CHANNEL};messageid=${transcriptId}`,
      );
      expect(teams.textOf(confirmation)).toContain(`Guest: ${GUEST_PHONE}`);
      expect(teams.textOf(confirmation)).toContain(REPLY);
      expect(teams.buttonsOf(confirmation).map((b) => b.data)).toEqual([
        MGR_CALLBACK.AI_SEND,
        MGR_CALLBACK.TAKE_CONTROL,
      ]);
      expect(sessionMock.sendManagerReplySmsForPhone).not.toHaveBeenCalled();
    });

    it('sends the message to the guest and updates the card when the manager confirms', async () => {
      const { transcriptId, confirmation } = await replyAndGetConfirmation();
      const send = teams
        .buttonsOf(confirmation)
        .find((b) => b.data === MGR_CALLBACK.AI_SEND)!;

      await webhook.handleActivity(
        click(transcriptId, confirmation.id, send.data),
      );

      expect(sessionMock.sendManagerReplySmsForPhone).toHaveBeenCalledTimes(1);
      expect(sessionMock.sendManagerReplySmsForPhone).toHaveBeenCalledWith(
        expect.objectContaining({ id: hotelId }),
        GUEST_PHONE,
        REPLY,
        { setDirect: false },
      );
      expect(confirmation.edits).toBe(1);
      expect(teams.textOf(confirmation)).toContain('Message sent');
      expect(teams.buttonsOf(confirmation)).toEqual([]);
      expect(kpiCount(KpiStat.TeamsMessageReceived)).toBe(2);
      expect(kpiCount(KpiStat.TeamsMessageSent)).toBe(3);
    });

    it('takes control of the guest when the manager picks "Send & Take Control"', async () => {
      const { transcriptId, confirmation } = await replyAndGetConfirmation();

      await webhook.handleActivity(
        click(transcriptId, confirmation.id, MGR_CALLBACK.TAKE_CONTROL),
      );

      expect(sessionMock.sendManagerReplySmsForPhone).toHaveBeenCalledWith(
        expect.objectContaining({ id: hotelId }),
        GUEST_PHONE,
        REPLY,
        { setDirect: true },
      );
      expect(teams.textOf(confirmation)).toContain('taken control');
    });

    it('tells the manager on the card when the message could not be sent', async () => {
      const { transcriptId, confirmation } = await replyAndGetConfirmation();
      sessionMock.sendManagerReplySmsForPhone.mockRejectedValue(
        new Error('No active SMS session'),
      );

      await expect(
        webhook.handleActivity(
          click(transcriptId, confirmation.id, MGR_CALLBACK.AI_SEND),
        ),
      ).rejects.toThrow('No active SMS session');

      expect(teams.textOf(confirmation)).toContain(
        'Failed to send: No active SMS session',
      );
    });

    it('posts nothing when the hotel has manager replies switched off', async () => {
      await ctx
        .knex('hotel_configurations')
        .where({ hotel_id: hotelId })
        .update({ enable_manager_barge_in: false });
      const transcriptId = await postTranscript();

      await webhook.handleActivity(
        replyInThread(TRANSCRIPT_CHANNEL, transcriptId, REPLY),
      );

      expect(teams.inChannel(TRANSCRIPT_CHANNEL)).toHaveLength(2);
    });
  });
});
