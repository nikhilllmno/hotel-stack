import dayjs from 'dayjs';
import config from '../../config';
import { Reservation as ReservationDTO } from '../../dtos/Reservation';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { DbActivityRow, PgInterval } from '../../models/DbActivity';
import { Payment } from '../../models/Payment';
import { DbActivityRepository } from '../../repositories/DbActivityRepository';
import { PaymentRepository } from '../../repositories/PaymentRepository';
import { ReservationRepository } from '../../repositories/ReservationRepository';
import { formatCurrencyAmount } from '../../utils/helper';
import { KpiStat, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import { SlackService } from '../slack/slackService';
import { SlackSendResult } from '../slack/types';

export interface DbActivityReport {
  /** Number of matching backends found by the query. */
  count: number;
  /** The raw rows returned (useful for the HTTP response / debugging). */
  rows: DbActivityRow[];
  /** Per-message Slack delivery results (one per row, or one for the "all clear"). */
  slackResults: SlackSendResult[];
}

export interface PaymentReservationMismatchResult {
  payment_id: string;
  reservation_id: string;
  hotel_id: string;
  status: 'alerted' | 'error';
  detail?: string;
}

export interface PaymentReservationMismatchReport {
  count: number;
  results: PaymentReservationMismatchResult[];
}

/**
 * Home for scheduled/cron-style monitoring jobs (see `/jobs` routes in
 * `scheduledJobsRouter.ts`) that detect an anomaly and report it to the
 * shared Daisy alerts Slack channel. Each monitor is a self-contained public
 * method with its own repository dependencies; add new monitors here rather
 * than creating a new single-purpose service per job.
 */
export class MonitoringService {
  constructor(
    private readonly dbActivityRepository: DbActivityRepository = new DbActivityRepository(),
    private readonly paymentRepository: PaymentRepository = new PaymentRepository(),
    private readonly reservationRepository: ReservationRepository = new ReservationRepository(),
    private readonly slackService: SlackService = new SlackService(),
  ) {}

  // ---- DB activity monitor ----

  async reportLongRunningTransactions(): Promise<DbActivityReport> {
    const rows = await this.dbActivityRepository.getLongRunningTransactions();

    logger.info(
      `MonitoringService::reportLongRunningTransactions - found ${rows.length} backend(s)`,
    );

    if (rows.length === 0) {
      const slackResults = await this.slackService.sendMessages(
        [
          [
            '✅ *DB activity check — all good.*',
            'No backends were found in any of the monitored states:',
            '> • *idle in transaction* — open transaction sitting idle (holds locks/bloat)',
            '> • *idle in transaction (aborted)* — failed transaction not rolled back or committed',
            '> • *active* transactions running for longer than *1 minute*',
          ].join('\n'),
        ],
        config.SLACK_DAISY_ALERT_WEBHOOK_URL,
      );
      return { count: 0, rows, slackResults };
    }

    const messages = rows.map((row, index) =>
      this.formatDbActivityRow(row, index + 1, rows.length),
    );
    const slackResults = await this.slackService.sendMessages(
      messages,
      config.SLACK_DAISY_ALERT_WEBHOOK_URL,
    );

    return { count: rows.length, rows, slackResults };
  }

  /**
   * Formats a single backend row into a readable Slack mrkdwn message, grouped
   * into logical sections (identity → timing → transaction → query) with a
   * divider between each so it scans cleanly in the channel.
   */
  private formatDbActivityRow(
    row: DbActivityRow,
    index: number,
    total: number,
  ): string {
    const line = (label: string, value: unknown): string =>
      `> *${label.padEnd(14)}* ${this.formatDbActivityValue(value)}`;
    const divider = '────────────────────────────';

    return [
      `:rotating_light: *Long-running / idle-in-transaction backend* — *${index} of ${total}*`,
      '',
      '*Connection*',
      line('PID', row.pid),
      line('User', row.usename),
      line('Application', row.application_name),
      line('Client', row.client_addr),
      line('State', row.state),
      divider,
      '*Timing*',
      line('Xact age', row.xact_age),
      line('Idle for', row.idle_for),
      line('Xact start', row.xact_start),
      line('State change', row.state_change),
      divider,
      '*Transaction*',
      line('Wait event', this.formatDbActivityWaitEvent(row)),
      line('Backend xid', row.backend_xid),
      line('Backend xmin', row.backend_xmin),
      divider,
      '*Query*',
      // Query goes in a code block, truncated so we never blow past Slack's limits.
      `\`\`\`${this.truncate(row.query, 2500)}\`\`\``,
    ].join('\n');
  }

  private formatDbActivityWaitEvent(row: DbActivityRow): string {
    if (!row.wait_event_type && !row.wait_event) return '—';
    return [row.wait_event_type, row.wait_event].filter(Boolean).join(' / ');
  }

  private formatDbActivityValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    if (value instanceof Date) return value.toISOString();
    // pg returns interval columns (xact_age, idle_for) as objects, not strings.
    if (typeof value === 'object')
      return this.formatInterval(value as PgInterval);
    return String(value);
  }

  /** Renders a pg interval object as a compact human string, e.g. "2m 13s" or "1h 4m 9s". */
  private formatInterval(interval: PgInterval): string {
    const parts: string[] = [];
    if (interval.years) parts.push(`${interval.years}y`);
    if (interval.months) parts.push(`${interval.months}mo`);
    if (interval.days) parts.push(`${interval.days}d`);
    if (interval.hours) parts.push(`${interval.hours}h`);
    if (interval.minutes) parts.push(`${interval.minutes}m`);
    // Fold sub-second precision into the seconds component.
    const seconds =
      (interval.seconds ?? 0) + (interval.milliseconds ?? 0) / 1000;
    if (seconds || parts.length === 0) {
      parts.push(`${Number(seconds.toFixed(1))}s`);
    }
    return parts.join(' ');
  }

  private truncate(value: string | null, max: number): string {
    if (!value) return '—';
    return value.length > max ? `${value.slice(0, max)}… [truncated]` : value;
  }

  // ---- Paid reservation / PMS mismatch monitor ----

  /**
   * Detects payments that completed successfully while the reservation(s)
   * they are attached to never left INACTIVE — i.e. PMS reservation creation
   * failed and was never retried. `stripeWebhookService.handlePaymentIntentSucceeded`
   * already escalates this in real time when the failure happens, but a
   * crash mid-flow or a non-webhook payment path can slip through; this job
   * re-checks and reports anything still unresolved. Every match is posted
   * to Slack on every run — duplicates across runs are expected and fine,
   * since resolving the underlying reservation is what stops it from being
   * reported again.
   */
  async findAndReportPaidReservationsWithFailedPmsCreation(): Promise<PaymentReservationMismatchReport> {
    const payments =
      await this.paymentRepository.findCompletedPaymentsWithInactiveReservations();

    if (!payments.length) {
      return { count: 0, results: [] };
    }

    const reservationIds = [
      ...new Set(payments.flatMap((payment) => payment.reservation_ids ?? [])),
    ];
    const reservations =
      (await this.reservationRepository.findManyReservationWithDetailsByIds(
        reservationIds,
      )) ?? [];
    const reservationsById = new Map(
      reservations.map((reservation) => [reservation.id, reservation]),
    );

    const results: PaymentReservationMismatchResult[] = [];

    for (const payment of payments) {
      for (const reservationId of payment.reservation_ids ?? []) {
        const reservation = reservationsById.get(reservationId);
        if (!reservation || reservation.status !== ReservationStatus.INACTIVE) {
          continue;
        }
        results.push(
          await this.reportPaymentReservationMismatch(payment, reservation),
        );
      }
    }

    logger.info(
      `MonitoringService::findAndReportPaidReservationsWithFailedPmsCreation - found ${results.length} paid-but-not-created reservation(s)`,
    );

    return { count: results.length, results };
  }

  private async reportPaymentReservationMismatch(
    payment: Payment,
    reservation: ReservationDTO,
  ): Promise<PaymentReservationMismatchResult> {
    const base = {
      payment_id: payment.id,
      reservation_id: reservation.id,
      hotel_id: reservation.hotel_id,
    };

    logKpi({
      stat: KpiStat.ReservationPaidPmsCreationFailed,
      value: 1,
      contextName:
        'MonitoringService.findAndReportPaidReservationsWithFailedPmsCreation',
      clientId:
        reservation.hotel?.assistant_phone_number ?? reservation.hotel_id,
      contextId: reservation.id,
    });

    try {
      await this.notifySlackOfPaymentReservationMismatch(payment, reservation);
      return { ...base, status: 'alerted' };
    } catch (error) {
      logger.error(
        `MonitoringService::reportPaymentReservationMismatch - Failed to post Slack alert for reservation ${reservation.id}: ${error}`,
      );
      return {
        ...base,
        status: 'error',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async notifySlackOfPaymentReservationMismatch(
    payment: Payment,
    reservation: ReservationDTO,
  ): Promise<void> {
    if (!config.SLACK_DAISY_ALERT_WEBHOOK_URL) {
      throw new Error('SLACK_DAISY_ALERT_WEBHOOK_URL is not configured');
    }

    const lines = [
      ':rotating_light: *Payment completed but PMS reservation was never created*',
      `> *Hotel*          ${reservation.hotel?.name ?? reservation.hotel_id}`,
      `> *Guest*          ${reservation.customer.first_name} ${reservation.customer.last_name} (${reservation.phone_number})`,
      `> *Amount*         ${formatCurrencyAmount(payment.currency, payment.amount_charged)}`,
      `> *Check-in*       ${dayjs(reservation.check_in).format('DD/MM/YYYY')}`,
      `> *Check-out*      ${dayjs(reservation.check_out).format('DD/MM/YYYY')}`,
      `> *Payment ID*     ${payment.id}`,
      `> *Reservation ID* ${reservation.id}`,
    ];

    await this.slackService.sendMessage({
      // `recipient` doubles as the destination webhook URL for Slack (unlike
      // SMS/Telegram, which use it for a phone number/chat ID).
      recipient: config.SLACK_DAISY_ALERT_WEBHOOK_URL,
      content: { message: lines.join('\n') },
    });
  }
}

export const monitoringService = new MonitoringService();
