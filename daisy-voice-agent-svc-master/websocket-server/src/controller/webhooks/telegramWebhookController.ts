import { Request, Response, Router } from 'express';
import { TelegramUpdate } from '../../dtos/telegram/TelegramUpdate';
import { TelegramWebhookService } from '../../services/telegram/telegramWebhookService';
import logger from '../../utils/logger';

export class TelegramWebhookController {
  private telegramWebhookService: TelegramWebhookService;
  public router: Router;

  constructor(telegramWebhookService: TelegramWebhookService) {
    this.telegramWebhookService = telegramWebhookService;
    this.router = Router();

    /**
     * Telegram webhook endpoint
     *
     * This endpoint handles incoming webhook updates from Telegram Bot API.
     * Telegram will send POST requests to this endpoint when events occur.
     */
    this.router.post('/', this.handleWebhook.bind(this));

    /**
     * Health check endpoint for Telegram webhook
     * Can be used to verify the webhook is accessible
     */
    this.router.get('/', this.healthCheck.bind(this));
  }

  /**
   * Handles incoming Telegram webhook requests
   */
  public async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      // Validate secret token from Telegram
      const secretToken = req.headers[
        'x-telegram-bot-api-secret-token'
      ] as string;

      if (!this.telegramWebhookService.validateSecretToken(secretToken)) {
        logger.warn('Invalid Telegram webhook secret token');
        res.status(401).json({
          ok: false,
          error: 'Unauthorized',
        });
        return;
      }

      const data: TelegramUpdate = req.body;

      // Validate that we received an update
      if (!data || typeof data.update_id !== 'number') {
        logger.warn('Received invalid Telegram update - missing update_id');
        res.status(400).json({
          ok: false,
          error: 'Invalid update format',
        });
        return;
      }

      await this.telegramWebhookService.handleWebhookMessage(data);

      res.status(200).json({ ok: true });
    } catch (error) {
      const err = error as Error;
      logger.error(`Telegram webhook error: ${err.message}`);

      // Still return 200 to prevent Telegram from retrying
      // Log the error for debugging
      res.status(200).json({ ok: true });
    }
  }

  /**
   * Health check endpoint
   */
  public async healthCheck(req: Request, res: Response): Promise<void> {
    res.status(200).json({
      status: 'ok',
      service: 'telegram-webhook',
      timestamp: new Date().toISOString(),
    });
  }
}
