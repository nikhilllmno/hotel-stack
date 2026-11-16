import { Response } from 'express';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { SessionType } from '../../dtos/enum/SessionType';
import { BadRequestError } from '../../errors/BadRequestError';
import { NoDataError } from '../../errors/NoDataError';
import { PaginationQueryParams } from '../../models/request/common';
import { SessionService } from '../../services/session/SessionService';
import { AuthenticatedRequest } from '../../types/customRequest';
import logger from '../../utils/logger';
import {
  kpiQuerySchema,
  smsInboxPaginationQuerySchema,
  smsInboxSendBodySchema,
} from '../../validators/sessionSchema';
import { handleCoreApiErrorAndSendResponse } from '../util/helper';
import { stripSensitiveConfigFromReservations } from '../util/stripSensitiveConfigFields';
interface GetSessionQueryParams extends PaginationQueryParams {
  phone_number?: string;
  session_type?: SessionType;
  start_date?: string;
  end_date?: string;
  intent?: string;
}

export class ProtectedSessionController {
  constructor(private sessionService: SessionService) {}

  public async getCallDashboardSummary(
    req: AuthenticatedRequest,
    res: Response,
  ) {
    try {
      this.validateParams(req.query);
      const hotel_id = req.user?.hotel_id;
      const start_date = req.query.start_date
        ? new Date(req.query.start_date.toString())
        : undefined;
      const end_date = req.query.end_date
        ? new Date(req.query.end_date.toString())
        : undefined;
      const session_type = req.query.session_type
        ? req.query.session_type.toString()
        : SessionType.CALL;
      if (hotel_id) {
        const summary = await this.sessionService.getCallSummary(
          hotel_id,
          start_date,
          end_date,
          session_type,
        );
        res.status(200).json(summary);
      }
    } catch (error) {
      logger.error(`Error getting conversation summary: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  /**
   * GET /api/sessions — Paginated session list (call logs). If query session_type=SMS, returns the same
   * SMS operator inbox thread list as GET /sms-sessions (supports ?search= for caller phone substring).
   */
  public async getPaginatedSessions(req: AuthenticatedRequest, res: Response) {
    try {
      const validatedParams = this.validateParams(req.query);
      const hotelId = req.user?.hotel_id;
      if (!hotelId) {
        throw new NoDataError('Hotel ID is required');
      }

      if (validatedParams.session_type === SessionType.SMS) {
        const { error, value } = smsInboxPaginationQuerySchema.validate(
          req.query,
          {
            stripUnknown: true,
          },
        );
        if (error) {
          res.status(400).json({
            error: 'Validation failed',
            details: error.details.map((d) => d.message),
          });
          return;
        }
        const result = await this.sessionService.listActiveSmsSessions(
          hotelId,
          value.page,
          value.limit,
          {
            base_path: `${req.baseUrl}${req.path}?`,
            query_params: { ...req.query },
          },
          value.search,
        );
        res.status(200).json(result);
        return;
      }

      const sessionLogs = await this.sessionService.getCallLogList(
        {
          ...validatedParams,
          hotel_id: hotelId,
        },
        {
          base_path: `${req.baseUrl}${req.path}?`,
          query_params: { ...req.query },
        },
      );

      res.status(200).json(sessionLogs);
    } catch (error) {
      logger.error('Error fetching latest active call:', error);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  private validateParams(params: GetSessionQueryParams): GetSessionQueryParams {
    if (Number(params?.page) <= 0) {
      throw new BadRequestError('Page Number should be greater than 0');
    }

    if (Number(params?.limit) <= 0) {
      throw new BadRequestError('Limit must by greater than 0');
    }

    if (
      params?.start_date &&
      params?.end_date &&
      new Date(params?.start_date) > new Date(params?.end_date)
    ) {
      throw new BadRequestError(
        'start date must be less than or equal to end date',
      );
    }

    if (params.session_type) {
      if (!(params.session_type in SessionType)) {
        throw new BadRequestError(`Session type must be CALL, CHAT or SMS`);
      }
    }
    return params;
  }

  public async getReservationsList(req: AuthenticatedRequest, res: Response) {
    try {
      const session_id = req.params.session_id.toString();
      const reservations =
        await this.sessionService.getReservationsBySessionId(session_id);
      res.status(200).json(stripSensitiveConfigFromReservations(reservations));
    } catch (error) {
      logger.error(`Error getting reservations list: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async getEscalationsList(req: AuthenticatedRequest, res: Response) {
    try {
      const session_id = req.params.session_id.toString();
      const escalations =
        await this.sessionService.getEscalationsBySesionId(session_id);
      res.status(200).json(escalations);
    } catch (error) {
      logger.error(`Error getting escalations list: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async getConversationSummary(
    req: AuthenticatedRequest,
    res: Response,
  ) {
    try {
      const session_id = req.params.session_id.toString();
      const conversation =
        await this.sessionService.getConversationSummaryBySessionId(session_id);
      res.status(200).json(conversation);
    } catch (error) {
      logger.error(`Error getting conversation summary: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async getConversationTranscript(
    req: AuthenticatedRequest,
    res: Response,
  ) {
    try {
      const session_id = req.params.session_id.toString();
      const hotel_id = req.user?.hotel_id;

      if (!hotel_id) {
        throw new BadRequestError('Hotel ID is required');
      }

      const validatedParams = this.validateParams(req.query);
      const transcript =
        await this.sessionService.getConversationTranscriptBySessionId(
          session_id,
          hotel_id,
          validatedParams.page,
          validatedParams.limit,
          {
            base_path: `${req.baseUrl}${req.path}?`,
            query_params: { ...req.query },
          },
        );
      res.status(200).json(transcript);
    } catch (error) {
      logger.error(`Error getting conversation transcript: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  /**
   * GET /api/sessions/sms-sessions — SMS operator inbox: paginated active SMS threads for the JWT hotel
   * (one row per guest number). Same payload as GET /api/sessions?session_type=SMS.
   */
  public async listSmsInboxSessions(req: AuthenticatedRequest, res: Response) {
    try {
      const hotelId = req.user?.hotel_id;
      if (!hotelId) {
        throw new NoDataError('Hotel ID is required');
      }
      const { error, value } = smsInboxPaginationQuerySchema.validate(
        req.query,
        {
          stripUnknown: true,
        },
      );
      if (error) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.details.map((d) => d.message),
        });
        return;
      }
      const result = await this.sessionService.listActiveSmsSessions(
        hotelId,
        value.page,
        value.limit,
        {
          base_path: `${req.baseUrl}${req.path}?`,
          query_params: { ...req.query },
        },
        value.search,
      );
      res.status(200).json(result);
    } catch (err) {
      logger.error('ProtectedSessionController.listSmsInboxSessions:', err);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  }

  /**
   * GET /api/sessions/sms-sessions/:sessionId/messages — Paginated USER and AI messages only (excludes SYSTEM / tool rows).
   */
  public async listSmsInboxMessages(req: AuthenticatedRequest, res: Response) {
    try {
      const hotelId = req.user?.hotel_id;
      if (!hotelId) {
        throw new NoDataError('Hotel ID is required');
      }
      const sessionId = req.params.sessionId;
      const { error, value } = smsInboxPaginationQuerySchema.validate(
        req.query,
        {
          stripUnknown: true,
        },
      );
      if (error) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.details.map((d) => d.message),
        });
        return;
      }
      const result = await this.sessionService.listSmsInboxMessages(
        hotelId,
        sessionId,
        value.page,
        value.limit,
        {
          base_path: `${req.baseUrl}${req.path}?`,
          query_params: { ...req.query },
        },
      );
      res.status(200).json(result);
    } catch (err) {
      logger.error('ProtectedSessionController.listSmsInboxMessages:', err);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  }

  /**
   * POST /api/sessions/sms-sessions/:sessionId/messages — Send an outbound staff SMS to the guest (Twilio)
   * and record it on the conversation (via sms:sent event pipeline).
   */
  public async sendSmsInboxMessage(req: AuthenticatedRequest, res: Response) {
    try {
      const hotelId = req.user?.hotel_id;
      if (!hotelId) {
        throw new NoDataError('Hotel ID is required');
      }
      const sessionId = req.params.sessionId;
      const { error, value } = smsInboxSendBodySchema.validate(req.body, {
        stripUnknown: true,
      });
      if (error) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.details.map((d) => d.message),
        });
        return;
      }
      await this.sessionService.sendSmsInboxManagerReply(
        hotelId,
        sessionId,
        value.body,
      );
      res.status(201).json({ success: true });
    } catch (err) {
      logger.error('ProtectedSessionController.sendSmsInboxMessage:', err);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  }

  /**
   * POST /api/sessions/sms-sessions/:sessionId/read — Clears has_unread_messages after the operator opened the thread.
   */
  public async markSmsInboxSessionRead(
    req: AuthenticatedRequest,
    res: Response,
  ) {
    try {
      const hotelId = req.user?.hotel_id;
      if (!hotelId) {
        throw new NoDataError('Hotel ID is required');
      }
      const sessionId = req.params.sessionId;
      await this.sessionService.markSmsInboxSessionRead(hotelId, sessionId);
      res.status(204).send();
    } catch (err) {
      logger.error('ProtectedSessionController.markSmsInboxSessionRead:', err);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  }

  public async getConversationIntentSummary(
    req: AuthenticatedRequest,
    res: Response,
  ) {
    const hotel_id = req.user?.hotel_id;
    const start_date = req.query.start_date
      ? new Date(req.query.start_date.toString())
      : undefined;
    const end_date = req.query.end_date
      ? new Date(req.query.end_date.toString())
      : undefined;
    const session_type = req.query.session_type
      ? req.query.session_type.toString()
      : SessionType.CALL;
    try {
      this.validateParams(req.query);
      if (!hotel_id) {
        logger.error('Hotel Id not available in request user details');
        throw new BadRequestError(
          `Hotel Id must be present in request user details`,
        );
      }
      const intentSummary =
        await this.sessionService.getConversationIntentSummary(
          hotel_id,
          start_date,
          end_date,
          session_type,
        );
      res.status(200).json(intentSummary);
    } catch (error) {
      logger.error(`Error getting intent summary for hotel.`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  /**
   * GET /api/sessions/kpis?start_date=...&end_date=...
   * Returns all 7 KPI card values for a date range.
   */
  public async getCallKpiSummary(req: AuthenticatedRequest, res: Response) {
    try {
      const hotelId = req.user?.hotel_id;
      if (!hotelId) {
        throw new BadRequestError('Hotel ID is required');
      }
      const { error, value } = kpiQuerySchema.validate(req.query, {
        stripUnknown: true,
      });
      if (error) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.details.map((d) => d.message),
        });
        return;
      }
      const DEFAULT_RESERVATION_STATUSES = [
        ReservationStatus.ACTIVE,
        ReservationStatus.NO_SHOW,
      ];
      const reservation_statuses: ReservationStatus[] =
        value.reservation_statuses
          ? value.reservation_statuses
              .split(',')
              .map((s: string) => s.trim().toUpperCase() as ReservationStatus)
          : DEFAULT_RESERVATION_STATUSES;

      const validStatuses = Object.values(ReservationStatus) as string[];
      const invalidStatuses = reservation_statuses.filter(
        (s) => !validStatuses.includes(s),
      );
      if (invalidStatuses.length > 0) {
        res.status(400).json({
          error: `Invalid reservation status(es): ${invalidStatuses.join(', ')}. Must be one of: ${validStatuses.join(', ')}`,
        });
        return;
      }

      const summary = await this.sessionService.getCallKpiSummary(
        hotelId,
        new Date(value.start_date),
        new Date(value.end_date),
        reservation_statuses,
      );
      res.status(200).json(summary);
    } catch (err) {
      logger.error('ProtectedSessionController.getCallKpiSummary:', err);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  }

  /**
   * GET /api/sessions/kpis/trend?start_date=...&end_date=...
   * Returns 6 chart series (2 per graph) for a date range (max 90 days).
   */
  public async getKpiTrend(req: AuthenticatedRequest, res: Response) {
    try {
      const hotelId = req.user?.hotel_id;
      if (!hotelId) {
        throw new BadRequestError('Hotel ID is required');
      }
      const { error, value } = kpiQuerySchema.validate(req.query, {
        stripUnknown: true,
      });
      if (error) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.details.map((d) => d.message),
        });
        return;
      }
      const start = new Date(value.start_date);
      const end = new Date(value.end_date);
      const diffDays =
        (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > 90) {
        res.status(400).json({ error: 'Date range must not exceed 90 days' });
        return;
      }
      const DEFAULT_RESERVATION_STATUSES = [
        ReservationStatus.ACTIVE,
        ReservationStatus.NO_SHOW,
      ];
      const reservation_statuses: ReservationStatus[] =
        value.reservation_statuses
          ? value.reservation_statuses
              .split(',')
              .map((s: string) => s.trim().toUpperCase() as ReservationStatus)
          : DEFAULT_RESERVATION_STATUSES;

      const validStatuses = Object.values(ReservationStatus) as string[];
      const invalidStatuses = reservation_statuses.filter(
        (s) => !validStatuses.includes(s),
      );
      if (invalidStatuses.length > 0) {
        res.status(400).json({
          error: `Invalid reservation status(es): ${invalidStatuses.join(', ')}. Must be one of: ${validStatuses.join(', ')}`,
        });
        return;
      }

      const trend = await this.sessionService.getKpiTrend(
        hotelId,
        start,
        end,
        reservation_statuses,
      );
      res.status(200).json(trend);
    } catch (err) {
      logger.error('ProtectedSessionController.getKpiTrend:', err);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  }
}
