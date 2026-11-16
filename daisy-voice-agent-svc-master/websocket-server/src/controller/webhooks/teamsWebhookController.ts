import type { CloudAdapter } from '@microsoft/agents-hosting';
import { NextFunction, Request, Response, Router } from 'express';
import {
  getTeamsAdapter,
  isTeamsConfigured,
} from '../../services/teams/teamsAdapter';
import {
  TeamsInboundActivity,
  TeamsWebhookService,
} from '../../services/teams/teamsWebhookService';
import logger from '../../utils/logger';

export class TeamsWebhookController {
  public router: Router;

  constructor(
    private teamsWebhookService: () => TeamsWebhookService,
    private adapter: () => Promise<CloudAdapter> = getTeamsAdapter,
    private isConfigured: () => boolean = isTeamsConfigured,
  ) {
    this.router = Router();

    /**
     * Bot Framework posts every Teams activity here. The SDK adapter checks the
     * Bot Framework JWT (authorizeRequest) before the activity is processed.
     */
    this.router.post(
      '/',
      this.requireConfigured.bind(this),
      this.authorize.bind(this),
      this.handleWebhook.bind(this),
    );
    this.router.get('/', this.healthCheck.bind(this));
  }

  public requireConfigured(
    _req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (!this.isConfigured()) {
      logger.warn('Teams webhook called but Teams credentials are not set');
      res.status(503).json({ ok: false, error: 'Teams is not configured' });
      return;
    }
    next();
  }

  private async authorize(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const adapter = await this.adapter();
    await adapter.authorizeRequest(req, res, next);
  }

  public async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      const adapter = await this.adapter();
      await adapter.process(req, res, async (context) => {
        try {
          await this.teamsWebhookService().handleActivity(
            context.activity as TeamsInboundActivity,
          );
        } catch (error) {
          // Answer 200 anyway so Bot Framework does not redeliver the activity.
          logger.error(`Teams webhook error: ${(error as Error).message}`);
        }
      });
    } catch (error) {
      logger.error(
        `Teams webhook processing error: ${(error as Error).message}`,
      );
      if (!res.headersSent) {
        res.status(500).json({ ok: false });
      }
    }
  }

  public async healthCheck(_req: Request, res: Response): Promise<void> {
    res.status(200).json({
      status: 'ok',
      service: 'teams-webhook',
      timestamp: new Date().toISOString(),
    });
  }
}
