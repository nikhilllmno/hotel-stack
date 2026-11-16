import { Response } from 'express';
import { PaymentService } from '../services/payment/paymentService';
import { AuthenticatedRequest } from '../types/customRequest';
import logger from '../utils/logger';
import { handleCoreApiErrorAndSendResponse } from './util/helper';
import { resourceBelongsToTokenHotel } from './util/hotelResourceAccess';

export class PaymentController {
  constructor(private paymentService: PaymentService) {}

  public getPaymentById = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Payment ID is required',
        });
      }

      logger.info(
        `PaymentController::getPaymentById - Fetching payment with ID: ${id}`,
      );
      const payment = await this.paymentService.getPaymentById(id);

      if (!payment || !resourceBelongsToTokenHotel(req, payment.hotel_id)) {
        return res.status(404).json({
          success: false,
          error: 'Payment not found',
        });
      }

      res.json({
        success: true,
        data: payment,
      });
    } catch (error: unknown) {
      logger.error(
        `Error in PaymentController::getPaymentById: Error fetching payment with ID ${req.params.id}:`,
        error,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  };
}
