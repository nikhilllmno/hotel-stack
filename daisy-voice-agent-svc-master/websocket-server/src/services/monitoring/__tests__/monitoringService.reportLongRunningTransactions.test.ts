import { DbActivityRow } from '@/models/DbActivity';
import { DbActivityRepository } from '@/repositories/DbActivityRepository';
import { MonitoringService } from '@/services/monitoring/monitoringService';
import { SlackService } from '@/services/slack/slackService';
import { SlackSendResult } from '@/services/slack/types';

describe('MonitoringService.reportLongRunningTransactions', () => {
  let mockRepository: jest.Mocked<
    Pick<DbActivityRepository, 'getLongRunningTransactions'>
  >;
  let mockSlack: jest.Mocked<Pick<SlackService, 'sendMessages'>>;
  let service: MonitoringService;

  const buildService = (): MonitoringService =>
    new MonitoringService(
      mockRepository as unknown as DbActivityRepository,
      undefined,
      undefined,
      mockSlack as unknown as SlackService,
    );

  const sampleRow = (
    overrides: Partial<DbActivityRow> = {},
  ): DbActivityRow => ({
    pid: 4242,
    usename: 'daisy',
    application_name: 'daisy-voice-agent',
    client_addr: '10.0.0.5',
    state: 'idle in transaction',
    xact_start: new Date('2026-07-15T10:00:00.000Z'),
    state_change: new Date('2026-07-15T10:00:30.000Z'),
    xact_age: { minutes: 2, seconds: 13 },
    idle_for: { minutes: 1, seconds: 43 },
    wait_event_type: 'Client',
    wait_event: 'ClientRead',
    backend_xid: '12345',
    backend_xmin: '12000',
    query: 'SELECT * FROM reservations WHERE id = 1',
    ...overrides,
  });

  const ok = (): SlackSendResult => ({ success: true });

  beforeEach(() => {
    mockRepository = { getLongRunningTransactions: jest.fn() };
    mockSlack = { sendMessages: jest.fn() };
    service = buildService();
  });

  it('sends one Slack message per offending backend and returns the count', async () => {
    const rows = [sampleRow({ pid: 1 }), sampleRow({ pid: 2 })];
    mockRepository.getLongRunningTransactions.mockResolvedValue(rows);
    mockSlack.sendMessages.mockResolvedValue([ok(), ok()]);

    const report = await service.reportLongRunningTransactions();

    expect(mockRepository.getLongRunningTransactions).toHaveBeenCalledTimes(1);
    expect(report.count).toBe(2);
    expect(report.rows).toBe(rows);
    expect(report.slackResults).toEqual([ok(), ok()]);

    expect(mockSlack.sendMessages).toHaveBeenCalledTimes(1);
    const [messages] = mockSlack.sendMessages.mock.calls[0];
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain(':rotating_light:');
    expect(messages[0]).toContain('*1 of 2*');
    expect(messages[1]).toContain('*2 of 2*');
  });

  it('sends a single "all good" message when no backends are found', async () => {
    mockRepository.getLongRunningTransactions.mockResolvedValue([]);
    mockSlack.sendMessages.mockResolvedValue([ok()]);

    const report = await service.reportLongRunningTransactions();

    expect(report.count).toBe(0);
    expect(report.rows).toEqual([]);
    expect(report.slackResults).toEqual([ok()]);

    const [messages] = mockSlack.sendMessages.mock.calls[0];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('DB activity check — all good.');
  });

  it('propagates per-message Slack delivery failures without throwing', async () => {
    mockRepository.getLongRunningTransactions.mockResolvedValue([sampleRow()]);
    const failure: SlackSendResult = { success: false, error: 'no_service' };
    mockSlack.sendMessages.mockResolvedValue([failure]);

    const report = await service.reportLongRunningTransactions();

    expect(report.count).toBe(1);
    expect(report.slackResults).toEqual([failure]);
  });

  it('formats interval columns, null values, wait event and query into the message', async () => {
    mockRepository.getLongRunningTransactions.mockResolvedValue([
      sampleRow({
        pid: 99,
        usename: null,
        xact_age: { hours: 1, minutes: 4, seconds: 9 },
        wait_event_type: 'Lock',
        wait_event: 'transactionid',
      }),
    ]);
    mockSlack.sendMessages.mockResolvedValue([ok()]);

    await service.reportLongRunningTransactions();

    const [messages] = mockSlack.sendMessages.mock.calls[0];
    const message = messages[0] as string;

    expect(message).toContain('99'); // pid rendered
    expect(message).toContain('—'); // null usename rendered as em dash
    expect(message).toContain('1h 4m 9s'); // interval formatted compactly
    expect(message).toContain('Lock / transactionid'); // wait event joined
    expect(message).toContain('```SELECT * FROM reservations WHERE id = 1```');
  });

  it('truncates an oversized query before sending it to Slack', async () => {
    const longQuery = 'x'.repeat(3000);
    mockRepository.getLongRunningTransactions.mockResolvedValue([
      sampleRow({ query: longQuery }),
    ]);
    mockSlack.sendMessages.mockResolvedValue([ok()]);

    await service.reportLongRunningTransactions();

    const [messages] = mockSlack.sendMessages.mock.calls[0];
    const message = messages[0] as string;

    expect(message).toContain('… [truncated]');
    expect(message).not.toContain('x'.repeat(3000));
  });

  it('does not call Slack when the repository query fails', async () => {
    mockRepository.getLongRunningTransactions.mockRejectedValue(
      new Error('pg_stat_activity unavailable'),
    );

    await expect(service.reportLongRunningTransactions()).rejects.toThrow(
      'pg_stat_activity unavailable',
    );
    expect(mockSlack.sendMessages).not.toHaveBeenCalled();
  });
});
