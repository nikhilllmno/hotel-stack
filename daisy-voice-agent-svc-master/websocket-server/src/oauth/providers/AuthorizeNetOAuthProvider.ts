import authorizeNetOAuthService from '../../authorizeNet/services/AuthorizeNetOAuthService';
import { getMerchantDetails } from '../../authorizeNet/services/merchantDetailsClient';
import config from '../../config';
import { BadRequestError } from '../../errors/BadRequestError';
import { SlackService } from '../../services/slack/slackService';
import logger from '../../utils/logger';
import { IOAuthProvider, OAuthCallbackResult } from '../IOAuthProvider';

export class AuthorizeNetOAuthProvider implements IOAuthProvider {
  readonly name = 'authorizenet';

  constructor(
    private readonly slackService: SlackService = new SlackService(),
  ) {}

  getAuthorizeUrl(_query: Record<string, unknown>): string {
    return authorizeNetOAuthService.buildAuthorizeUrl();
  }

  async handleCallback(
    query: Record<string, unknown>,
  ): Promise<OAuthCallbackResult> {
    const { code, state } = query;
    if (typeof code !== 'string' || !code) {
      throw new BadRequestError('code query param is required');
    }
    if (typeof state !== 'string' || !state) {
      throw new BadRequestError('state query param is required');
    }

    authorizeNetOAuthService.verifyState(state);

    const tokenResponse =
      await authorizeNetOAuthService.exchangeAuthorizationCode(code);
    const { access_token, refresh_token, expires_in } = tokenResponse;

    const merchantDetails = await getMerchantDetails(access_token);

    logger.info('AuthorizeNetOAuthProvider::handleCallback - OAuth complete', {
      merchantName: merchantDetails.merchantName,
    });

    await this.alertOAuthConnect(
      merchantDetails,
      access_token,
      refresh_token,
      expires_in,
    );

    return {
      provider: this.name,
      tokens: {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresIn: expires_in,
      },
      meta: {
        apiLoginId: merchantDetails.apiLoginId,
        publicClientKey: merchantDetails.publicClientKey,
        merchantName: merchantDetails.merchantName,
      },
    };
  }

  private async alertOAuthConnect(
    merchantDetails: {
      apiLoginId: string;
      publicClientKey: string;
      merchantName: string;
    },
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
  ): Promise<void> {
    if (!config.DEXTR_SLACK_WEBHOOK_URL) {
      logger.warn(
        'AuthorizeNetOAuthProvider::alertOAuthConnect - DEXTR_SLACK_WEBHOOK_URL is not configured; skipping alert',
      );
      return;
    }

    const mentions = config.DEXTR_SLACK_ALERT_MENTION_USER_IDS.map(
      (userId: string) => `<@${userId}>`,
    ).join(' ');

    const lines = [
      ':key: *Authorize.Net OAuth connect completed — needs linking to a hotel*',
      `> *Merchant Name*     ${merchantDetails.merchantName}`,
      `> *API Login ID*      ${merchantDetails.apiLoginId}`,
      `> *Public Client Key* ${merchantDetails.publicClientKey}`,
      `> *Token Expires In*  ${expiresIn}s`,
      '*Access token*',
      `\`\`\`${accessToken}\`\`\``,
      '*Refresh token*',
      `\`\`\`${refreshToken}\`\`\``,
      "Encrypt both and store them on the matching hotel's `external_auth_config.authorizeNet` with `apiLoginId`, `publicClientKey`, and `merchantName`.",
      mentions,
    ];

    try {
      await this.slackService.sendMessage({
        recipient: config.DEXTR_SLACK_WEBHOOK_URL,
        content: { message: lines.filter(Boolean).join('\n') },
      });
    } catch (error) {
      logger.error(
        'AuthorizeNetOAuthProvider::alertOAuthConnect - Failed to post Slack alert',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }
}
