// Dashboard controller for room reservation service

import { Response } from 'express';
import Joi from 'joi';
import { CancellationSource } from '../../dtos/enum/CancellationSource';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { SessionType } from '../../dtos/enum/SessionType';
import {
  ChargeReservationRequest,
  MarkPaymentCollectedRequest,
} from '../../dtos/Payment';
import { RefundRequest } from '../../dtos/refund/RefundDto';
import { SetupAutoChargeRequest } from '../../dtos/Reservation';
import { BadRequestError } from '../../errors/BadRequestError';
import { RoomReservationService } from '../../services/roomReservation/roomReservationService';
import { AuthenticatedRequest } from '../../types/customRequest';
import { GetRequestForPagination } from '../../utils/common';
import logger from '../../utils/logger';
import { refundRequestSchema } from '../../validators/refundSchema';
import {
  chargeReservationSchema,
  getHotelReservationListQuerySchema,
  getTranscriptsQuerySchema,
  markPaymentCollectedSchema,
  setupAutoChargeSchema,
  updateReservationStatusSchema,
} from '../../validators/reservationSchema';
import { handleCoreApiErrorAndSendResponse } from '../util/helper';
import { stripSensitiveConfigFromReservations } from '../util/stripSensitiveConfigFields';

export class ProtectedReservationController {
  private roomReservationService: RoomReservationService;

  constructor(roomReservationService: RoomReservationService) {
    this.roomReservationService = roomReservationService;
  }

  public async getReservationDashboardSummary(
    req: AuthenticatedRequest,
    res: Response,
  ) {
    try {
      const hotel_id = req.user?.hotel_id;
      const start_date = req.query.start_date
        ? new Date(req.query.start_date.toString())
        : undefined;
      const end_date = req.query.end_date
        ? new Date(req.query.end_date.toString())
        : undefined;
      const session_types = req.query.session_type
        ? req.query.session_type
            .toString()
            .split(',')
            .map((t: string) => t.trim())
        : [SessionType.CALL];
      const DEFAULT_RESERVATION_STATUSES = [
        ReservationStatus.ACTIVE,
        ReservationStatus.NO_SHOW,
      ];
      const reservation_statuses: ReservationStatus[] = req.query
        .reservation_statuses
        ? req.query.reservation_statuses
            .toString()
            .split(',')
            .map((s: string) => s.trim().toUpperCase() as ReservationStatus)
        : DEFAULT_RESERVATION_STATUSES;

      const validStatuses = Object.values(ReservationStatus) as string[];
      const invalidStatuses = reservation_statuses.filter(
        (s) => !validStatuses.includes(s),
      );
      if (invalidStatuses.length > 0) {
        throw new BadRequestError(
          `Invalid reservation status(es): ${invalidStatuses.join(', ')}. Must be one of: ${validStatuses.join(', ')}`,
        );
      }

      // Get version from header (supports both 'API-Version' and 'X-API-Version')
      const versionHeader = (req.headers['api-version'] ||
        req.headers['x-api-version'] ||
        'v2') as string;
      const version = versionHeader.toLowerCase().trim();

      if (!hotel_id) {
        throw new BadRequestError(`Hotel Id not present in requested user`);
      }

      // Validate version
      if (!['v1', 'v2'].includes(version)) {
        throw new BadRequestError(
          `Invalid API version: ${version}. Supported versions: v1, v2`,
        );
      }

      const validSessionTypes = Object.values(SessionType).filter(
        (t) => t !== SessionType.EXTERNAL,
      ) as string[];
      const invalidTypes = session_types.filter(
        (t: string) => !validSessionTypes.includes(t),
      );
      if (invalidTypes.length > 0) {
        throw new BadRequestError(
          `Invalid session type(s): ${invalidTypes.join(', ')}. Must be one of: ${validSessionTypes.join(', ')}`,
        );
      }
      const summary =
        await this.roomReservationService.getBookingDashboardSummary(
          hotel_id,
          start_date,
          end_date,
          session_types.filter(
            (t: string) => t !== SessionType.EXTERNAL,
          ) as SessionType[],
          version,
          reservation_statuses,
        );
      res.status(200).json(summary);
    } catch (error) {
      logger.error(`Error getting Reservation Summary: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async getHotelReservationList(
    req: AuthenticatedRequest,
    res: Response,
  ) {
    try {
      const hotel_id = this.getHotelId(req);

      const { value: validatedQuery, error } =
        getHotelReservationListQuerySchema.validate(req.query, {
          abortEarly: false,
          stripUnknown: true,
        });

      if (error) {
        throw new BadRequestError(
          error.details.map((d) => d.message).join(', '),
        );
      }

      const {
        page,
        limit,
        search,
        channel,
        status,
        payment_status,
        start_date,
        end_date,
      } = validatedQuery;

      const paginationReq: GetRequestForPagination = {
        base_path: `${req.baseUrl}${req.path}?`,
        query_params: { ...req.query },
      };

      const reservations =
        await this.roomReservationService.getHotelReservationList(
          hotel_id,
          page,
          limit,
          search,
          channel,
          status,
          payment_status,
          start_date,
          end_date,
          paginationReq,
        );

      res.status(200).json(reservations);
    } catch (error) {
      logger.error(`Error getting hotel reservation list: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async getReservationByBookingId(
    req: AuthenticatedRequest,
    res: Response,
  ) {
    try {
      const hotel_id = this.getHotelId(req);
      const booking_id = this.getBookingId(req);

      const reservations =
        await this.roomReservationService.getReservationsByBookingId(
          booking_id,
          hotel_id,
        );

      res.status(200).json(stripSensitiveConfigFromReservations(reservations));
    } catch (error) {
      logger.error(`Error getting reservation by booking ID: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async getConversationSummaryByBookingId(
    req: AuthenticatedRequest,
    res: Response,
  ) {
    try {
      const hotel_id = this.getHotelId(req);
      const booking_id = this.getBookingId(req);

      const summary =
        await this.roomReservationService.getConversationSummaryByBookingId(
          booking_id,
          hotel_id,
        );

      res.status(200).json(summary);
    } catch (error) {
      logger.error(
        `Error getting conversation summary by booking ID: ${error}`,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async getTranscriptsByBookingId(
    req: AuthenticatedRequest,
    res: Response,
  ) {
    try {
      const hotel_id = this.getHotelId(req);
      const booking_id = this.getBookingId(req);

      const { value: validatedQuery, error } =
        getTranscriptsQuerySchema.validate(req.query, {
          abortEarly: false,
          stripUnknown: false,
        });

      if (error) {
        throw new BadRequestError(
          error.details.map((d) => d.message).join(', '),
        );
      }

      const { page, limit } = validatedQuery;

      const paginationReq: GetRequestForPagination = {
        base_path: `${req.baseUrl}${req.path}?`,
        query_params: { ...req.query },
      };

      const transcripts =
        await this.roomReservationService.getTranscriptsByBookingId(
          booking_id,
          hotel_id,
          page,
          limit,
          paginationReq,
        );

      res.status(200).json(transcripts);
    } catch (error) {
      logger.error(`Error getting transcripts by booking ID: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async markPaymentCollected(req: AuthenticatedRequest, res: Response) {
    try {
      const hotel_id = this.getHotelId(req);
      const booking_id = this.getBookingId(req);

      const { value: validatedBody, error } =
        markPaymentCollectedSchema.validate(req.body, {
          abortEarly: false,
          stripUnknown: true,
        });

      if (error) {
        throw new BadRequestError(
          error.details.map((d) => d.message).join(', '),
        );
      }

      const result =
        await this.roomReservationService.markPaymentCollectedOffline(
          booking_id,
          hotel_id,
          validatedBody as MarkPaymentCollectedRequest,
        );

      res.status(200).json(result);
    } catch (error) {
      logger.error(
        `Error marking payment as collected for booking ID: ${error}`,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async setupAutoCharge(req: AuthenticatedRequest, res: Response) {
    try {
      const hotel_id = this.getHotelId(req);
      const booking_id = this.getBookingId(req);

      const { value: validatedBody, error } = setupAutoChargeSchema.validate(
        req.body,
      );

      if (error) {
        throw new BadRequestError(
          error.details.map((d) => d.message).join(', '),
        );
      }

      const result = await this.roomReservationService.setupAutoCharge(
        booking_id,
        hotel_id,
        validatedBody as SetupAutoChargeRequest,
      );

      res.status(200).json(result);
    } catch (error) {
      logger.error(`Error setting up auto-charge for booking ID: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async chargeReservationImmediately(
    req: AuthenticatedRequest,
    res: Response,
  ) {
    try {
      const hotel_id = this.getHotelId(req);
      const booking_id = this.getBookingId(req);

      const { value: validatedBody, error } = chargeReservationSchema.validate(
        req.body,
        {
          abortEarly: false,
          stripUnknown: true,
        },
      );

      if (error) {
        throw new BadRequestError(
          error.details.map((d) => d.message).join(', '),
        );
      }

      const result =
        await this.roomReservationService.chargeReservationImmediately(
          booking_id,
          hotel_id,
          validatedBody as ChargeReservationRequest,
        );

      res.status(200).json(result);
    } catch (error) {
      logger.error(
        `Error charging reservation directly for booking ID: ${error}`,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  private getHotelId(req: AuthenticatedRequest): string {
    const hotel_id = req.user?.hotel_id;
    if (!hotel_id) {
      throw new BadRequestError('Hotel Id not present in requested user');
    }
    return hotel_id;
  }

  private getBookingId(req: AuthenticatedRequest): string {
    const booking_id = req.params.booking_id;
    if (!booking_id) {
      throw new BadRequestError('Booking ID is required');
    }
    return booking_id;
  }

  public async getBookingPaymentSummary(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      const hotel_id = this.getHotelId(req);
      const booking_id = this.getBookingId(req);

      const paymentSummary =
        await this.roomReservationService.calculateBookingPaymentSummary(
          booking_id,
          hotel_id,
        );

      res.status(200).json(paymentSummary);
    } catch (error) {
      logger.error(`Error getting booking payment summary: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async processBookingRefund(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      const hotel_id = this.getHotelId(req);
      const booking_id = this.getBookingId(req);

      // Validate request body
      const { value: refundRequest, error } = refundRequestSchema.validate(
        req.body,
        {
          abortEarly: false,
          stripUnknown: true,
        },
      ) as { value: RefundRequest; error: Joi.ValidationError | undefined };

      if (error) {
        throw new BadRequestError(
          error.details.map((d) => d.message).join(', '),
        );
      }

      const refundResult =
        await this.roomReservationService.processBookingRefund(
          booking_id,
          hotel_id,
          { ...refundRequest, initiatedBy: req.user?.id || 'unknown' },
        );

      res.status(200).json(refundResult);
    } catch (error) {
      logger.error(`Error processing booking refund: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async updateReservationStatus(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      const hotel_id = this.getHotelId(req);
      const booking_id = this.getBookingId(req);

      const { value: validatedBody, error } =
        updateReservationStatusSchema.validate(req.body, {
          abortEarly: false,
          stripUnknown: true,
        });

      if (error) {
        throw new BadRequestError(
          error.details.map((d) => d.message).join(', '),
        );
      }

      const result =
        await this.roomReservationService.updateMultipleReservationStatus(
          booking_id,
          hotel_id,
          validatedBody.status,
          CancellationSource.DASHBOARD,
        );

      res.status(200).json(stripSensitiveConfigFromReservations(result));
    } catch (error) {
      logger.error(
        `Error updating reservation status for booking ID: ${error}`,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public getPaymentsByExternalId = async (
    req: AuthenticatedRequest,
    res: Response,
  ) => {
    try {
      const { externalId } = req.params;

      if (!externalId) {
        res.status(400).json({
          success: false,
          message: `externalId is required`,
        });
        return;
      }

      if (!req.user?.hotel_id) {
        res.status(400).json({
          success: false,
          message: 'hotel Id is required',
        });
        return;
      }

      const payments =
        await this.roomReservationService.getPaymentsByExternalId(externalId);

      res.status(200).json({
        success: true,
        data: payments,
      });
    } catch (error) {
      logger.error(`Error fetching payments by externalId: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };
}
