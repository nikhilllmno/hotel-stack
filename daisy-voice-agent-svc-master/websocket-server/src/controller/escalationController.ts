import { Response } from 'express';
import { CustomRequest } from '../customheaderTypes/express';
import { EscalationStatus } from '../dtos/enum/EscalationStatus';
import { EscalationService } from '../services/escalation/escalationService';
import {
  getAssistantPhoneNumber,
  getCallerPhoneNumber,
  getCurrentSessionId,
} from '../utils/helper';
import logger from '../utils/logger';
import { createEscalationSchema } from '../validators/escalationSchema';
import { handleCoreApiErrorAndSendResponse } from './util/helper';

export class EscalationController {
  constructor(private escalationService: EscalationService) {}

  public createEscalation = async (req: CustomRequest, res: Response) => {
    try {
      // Validate request body
      const { error, value } = createEscalationSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        logger.error(
          `Validation error in createEscalation: ${error.details.map((d) => d.message).join(', ')}`,
        );
        return res.status(400).json({
          error: 'Validation failed',
          details: error.details.map((d) => d.message),
        });
      }

      const { message, full_name } = value;
      const phoneNumber = getCallerPhoneNumber(req).trim();
      const sessionId = getCurrentSessionId(req);
      const assistantPhoneNumber = getAssistantPhoneNumber(req);

      // Check if we have at least one phone number
      if (!phoneNumber) {
        return res.status(400).json({
          error: 'Missing caller_phone_number',
        });
      }

      const result = await this.escalationService.handleEscalation(
        {
          phone_number: phoneNumber,
          full_name,
          message,
          session_id: sessionId,
          status: EscalationStatus.OPEN,
        },
        assistantPhoneNumber,
      );
      res.status(201).json(result);
    } catch (err) {
      logger.error('Error creating escalation:', err);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  };
}
