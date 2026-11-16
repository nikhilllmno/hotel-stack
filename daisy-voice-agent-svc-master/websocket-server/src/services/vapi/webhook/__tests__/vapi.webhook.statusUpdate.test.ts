import { StatusUpdateType } from '../../../../models/request/StatusUpdate';
import { VapiWebhookService } from '../vapi.webhook.service';

const TOKEN = 'test-server-token';

/** Collects the `stat` of every EMF line logKpi wrote, ignoring winston output. */
function collectKpiStats(
  consoleSpy: jest.SpiedFunction<typeof console.log>,
): string[] {
  const stats: string[] = [];
  for (const call of consoleSpy.mock.calls) {
    const [first] = call;
    if (typeof first !== 'string') continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(first) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (parsed._aws !== undefined && typeof parsed.stat === 'string') {
      stats.push(parsed.stat);
    }
  }
  return stats;
}

function buildService(): {
  service: VapiWebhookService;
  upsertSessionData: jest.Mock;
} {
  const upsertSessionData = jest.fn().mockResolvedValue({ id: 'session-1' });
  const service = new VapiWebhookService({
    assistantServerToken: TOKEN,
    conversationService: {} as never,
    sessionService: { upsertSessionData } as never,
    roomReservationService: {} as never,
    escalationService: {} as never,
    hotelService: {} as never,
    notificationFactory: {} as never,
    smsService: {} as never,
    discountService: {} as never,
    hotelConfigurationService: {} as never,
    followupPaymentLinkService: {} as never,
  });
  return { service, upsertSessionData };
}

function statusUpdatePayload(status: string): unknown {
  return {
    message: {
      type: 'status-update',
      status,
      call: { id: 'call-1', customer: { number: '+15551110000' } },
      phoneNumber: { number: '+15552220000' },
    },
  };
}

describe('VapiWebhookService status-update KPI gating', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(['queued', 'ringing', 'forwarding'])(
    'does not emit call.started for the pre-answer status %s',
    async (status) => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      const { service, upsertSessionData } = buildService();

      await service.handleWebhookEvent(statusUpdatePayload(status), TOKEN);

      // The session is still upserted, and deliberately narrowed to
      // InProgress: session_status is alive-or-ended everywhere that reads
      // it, so a pre-answer call has no state of its own. Only the metric
      // is gated.
      expect(upsertSessionData).toHaveBeenCalledTimes(1);
      expect(upsertSessionData).toHaveBeenCalledWith(
        expect.objectContaining({
          session_status: StatusUpdateType.InProgress,
        }),
      );
      expect(collectKpiStats(consoleSpy)).toEqual([]);
    },
  );

  it('emits exactly one call.started for in-progress', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { service } = buildService();

    await service.handleWebhookEvent(statusUpdatePayload('in-progress'), TOKEN);

    expect(collectKpiStats(consoleSpy)).toEqual(['call.started']);
  });

  it('emits exactly one call.ended for ended', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { service } = buildService();

    await service.handleWebhookEvent(statusUpdatePayload('ended'), TOKEN);

    expect(collectKpiStats(consoleSpy)).toEqual(['call.ended']);
  });

  it('emits one call.started and one call.ended across a full call lifecycle', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { service } = buildService();

    for (const status of ['queued', 'ringing', 'in-progress', 'ended']) {
      await service.handleWebhookEvent(statusUpdatePayload(status), TOKEN);
    }

    expect(collectKpiStats(consoleSpy)).toEqual(['call.started', 'call.ended']);
  });
});
