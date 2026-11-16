import { raw, Request, Response, Router } from 'express';
import { StripeWebhookService } from '../../services/stripe/webhook/stripeWebhookService';
import logger from '../../utils/logger';

export class StripeWebhookController {
  private stripeWebhookService: StripeWebhookService;
  public router: Router;

  constructor(stripeWebhookService: StripeWebhookService) {
    this.stripeWebhookService = stripeWebhookService;
    this.router = Router();
    this.router.use(raw({ type: 'application/json' }));

    /**
     * Stripe webhook endpoint
     *
     * This endpoint handles incoming webhook events from Stripe.
     * It uses the raw body parser to preserve the signature for verification.
     */
    this.router.post('/payment-complete', this.handleWebhook.bind(this));
    this.router.post(
      '/connected-payment',
      this.handleConnectedAccountWebhook.bind(this),
    );
  }
  /**
   * Handles incoming Stripe webhook requests
   */
  public async handleWebhook(req: Request, res: Response): Promise<void> {
    const sig = req.headers['stripe-signature'] as string;
    const payload = req.body;

    try {
      await this.stripeWebhookService.handleWebhookEvent(payload, sig);
      res.status(200).json({ received: true });
    } catch (error) {
      const err = error as Error;
      logger.error(`Webhook error: ${err.message}`);

      if (err.message.startsWith('Webhook Error:')) {
        res.status(400).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Error processing webhook event' });
      }
    }
  }

  /**
   * Handles incoming Stripe webhook requests
   */
  public async handleConnectedAccountWebhook(
    req: Request,
    res: Response,
  ): Promise<void> {
    const sig = req.headers['stripe-signature'] as string;
    const payload = req.body;

    try {
      await this.stripeWebhookService.handleConnectedAccountWebhookEvent(
        payload,
        sig,
      );
      res.status(200).json({ received: true });
    } catch (error) {
      const err = error as Error;
      logger.error(`Webhook error: ${err.message}`);

      if (err.message.startsWith('Webhook Error:')) {
        res.status(400).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Error processing webhook event' });
      }
    }
  }
}
