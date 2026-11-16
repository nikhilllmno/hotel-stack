process.env.DEXTR_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/dextr-alerts';
process.env.SLACK_DAISY_ALERT_WEBHOOK_URL =
  'https://hooks.slack.test/ops-alerts';
process.env.CLOUDBEDS_CLIENT_ID = 'test-client-id';

import { CloudbedsWebhookService } from '@/cloudbeds/services/cloudbedsWebhookService';
import { CloudbedsAppStateChangedPayload } from '@/cloudbeds/types/WebhookPayload';
import config from '@/config';
import { Hotel } from '@/models/Hotel';
import { Country, PaymentProvider } from '@/types/enums';

function buildHotel(): Hotel {
  return {
    id: 'hotel-uuid-1',
    name: 'Test Hotel',
    business_id: '12345',
    pms_provider: 'cloudbeds',
    assistant_phone_number: '+15551234567',
    country: Country.US,
    timezone: 'America/New_York',
    telegram_check_in_group_id: 'group-1',
    telegram_alerts_group_id: 'group-2',
    sms_number: '+15551234567',
    internal_phone_number: '+15551234568',
    url: 'https://hotel.test',
    address: '1 Test St',
    image_url: 'https://hotel.test/image.png',
    currency: 'USD',
    payment_provider: PaymentProvider.SHIFT4,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function buildAppStatePayload(
  overrides: Partial<CloudbedsAppStateChangedPayload> = {},
): CloudbedsAppStateChangedPayload {
  return {
    version: '1.0',
    timestamp: 1611758157.431234,
    event: 'integration/appstate_changed',
    propertyID: '12345',
    clientID: 'test-client-id',
    oldState: 'enabled',
    newState: 'disabled',
    ...overrides,
  };
}

describe('CloudbedsWebhookService – integration/appstate_changed', () => {
  const mockHotelService = {
    getHotelByBusinessId: jest.fn(),
  };

  const mockSyncService = {
    findLocalReservation: jest.fn(),
    syncCreateReservation: jest.fn(),
    syncUpdateReservation: jest.fn(),
  };

  const mockClient = {
    getReservation: jest.fn(),
  };

  const mockHotelConfigService = {
    setExternalAuthConfigDisabledAt: jest.fn(),
  };

  // Single Slack client — the destination webhook is chosen per call via
  // `recipient`, not baked into the constructor.
  const mockSlackService = {
    sendMessage: jest.fn(),
  };

  let service: CloudbedsWebhookService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CloudbedsWebhookService(
      mockHotelService as any,
      mockSyncService as any,
      mockClient as any,
      mockHotelConfigService as any,
      undefined,
      mockSlackService as any,
    );
  });

  it('sets external_auth_config.disabledAt and posts a critical Slack alert when newState is disabled and hotel is known', async () => {
    const hotel = buildHotel();
    mockHotelService.getHotelByBusinessId.mockResolvedValue(hotel);
    mockHotelConfigService.setExternalAuthConfigDisabledAt.mockResolvedValue(1);
    mockSlackService.sendMessage.mockResolvedValue(undefined);

    const payload = buildAppStatePayload();
    const result = await service.handleWebhookEvent(payload);

    expect(mockHotelService.getHotelByBusinessId).toHaveBeenCalledWith('12345');
    expect(
      mockHotelConfigService.setExternalAuthConfigDisabledAt,
    ).toHaveBeenCalledWith('hotel-uuid-1', expect.any(Date));
    expect(mockSlackService.sendMessage).toHaveBeenCalledTimes(1);
    const [slackPayload] = mockSlackService.sendMessage.mock.calls[0];
    expect(slackPayload.recipient).toBe(config.DEXTR_SLACK_WEBHOOK_URL);
    expect(slackPayload.content.message).toContain(hotel.name);
    expect(result).toEqual({
      success: true,
      message: 'Integration disabled, Cloudbeds API access blocked',
    });
  });

  it('ignores non-actionable state transitions without touching the DB or hotel lookup', async () => {
    const payload = buildAppStatePayload({
      oldState: 'enabled',
      newState: 'suspended',
    });
    const result = await service.handleWebhookEvent(payload);

    expect(mockHotelService.getHotelByBusinessId).not.toHaveBeenCalled();
    expect(
      mockHotelConfigService.setExternalAuthConfigDisabledAt,
    ).not.toHaveBeenCalled();
    expect(mockSlackService.sendMessage).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'App state suspended not actionable, ignored',
    });
  });

  it('posts a Slack alert naming the property when newState is enabled and hotel is known', async () => {
    const hotel = buildHotel();
    mockHotelService.getHotelByBusinessId.mockResolvedValue(hotel);
    mockSlackService.sendMessage.mockResolvedValue(undefined);

    const payload = buildAppStatePayload({
      oldState: 'disabled',
      newState: 'enabled',
    });
    const result = await service.handleWebhookEvent(payload);

    expect(mockHotelService.getHotelByBusinessId).toHaveBeenCalledWith('12345');
    expect(
      mockHotelConfigService.setExternalAuthConfigDisabledAt,
    ).not.toHaveBeenCalled();
    expect(mockSlackService.sendMessage).toHaveBeenCalledTimes(1);
    const [slackPayload] = mockSlackService.sendMessage.mock.calls[0];
    expect(slackPayload.recipient).toBe(config.DEXTR_SLACK_WEBHOOK_URL);
    expect(slackPayload.content.message).toContain(hotel.name);
    expect(result).toEqual({
      success: true,
      message: 'Integration connected',
    });
  });

  it('ignores newState enabled for an unknown property without posting a Slack alert', async () => {
    mockHotelService.getHotelByBusinessId.mockResolvedValue(null);

    const payload = buildAppStatePayload({
      oldState: 'disabled',
      newState: 'enabled',
      propertyID: '99999',
    });
    const result = await service.handleWebhookEvent(payload);

    expect(mockHotelService.getHotelByBusinessId).toHaveBeenCalledWith('99999');
    expect(mockSlackService.sendMessage).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'Ignored: unknown property',
    });
  });

  it('ignores appstate_changed events for a different Cloudbeds clientID', async () => {
    const payload = buildAppStatePayload({ clientID: 'someone-elses-app' });
    const result = await service.handleWebhookEvent(payload);

    expect(mockHotelService.getHotelByBusinessId).not.toHaveBeenCalled();
    expect(
      mockHotelConfigService.setExternalAuthConfigDisabledAt,
    ).not.toHaveBeenCalled();
    expect(mockSlackService.sendMessage).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'Ignored: not our Cloudbeds app',
    });
  });

  it('throws and alerts the shared ops channel when CLOUDBEDS_CLIENT_ID is not configured', async () => {
    const originalClientId = config.CLOUDBEDS_CLIENT_ID;
    config.CLOUDBEDS_CLIENT_ID = '';
    mockSlackService.sendMessage.mockResolvedValue(undefined);
    try {
      const payload = buildAppStatePayload();

      await expect(service.handleWebhookEvent(payload)).rejects.toThrow(
        'CLOUDBEDS_CLIENT_ID is not configured',
      );

      expect(mockHotelService.getHotelByBusinessId).not.toHaveBeenCalled();
      expect(
        mockHotelConfigService.setExternalAuthConfigDisabledAt,
      ).not.toHaveBeenCalled();
      expect(mockSlackService.sendMessage).toHaveBeenCalledTimes(1);
      const [opsAlertPayload] = mockSlackService.sendMessage.mock.calls[0];
      expect(opsAlertPayload.recipient).toBe(
        config.SLACK_DAISY_ALERT_WEBHOOK_URL,
      );
      expect(opsAlertPayload.content.message).toContain(
        'CLOUDBEDS_CLIENT_ID is not configured',
      );
    } finally {
      config.CLOUDBEDS_CLIENT_ID = originalClientId;
    }
  });

  it('returns success without DB call for unknown propertyID', async () => {
    mockHotelService.getHotelByBusinessId.mockResolvedValue(null);

    const payload = buildAppStatePayload({ propertyID: '99999' });
    const result = await service.handleWebhookEvent(payload);

    expect(mockHotelService.getHotelByBusinessId).toHaveBeenCalledWith('99999');
    expect(
      mockHotelConfigService.setExternalAuthConfigDisabledAt,
    ).not.toHaveBeenCalled();
    expect(mockSlackService.sendMessage).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'Ignored: unknown property',
    });
  });

  it('prefers propertyID_str over the numeric propertyID to avoid precision loss on large IDs', async () => {
    mockHotelService.getHotelByBusinessId.mockResolvedValue(null);

    const payload = buildAppStatePayload({
      propertyID: 9007199254740993,
      propertyID_str: '9007199254740993',
    });
    await service.handleWebhookEvent(payload);

    expect(mockHotelService.getHotelByBusinessId).toHaveBeenCalledWith(
      '9007199254740993',
    );
  });

  it('rethrows and alerts the shared ops channel if the dedicated Slack alert fails', async () => {
    const hotel = buildHotel();
    mockHotelService.getHotelByBusinessId.mockResolvedValue(hotel);
    mockHotelConfigService.setExternalAuthConfigDisabledAt.mockResolvedValue(1);
    mockSlackService.sendMessage.mockImplementation(
      async ({ recipient }: { recipient: string }) => {
        if (recipient === config.DEXTR_SLACK_WEBHOOK_URL) {
          throw new Error('slack down');
        }
      },
    );

    const payload = buildAppStatePayload();

    await expect(service.handleWebhookEvent(payload)).rejects.toThrow(
      'slack down',
    );

    // disabledAt was already set before the alert failed — not rolled back.
    expect(
      mockHotelConfigService.setExternalAuthConfigDisabledAt,
    ).toHaveBeenCalledWith('hotel-uuid-1', expect.any(Date));
    expect(mockSlackService.sendMessage).toHaveBeenCalledTimes(2);
    const [disabledAlertPayload, opsAlertPayload] =
      mockSlackService.sendMessage.mock.calls.map(([payload]) => payload);
    expect(disabledAlertPayload.recipient).toBe(config.DEXTR_SLACK_WEBHOOK_URL);
    expect(opsAlertPayload.recipient).toBe(
      config.SLACK_DAISY_ALERT_WEBHOOK_URL,
    );
    expect(opsAlertPayload.content.message).toContain('slack down');
  });

  it('alerts the shared ops channel and rethrows on an unrelated processing error', async () => {
    mockHotelService.getHotelByBusinessId.mockRejectedValue(
      new Error('db unavailable'),
    );
    mockSlackService.sendMessage.mockResolvedValue(undefined);

    const payload = buildAppStatePayload();

    await expect(service.handleWebhookEvent(payload)).rejects.toThrow(
      'db unavailable',
    );

    expect(
      mockHotelConfigService.setExternalAuthConfigDisabledAt,
    ).not.toHaveBeenCalled();
    expect(mockSlackService.sendMessage).toHaveBeenCalledTimes(1);
    const [opsAlertPayload] = mockSlackService.sendMessage.mock.calls[0];
    expect(opsAlertPayload.recipient).toBe(
      config.SLACK_DAISY_ALERT_WEBHOOK_URL,
    );
    expect(opsAlertPayload.content.message).toContain('db unavailable');
  });
});
