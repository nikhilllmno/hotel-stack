import { Response } from 'express';
import { EmailService } from '../services/email/emailService';
import { AuthenticatedRequest } from '../types/customRequest';
import logger from '../utils/logger';
import { sendEmailSchema } from '../validators/emailSchema';
import { handleCoreApiErrorAndSendResponse } from './util/helper';

export class EmailController {
  constructor(private emailService: EmailService) {}

  public sendEmail = async (req: AuthenticatedRequest, res: Response) => {
    const { error, value } = sendEmailSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      logger.error(
        `Validation error in sendEmail: ${error.details.map((d) => d.message).join(', ')}`,
      );
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details.map((d) => d.message),
      });
    }

    try {
      const { to, templateName, subject, variables, cc, bcc } = value;
      const messageId = await this.emailService.sendTemplatedEmail({
        to,
        templateName,
        subject,
        variables,
        cc,
        bcc,
      });

      res.status(200).json({
        message: 'Email sent successfully',
        messageId,
      });
    } catch (err: unknown) {
      logger.error('Error in EmailController::sendEmail:', err);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  };

  public listTemplates = async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const templates = await this.emailService.listTemplates();
      res.status(200).json({ templates });
    } catch (err: unknown) {
      logger.error('Error in EmailController::listTemplates:', err);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  };
}
