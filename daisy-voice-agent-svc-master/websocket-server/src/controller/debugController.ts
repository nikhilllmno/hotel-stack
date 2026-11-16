import { Request, Response } from 'express';
import { AdminUpdateHotelPhoneRequest } from '../dtos/Hotel';
import { Hotel } from '../models/Hotel';
import { HotelConfiguration } from '../models/HotelConfiguration';
import { DebugService } from '../services/debug/DebugService';
import { hotelService } from '../services/hotel/hotelService';
import { hotelConfigurationService } from '../services/hotelConfiguration/hotelConfigurationService';
import logger from '../utils/logger';
import { getDebugConversationsQuerySchema } from '../validators/debugSchema';
import { adminUpdateHotelPhoneSchema } from '../validators/hotelSchema';
import {
  handleAgentErrorAndSendResponse,
  handleCoreApiErrorAndSendResponse,
} from './util/helper';
import { stripSensitiveConfigFields } from './util/stripSensitiveConfigFields';

type HotelWithConfig = Hotel & { config: HotelConfiguration | null };

export class DebugController {
  private debugService: DebugService;

  constructor() {
    this.debugService = new DebugService();
  }

  async queryConversations(req: Request, res: Response): Promise<void> {
    const { error, value } = getDebugConversationsQuerySchema.validate(
      req.query,
    );
    if (error) {
      logger.error(
        `Validation error in queryConversations: ${error.details.map((d) => d.message).join(', ')}`,
      );
      res.status(400).json({
        error: 'Validation failed',
        details: error.details.map((d) => d.message),
      });
      return;
    }

    const params = {
      phoneNumber: value.phone_number,
      hotelId: value.hotel_id,
      limit: value.limit,
      sortOrder: value.sort_order,
      startTime: value.start_time,
      endTime: value.end_time,
    };

    try {
      const messages = await this.debugService.queryConversations(params);
      res.status(200).json(messages);
    } catch (err) {
      logger.error(`Error querying debug conversations: ${err}`);
      handleAgentErrorAndSendResponse(err, res);
    }
  }

  async getHotels(req: Request, res: Response): Promise<void> {
    try {
      const [hotels, configurations] = await Promise.all([
        hotelService.getHotels(),
        hotelConfigurationService.getAllHotelConfigurations(),
      ]);
      const configMap = new Map<string, HotelConfiguration>(
        configurations.map((c) => [c.hotel_id, c]),
      );
      const hotelsWithConfig: HotelWithConfig[] = hotels.map((hotel) => {
        const config = configMap.get(hotel.id) ?? null;
        return {
          ...hotel,
          config: config ? stripSensitiveConfigFields(config) : null,
        };
      });
      res.status(200).json(hotelsWithConfig);
    } catch (err) {
      logger.error(`Error fetching hotels: ${err}`);
      handleAgentErrorAndSendResponse(err, res);
    }
  }

  async adminUpdateHotelPhone(req: Request, res: Response): Promise<void> {
    const { error, value } = adminUpdateHotelPhoneSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      logger.error(
        `Validation error in adminUpdateHotelPhone: ${error.details.map((d) => d.message).join(', ')}`,
      );
      res.status(400).json({
        error: 'Validation failed',
        details: error.details.map((d) => d.message),
      });
      return;
    }

    try {
      const body = value as AdminUpdateHotelPhoneRequest;
      const hotel = await hotelService.adminUpdateHotelPhone({
        hotelId: body.hotel_id,
        currentPhone: body.current_phone,
        newPhone: body.new_phone,
      });
      res.status(200).json({
        success: true,
        data: hotel,
        message: 'Hotel phone numbers updated successfully',
      });
    } catch (err: unknown) {
      logger.error('Error in DebugController::adminUpdateHotelPhone:', err);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  }
}
