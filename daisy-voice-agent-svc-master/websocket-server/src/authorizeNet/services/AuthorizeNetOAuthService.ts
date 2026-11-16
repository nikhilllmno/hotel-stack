/* global URL, URLSearchParams */
import axios from 'axios';
import jwt from 'jsonwebtoken';
import config from '../../config';
import { AuthorizeNetError } from '../../errors/AuthorizeNetError';
import { BadRequestError } from '../../errors/BadRequestError';
import logger from '../../utils/logger';
import { AUTHNET_URLS, AuthorizeNetTokenResponse } from '../types';

const STATE_PURPOSE = 'authorizenet_oauth';
const STATE_TTL = '15m';

interface AuthorizeNetStatePayload {
  purpose: string;
}

/**
 * Handles Authorize.net Authorization Code OAuth: authorize URL, CSRF state, code exchange.
 */
export class AuthorizeNetOAuthService {
  buildAuthorizeUrl(): string {
    if (!config.JWT_SECRET) {
      throw new BadRequestError('JWT_SECRET is not configured');
    }
    if (!config.AUTHORIZE_NET_CLIENT_ID) {
      throw new BadRequestError('AUTHORIZE_NET_CLIENT_ID is not configured');
    }
    if (!config.AUTHORIZE_NET_REDIRECT_URI) {
      throw new BadRequestError('AUTHORIZE_NET_REDIRECT_URI is not configured');
    }

    const state = this.createState();

    const url = new URL(
      AUTHNET_URLS[config.AUTHORIZE_NET_ENVIRONMENT].authorize,
    );
    url.searchParams.set('sub', 'oauth');
    url.searchParams.set('client_id', config.AUTHORIZE_NET_CLIENT_ID);
    url.searchParams.set('redirect_uri', config.AUTHORIZE_NET_REDIRECT_URI);
    url.searchParams.set('scope', 'read,write');
    url.searchParams.set('state', state);

    return url.toString();
  }

  createState(): string {
    if (!config.JWT_SECRET) {
      throw new BadRequestError('JWT_SECRET is not configured');
    }
    return jwt.sign({ purpose: STATE_PURPOSE }, config.JWT_SECRET, {
      expiresIn: STATE_TTL,
    });
  }

  verifyState(state: string): void {
    if (!config.JWT_SECRET) {
      throw new BadRequestError('JWT_SECRET is not configured');
    }

    let payload: AuthorizeNetStatePayload;
    try {
      payload = jwt.verify(
        state,
        config.JWT_SECRET,
      ) as AuthorizeNetStatePayload;
    } catch (error) {
      throw new BadRequestError(
        `Invalid or expired Authorize.net OAuth state: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (payload.purpose !== STATE_PURPOSE) {
      throw new BadRequestError('Authorize.net OAuth state failed validation');
    }
  }

  async exchangeAuthorizationCode(
    code: string,
  ): Promise<AuthorizeNetTokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.AUTHORIZE_NET_CLIENT_ID,
      client_secret: config.AUTHORIZE_NET_CLIENT_SECRET,
      redirect_uri: config.AUTHORIZE_NET_REDIRECT_URI,
    });

    let response;
    try {
      response = await axios.post<AuthorizeNetTokenResponse>(
        AUTHNET_URLS[config.AUTHORIZE_NET_ENVIRONMENT].token,
        body.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: config.API_TIMEOUT,
        },
      );
    } catch (error: unknown) {
      // Never let the raw AxiosError propagate: its serialized `config.data`
      // carries the request body (client_secret + authorization code) in
      // plaintext, which upstream error logging would write to logs.
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        logger.error(
          `AuthorizeNetOAuthService::exchangeAuthorizationCode - token endpoint returned ${
            status ?? 'no response'
          }`,
        );
        throw new AuthorizeNetError(
          `Authorize.net authorization code exchange failed${
            status ? ` (status ${status})` : ''
          }`,
          502,
        );
      }
      logger.error(
        'AuthorizeNetOAuthService::exchangeAuthorizationCode - unexpected error during token exchange',
      );
      throw new AuthorizeNetError(
        'Authorize.net authorization code exchange failed',
        502,
      );
    }

    const { access_token, refresh_token } = response.data;
    if (!access_token || !refresh_token) {
      logger.error(
        'AuthorizeNetOAuthService::exchangeAuthorizationCode - Missing tokens in response',
      );
      throw new AuthorizeNetError(
        'Authorize.net token response did not contain both access_token and refresh_token',
        502,
      );
    }

    return response.data;
  }
}

export const authorizeNetOAuthService = new AuthorizeNetOAuthService();
export default authorizeNetOAuthService;
