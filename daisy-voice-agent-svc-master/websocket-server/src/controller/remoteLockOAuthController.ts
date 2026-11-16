import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { BadRequestError } from '../errors/BadRequestError';
import {
  RemoteLockOAuthService,
  remoteLockOAuthService as defaultRemoteLockOAuthService,
} from '../remotelock/services/oauthService';
import logger from '../utils/logger';
import { handleCoreApiErrorAndSendResponse } from './util/helper';

/**
 * The last thing a hotel sees after authorizing from the RemoteLock
 * marketplace, so it renders as a page rather than the raw JSON that reads as
 * a failure to a non-technical user. Read once on first request and cached —
 * it has no data to interpolate.
 */
const AUTHORIZATION_COMPLETE_PAGE_PATH = path.resolve(
  __dirname,
  '../static/templates/pages/remotelock-connected.html',
);

let authorizationCompletePage: string | undefined;

const getAuthorizationCompletePage = (): string => {
  if (authorizationCompletePage === undefined) {
    authorizationCompletePage = fs.readFileSync(
      AUTHORIZATION_COMPLETE_PAGE_PATH,
      'utf-8',
    );
  }
  return authorizationCompletePage;
};

export class RemoteLockOAuthController {
  constructor(
    private remoteLockOAuthService: RemoteLockOAuthService = defaultRemoteLockOAuthService,
  ) {}

  /**
   * Public: the Redirect URI registered on Dextr's RemoteLock OAuth
   * Application.
   * RemoteLock calls it directly once a hotel authorizes us from the
   * marketplace, so there is no way to attach Daisy's own auth header — and no
   * `state`, since RemoteLock builds the authorize URL, not us.
   *
   * The token pair is logged rather than stored: the callback carries nothing
   * that identifies which hotel authorized. See `RemoteLockOAuthService`.
   */
  public async callback(req: Request, res: Response) {
    try {
      const { code } = req.query;
      if (typeof code !== 'string' || !code) {
        throw new BadRequestError('code query param is required');
      }

      await this.remoteLockOAuthService.exchangeCodeForToken(code);
      res.status(200).type('html').send(getAuthorizationCompletePage());
    } catch (error) {
      logger.error(
        `Error in RemoteLockOAuthController.callback: ${
          error instanceof Error ? error.stack || error.message : String(error)
        }`,
      );
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }
}

export default new RemoteLockOAuthController();
