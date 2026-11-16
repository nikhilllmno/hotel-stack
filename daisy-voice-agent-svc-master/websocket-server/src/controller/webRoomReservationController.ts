import { Request, Response } from 'express';
import { BadRequestError } from '../errors/BadRequestError';
import { NoDataError } from '../errors/NoDataError';
import { CreateWebRoomReservationRequest } from '../models/request/roomReservation';
import roomReservationService, {
  RoomReservationService,
} from '../services/roomReservation/roomReservationService';
import logger from '../utils/logger';
import {
  validateGetRateCalendarRequestParams,
  validateGetWebRoomAvailabilityRequestParams,
  validateWebRoomReservationRequest,
} from '../utils/validateReservationRequest';
import { handleCoreApiErrorAndSendResponse } from './util/helper';

class WebRoomReservationController {
  constructor(private roomReservationService: RoomReservationService) {}

  public async getWebRoomAvailabilityInfo(req: Request, res: Response) {
    try {
      const getAvailabilityParams = validateGetWebRoomAvailabilityRequestParams(
        req.query,
      );
      if (getAvailabilityParams.num_adults < 1) {
        throw new BadRequestError(
          'validateGetWebRoomAvailabilityRequestParams:: num_adults must be greater than 1',
        );
      }
      if (getAvailabilityParams.num_children < 0) {
        throw new BadRequestError(
          'validateGetWebRoomAvailabilityRequestParams:: num_children must be greater than or equal to 0',
        );
      }
      if (getAvailabilityParams.num_rooms < 1) {
        throw new BadRequestError(
          'validateGetWebRoomAvailabilityRequestParams:: num_rooms must be greater than or equal to 1',
        );
      }

      const availabilityInfo =
        await this.roomReservationService.getWebRoomAvailabilityV2(
          getAvailabilityParams,
        );
      res.status(200).json(availabilityInfo);
    } catch (error) {
      if (error instanceof NoDataError) {
        res.status(error.statusCode).json(error.toJSON());
        return;
      }
      logger.error(
        `Error in getWebRoomAvailabilityInfo: ${JSON.stringify(error)}`,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async getRateCalendar(req: Request, res: Response) {
    try {
      const params = validateGetRateCalendarRequestParams(req.query);
      const rateCalendar =
        await this.roomReservationService.getRateCalendar(params);
      res.set('Cache-Control', 'public, max-age=300');
      res.status(200).json(rateCalendar);
    } catch (error) {
      if (error instanceof NoDataError) {
        res.status(error.statusCode).json(error.toJSON());
        return;
      }
      logger.error(`Error in getRateCalendar: ${JSON.stringify(error)}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async createWebReservation(
    req: Request<{}, {}, CreateWebRoomReservationRequest>,
    res: Response,
  ) {
    try {
      const validatedReservationParams = validateWebRoomReservationRequest({
        ...req.body,
      });

      const reservationInfo =
        await this.roomReservationService.createWebReservation(
          validatedReservationParams,
        );
      res.status(201).json(reservationInfo);
    } catch (error) {
      logger.error(`Error in createWebReservation: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }
}

let instance: WebRoomReservationController | null = null;

const webRoomReservationController = () => {
  if (!instance) {
    instance = new WebRoomReservationController(roomReservationService);
  }
  return instance;
};

export default webRoomReservationController;
export { WebRoomReservationController };
