export const AUTHNET_URLS = {
  sandbox: {
    authorize: 'https://sandbox.authorize.net/oauth/authorize',
    token: 'https://accesstest.authorize.net/oauth/v1/token',
    api: 'https://apitest.authorize.net/xml/v1/request.api',
  },
  production: {
    authorize: 'https://account.authorize.net/oauth/authorize',
    token: 'https://access.authorize.net/oauth/v1/token',
    api: 'https://api.authorize.net/xml/v1/request.api',
  },
} as const;

export interface AuthorizeNetTokenResponse {
  access_token: string;
  token_type: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
}

export interface AuthorizeNetMerchantDetails {
  apiLoginId: string;
  publicClientKey: string;
  merchantName: string;
}

/**
 * Per-hotel Authorize.net OAuth credentials stored in
 * `hotel_configurations.external_auth_config` under the `authorizeNet` key.
 * `accessToken` and `refreshToken` are AES-256-GCM encrypted at rest.
 */
export interface AuthorizeNetConfig {
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string;
  apiLoginId: string;
  publicClientKey: string;
  merchantName: string;
  connectedAt: string;
}
