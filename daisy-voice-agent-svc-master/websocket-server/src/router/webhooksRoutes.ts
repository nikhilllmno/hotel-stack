/**
 * Stayntouch registers its callback URL as /webhooks/stayntouch (plural).
 * Other integrations (Stripe, Vapi, Telegram) live under /webhook and that
 * mount path cannot be changed, so Stayntouch is routed here instead.
 * PMS webhooks (Stayntouch, Mews, Cloudbeds) live here together.
 */
import { Router } from 'express';
import { CloudbedsWebhookController } from '../controller/webhooks/cloudbedsWebhookController';
import { MewsWebhookController } from '../controller/webhooks/mewsWebhookController';
import { StayntouchWebhookController } from '../controller/webhooks/stayntouchWebhookController';
import { mewsWebhookService } from '../mews/services/mewsWebhookService';
import { stayntouchWebhookService } from '../services/stayntouch/stayntouchWebhookService';

const pmsWebhookRouter = Router();

const stayntouchController = new StayntouchWebhookController(
  stayntouchWebhookService,
);
const mewsController = new MewsWebhookController(mewsWebhookService);
const cloudbedsController = new CloudbedsWebhookController();

pmsWebhookRouter.use('/stayntouch', stayntouchController.router);
pmsWebhookRouter.use('/mews', mewsController.router);
pmsWebhookRouter.use('/cloudbeds', cloudbedsController.router);

export default pmsWebhookRouter;
