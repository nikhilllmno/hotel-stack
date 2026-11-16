jest.mock('@/config', () => ({
  __esModule: true,
  default: {
    ...jest.requireActual('@/config').default,
    TEAMS_BOT_APP_ID: 'bot-app-id',
    TEAMS_BOT_APP_PASSWORD: 'secret',
    TEAMS_BOT_TENANT_ID: 'tenant-id',
  },
}));

const mockConnector = {
  createConversation: jest.fn(),
  sendToConversation: jest.fn(),
  updateActivity: jest.fn(),
  deleteActivity: jest.fn(),
};

// Like the SDK's runMiddleware: an error thrown by the turn logic goes to
// onTurnError and continueConversation resolves instead of rejecting.
jest.mock('@microsoft/agents-hosting', () => ({
  CloudAdapter: class {
    ConnectorClientKey = 'connector';
    onTurnError?: (context: unknown, error: Error) => Promise<void>;

    async continueConversation(
      _appId: string,
      _reference: unknown,
      logic: (context: unknown) => Promise<void>,
    ) {
      const context = {
        turnState: new Map([[this.ConnectorClientKey, mockConnector]]),
      };
      try {
        await logic(context);
      } catch (error) {
        if (!this.onTurnError) {
          throw error;
        }
        await this.onTurnError(context, error as Error);
      }
    }
  },
}));

import { ChatOutboundMessageRepository } from '@/repositories/ChatOutboundMessageRepository';
import { TeamsConversationReferenceRepository } from '@/repositories/TeamsConversationReferenceRepository';
import { TeamsNotificationService } from '@/services/notification/teamsNotificationService';
import { SdkTeamsConnectorProvider } from '@/services/teams/teamsAdapter';

const TARGET = {
  serviceUrl: 'https://smba.trafficmanager.net/amer/',
  tenantId: 'tenant-1',
  conversationId: '19:abc@thread.tacv2',
};

describe('SdkTeamsConnectorProvider.withConnector', () => {
  const provider = new SdkTeamsConnectorProvider();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns what the call returns', async () => {
    await expect(
      provider.withConnector(TARGET, async () => 'ok'),
    ).resolves.toBe('ok');
  });

  it('rethrows the original error instead of resolving undefined', async () => {
    const throttled = { status: 429 };

    await expect(
      provider.withConnector(TARGET, async () => {
        throw throttled;
      }),
    ).rejects.toBe(throttled);
  });

  it('retries a throttled send made through the SDK adapter', async () => {
    mockConnector.createConversation
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce({ id: '19:abc@thread.tacv2;messageid=9' });
    const service = new TeamsNotificationService({
      connectors: provider,
      references: {
        findByChannelId: jest.fn().mockResolvedValue({
          channel_id: TARGET.conversationId,
          tenant_id: TARGET.tenantId,
          service_url: TARGET.serviceUrl,
          bot_id: '28:bot',
        }),
      } as unknown as TeamsConversationReferenceRepository,
      outboundMessages: {
        record: jest.fn().mockResolvedValue(undefined),
      } as unknown as ChatOutboundMessageRepository,
      hotels: {
        findByTelegramCheckInGroupId: jest.fn().mockResolvedValue(null),
        findByTelegramTranscriptGroupId: jest.fn().mockResolvedValue(null),
      },
      sleep: () => Promise.resolve(),
    });

    await expect(
      service.sendMessage({
        recipient: TARGET.conversationId,
        content: { message: 'x' },
      }),
    ).resolves.toBe('9');
    expect(mockConnector.createConversation).toHaveBeenCalledTimes(2);
  });

  it('fails an edit that Teams rejected instead of reporting success', async () => {
    mockConnector.updateActivity.mockRejectedValue(new Error('Forbidden'));
    const service = new TeamsNotificationService({
      connectors: provider,
      references: {
        findByChannelId: jest.fn().mockResolvedValue({
          channel_id: TARGET.conversationId,
          tenant_id: TARGET.tenantId,
          service_url: TARGET.serviceUrl,
          bot_id: '28:bot',
        }),
      } as unknown as TeamsConversationReferenceRepository,
      outboundMessages: {
        record: jest.fn().mockResolvedValue(undefined),
      } as unknown as ChatOutboundMessageRepository,
      hotels: {
        findByTelegramCheckInGroupId: jest.fn().mockResolvedValue(null),
        findByTelegramTranscriptGroupId: jest.fn().mockResolvedValue(null),
      },
      sleep: () => Promise.resolve(),
    });

    await expect(
      service.editMessage(TARGET.conversationId, '222', { message: 'Done' }),
    ).rejects.toThrow(/Forbidden/);
  });
});
