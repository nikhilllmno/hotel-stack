/**
 * Postgres `interval` value as parsed by node-postgres. The driver returns an
 * object (via the `postgres-interval` package), not a string — every component
 * is optional and present only when non-zero.
 */
export interface PgInterval {
  years?: number;
  months?: number;
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;
}

/**
 * One row from `pg_stat_activity`, filtered to long-running / idle-in-transaction
 * backends. Interval columns (`xact_age`, `idle_for`) are returned by the pg
 * driver as {@link PgInterval} objects.
 */
export interface DbActivityRow {
  pid: number;
  usename: string | null;
  application_name: string | null;
  client_addr: string | null;
  state: string | null;
  xact_start: Date | null;
  state_change: Date | null;
  xact_age: PgInterval | string | null;
  idle_for: PgInterval | string | null;
  wait_event_type: string | null;
  wait_event: string | null;
  backend_xid: string | null;
  backend_xmin: string | null;
  query: string | null;
}
