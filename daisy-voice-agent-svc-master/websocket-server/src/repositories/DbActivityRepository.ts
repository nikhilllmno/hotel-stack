import { DbActivityRow } from '../models/DbActivity';
import { BaseRepository } from './BaseRepository';

/**
 * Read-only access to `pg_stat_activity` for connection/transaction monitoring.
 */
export class DbActivityRepository extends BaseRepository {
  /**
   * Returns backends that are either stuck in a transaction
   * ('idle in transaction' / 'idle in transaction (aborted)') or actively
   * running a transaction for longer than one minute — the usual suspects for
   * lock contention and bloat. Ordered oldest-transaction-first.
   */
  async getLongRunningTransactions(): Promise<DbActivityRow[]> {
    const result = await this.db.raw(`
      SELECT pid,
             usename,
             application_name,
             client_addr,
             state,
             xact_start,
             state_change,
             now() - xact_start  AS xact_age,
             now() - state_change AS idle_for,
             wait_event_type,
             wait_event,
             backend_xid,
             backend_xmin,
             query
      FROM pg_stat_activity
      WHERE state IN ('idle in transaction', 'idle in transaction (aborted)')
         OR (state = 'active' AND now() - xact_start > interval '1 minute')
      ORDER BY xact_start NULLS LAST;
    `);

    // node-postgres returns { rows }; pg-mem/knex may return the array directly.
    return (result.rows ?? result) as DbActivityRow[];
  }
}
