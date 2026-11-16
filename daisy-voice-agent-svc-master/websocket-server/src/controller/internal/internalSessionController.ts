import { Request, Response } from 'express';
import SessionService from '../../services/session/SessionService';
import logger from '../../utils/logger';
import { handleCoreApiErrorAndSendResponse } from '../util/helper';

export class InternalSessionController {
  constructor(private readonly sessionService: typeof SessionService) {}

  /**
   * GET /internal/sessions/routing
   * Query params: caller_phone_number, assistant_phone_number
   *
   * Lightweight routing-mode check only — no message storage.
   * Can be used from dashboard to check if the session is in DIRECT mode.
   */
  async getSessionRouting(req: Request, res: Response): Promise<void> {
    // No global error middleware — wrap the handler so errors are caught explicitly.
    try {
      const { caller_phone_number, assistant_phone_number } =
        req.query as Record<string, string>;

      if (!caller_phone_number || !assistant_phone_number) {
        res.status(400).json({
          error:
            'caller_phone_number and assistant_phone_number are required query parameters',
        });
        return;
      }

      const result = await this.sessionService.getEffectiveRoutingMode(
        caller_phone_number,
        assistant_phone_number,
      );
      res.status(200).json(result);
    } catch (error) {
      logger.error(`getSessionRouting: Error: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  /**
   * POST /internal/sessions/routing
   * Body: { caller_phone_number, assistant_phone_number, message, timestamp? }
   *
   * Combined routing-check + conditional message storage.
   * - Returns { mode, agent_may_reply } same as GET.
   * - When mode is DIRECT: stores the guest message in conversation history
   *   and fires sendTranscriptToTelegram (same path as normal message receipt).
   * - When mode is AI: returns immediately — n8n continues to the AI agent.
   */
  async handleIncomingGuestMessage(req: Request, res: Response): Promise<void> {
    // No global error middleware — wrap the handler so errors are caught explicitly.
    try {
      const {
        caller_phone_number,
        assistant_phone_number,
        message,
        timestamp,
      } = req.body as {
        caller_phone_number?: string;
        assistant_phone_number?: string;
        message?: string;
        timestamp?: string;
      };

      if (!caller_phone_number || !assistant_phone_number || !message) {
        res.status(400).json({
          error:
            'caller_phone_number, assistant_phone_number, and message are required',
        });
        return;
      }

      const messageTimestamp = timestamp ? new Date(timestamp) : new Date();
      if (isNaN(messageTimestamp.getTime())) {
        res.status(400).json({ error: 'Invalid timestamp format' });
        return;
      }

      const result = await this.sessionService.handleIncomingGuestMessage(
        caller_phone_number,
        assistant_phone_number,
        message,
        messageTimestamp,
      );
      res.status(200).json(result);
    } catch (error) {
      logger.error(`handleIncomingGuestMessage: Error: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }
}
