import { OAuthCallbackResult } from './IOAuthProvider';
import oauthProviderFactory, {
  OAuthProviderFactory,
} from './OAuthProviderFactory';

export class OAuthService {
  constructor(
    private providerFactory: OAuthProviderFactory = oauthProviderFactory,
  ) {}

  getAuthorizeUrl(
    providerName: string,
    query: Record<string, unknown>,
  ): string {
    const provider = this.providerFactory.getProvider(providerName);
    return provider.getAuthorizeUrl(query);
  }

  async handleCallback(
    providerName: string,
    query: Record<string, unknown>,
  ): Promise<OAuthCallbackResult> {
    const provider = this.providerFactory.getProvider(providerName);
    return provider.handleCallback(query);
  }
}

export const oauthService = new OAuthService();
