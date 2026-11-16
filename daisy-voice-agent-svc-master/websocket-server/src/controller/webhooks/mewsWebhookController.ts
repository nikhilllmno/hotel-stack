import { Request, Response, Router } from 'express';
import { MewsWebhookService } from '../../mews/services/mewsWebhookService';
import { MewsWebhookPayload } from '../../mews/types';
import logger from '../../utils/logger';

export class MewsWebhookController {
  private mewsWebhookService: MewsWebhookService;
  public router: Router;

  constructor(mewsWebhookService: MewsWebhookService) {
    this.mewsWebhookService = mewsWebhookService;
    this.router = Router();

    this.router.post('/', this.handleWebhook.bind(this));
  }

  public async handleWebhook(req: Request, res: Response): Promise<void> {
    const payload = req.body as MewsWebhookPayload;

    try {
      logger.info(
        `MewsWebhookController: Received webhook enterpriseId=${payload?.EnterpriseId}`,
      );

      const result = await this.mewsWebhookService.handleWebhookEvent(payload);

      res.status(200).json(result);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`MewsWebhookController: Webhook error: ${errorMessage}`, {
        error,
      });

      if (errorMessage.startsWith('Webhook Error:')) {
        res.status(400).json({
          success: false,
          error: errorMessage,
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Error processing Mews webhook event',
        });
      }
    }
  }
}
