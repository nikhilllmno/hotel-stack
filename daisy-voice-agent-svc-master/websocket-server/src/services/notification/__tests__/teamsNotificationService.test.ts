jest.mock('@/config', () => ({
  __esModule: true,
  default: {
    ...jest.requireActual('@/config').default,
    TEAMS_BOT_APP_ID: 'bot-app-id',
  },
}));

jest.mock('@/utils/kpiLogger', () => ({
  ...jest.requireActual('@/utils/kpiLogger'),
  logKpi: jest.fn(),
}));

import { TeamsError } from '@/errors/TeamsError';
import { ChatOutboundMessageRepository } from '@/repositories/ChatOutboundMessageRepository';
import { TeamsConversationReferenceRepository } from '@/repositories/TeamsConversationReferenceRepository';
import {
  normalizeTeamsChannelId,
  parseTeamsThreadId,
  TeamsNotificationService,
} from '@/services/notification/teamsNotificationService';
import {
  TeamsConnector,
  TeamsConnectorProvider,
} from '@/services/teams/teamsAdapter';
import { KpiStat, logKpi } from '@/utils/kpiLogger';

const CHANNEL = '19:abc@thread.tacv2';
const HOTEL_PHONE = '+15551234567';
const REFERENCE = {
  channel_id: CHANNEL,
  tenant_id: 'tenant-1',
  service_url: 'https://smba.trafficmanager.net/amer/',
  bot_id: '28:bot-app-id',
};

function createHarness(options: { reference?: typeof REFERENCE | null } = {}) {
  const connector = {
    createConversation: jest
      .fn()
      .mockResolvedValue({ id: `${CHANNEL};messageid=111`, activityId: '111' }),
    sendToConversation: jest.fn().mockResolvedValue({ id: '222' }),
    updateActivity: jest.fn().mockResolvedValue({ id: '222' }),
    deleteActivity: jest.fn().mockResolvedValue(undefined),
  };
  const connectors: TeamsConnectorProvider = {
    withConnector: jest.fn(async (_target, run) =>
      run(connector as unknown as TeamsConnector),
    ),
  };
  const references = {
    findByChannelId: jest
      .fn()
      .mockResolvedValue(options.reference === undefined ? REFERENCE : null),
  } as unknown as TeamsConversationReferenceRepository;
  const outboundMessages = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as ChatOutboundMessageRepository;
  const hotels = {
    findByTelegramCheckInGroupId: jest
      .fn()
      .mockResolvedValue({ assistant_phone_number: HOTEL_PHONE }),
    findByTelegramTranscriptGroupId: jest.fn().mockResolvedValue(null),
  };
  const sleep = jest.fn().mockResolvedValue(undefined);
  const service = new TeamsNotificationService({
    connectors,
    references,
    outboundMessages,
    hotels,
    sleep,
  });
  return {
    service,
    connector,
    connectors,
    references,
    outboundMessages,
    hotels,
    sleep,
  };
}

beforeEach(() => {
  (logKpi as jest.Mock).mockReset();
});

describe('Teams id helpers', () => {
  it('splits channel and thread ids', () => {
    expect(normalizeTeamsChannelId(`${CHANNEL};messageid=5`)).toBe(CHANNEL);
    expect(parseTeamsThreadId(`${CHANNEL};messageid=5`)).toBe('5');
    expect(parseTeamsThreadId(CHANNEL)).toBeUndefined();
  });
});

describe('TeamsNotificationService.sendMessage', () => {
  it('starts a new thread in the channel and returns the root message id', async () => {
    const { service, connector, outboundMessages } = createHarness();

    const messageId = await service.sendMessage({
      recipient: CHANNEL,
      content: { message: '<b>Hi</b> Guest Phone: +1555', parseMode: 'HTML' },
    });

    expect(messageId).toBe('111');
    expect(connector.createConversation).toHaveBeenCalledTimes(1);
    const params = connector.createConversation.mock.calls[0][0];
    expect(params.channelData).toEqual({ channel: { id: CHANNEL } });
    expect(params.tenantId).toBe('tenant-1');
    expect(params.activity.text).toBe('**Hi** Guest Phone: +1555');
    expect(params.activity.textFormat).toBe('markdown');
    expect(outboundMessages.record).toHaveBeenCalledWith({
      provider: 'teams',
      channel_id: CHANNEL,
      message_id: '111',
      text: '<b>Hi</b> Guest Phone: +1555',
    });
  });

  it('replies inside the thread when replyToMessageId is set', async () => {
    const { service, connector } = createHarness();

    const messageId = await service.sendMessage({
      recipient: CHANNEL,
      content: { message: 'Reminder', replyToMessageId: '111' },
    });

    expect(messageId).toBe('222');
    expect(connector.createConversation).not.toHaveBeenCalled();
    expect(connector.sendToConversation).toHaveBeenCalledWith(
      `${CHANNEL};messageid=111`,
      expect.anything(),
    );
  });

  it('sends buttons as an Adaptive Card', async () => {
    const { service, connector } = createHarness();

    await service.sendMessage({
      recipient: CHANNEL,
      content: {
        message: 'Confirm',
        actions: [[{ text: 'Send', data: 'mgr_send' }]],
      },
    });

    const activity = connector.createConversation.mock.calls[0][0].activity;
    expect(activity.attachments).toHaveLength(1);
    expect(activity.attachments[0].contentType).toBe(
      'application/vnd.microsoft.card.adaptive',
    );
    expect(activity.attachments[0].content.body[1].actions[0].data).toEqual({
      daisyAction: 'mgr_send',
    });
  });

  it('retries after a 429 using Retry-After', async () => {
    const { service, connector, sleep } = createHarness();
    connector.createConversation
      .mockRejectedValueOnce({
        status: 429,
        response: { headers: { get: () => '2' } },
      })
      .mockResolvedValueOnce({ id: `${CHANNEL};messageid=9`, activityId: '9' });

    await expect(
      service.sendMessage({ recipient: CHANNEL, content: { message: 'x' } }),
    ).resolves.toBe('9');
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('wraps failures that are not throttling in a TeamsError', async () => {
    const { service, connector, sleep } = createHarness();
    connector.createConversation.mockRejectedValue(new Error('Forbidden'));

    await expect(
      service.sendMessage({ recipient: CHANNEL, content: { message: 'x' } }),
    ).rejects.toThrow(TeamsError);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('fails clearly when the bot was never installed in the channel', async () => {
    const { service, connectors } = createHarness({ reference: null });

    await expect(
      service.sendMessage({ recipient: CHANNEL, content: { message: 'x' } }),
    ).rejects.toThrow(/not installed/);
    expect(connectors.withConnector).not.toHaveBeenCalled();
  });
});

describe('TeamsNotificationService KPIs', () => {
  const message = { recipient: CHANNEL, content: { message: 'x' } };

  it('counts a delivered message once, for the hotel that owns the channel', async () => {
    const { service } = createHarness();

    await service.sendMessage(message);

    expect(logKpi).toHaveBeenCalledTimes(1);
    expect(logKpi).toHaveBeenCalledWith({
      stat: KpiStat.TeamsMessageSent,
      value: 1,
      contextName: 'TeamsNotificationService.sendMessage',
      clientId: HOTEL_PHONE,
    });
  });

  it('counts a thread reply as sent', async () => {
    const { service } = createHarness();

    await service.sendMessage({
      recipient: CHANNEL,
      content: { message: 'x', replyToMessageId: '111' },
    });

    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({ stat: KpiStat.TeamsMessageSent }),
    );
  });

  it('counts an API failure as failed, not sent', async () => {
    const { service, connector } = createHarness();
    connector.createConversation.mockRejectedValue(new Error('Forbidden'));

    await expect(service.sendMessage(message)).rejects.toThrow(TeamsError);

    expect(logKpi).toHaveBeenCalledTimes(1);
    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({ stat: KpiStat.TeamsMessageSendFailed }),
    );
  });

  it('counts a channel the app is not installed in as failed', async () => {
    const { service } = createHarness({ reference: null });

    await expect(service.sendMessage(message)).rejects.toThrow(/not installed/);

    expect(logKpi).toHaveBeenCalledTimes(1);
    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({ stat: KpiStat.TeamsMessageSendFailed }),
    );
  });

  it('counts once when a throttled send succeeds on retry', async () => {
    const { service, connector } = createHarness();
    connector.createConversation
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce({ id: `${CHANNEL};messageid=9`, activityId: '9' });

    await service.sendMessage(message);

    expect(logKpi).toHaveBeenCalledTimes(1);
    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({ stat: KpiStat.TeamsMessageSent }),
    );
  });

  it('does not count edits or deletes', async () => {
    const { service } = createHarness();

    await service.editMessage(CHANNEL, '222', { message: 'Done' });
    await service.deleteMessage(CHANNEL, '222');

    expect(logKpi).not.toHaveBeenCalled();
  });

  it('still counts the message when the hotel lookup fails', async () => {
    const { service, hotels } = createHarness();
    hotels.findByTelegramCheckInGroupId.mockRejectedValue(new Error('db down'));

    await service.sendMessage(message);

    expect(logKpi).toHaveBeenCalledWith({
      stat: KpiStat.TeamsMessageSent,
      value: 1,
      contextName: 'TeamsNotificationService.sendMessage',
      clientId: undefined,
    });
  });
});

describe('TeamsNotificationService.editMessage / deleteMessage', () => {
  it('updates a message in its thread', async () => {
    const { service, connector, outboundMessages } = createHarness();
    const thread = `${CHANNEL};messageid=111`;

    await service.editMessage(thread, '222', { message: 'Done' });

    expect(connector.updateActivity).toHaveBeenCalledWith(
      thread,
      '222',
      expect.objectContaining({ id: '222' }),
    );
    expect(outboundMessages.record).toHaveBeenCalledWith(
      expect.objectContaining({ message_id: '222', text: 'Done' }),
    );
  });

  it('deletes a message', async () => {
    const { service, connector } = createHarness();

    await service.deleteMessage(CHANNEL, 111);

    expect(connector.deleteActivity).toHaveBeenCalledWith(CHANNEL, '111');
  });
});
