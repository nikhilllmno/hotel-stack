import { Response } from 'express';
import { CustomRequest } from '../customheaderTypes/express';
import { BadRequestError } from '../errors/BadRequestError';
import {
  AlfredService,
  CustomerLookupParams,
} from '../services/alfred/alfredService';
import logger from '../utils/logger';
import { handleCoreApiErrorAndSendResponse } from './util/helper';

export class AlfredController {
  constructor(private alfredService: AlfredService) {}

  private extractLookupParams(
    body: Record<string, unknown>,
  ): CustomerLookupParams {
    const tenantId = body?.tenant_id;
    if (!tenantId || typeof tenantId !== 'string') {
      throw new BadRequestError('tenant_id is required');
    }

    const externalPartnerId = body?.external_partner_id;
    const lastName = body?.last_name;
    const checkoutDate = body?.checkout_date;

    if (externalPartnerId) {
      if (
        typeof externalPartnerId !== 'string' &&
        typeof externalPartnerId !== 'number'
      ) {
        throw new BadRequestError(
          'external_partner_id must be a string or number',
        );
      }
      return { externalPartnerId: String(externalPartnerId), tenantId };
    }

    if (lastName && checkoutDate) {
      if (typeof lastName !== 'string' || typeof checkoutDate !== 'string') {
        throw new BadRequestError(
          'last_name and checkout_date must be strings',
        );
      }
      return { lastName, checkoutDate, tenantId };
    }

    throw new BadRequestError(
      'Either external_partner_id or both last_name and checkout_date are required',
    );
  }

  async getDoorCodeByExternalPartner(
    req: CustomRequest,
    res: Response,
  ): Promise<void> {
    const phoneNumber = req.phoneNumber;

    try {
      const lookupParams = this.extractLookupParams(req.body);

      logger.info(
        `AlfredController: getDoorCodeByExternalPartner called, lookup=${JSON.stringify(lookupParams)}, phoneNumber=${phoneNumber}`,
      );

      if (!req.assistantPhoneNumber || !phoneNumber) {
        throw new BadRequestError(
          'Assistant phone number and customer phone number are required',
        );
      }

      const result = await this.alfredService.getDoorCodeByExternalPartner(
        lookupParams,
        {
          assistantPhoneNumber: req.assistantPhoneNumber,
          customerPhoneNumber: phoneNumber,
        },
      );

      res.status(200).json({
        doorCode: result.doorCode,
        doorCodeSpoken: result.doorCodeSpoken,
      });
    } catch (error) {
      logger.error(
        `AlfredController: Error in getDoorCodeByExternalPartner: ${error}`,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  async getReservationDetailsByExternalPartner(
    req: CustomRequest,
    res: Response,
  ): Promise<void> {
    try {
      const lookupParams = this.extractLookupParams(req.body);

      logger.info(
        `AlfredController: getReservationDetailsByExternalPartner called, lookup=${JSON.stringify(lookupParams)}`,
      );

      const result =
        await this.alfredService.getReservationDetailsByExternalPartner(
          lookupParams,
        );

      res.status(200).json(result);
    } catch (error) {
      logger.error(
        `AlfredController: Error in getReservationDetailsByExternalPartner: ${error}`,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  async updateCustomerPhoneNumber(
    req: CustomRequest,
    res: Response,
  ): Promise<void> {
    try {
      const customerId = req.body?.customer_id;
      const phoneNumber = req.body?.phone_number;
      if (!customerId || typeof customerId !== 'string') {
        throw new BadRequestError('customer_id must be a non-empty string');
      }
      if (!phoneNumber || typeof phoneNumber !== 'string') {
        throw new BadRequestError('phone_number must be a non-empty string');
      }

      const digits = phoneNumber.replace(/\D/g, '');
      if (digits.length !== 10) {
        throw new BadRequestError(
          'phone_number must be a valid 10-digit number',
        );
      }

      logger.info(
        `AlfredController: updateCustomerPhoneNumber called, customerId=${customerId}`,
      );

      const result = await this.alfredService.updateCustomerPhoneNumber({
        customerId,
        phoneNumber: digits,
      });

      res.status(200).json(result);
    } catch (error) {
      logger.error(
        `AlfredController: Error in updateCustomerPhoneNumber: ${error}`,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }
}
