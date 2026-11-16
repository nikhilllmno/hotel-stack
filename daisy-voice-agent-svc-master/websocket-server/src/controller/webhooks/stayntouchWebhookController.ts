import { Request, Response, Router } from 'express';
import { StayntouchWebhookService } from '../../services/stayntouch/stayntouchWebhookService';
import { StayntouchEvent } from '../../types/stayntouch.types';
import logger from '../../utils/logger';

export class StayntouchWebhookController {
  private stayntouchWebhookService: StayntouchWebhookService;
  public router: Router;

  constructor(stayntouchWebhookService: StayntouchWebhookService) {
    this.stayntouchWebhookService = stayntouchWebhookService;
    this.router = Router();

    this.router.post('/', this.handleWebhook.bind(this));
  }

  public async handleWebhook(req: Request, res: Response): Promise<void> {
    const payload = req.body as StayntouchEvent;

    try {
      logger.info(
        `StayntouchWebhookController: Received webhook event type=${payload.event}`,
      );

      const result =
        await this.stayntouchWebhookService.handleWebhookEvent(payload);

      res.status(200).json(result);
    } catch (error) {
      const err = error as Error;
      logger.error(
        `StayntouchWebhookController: Webhook error: ${err.message}`,
        { error: err },
      );

      if (err.message.startsWith('Webhook Error:')) {
        res.status(400).json({
          success: false,
          error: err.message,
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Error processing Stayntouch webhook event',
        });
      }
    }
  }
}
