import { Request, Response } from 'express';
import { remoteLockTokenService } from '../remotelock/services/tokenService';
import { EscalationService } from '../services/escalation/escalationService';
import { HotelService } from '../services/hotel/hotelService';
import {
  MonitoringService,
  monitoringService as defaultMonitoringService,
} from '../services/monitoring/monitoringService';
import { stayntouchTokenService } from '../stayntouch/services/tokenService';
import logger from '../utils/logger';
import { handleCoreApiErrorAndSendResponse } from './util/helper';

export class ScheduledJobsController {
  constructor(
    private readonly hotelService: HotelService,
    private readonly escalationService: EscalationService,
    private readonly monitoringService: MonitoringService = defaultMonitoringService,
  ) {}

  public syncStayntouchRoomTypes = async (_req: Request, res: Response) => {
    try {
      logger.info(
        'ScheduledJobsController::syncStayntouchRoomTypes - Starting room types sync',
      );

      const results =
        await this.hotelService.syncRoomTypesForStayntouchHotels();

      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.length - successCount;

      res.status(200).json({
        success: true,
        message: `Room types sync completed. Success: ${successCount}, Failed: ${failureCount}`,
        results,
        summary: {
          total: results.length,
          successful: successCount,
          failed: failureCount,
        },
      });
    } catch (error: unknown) {
      logger.error(
        'ScheduledJobsController::syncStayntouchRoomTypes - Error:',
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  /**
   * Refreshes the Stayntouch OAuth token by calling the Stayntouch auth endpoint,
   * then stores the new token encrypted in the database.
   *
   * Designed to be invoked on a schedule (e.g. AWS EventBridge every ~25 days)
   * so the token never expires in production.
   *
   * POST /jobs/stayntouch/refresh-token
   */
  public refreshStayntouchToken = async (_req: Request, res: Response) => {
    try {
      logger.info(
        'ScheduledJobsController::refreshStayntouchToken - Starting token refresh',
      );

      const results = await stayntouchTokenService.refreshToken();
      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.length - successCount;

      if (failureCount > 0) {
        logger.error(
          `ScheduledJobsController::refreshStayntouchToken - ${failureCount} of ${results.length} hotel(s) failed to refresh`,
          { results },
        );
      }

      res.status(200).json({
        success: true,
        message: `Stayntouch token refresh completed. Success: ${successCount}, Failed: ${failureCount}`,
        results,
        summary: {
          total: results.length,
          successful: successCount,
          failed: failureCount,
        },
      });
    } catch (error: unknown) {
      logger.error(
        'ScheduledJobsController::refreshStayntouchToken - Error:',
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  /**
   * Refreshes the RemoteLock OAuth token for every hotel that has a stored
   * refresh token in external_auth_config, then stores the new access +
   * refresh tokens encrypted back there.
   *
   * Designed to be invoked on a schedule (e.g. AWS EventBridge, cadence
   * shorter than the token's 7200s expiry) so the token never expires.
   *
   * POST /jobs/remotelock/token/refresh
   */
  public refreshRemoteLockToken = async (_req: Request, res: Response) => {
    try {
      logger.info(
        'ScheduledJobsController::refreshRemoteLockToken - Starting token refresh',
      );

      const results = await remoteLockTokenService.refreshToken();
      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.length - successCount;

      if (failureCount > 0) {
        logger.error(
          `ScheduledJobsController::refreshRemoteLockToken - ${failureCount} of ${results.length} hotel(s) failed to refresh`,
          { results },
        );
      }

      res.status(200).json({
        success: true,
        message: `RemoteLock token refresh completed. Success: ${successCount}, Failed: ${failureCount}`,
        results,
        summary: {
          total: results.length,
          successful: successCount,
          failed: failureCount,
        },
      });
    } catch (error: unknown) {
      logger.error(
        'ScheduledJobsController::refreshRemoteLockToken - Error:',
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  public sendEscalationReport = async (_req: Request, res: Response) => {
    try {
      logger.info(
        'ScheduledJobsController::sendEscalationReport - Starting daily escalation report',
      );

      const results = await this.escalationService.sendDailyReport();

      const sentCount = results.filter((r) => r.status === 'sent').length;
      const skippedCount = results.filter((r) => r.status === 'skipped').length;
      const errorCount = results.filter((r) => r.status === 'error').length;

      res.status(200).json({
        success: true,
        message: `Escalation report completed. Sent: ${sentCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`,
        results,
        summary: {
          total: results.length,
          sent: sentCount,
          skipped: skippedCount,
          errors: errorCount,
        },
      });
    } catch (error: unknown) {
      logger.error(
        'ScheduledJobsController::sendEscalationReport - Error:',
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  public syncHotelRates = async (_req: Request, res: Response) => {
    logger.info(
      'ScheduledJobsController::syncHotelRates - Starting hotel rates sync',
    );

    res.status(202).json({
      success: true,
      message: 'Hotel rates sync started in background',
    });

    this.hotelService
      .syncHotelRatesForStayntouchHotels()
      .then((results) => {
        const successCount = results.filter((r) => r.success).length;
        const failureCount = results.length - successCount;
        logger.info(
          `ScheduledJobsController::syncHotelRates - Sync completed. Success: ${successCount}, Failed: ${failureCount}`,
        );
      })
      .catch((error) => {
        logger.error(
          'ScheduledJobsController::syncHotelRates - Background sync error:',
          error,
        );
      });
  };

  public sendEscalationReminders = async (_req: Request, res: Response) => {
    try {
      logger.info(
        'ScheduledJobsController::sendEscalationReminders - Starting escalation reminders',
      );

      const results = await this.escalationService.sendReminders();

      const sentCount = results.filter((r) => r.status === 'sent').length;
      const skippedCount = results.filter((r) => r.status === 'skipped').length;
      const errorCount = results.filter((r) => r.status === 'error').length;

      res.status(200).json({
        success: true,
        message: `Escalation reminders completed. Sent: ${sentCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`,
        results,
        summary: {
          total: results.length,
          sent: sentCount,
          skipped: skippedCount,
          errors: errorCount,
        },
      });
    } catch (error: unknown) {
      logger.error(
        'ScheduledJobsController::sendEscalationReminders - Error:',
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  /**
   * Runs the long-running / idle-in-transaction query and posts each offending
   * backend to Slack (one message per row). Responds with a summary and the raw
   * rows so the caller (dashboard / Lambda / EventBridge) can inspect them too.
   */
  public reportLongRunningTransactions = async (
    _req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const report =
        await this.monitoringService.reportLongRunningTransactions();

      const slackFailures = report.slackResults.filter((r) => !r.success);
      if (slackFailures.length > 0) {
        logger.error(
          `ScheduledJobsController::reportLongRunningTransactions - ${slackFailures.length} Slack message(s) failed to send`,
        );
      }

      res.status(200).json({
        success: true,
        message: `Reported ${report.count} long-running/idle-in-transaction backend(s) to Slack.`,
        count: report.count,
        slackDelivered: report.slackResults.filter((r) => r.success).length,
        slackFailed: slackFailures.length,
        rows: report.rows,
      });
    } catch (error: unknown) {
      logger.error(
        'ScheduledJobsController::reportLongRunningTransactions - Error:',
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  /**
   * Finds payments that completed successfully while the linked reservation
   * never left INACTIVE (PMS reservation creation failed and was never
   * retried), and posts each one to the shared Daisy alerts Slack channel.
   */
  public reportPaidReservationsWithFailedPmsCreation = async (
    _req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const report =
        await this.monitoringService.findAndReportPaidReservationsWithFailedPmsCreation();

      res.status(200).json({
        success: true,
        message: `Found ${report.count} paid reservation(s) with failed PMS creation.`,
        count: report.count,
        results: report.results,
      });
    } catch (error: unknown) {
      logger.error(
        'ScheduledJobsController::reportPaidReservationsWithFailedPmsCreation - Error:',
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };
}
