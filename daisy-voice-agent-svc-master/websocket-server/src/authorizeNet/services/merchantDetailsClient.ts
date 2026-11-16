/* global setInterval, setTimeout, clearInterval, clearTimeout */
import { APIContracts, APIControllers } from 'authorizenet';
import config from '../../config';
import { AuthorizeNetError } from '../../errors/AuthorizeNetError';
import logger from '../../utils/logger';
import { AUTHNET_URLS, AuthorizeNetMerchantDetails } from '../types';

const CONTROLLER_TIMEOUT_MS = config.API_TIMEOUT + 5000;

/**
 * Calls getMerchantDetailsRequest using the OAuth access token to retrieve
 * the merchant's apiLoginId, publicClientKey, and merchantName.
 */
export async function getMerchantDetails(
  accessToken: string,
): Promise<AuthorizeNetMerchantDetails> {
  const merchantAuth = new APIContracts.MerchantAuthenticationType();
  merchantAuth.setAccessToken(accessToken);

  const request = new APIContracts.GetMerchantDetailsRequest();
  request.setMerchantAuthentication(merchantAuth);

  const controller = new APIControllers.ANetApiController(request.getJSON());
  controller.setEnvironment(AUTHNET_URLS[config.AUTHORIZE_NET_ENVIRONMENT].api);

  return new Promise<AuthorizeNetMerchantDetails>((resolve, reject) => {
    let settled = false;

    const errorPollInterval = setInterval(() => {
      const err = controller.getError();
      if (err && !settled) {
        settled = true;
        clearInterval(errorPollInterval);
        clearTimeout(absoluteTimeout);
        logger.error(
          'AuthorizeNet merchantDetailsClient::getMerchantDetails - API error (polled)',
          { error: err },
        );
        reject(
          new AuthorizeNetError(`Authorize.net API error: ${String(err)}`, 502),
        );
      }
    }, 500);

    const absoluteTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        clearInterval(errorPollInterval);
        const err = controller.getError();
        reject(
          new AuthorizeNetError(
            `Authorize.net getMerchantDetails timed out after ${CONTROLLER_TIMEOUT_MS}ms${err ? `: ${String(err)}` : ''}`,
            502,
          ),
        );
      }
    }, CONTROLLER_TIMEOUT_MS);

    controller.execute(() => {
      if (settled) return;
      settled = true;
      clearInterval(errorPollInterval);
      clearTimeout(absoluteTimeout);

      const response = controller.getResponse();
      const error = controller.getError();

      if (error) {
        logger.error(
          'AuthorizeNet merchantDetailsClient::getMerchantDetails - API error',
          { error },
        );
        reject(
          new AuthorizeNetError(
            `Authorize.net API error: ${String(error)}`,
            502,
          ),
        );
        return;
      }

      if (!response) {
        reject(
          new AuthorizeNetError('Authorize.net returned no response', 502),
        );
        return;
      }

      if (
        response.messages?.resultCode !== 'Ok' &&
        response.messages?.resultCode !== 'OK'
      ) {
        const msg =
          response.messages?.message?.[0]?.text ||
          response.messages?.message?.text ||
          'Unknown error';
        logger.error(
          'AuthorizeNet merchantDetailsClient::getMerchantDetails - API rejection',
          { resultCode: response.messages?.resultCode, msg },
        );
        reject(
          new AuthorizeNetError(
            `Authorize.net getMerchantDetails failed: ${msg}`,
            502,
          ),
        );
        return;
      }

      const apiLoginId: string | undefined =
        response.credentials?.apiLoginId ?? response.apiLoginId;
      const publicClientKey: string | undefined =
        response.publicClientKey ?? response.credentials?.publicClientKey;
      const merchantName: string | undefined = response.merchantName;

      if (!apiLoginId || !publicClientKey) {
        reject(
          new AuthorizeNetError(
            'Authorize.net getMerchantDetails response missing apiLoginId or publicClientKey',
            502,
          ),
        );
        return;
      }

      resolve({
        apiLoginId,
        publicClientKey,
        merchantName: merchantName || '',
      });
    });
  });
}
