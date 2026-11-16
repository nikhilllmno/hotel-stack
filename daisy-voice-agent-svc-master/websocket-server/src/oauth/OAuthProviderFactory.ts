import { BadRequestError } from '../errors/BadRequestError';
import { OAuthProvider } from '../types/enums';
import logger from '../utils/logger';
import { IOAuthProvider } from './IOAuthProvider';
import { AuthorizeNetOAuthProvider } from './providers/AuthorizeNetOAuthProvider';

export class OAuthProviderFactory {
  getProvider(providerName: string): IOAuthProvider {
    switch (providerName.toLowerCase()) {
      case OAuthProvider.AUTHORIZENET: {
        return new AuthorizeNetOAuthProvider();
      }

      case OAuthProvider.REMOTELOCK: {
        // TODO: provider = new RemoteLockOAuthProvider();
        throw new BadRequestError(
          'RemoteLock OAuth provider not yet implemented',
        );
      }

      default:
        logger.error(
          `getProvider: Unsupported OAuth provider: ${providerName}`,
        );
        throw new BadRequestError(
          `Unsupported OAuth provider: ${providerName}`,
        );
    }
  }
}

const oauthProviderFactory = new OAuthProviderFactory();
export default oauthProviderFactory;
