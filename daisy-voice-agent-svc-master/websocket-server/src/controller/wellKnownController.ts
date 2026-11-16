import { Request, RequestHandler, Response } from 'express';
import { buildJwksJson } from '../utils/jwtIssuer';
import logger from '../utils/logger';

/**
 * Public metadata endpoints (e.g. JWKS for RS256 JWT verification; must not sit behind authMiddleware).
 */
export class WellKnownController {
  getJwks: RequestHandler = (_req: Request, res: Response) => {
    try {
      const body = buildJwksJson();
      res.status(200).json(body);
    } catch (err) {
      logger.error('JWKS endpoint error', err);
      res.status(500).json({ error: 'Failed to build JWKS' });
    }
  };
}
