import { Response } from 'express';
import config from '../config';
import { CreateHotelRequest, UpdateHotelRequest } from '../dtos/Hotel';
import {
  CreateHotelConfigurationRequest,
  UpdateHotelConfigurationRequest,
} from '../dtos/HotelConfiguration';
import { UserRole } from '../models/User';
import { HotelService } from '../services/hotel/hotelService';
import { HotelConfigurationService } from '../services/hotelConfiguration/hotelConfigurationService';
import {
  RecordingBackfillService,
  recordingBackfillService,
  resolveVapiApiKeyForBackfill,
} from '../services/vapi/recordingBackfillService';
import { AuthenticatedRequest } from '../types/customRequest';
import logger from '../utils/logger';
import { hotelConfigurationSchema } from '../validators/hotelConfigurationSchema';
import {
  createHotelSchema,
  updateHotelSchema,
} from '../validators/hotelSchema';
import {
  RecordingBackfillBody,
  RecordingBackfillConversationBody,
  recordingBackfillConversationSchema,
  recordingBackfillSchema,
} from '../validators/recordingBackfillSchema';
import { handleCoreApiErrorAndSendResponse } from './util/helper';
import { stripSensitiveConfigFields } from './util/stripSensitiveConfigFields';

/** Only superadmin: get all hotels, create/delete hotel, delete config. */
function requireSuperadmin(req: AuthenticatedRequest, res: Response): boolean {
  if (req.user?.role !== UserRole.SUPERADMIN) {
    res.status(403).json({ error: 'Only superadmin can perform this action' });
    return false;
  }
  return true;
}

/** Admin or superadmin; admin can only access their own hotel (hotel_id). */
function requireAdminOrSuperadmin(
  req: AuthenticatedRequest,
  res: Response,
): boolean {
  const role = req.user?.role;
  if (role !== UserRole.SUPERADMIN && role !== UserRole.ADMIN) {
    res
      .status(403)
      .json({ error: 'Only admin or superadmin can perform this action' });
    return false;
  }
  return true;
}

// hotel controller class to get hotel by id and manage hotel configurations
export class HotelController {
  constructor(
    private hotelService: HotelService,
    private hotelConfigurationService: HotelConfigurationService,
    private readonly recordingBackfill: RecordingBackfillService = recordingBackfillService,
  ) {}

  public getHotels = async (req: AuthenticatedRequest, res: Response) => {
    if (!requireSuperadmin(req, res)) return;
    try {
      const hotels = await this.hotelService.getHotels();
      res.json(hotels);
    } catch (error: unknown) {
      logger.error('Error in HotelController::getHotels:', error);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  public getHotelById = async (req: AuthenticatedRequest, res: Response) => {
    if (!requireAdminOrSuperadmin(req, res)) return;
    try {
      const hotel = await this.hotelService.getHotelById(req.params.id);
      res.json(hotel);
    } catch (error: unknown) {
      logger.error(
        `Error in HotelController::getHotelById: Error fetching hotel with ID ${req.params.id}:`,
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  public createHotel = async (req: AuthenticatedRequest, res: Response) => {
    if (!requireSuperadmin(req, res)) return;
    const { error, value } = createHotelSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      logger.error(
        `Validation error in createHotel: ${error.details.map((d) => d.message).join(', ')}`,
      );
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details.map((d) => d.message),
      });
    }
    try {
      const hotel = await this.hotelService.createHotel(
        value as CreateHotelRequest,
      );
      res.status(201).json(hotel);
    } catch (err: unknown) {
      logger.error('Error in HotelController::createHotel:', err);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  };

  public updateHotel = async (req: AuthenticatedRequest, res: Response) => {
    if (!requireAdminOrSuperadmin(req, res)) return;
    const { error, value } = updateHotelSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      logger.error(
        `Validation error in updateHotel: ${error.details.map((d) => d.message).join(', ')}`,
      );
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details.map((d) => d.message),
      });
    }
    try {
      const { id } = req.params;
      const hotel = await this.hotelService.updateHotel(
        id,
        value as UpdateHotelRequest,
      );
      res.json(hotel);
    } catch (err: unknown) {
      logger.error(
        `Error in HotelController::updateHotel for hotel ${req.params.id}:`,
        err,
      );
      handleCoreApiErrorAndSendResponse(err, res);
    }
  };

  public deleteHotel = async (req: AuthenticatedRequest, res: Response) => {
    if (!requireSuperadmin(req, res)) return;
    try {
      const { id } = req.params;
      const deleted = await this.hotelService.deleteHotel(id);
      if (!deleted) {
        return res
          .status(404)
          .json({ success: false, error: 'Hotel not found' });
      }
      res
        .status(200)
        .json({ success: true, message: 'Hotel deleted successfully' });
    } catch (error: unknown) {
      logger.error(
        `Error in HotelController::deleteHotel for hotel ${req.params.id}:`,
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  // Hotel Configuration Methods
  public getHotelConfiguration = async (
    req: AuthenticatedRequest,
    res: Response,
  ) => {
    if (!requireAdminOrSuperadmin(req, res)) return;
    const { id } = req.params;
    if (!id) {
      return res
        .status(400)
        .json({ success: false, error: 'Hotel ID is required' });
    }
    try {
      const hotel = await this.hotelService.getHotelById(id);
      if (!hotel) {
        return res.status(404).json({
          success: false,
          error: 'Hotel not found',
        });
      }

      logger.info(
        `HotelController::getHotelConfiguration - Fetching configuration for hotel ID: ${id}`,
      );
      const configuration =
        await this.hotelConfigurationService.getHotelConfigurationByHotelId(id);

      res.status(200).json({
        success: true,
        data: configuration ? stripSensitiveConfigFields(configuration) : null,
      });
    } catch (error: unknown) {
      logger.error(
        `Error in HotelController::getHotelConfiguration for hotel ${req.params.id}:`,
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  public createHotelConfiguration = async (
    req: AuthenticatedRequest,
    res: Response,
  ) => {
    if (!requireAdminOrSuperadmin(req, res)) return;
    const { id } = req.params;
    if (!id) {
      return res
        .status(400)
        .json({ success: false, error: 'Hotel ID is required' });
    }
    try {
      const createData: CreateHotelConfigurationRequest = {
        hotel_id: id,
        ...req.body,
      };

      // Validate request data
      const { error, value } = hotelConfigurationSchema.validate(createData, {
        context: { isUpdate: false },
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        logger.error(
          `Validation error in createHotelConfiguration: ${error.details.map((d) => d.message).join(', ')}`,
        );
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.details.map((d) => d.message),
        });
      }

      const validatedData: CreateHotelConfigurationRequest = value;

      const hotel = await this.hotelService.getHotelById(id);
      if (!hotel) {
        return res.status(404).json({
          success: false,
          error: 'Hotel not found',
        });
      }

      logger.info(
        `HotelController::createHotelConfiguration - Creating configuration for hotel ID: ${id}`,
      );
      const configuration =
        await this.hotelConfigurationService.createHotelConfiguration(
          validatedData,
        );

      res.status(201).json({
        success: true,
        data: stripSensitiveConfigFields(configuration),
        message: 'Hotel configuration created successfully',
      });
    } catch (error: unknown) {
      logger.error(
        `Error in HotelController::createHotelConfiguration for hotel ${req.params.id}:`,
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  public updateHotelConfiguration = async (
    req: AuthenticatedRequest,
    res: Response,
  ) => {
    if (!requireAdminOrSuperadmin(req, res)) return;
    const { id } = req.params;
    if (!id) {
      return res
        .status(400)
        .json({ success: false, error: 'Hotel ID is required' });
    }
    try {
      const updateData: UpdateHotelConfigurationRequest = req.body;

      // Validate request data
      const { error, value } = hotelConfigurationSchema.validate(updateData, {
        context: { isUpdate: true },
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        logger.error(
          `Validation error in updateHotelConfiguration: ${error.details.map((d) => d.message).join(', ')}`,
        );
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: error.details.map((d) => d.message),
        });
      }

      const validatedData: UpdateHotelConfigurationRequest = value;

      const hotel = await this.hotelService.getHotelById(id);
      if (!hotel) {
        return res.status(404).json({
          success: false,
          error: 'Hotel not found',
        });
      }

      logger.info(
        `HotelController::updateHotelConfiguration - Updating configuration for hotel ID: ${id}`,
      );
      const configuration =
        await this.hotelConfigurationService.updateHotelConfigurationByHotelId(
          id,
          validatedData,
        );

      res.status(200).json({
        success: true,
        data: configuration ? stripSensitiveConfigFields(configuration) : null,
        message: 'Hotel configuration updated successfully',
      });
    } catch (error: unknown) {
      logger.error(
        `Error in HotelController::updateHotelConfiguration for hotel ${req.params.id}:`,
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  public deleteHotelConfiguration = async (
    req: AuthenticatedRequest,
    res: Response,
  ) => {
    if (!requireSuperadmin(req, res)) return;
    const { id } = req.params;
    if (!id) {
      return res
        .status(400)
        .json({ success: false, error: 'Hotel ID is required' });
    }
    try {
      logger.info(
        `HotelController::deleteHotelConfiguration - Deleting configuration for hotel ID: ${id}`,
      );
      const deleted =
        await this.hotelConfigurationService.deleteHotelConfigurationByHotelId(
          id,
        );

      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'Hotel configuration not found',
        });
      }

      res.status(200).json({
        success: true,
        message: 'Hotel configuration deleted successfully',
      });
    } catch (error: unknown) {
      logger.error(
        `Error in HotelController::deleteHotelConfiguration for hotel ${req.params.id}:`,
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  public syncRoomTypes = async (req: AuthenticatedRequest, res: Response) => {
    try {
      logger.info(
        'HotelController::syncRoomTypes - Starting room types sync for all hotels',
      );

      const results =
        await this.hotelService.syncRoomTypesForStayntouchHotels();

      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.filter((r) => !r.success).length;

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
      logger.error('Error in HotelController::syncRoomTypes:', error);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };

  /**
   * POST /api/hotel/recordings/backfill
   *
   * Superadmin only. Migrates legacy https:// recording URLs (including private
   * HIPAA Cloudflare R2 URLs) to S3 for the given calendar day in each hotel's
   * timezone. Processes hotels one by one. Returns 200 immediately; work
   * continues in the background.
   */
  public backfillRecordingsForDate = async (
    req: AuthenticatedRequest,
    res: Response,
  ) => {
    if (!requireSuperadmin(req, res)) return;

    const { error, value } = recordingBackfillSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      res.status(400).json({
        error: 'Validation failed',
        details: error.details.map((d) => d.message),
      });
      return;
    }

    const body = value as RecordingBackfillBody;

    try {
      resolveVapiApiKeyForBackfill();
      if (!config.S3_BUCKET) {
        res.status(503).json({ error: 'S3_BUCKET is not configured' });
        return;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({ error: message });
      return;
    }

    logger.info(
      `HotelController::backfillRecordingsForDate - accepted date=${body.date} scope=all hotels`,
    );

    res.status(200).json({
      success: true,
      message: 'Recording backfill started in background',
      date: body.date,
      scope: 'all hotels',
    });

    this.recordingBackfill
      .backfillAllHotelsForDate({
        date: body.date,
      })
      .then((result) => {
        logger.info(
          'HotelController::backfillRecordingsForDate - background job completed',
          result,
        );
      })
      .catch((err) => {
        logger.error(
          'HotelController::backfillRecordingsForDate - background job failed',
          err,
        );
      });
  };

  /**
   * POST /api/hotel/recordings/backfill/conversation
   *
   * Superadmin only. Migrates one conversation's legacy https:// recording URL
   * (including private HIPAA R2 URLs) to S3 via authenticated VAPI download.
   * Runs synchronously and returns the result (uploaded, skipped, or failed).
   */
  public backfillRecordingForConversation = async (
    req: AuthenticatedRequest,
    res: Response,
  ) => {
    if (!requireSuperadmin(req, res)) return;

    const { error, value } = recordingBackfillConversationSchema.validate(
      req.body,
      {
        abortEarly: false,
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

    const body = value as RecordingBackfillConversationBody;

    try {
      resolveVapiApiKeyForBackfill();
      if (!config.S3_BUCKET) {
        res.status(503).json({ error: 'S3_BUCKET is not configured' });
        return;
      }

      const result = await this.recordingBackfill.backfillConversation(
        body.conversation_id,
      );

      logger.info(
        `HotelController::backfillRecordingForConversation - conversationId=${body.conversation_id} status=${result.status}`,
        result,
      );

      const statusCode = result.status === 'failed' ? 502 : 200;
      res.status(statusCode).json({
        success: result.status !== 'failed',
        ...result,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not configured')) {
        res.status(503).json({ error: message });
        return;
      }
      handleCoreApiErrorAndSendResponse(err, res);
    }
  };
}
