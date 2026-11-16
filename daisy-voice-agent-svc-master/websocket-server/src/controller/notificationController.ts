// controller/notificationController.ts

import { Response } from 'express';
import { CustomRequest } from '../customheaderTypes/express';
import { BadRequestError } from '../errors/BadRequestError';
import { GuestCheckinSummaryService } from '../services/guestCheckinSummaryService/GuestCheckinSummaryService';
import logger from '../utils/logger';
import { handleCoreApiErrorAndSendResponse } from './util/helper';

export class NotificationController {
  constructor(private guestCheckinSummaryService: GuestCheckinSummaryService) {}

  public sendGuestCheckinSummary = async (
    req: CustomRequest,
    res: Response,
  ) => {
    try {
      const timezones = req.body.timezones;
      if (!Array.isArray(timezones) || timezones.length === 0) {
        throw new BadRequestError(
          `sendGuestCheckinSummary: timezones array is missing in the request`,
        );
      }
      const messageId =
        await this.guestCheckinSummaryService.sendSummaryToHotels(timezones);

      res.status(200).json({
        message: 'Guest check-in summary sent successfully',
        messageId: messageId,
      });
    } catch (err) {
      logger.error('Error sending guest check-in summary:', err);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  };
}
