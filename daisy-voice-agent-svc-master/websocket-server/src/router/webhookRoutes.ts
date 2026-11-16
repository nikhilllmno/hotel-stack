import { Router } from 'express';
import { StripeWebhookController } from '../controller/webhooks/stripeWebhookController';
import { TeamsWebhookController } from '../controller/webhooks/teamsWebhookController';
import { TelegramWebhookController } from '../controller/webhooks/telegramWebhookController';
import { VapiWebhookController } from '../controller/webhooks/vapi.webhook.controller';
import { stripeWebhookService } from '../services/stripe/webhook/stripeWebhookService';
import { getTeamsWebhookService } from '../services/teams/teamsWebhookService';
import { telegramWebhookService } from '../services/telegram/telegramWebhookService';
import { vapiWebhookService } from '../services/vapi/webhook/vapi.webhook.service';

const webhookRouter = Router();

const stripeController = new StripeWebhookController(stripeWebhookService);
const vapiController = new VapiWebhookController(vapiWebhookService);
const telegramController = new TelegramWebhookController(
  telegramWebhookService,
);
const teamsController = new TeamsWebhookController(getTeamsWebhookService);

webhookRouter.use('/stripe', stripeController.router);
webhookRouter.use('/vapi', vapiController.router);
webhookRouter.use('/telegram', telegramController.router);
webhookRouter.use('/teams', teamsController.router);

export default webhookRouter;
