export interface OAuthProviderConfig {
  providerName: string;
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string;
  extraAuthorizeParams?: Record<string, string>;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
  extra?: Record<string, unknown>;
}

export interface OAuthCallbackResult {
  provider: string;
  tokens: OAuthTokenSet;
  meta?: Record<string, unknown>;
}

export interface OAuthCredentialEntry {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
  connectedAt: string;
  providerMeta?: Record<string, unknown>;
}

export type OAuthCredentials = Record<string, OAuthCredentialEntry>;

/**
 * Each OAuth provider implements this interface. The OAuthService dispatches
 * to the provider resolved by OAuthProviderFactory based on the `:provider`
 * route param.
 *
 * Each provider fully owns its authorize and callback flows — there is no
 * generic pipeline. Shared utilities (HMAC state signing, encryption) are
 * available for providers to use but not imposed.
 *
 * The service layer receives plain data only — never Express req/res.
 */
export interface IOAuthProvider {
  readonly name: string;

  /** Build the authorize URL. `query` contains raw query params from the original request. */
  getAuthorizeUrl(query: Record<string, unknown>): string;

  /** Handle the full callback flow (verify state, exchange code, persist, etc.). */
  handleCallback(query: Record<string, unknown>): Promise<OAuthCallbackResult>;
}
