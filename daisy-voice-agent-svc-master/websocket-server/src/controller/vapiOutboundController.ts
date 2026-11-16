import { Request, Response } from 'express';
import { vapiOutboundService } from '../services/vapi/vapiOutboundService';
import logger from '../utils/logger';
import {
  VapiOutboundCallBody,
  vapiOutboundCallSchema,
} from '../validators/vapiOutboundCallSchema';

export class VapiOutboundController {
  /**
   * POST /vapi/outbound-call — proxy to Vapi outbound call API.
   */
  createOutboundCall = async (req: Request, res: Response): Promise<void> => {
    const { error, value } = vapiOutboundCallSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      const details = error.details.map((d) => d.message);
      res.status(400).json({
        error: 'Validation failed',
        details,
      });
      return;
    }

    try {
      const data = await vapiOutboundService.createOutboundCall(
        value as VapiOutboundCallBody,
      );
      res.status(201).json(data);
    } catch (err: unknown) {
      const e = err as Error & { statusCode?: number; details?: unknown };
      if (e.statusCode && e.statusCode >= 400 && e.statusCode < 600) {
        res.status(e.statusCode).json({
          error: e.message,
          details: e.details,
        });
        return;
      }
      if (e.message === 'VAPI_API_KEY is not configured') {
        res.status(503).json({ error: e.message });
        return;
      }
      logger.error('VapiOutboundController.createOutboundCall:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export const vapiOutboundController = new VapiOutboundController();
