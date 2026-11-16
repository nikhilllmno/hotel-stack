/**
 * CloudbedsWebhookController
 *
 * HTTP layer for Cloudbeds webhooks. Receives the POST request,
 * delegates to the webhook service, and returns the appropriate
 * HTTP status code.
 *
 * - 200: Event processed successfully (or intentionally skipped)
 * - 400: Malformed payload (missing required fields)
 * - 500: Unexpected error (Cloudbeds will retry)
 */

import { Request, Response, Router } from 'express';
import {
  CloudbedsWebhookService,
  cloudbedsWebhookService,
} from '../../cloudbeds/services/cloudbedsWebhookService';
import { CloudbedsWebhookBasePayload } from '../../cloudbeds/types/WebhookPayload';
import logger from '../../utils/logger';

export class CloudbedsWebhookController {
  public router: Router;

  constructor(
    private readonly webhookService: CloudbedsWebhookService = cloudbedsWebhookService,
  ) {
    this.router = Router();
    this.router.post('/', this.handleWebhook.bind(this));
  }

  public async handleWebhook(req: Request, res: Response): Promise<void> {
    const payload = req.body as CloudbedsWebhookBasePayload;

    try {
      if (!payload?.event) {
        logger.warn(
          'CloudbedsWebhookController: Received webhook without event field',
        );
        res.status(400).json({
          success: false,
          message: 'Missing required field: event',
        });
        return;
      }

      const result = await this.webhookService.handleWebhookEvent(payload);
      res.status(200).json(result);
    } catch (error) {
      const err = error as Error;
      logger.error(
        `CloudbedsWebhookController: Webhook processing failed: ${err.message}`,
        { error: err, event: payload?.event },
      );

      res.status(500).json({
        success: false,
        message: 'Internal error processing webhook',
      });
    }
  }
}
