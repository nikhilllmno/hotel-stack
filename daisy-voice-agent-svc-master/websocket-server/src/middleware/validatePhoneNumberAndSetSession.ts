import { NextFunction, Response } from 'express';
import { PHONE_NUMBER_HEADER } from '../constants/header';
import { CustomRequest } from '../customheaderTypes/express';
import { SessionType } from '../dtos/enum/SessionType';
import { BadRequestError } from '../errors/BadRequestError';
import { BaseError } from '../errors/BaseError';
import { hotelService } from '../services/hotel/hotelService';
import sessionService from '../services/session/SessionService';
import { convertToPhoneNumber, formatPhoneNumber } from '../utils/helper';
import logger from '../utils/logger';
import { setRequestContext } from '../utils/requestContext';

/**
 * Middleware to validate X-Phone-Number header
 * @param req Express request object
 * @param res Express response object
 * @param next Next middleware function
 */
export const validatePhoneNumber = async (
  req: CustomRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const customerPhoneNumber =
      req.body?.caller_phone_number || req.get(PHONE_NUMBER_HEADER);
    const assistantPhoneNumber = convertToPhoneNumber(
      req.body?.assistant_phone_number,
    );
    const businessId = req.businessId || req.body?.business_id;

    if (!customerPhoneNumber) {
      logger.error(
        `validatePhoneNumber: Missing phone number in request: ${customerPhoneNumber}`,
      );
      throw new BadRequestError(
        'Phone number is required in X-Phone-Number header or request body',
      );
    }

    // UUID is used instead of phone number for webchats
    if (req.body?.session_type === SessionType.CHAT) {
      logger.info(
        `validatePhoneNumber: Webchat request received for unique customer id: ${customerPhoneNumber}`,
      );
      req.phoneNumber = customerPhoneNumber;
      req.assistantPhoneNumber = assistantPhoneNumber || '';
      setRequestContext({
        customerPhone: customerPhoneNumber,
        assistantPhoneNumber: assistantPhoneNumber,
      });
      next();
    } else {
      const hotel = await hotelService.getHotelByBusinessIdOrPhoneNumber(
        businessId,
        assistantPhoneNumber,
      );
      if (!hotel) {
        if (businessId) {
          logger.error(
            `setSessionData: No hotel found for business ID ${businessId}`,
          );
        } else if (assistantPhoneNumber) {
          logger.error(
            `setSessionData: No hotel found for assistant phone number ${assistantPhoneNumber}`,
          );
        }
        throw new BadRequestError('No hotel found');
      }
      const cleanedCustomerPhoneNumber = convertToPhoneNumber(
        formatPhoneNumber(customerPhoneNumber, hotel.country),
      );
      if (!cleanedCustomerPhoneNumber) {
        logger.error(
          `validatePhoneNumber:Invalid phone number received: ${customerPhoneNumber}`,
        );
        throw new BadRequestError('Invalid phone number');
      }

      // Store the cleaned phone number for use in controller
      req.phoneNumber = cleanedCustomerPhoneNumber;
      req.assistantPhoneNumber = hotel.assistant_phone_number;
      setRequestContext({
        customerPhone: cleanedCustomerPhoneNumber,
        assistantPhoneNumber: hotel.assistant_phone_number,
      });
      next();
    }
  } catch (error) {
    logger.error(`validatePhoneNumber: Error occurred: ${error}`);
    if (error instanceof BaseError) {
      res.status(error.statusCode).json({
        message: error.message,
        error: error.message,
      });
      return;
    }
    res.status(500).json({
      message: 'Internal server error during phone number validation',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const setSessionData = async (
  req: CustomRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const customerPhoneNumber = req.phoneNumber || '';
    const businessId = req.businessId || req.body?.business_id;
    const assistantPhoneNumber = convertToPhoneNumber(
      req.body?.assistant_phone_number,
    );
    const sessionType = req.body?.session_type;
    if (!sessionType) {
      const msg = 'setSessionData: Session type is required.';
      logger.error(msg);
      throw new BadRequestError(msg);
    }
    if (!businessId && !assistantPhoneNumber) {
      const msg =
        'setSessionData: Either business ID or assistant phone number is required.';
      throw new BadRequestError(msg);
    }
    const hotel = await hotelService.getHotelByBusinessIdOrPhoneNumber(
      businessId,
      assistantPhoneNumber,
    );
    if (!hotel) {
      if (businessId) {
        logger.error(
          `setSessionData: No hotel found for business ID ${businessId}`,
        );
      } else if (assistantPhoneNumber) {
        logger.error(
          `setSessionData: No hotel found for assistant phone number ${assistantPhoneNumber}`,
        );
      }
      throw new BadRequestError('No hotel found');
    }
    const session = await sessionService.getLatestActiveSession(
      hotel.assistant_phone_number,
      customerPhoneNumber,
      sessionType,
    );
    if (!session) {
      logger.error(
        `No active session found for customer phone number: ${customerPhoneNumber}`,
      );
      throw new BadRequestError('No active session found for phone number');
    }
    // Remove caller_phone_number from the request body
    const { caller_phone_number: _caller_phone_number, ...restBody } = req.body;
    req.body = restBody;
    // Store the session details in CustomRequest
    req.sessionId = session.id;
    req.assistantPhoneNumber = hotel.assistant_phone_number;
    req.sessionType = session.session_type;
    req.hotelId = hotel.id;
    // Populate request context with customer/hotel metadata
    setRequestContext({
      customerPhone: customerPhoneNumber,
      assistantPhoneNumber: hotel.assistant_phone_number,
      hotelId: hotel.id,
    });
    next();
  } catch (error) {
    logger.error(`setSessionData: Error occurred: ${error}`);
    if (error instanceof BaseError) {
      res.status(error.statusCode).json({
        message: error.message,
        error: error.message,
      });
      return;
    }
    res.status(500).json({
      message: 'Internal server error during session data setup',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
