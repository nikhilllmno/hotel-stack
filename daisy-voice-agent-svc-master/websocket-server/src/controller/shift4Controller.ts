import { Request, Response } from 'express';
import { BadRequestError } from '../errors/BadRequestError';
import { Shift4Service } from '../services/shift4/shift4Service';
import logger from '../utils/logger';
import { handleCoreApiErrorAndSendResponse } from './util/helper';

export class Shift4Controller {
  constructor(private shift4Service: Shift4Service) {}

  async generateAccessToken(req: Request, res: Response): Promise<void> {
    const hotelId = req.body?.hotel_id;

    try {
      if (!hotelId) {
        throw new BadRequestError('hotel_id is required');
      }

      logger.info(
        `Shift4Controller: generateAccessToken called for hotel_id=${hotelId}`,
      );

      const result = await this.shift4Service.generateAccessToken(hotelId);

      res.status(200).json(result);
    } catch (error) {
      logger.error('Shift4Controller: Error in generateAccessToken:', error);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }
}
