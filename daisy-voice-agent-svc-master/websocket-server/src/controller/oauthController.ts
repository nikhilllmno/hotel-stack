import { Request, Response } from 'express';
import { BadRequestError } from '../errors/BadRequestError';
import {
  OAuthService,
  oauthService as defaultOAuthService,
} from '../oauth/OAuthService';
import logger from '../utils/logger';
import { handleCoreApiErrorAndSendResponse } from './util/helper';

export class OAuthController {
  constructor(private oauthService: OAuthService = defaultOAuthService) {}

  public async connect(req: Request, res: Response) {
    try {
      const { provider } = req.params;
      if (!provider) {
        throw new BadRequestError('provider route param is required');
      }

      const authorizeUrl = this.oauthService.getAuthorizeUrl(
        provider,
        req.query,
      );
      res.redirect(302, authorizeUrl);
    } catch (error) {
      logger.error(
        `Error in OAuthController.connect: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async callback(req: Request, res: Response) {
    try {
      const { provider } = req.params;
      if (!provider) {
        throw new BadRequestError('provider route param is required');
      }

      const result = await this.oauthService.handleCallback(
        provider,
        req.query,
      );
      res.status(200).json({
        message: `OAuth authorization complete for ${result.provider}`,
        provider: result.provider,
        meta: result.meta,
      });
    } catch (error) {
      logger.error(
        `Error in OAuthController.callback: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }
}

export default new OAuthController();
