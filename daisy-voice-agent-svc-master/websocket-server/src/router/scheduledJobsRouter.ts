import { RequestHandler, Router } from 'express';
import { ScheduledJobsController } from '../controller/scheduledJobsController';
import escalationService from '../services/escalation/escalationService';
import { hotelService } from '../services/hotel/hotelService';

const scheduledJobsController = new ScheduledJobsController(
  hotelService,
  escalationService,
);

const scheduledJobsRouter = Router();

scheduledJobsRouter.post(
  '/hotels/room-types/sync',
  scheduledJobsController.syncStayntouchRoomTypes as RequestHandler,
);

/**
 * POST /jobs/stayntouch/token/refresh
 *
 * Calls the Stayntouch OAuth endpoint to obtain a fresh bearer token,
 * encrypts it, and stores it in the database.
 *
 * Invoke this via an AWS EventBridge Scheduler rule + Lambda on a ~25-day
 * cadence (the token expires every 30 days).
 *
 * Authentication: x-api-key header (DAISY_INBOUND_API_KEYS) — enforced by the
 * apiKeyMiddleware applied to /jobs in router/index.ts.
 */
scheduledJobsRouter.post(
  '/stayntouch/token/refresh',
  scheduledJobsController.refreshStayntouchToken as RequestHandler,
);

/**
 * POST /jobs/remotelock/token/refresh
 *
 * Refreshes the RemoteLock OAuth token for every hotel that has a stored
 * refresh token in external_auth_config, encrypts the new access + refresh
 * tokens, and stores them back there.
 *
 * Authentication: x-api-key header (DAISY_INBOUND_API_KEYS) — enforced by the
 * apiKeyMiddleware applied to /jobs in router/index.ts.
 */
scheduledJobsRouter.post(
  '/remotelock/token/refresh',
  scheduledJobsController.refreshRemoteLockToken as RequestHandler,
);

/**
 * POST /jobs/hotels/rates/sync
 *
 * Fetches hotel rates from the Stayntouch API for all Stayntouch hotels
 * and caches the response in hotel_configurations.hotel_rates.
 *
 * Invoke via AWS EventBridge Scheduler + Lambda on a daily cadence.
 */
scheduledJobsRouter.post(
  '/hotels/rates/sync',
  scheduledJobsController.syncHotelRates as RequestHandler,
);

/**
 * POST /jobs/escalations/report
 *
 * Sends a daily summary of open escalations to each hotel's Telegram group.
 * Only fires when the hotel's local time is within the configured reporting window.
 *
 * Invoke via AWS EventBridge on a 15-30 min cadence (matching cron_window_minutes
 * in escalation_report_configuration).
 */
scheduledJobsRouter.post(
  '/escalations/report',
  scheduledJobsController.sendEscalationReport as RequestHandler,
);

/**
 * POST /jobs/escalations/reminders
 *
 * Sends reminder replies to escalation messages that are still open past the
 * configured delay. Uses the same Lambda cadence as the report endpoint.
 */
scheduledJobsRouter.post(
  '/escalations/reminders',
  scheduledJobsController.sendEscalationReminders as RequestHandler,
);

/**
 * POST /jobs/db/long-running-transactions
 *
 * Runs the pg_stat_activity monitoring query (idle-in-transaction backends and
 * transactions active for > 1 minute) and posts each matching row to Slack as
 * its own message. Returns a delivery summary plus the raw rows.
 *
 * Invoke on a schedule (e.g. AWS EventBridge + Lambda).
 */
scheduledJobsRouter.post(
  '/db/long-running-transactions',
  scheduledJobsController.reportLongRunningTransactions as RequestHandler,
);

/**
 * POST /jobs/reservations/paid-not-created
 *
 * Finds payments that completed successfully while the reservation(s) they
 * are attached to are still INACTIVE (PMS reservation creation failed and
 * was never retried), and escalates any not already under an open
 * escalation for that reservation's session.
 *
 * Invoke via AWS EventBridge Scheduler + Lambda (e.g. twice daily).
 */
scheduledJobsRouter.post(
  '/reservations/paid-not-created',
  scheduledJobsController.reportPaidReservationsWithFailedPmsCreation as RequestHandler,
);

export default scheduledJobsRouter;
