jest.mock('@/utils/kpiLogger', () => ({
  ...jest.requireActual('@/utils/kpiLogger'),
  logKpi: jest.fn(),
}));

import { Hotel } from '@/models/Hotel';
import { ChatOutboundMessageRepository } from '@/repositories/ChatOutboundMessageRepository';
import { HotelRepository } from '@/repositories/HotelRepository';
import { TeamsConversationReferenceRepository } from '@/repositories/TeamsConversationReferenceRepository';
import { ChatInteractionService } from '@/services/chat/chatInteractionService';
import {
  TeamsInboundActivity,
  TeamsWebhookService,
} from '@/services/teams/teamsWebhookService';
import { KpiStat, logKpi } from '@/utils/kpiLogger';

const CHANNEL = '19:abc@thread.tacv2';
const HOTEL = { id: 'hotel-1', name: 'Test Hotel' } as Hotel;
const ESCALATION_TEXT =
  '<b>Escalation</b>\n<b>📞 Guest Phone:</b> +14155550100\nNeeds a towel';
const TRANSCRIPT_TEXT =
  '<b>New Conversation Transcript</b>\n<b>📞 Guest Phone:</b> +14155550100';
const CONFIRMATION_TEXT =
  'Confirm your message:\n\nGuest: +14155550100\n────────MESSAGE────────\nSee you at 3\n────────MESSAGE────────';

function activity(
  overrides: Partial<TeamsInboundActivity> = {},
): TeamsInboundActivity {
  return {
    type: 'message',
    id: 'act-1',
    text: '<at>Daisy</at> hello',
    serviceUrl: 'https://smba.trafficmanager.net/amer/',
    from: { id: 'user-1', name: 'Manager Mia' },
    recipient: { id: '28:bot' },
    conversation: {
      id: `${CHANNEL};messageid=100`,
      conversationType: 'channel',
      tenantId: 'tenant-1',
    },
    channelData: {
      tenant: { id: 'tenant-1' },
      team: { id: 'team-1' },
      channel: { id: CHANNEL },
    },
    replyToId: '100',
    ...overrides,
  };
}

function createHarness() {
  const hotelRepository = {
    findByTelegramCheckInGroupId: jest.fn().mockResolvedValue(null),
    findByTelegramTranscriptGroupId: jest.fn().mockResolvedValue(null),
  };
  const chat = {
    handleEscalationReply: jest.fn().mockResolvedValue(undefined),
    handleEscalationReaction: jest.fn().mockResolvedValue(undefined),
    isManagerBargeInEnabled: jest.fn().mockResolvedValue(true),
    buildManagerReplyConfirmation: jest.fn().mockResolvedValue({
      message: CONFIRMATION_TEXT,
      actions: [[{ text: 'Send', data: 'mgr_send' }]],
    }),
    sendManagerReply: jest.fn().mockResolvedValue(undefined),
    buildManagerReplySentUi: jest
      .fn()
      .mockResolvedValue({ text: '✅ Sent', actions: undefined }),
    handleHandback: jest.fn().mockResolvedValue(undefined),
    handleResumeAi: jest.fn().mockResolvedValue(true),
    resumeAiUi: jest.fn().mockReturnValue({ text: 'AI is back' }),
  };
  const references = {
    findByChannelId: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue(undefined),
  };
  const outbound = { find: jest.fn().mockResolvedValue(null) };
  const teams = {
    sendMessage: jest.fn().mockResolvedValue('555'),
    editMessage: jest.fn().mockResolvedValue(undefined),
  };

  const service = new TeamsWebhookService(
    hotelRepository as unknown as HotelRepository,
    chat as unknown as ChatInteractionService,
    references as unknown as TeamsConversationReferenceRepository,
    outbound as unknown as ChatOutboundMessageRepository,
    () => teams,
  );
  return { service, hotelRepository, chat, references, outbound, teams };
}

describe('TeamsWebhookService', () => {
  beforeEach(() => {
    (logKpi as jest.Mock).mockReset();
  });

  describe('KPIs', () => {
    const received = expect.objectContaining({
      stat: KpiStat.TeamsMessageReceived,
    });

    it('counts a message for the hotel that owns the channel', async () => {
      const { service, hotelRepository } = createHarness();
      hotelRepository.findByTelegramCheckInGroupId.mockResolvedValue({
        ...HOTEL,
        assistant_phone_number: '+15551234567',
      });

      await service.handleActivity(activity());

      expect(logKpi).toHaveBeenCalledTimes(1);
      expect(logKpi).toHaveBeenCalledWith({
        stat: KpiStat.TeamsMessageReceived,
        value: 1,
        contextName: 'TeamsWebhookService.handleActivity',
        clientId: '+15551234567',
      });
    });

    it('counts a button click, which Teams delivers as a message', async () => {
      const { service } = createHarness();

      await service.handleActivity(
        activity({ text: undefined, value: { daisyAction: 'unknown' } }),
      );

      expect(logKpi).toHaveBeenCalledWith(received);
    });

    it('counts a message from a channel that is not linked to a hotel', async () => {
      const { service } = createHarness();

      await service.handleActivity(activity());

      expect(logKpi).toHaveBeenCalledWith({
        stat: KpiStat.TeamsMessageReceived,
        value: 1,
        contextName: 'TeamsWebhookService.handleActivity',
        clientId: undefined,
      });
    });

    it('does not count reactions or installs', async () => {
      const { service } = createHarness();

      await service.handleActivity(
        activity({
          type: 'messageReaction',
          reactionsAdded: [{ type: 'like' }],
        }),
      );
      await service.handleActivity(
        activity({
          type: 'installationUpdate',
          action: 'add',
          conversation: { id: CHANNEL, conversationType: 'channel' },
        }),
      );

      expect(logKpi).not.toHaveBeenCalled();
    });

    it('does not count a message from a different tenant', async () => {
      const { service, references } = createHarness();
      references.findByChannelId.mockResolvedValue({
        channel_id: CHANNEL,
        tenant_id: 'another-tenant',
      });

      await service.handleActivity(activity());

      expect(logKpi).not.toHaveBeenCalled();
    });

    it('does not count a message missing tenant or service URL', async () => {
      const { service } = createHarness();

      await service.handleActivity(activity({ serviceUrl: undefined }));

      expect(logKpi).not.toHaveBeenCalled();
    });
  });

  describe('channel registration', () => {
    it('stores the channel reference on every channel message', async () => {
      const { service, references } = createHarness();

      await service.handleActivity(activity());

      expect(references.upsert).toHaveBeenCalledWith({
        channel_id: CHANNEL,
        tenant_id: 'tenant-1',
        service_url: 'https://smba.trafficmanager.net/amer/',
        team_id: 'team-1',
        bot_id: '28:bot',
      });
    });

    it('ignores activity from a tenant other than the registered one', async () => {
      const { service, references, hotelRepository } = createHarness();
      references.findByChannelId.mockResolvedValue({
        channel_id: CHANNEL,
        tenant_id: 'another-tenant',
      });

      await service.handleActivity(activity());

      expect(references.upsert).not.toHaveBeenCalled();
      expect(
        hotelRepository.findByTelegramCheckInGroupId,
      ).not.toHaveBeenCalled();
    });

    it('welcomes with the channel id when the app is installed', async () => {
      const { service, teams } = createHarness();

      await service.handleActivity(
        activity({
          type: 'installationUpdate',
          action: 'add',
          conversation: { id: CHANNEL, conversationType: 'channel' },
        }),
      );

      expect(teams.sendMessage).toHaveBeenCalledWith({
        recipient: CHANNEL,
        content: { message: expect.stringContaining(CHANNEL) },
      });
    });

    it('welcomes once when Teams sends both installationUpdate and conversationUpdate', async () => {
      const { service, teams, references } = createHarness();
      const conversation = { id: CHANNEL, conversationType: 'channel' };

      await service.handleActivity(
        activity({ type: 'installationUpdate', action: 'add', conversation }),
      );
      await service.handleActivity(
        activity({
          type: 'conversationUpdate',
          membersAdded: [{ id: '28:bot' }],
          conversation,
        }),
      );

      expect(teams.sendMessage).toHaveBeenCalledTimes(1);
      expect(references.upsert).toHaveBeenCalledTimes(2);
    });

    it('answers "@Daisy link" with the channel id', async () => {
      const { service, teams } = createHarness();

      await service.handleActivity(
        activity({
          text: '<at>Daisy</at> link',
          id: 'msg-9',
          replyToId: undefined,
          conversation: {
            id: CHANNEL,
            conversationType: 'channel',
            tenantId: 'tenant-1',
          },
        }),
      );

      expect(teams.sendMessage).toHaveBeenCalledWith({
        recipient: CHANNEL,
        content: {
          message: expect.stringContaining(CHANNEL),
          replyToMessageId: 'msg-9',
        },
      });
    });

    it('answers "@Daisy link" when Teams stamps the post id into conversation.id', async () => {
      const { service, teams } = createHarness();

      await service.handleActivity(
        activity({
          text: '<at>Daisy</at> link',
          id: '1761700000009',
          replyToId: undefined,
          conversation: {
            id: `${CHANNEL};messageid=1761700000009`,
            conversationType: 'channel',
            tenantId: 'tenant-1',
          },
        }),
      );

      expect(teams.sendMessage).toHaveBeenCalledWith({
        recipient: CHANNEL,
        content: {
          message: expect.stringContaining(CHANNEL),
          replyToMessageId: '1761700000009',
        },
      });
    });
  });

  describe('escalation replies', () => {
    it('forwards a thread reply with the phone from the stored escalation text', async () => {
      const { service, hotelRepository, outbound, chat } = createHarness();
      hotelRepository.findByTelegramCheckInGroupId.mockResolvedValue(HOTEL);
      outbound.find.mockResolvedValue({ text: ESCALATION_TEXT });

      await service.handleActivity(
        activity({ text: '<at>Daisy</at> Towels are on the way' }),
      );

      expect(outbound.find).toHaveBeenCalledWith('teams', CHANNEL, '100');
      expect(chat.handleEscalationReply).toHaveBeenCalledWith({
        hotel: HOTEL,
        extractedPhone: '+14155550100',
        managerResponse: 'Towels are on the way',
      });
    });

    it('ignores replies to messages Daisy did not post', async () => {
      const { service, hotelRepository, chat } = createHarness();
      hotelRepository.findByTelegramCheckInGroupId.mockResolvedValue(HOTEL);

      await service.handleActivity(activity({ text: 'hello' }));

      expect(chat.handleEscalationReply).not.toHaveBeenCalled();
    });

    it('ignores top-level posts that are not commands', async () => {
      const { service, hotelRepository, chat } = createHarness();
      hotelRepository.findByTelegramCheckInGroupId.mockResolvedValue(HOTEL);

      await service.handleActivity(
        activity({
          text: 'Lunch anyone?',
          replyToId: undefined,
          conversation: {
            id: CHANNEL,
            conversationType: 'channel',
            tenantId: 'tenant-1',
          },
        }),
      );

      expect(chat.handleEscalationReply).not.toHaveBeenCalled();
    });
  });

  describe('transcript replies', () => {
    it('posts a confirmation in the thread of the transcript', async () => {
      const { service, hotelRepository, outbound, chat, teams } =
        createHarness();
      hotelRepository.findByTelegramTranscriptGroupId.mockResolvedValue(HOTEL);
      outbound.find.mockResolvedValue({ text: TRANSCRIPT_TEXT });

      await service.handleActivity(activity({ text: 'See you at 3' }));

      expect(chat.buildManagerReplyConfirmation).toHaveBeenCalledWith({
        hotel: HOTEL,
        guestPhone: '+14155550100',
        replyText: 'See you at 3',
      });
      expect(teams.sendMessage).toHaveBeenCalledWith({
        recipient: CHANNEL,
        content: {
          message: CONFIRMATION_TEXT,
          actions: [[{ text: 'Send', data: 'mgr_send' }]],
          replyToMessageId: '100',
        },
      });
    });

    it('does nothing when manager barge-in is off', async () => {
      const { service, hotelRepository, chat, teams } = createHarness();
      hotelRepository.findByTelegramTranscriptGroupId.mockResolvedValue(HOTEL);
      chat.isManagerBargeInEnabled.mockResolvedValue(false);

      await service.handleActivity(activity({ text: 'See you at 3' }));

      expect(teams.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('reactions', () => {
    it('maps Teams reaction names to emojis and passes the reacted message id', async () => {
      const { service, hotelRepository, chat } = createHarness();
      hotelRepository.findByTelegramCheckInGroupId.mockResolvedValue(HOTEL);

      await service.handleActivity(
        activity({
          type: 'messageReaction',
          text: undefined,
          reactionsAdded: [{ type: 'like' }, { type: 'heart' }],
        }),
      );

      expect(chat.handleEscalationReaction).toHaveBeenCalledWith({
        hotel: HOTEL,
        externalMessageId: '100',
        addedEmojis: ['👍', '❤️', '❤'],
        user: 'Manager Mia',
      });
    });
  });

  describe('button clicks', () => {
    function click(data: string, replyToId = '300') {
      return activity({
        text: undefined,
        value: { daisyAction: data },
        replyToId,
      });
    }

    it('sends the manager reply parsed from the stored confirmation and updates the card', async () => {
      const { service, hotelRepository, outbound, chat, teams } =
        createHarness();
      hotelRepository.findByTelegramTranscriptGroupId.mockResolvedValue(HOTEL);
      outbound.find.mockResolvedValue({ text: CONFIRMATION_TEXT });

      await service.handleActivity(click('mgr_send'));

      expect(outbound.find).toHaveBeenCalledWith('teams', CHANNEL, '300');
      expect(chat.sendManagerReply).toHaveBeenCalledWith({
        hotel: HOTEL,
        guestPhone: '+14155550100',
        replyText: 'See you at 3',
        action: 'mgr_send',
      });
      expect(teams.editMessage).toHaveBeenCalledWith(
        `${CHANNEL};messageid=100`,
        '300',
        { message: '✅ Sent', actions: undefined },
      );
    });

    it('tells the manager when sending failed', async () => {
      const { service, hotelRepository, outbound, chat, teams } =
        createHarness();
      hotelRepository.findByTelegramTranscriptGroupId.mockResolvedValue(HOTEL);
      outbound.find.mockResolvedValue({ text: CONFIRMATION_TEXT });
      chat.sendManagerReply.mockRejectedValue(new Error('SMS down'));

      await expect(service.handleActivity(click('mgr_send'))).rejects.toThrow(
        'SMS down',
      );

      expect(teams.editMessage).toHaveBeenCalledWith(
        `${CHANNEL};messageid=100`,
        '300',
        { message: '❌ Failed to send: SMS down', actions: undefined },
      );
    });

    it('does not send when the confirmation cannot be read', async () => {
      const { service, chat, teams } = createHarness();

      await service.handleActivity(click('mgr_send'));

      expect(chat.sendManagerReply).not.toHaveBeenCalled();
      expect(teams.editMessage).toHaveBeenCalledWith(
        `${CHANNEL};messageid=100`,
        '300',
        expect.objectContaining({
          message: expect.stringContaining('Could not read'),
        }),
      );
    });

    it('hands the guest back to the AI', async () => {
      const { service, hotelRepository, chat } = createHarness();
      hotelRepository.findByTelegramTranscriptGroupId.mockResolvedValue(HOTEL);

      await service.handleActivity(click('handback:+14155550100:+14155550999'));

      expect(chat.handleHandback).toHaveBeenCalledWith({
        hotelFromChat: HOTEL,
        guestPhone: '+14155550100',
        assistantPhone: '+14155550999',
      });
    });

    it('switches back to the AI and updates the message', async () => {
      const { service, chat, teams } = createHarness();

      await service.handleActivity(
        click('resume_ai:+14155550100:+14155550999'),
      );

      expect(chat.handleResumeAi).toHaveBeenCalled();
      expect(teams.editMessage).toHaveBeenCalledWith(
        `${CHANNEL};messageid=100`,
        '300',
        { message: 'AI is back', actions: undefined },
      );
    });
  });
});
