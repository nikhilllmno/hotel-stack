import axios from 'axios';
import config from '../../config';
import { SlackService } from '../../services/slack/slackService';
import { KpiStat, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import { RemoteLockClient } from '../client/RemoteLockClient';
import { getRemoteLockClientCredentials } from '../config';
import { RemoteLockAPIError } from '../errors/RemoteLockAPIError';
import { RemoteLockConfigurationError } from '../errors/RemoteLockConfigurationError';
import { RemoteLockUser } from '../types';

interface RemoteLockTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
}

export interface RemoteLockAuthorization {
  access_token: string;
  refresh_token: string;
  user: RemoteLockUser | null;
}

/**
 * Handles the marketplace-initiated half of RemoteLock's Authorization Code
 * grant.
 *
 * A hotel finds Dextr in the RemoteLock marketplace, signs into *their own*
 * RemoteLock account and authorizes Dextr's OAuth Application — one
 * Application for every hotel. RemoteLock then calls our registered
 * Redirect URI with a `code`. Because RemoteLock — not Daisy — builds that
 * authorize URL, there is no `state` we control and therefore nothing in the
 * callback that identifies which Daisy hotel just authorized.
 *
 * So this service deliberately writes nothing to the DB. It exchanges the code,
 * fetches the signed-in RemoteLock user for identification, logs the lot, and
 * alerts Slack so someone can act on it. They then paste the token pair into
 * that hotel's `external_auth_config.remotelock_access_token` /
 * `remotelock_refresh_token`, which is what `RemoteLockTokenService` reads and
 * refreshes from there on.
 */
export class RemoteLockOAuthService {
  constructor(private readonly slackService = new SlackService()) {}

  /**
   * Exchanges `code` for a token pair, then identifies the authorizing account
   * via `GET /user`. Identification failure is not fatal — the token pair is
   * the part that cannot be re-obtained without the hotel re-authorizing.
   */
  async exchangeCodeForToken(code: string): Promise<RemoteLockAuthorization> {
    const { clientId, clientSecret, redirectUri } = this.getClientCredentials();

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });

    let response;
    try {
      response = await axios.post<RemoteLockTokenResponse>(
        `${config.REMOTELOCK_AUTH_URL.replace(/\/+$/, '')}/oauth/token`,
        body.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: config.API_TIMEOUT,
        },
      );
    } catch (error) {
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      throw new RemoteLockAPIError(
        `RemoteLock rejected the authorization code: ${
          error instanceof Error ? error.message : String(error)
        }`,
        status && status < 500 ? 400 : 502,
      );
    }

    const { access_token, refresh_token } = response.data;
    if (!access_token || !refresh_token) {
      throw new RemoteLockAPIError(
        'RemoteLock OAuth token response did not contain both access_token and refresh_token',
        502,
      );
    }

    const user = await this.fetchAuthorizingUser(access_token);

    logger.info(
      'RemoteLockOAuthService::exchangeCodeForToken - RemoteLock authorization completed',
      {
        userId: user?.id,
        email: user?.attributes.email,
        primaryAccountId: user?.attributes.primary_account_id,
      },
    );

    logKpi({
      stat: KpiStat.RemoteLockAuthorizationCompleted,
      value: 1,
      contextName: 'RemoteLockOAuthService.exchangeCodeForToken',
      clientId: user?.attributes.primary_account_id,
    });

    await this.alertAuthorization(user, access_token, refresh_token);

    return { access_token, refresh_token, user };
  }

  /**
   * `GET /user` returns the RemoteLock user who authorized us — the only
   * signal available for working out which hotel this token pair belongs to.
   *
   * Failure is not fatal: the token pair is the part that cannot be re-obtained
   * without the hotel authorizing again, so it is returned (and alerted on)
   * even when the account behind it is unknown.
   */
  private async fetchAuthorizingUser(
    accessToken: string,
  ): Promise<RemoteLockUser | null> {
    try {
      return await RemoteLockClient.forAccessToken(accessToken).getUser();
    } catch (error) {
      logger.warn(
        'RemoteLockOAuthService::fetchAuthorizingUser - Could not identify the authorizing RemoteLock user',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return null;
    }
  }

  /**
   * Tells the team a hotel just authorized Dextr, who they are, and the token
   * pair to store against them.
   *
   * The tokens are posted in plaintext so the alert is self-contained — the
   * whole handoff is one message rather than a Slack ping plus a log lookup.
   * They are live credentials to that hotel's locks (the refresh token lasts
   * 90 days), so the channel behind `DEXTR_SLACK_WEBHOOK_URL` needs to be
   * restricted accordingly, and messages cleared once acted on.
   *
   * Delivery failure is swallowed: the authorization itself succeeded, and
   * failing the callback would show the hotel an error for something that
   * worked.
   */
  private async alertAuthorization(
    user: RemoteLockUser | null,
    accessToken: string,
    refreshToken: string,
  ): Promise<void> {
    // The webhook is supplied per call (the service itself is constructed
    // without one), so check the config value rather than `isConfigured()`.
    if (!config.DEXTR_SLACK_WEBHOOK_URL) {
      logger.warn(
        'RemoteLockOAuthService::alertAuthorization - DEXTR_SLACK_WEBHOOK_URL is not configured; skipping alert',
      );
      return;
    }

    const mentions = config.DEXTR_SLACK_ALERT_MENTION_USER_IDS.map(
      (userId: string) => `<@${userId}>`,
    ).join(' ');

    const identityLines = user
      ? [
          ':key: *RemoteLock authorization completed — needs linking to a hotel*',
          `> *Account*     ${user.attributes.name}`,
          `> *Email*       ${user.attributes.email}`,
          `> *Handle*      ${user.attributes.handle}`,
          `> *Account ID*  ${user.attributes.primary_account_id}`,
          `> *User ID*     ${user.id}`,
        ]
      : [
          ':warning: *RemoteLock authorization completed, but the account could not be identified*',
          '`GET /user` failed, so there are no account details to match a hotel on.',
        ];

    const lines = [
      ...identityLines,
      '*Access token*',
      `\`\`\`${accessToken}\`\`\``,
      '*Refresh token*',
      `\`\`\`${refreshToken}\`\`\``,
      'Encrypt both and store them on the matching hotel’s `external_auth_config` as `remotelock_access_token` / `remotelock_refresh_token`.',
      mentions,
    ];

    try {
      await this.slackService.sendMessage({
        recipient: config.DEXTR_SLACK_WEBHOOK_URL,
        content: { message: lines.filter(Boolean).join('\n') },
      });
    } catch (error) {
      logger.error(
        'RemoteLockOAuthService::alertAuthorization - Failed to post Slack alert',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  private getClientCredentials(): {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  } {
    const { clientId, clientSecret } = getRemoteLockClientCredentials();
    const redirectUri = config.REMOTELOCK_OAUTH_REDIRECT_URI;

    if (!redirectUri) {
      throw new RemoteLockConfigurationError(
        'RemoteLock OAuth is not configured. Missing: REMOTELOCK_OAUTH_REDIRECT_URI',
      );
    }

    return { clientId, clientSecret, redirectUri };
  }
}

export const remoteLockOAuthService = new RemoteLockOAuthService();
