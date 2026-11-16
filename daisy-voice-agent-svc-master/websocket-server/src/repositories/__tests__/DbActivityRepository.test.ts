import { DbActivityRow } from '@/models/DbActivity';
import { DbActivityRepository } from '@/repositories/DbActivityRepository';
import { Knex } from 'knex';

// `pg_stat_activity` is a live server catalog that pg-mem can't emulate, so the
// repository is unit-tested against a stub knex whose `raw` we control/assert on.
describe('DbActivityRepository.getLongRunningTransactions', () => {
  let rawMock: jest.Mock;
  let repository: DbActivityRepository;

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
    query: 'SELECT 1',
    ...overrides,
  });

  beforeEach(() => {
    rawMock = jest.fn();
    repository = new DbActivityRepository({ raw: rawMock } as unknown as Knex);
  });

  it('queries pg_stat_activity for the monitored states, oldest transaction first', async () => {
    rawMock.mockResolvedValue({ rows: [] });

    await repository.getLongRunningTransactions();

    expect(rawMock).toHaveBeenCalledTimes(1);
    const sql = rawMock.mock.calls[0][0] as string;
    expect(sql).toContain('FROM pg_stat_activity');
    expect(sql).toContain("'idle in transaction'");
    expect(sql).toContain("'idle in transaction (aborted)'");
    expect(sql).toContain("state = 'active'");
    expect(sql).toContain("now() - xact_start > interval '1 minute'");
    expect(sql).toContain('ORDER BY xact_start NULLS LAST');
  });

  it('unwraps the node-postgres { rows } result shape', async () => {
    const rows = [sampleRow({ pid: 1 }), sampleRow({ pid: 2 })];
    rawMock.mockResolvedValue({ rows });

    const result = await repository.getLongRunningTransactions();

    expect(result).toBe(rows);
  });

  it('returns a bare array result directly (pg-mem/knex shape)', async () => {
    const rows = [sampleRow({ pid: 7 })];
    rawMock.mockResolvedValue(rows);

    const result = await repository.getLongRunningTransactions();

    expect(result).toBe(rows);
  });

  it('returns an empty array when no backends match', async () => {
    rawMock.mockResolvedValue({ rows: [] });

    const result = await repository.getLongRunningTransactions();

    expect(result).toEqual([]);
  });

  it('propagates query errors', async () => {
    rawMock.mockRejectedValue(
      new Error('permission denied for pg_stat_activity'),
    );

    await expect(repository.getLongRunningTransactions()).rejects.toThrow(
      'permission denied for pg_stat_activity',
    );
  });
});
