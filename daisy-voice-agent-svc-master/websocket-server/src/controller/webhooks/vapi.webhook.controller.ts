import { Request, Response, Router } from 'express';
import { VapiWebhookService } from '../../services/vapi/webhook/vapi.webhook.service';
import logger from '../../utils/logger';

export class VapiWebhookController {
  private vapiWebhookService: VapiWebhookService;
  public router: Router;

  constructor(vapiWebhookService: VapiWebhookService) {
    this.vapiWebhookService = vapiWebhookService;
    this.router = Router();

    /**
     * Vapi webhook endpoint
     *
     * This endpoint handles incoming webhook events from Vapi.
     */
    this.router.post('/event', this.handleWebhook.bind(this));
  }

  /**
   * Handles incoming Vapi webhook requests
   */
  public async handleWebhook(req: Request, res: Response): Promise<void> {
    const signature = req.headers['x-vapi-secret'] as string;
    const payload = req.body;

    try {
      await this.vapiWebhookService.handleWebhookEvent(payload, signature);
      res.status(200).json({ received: true });
    } catch (error) {
      const err = error as Error;
      logger.error(`Vapi Webhook error: ${err.message}`);

      if (err.message.startsWith('Webhook Error:')) {
        res.status(400).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Error processing Vapi webhook event' });
      }
    }
  }
}
