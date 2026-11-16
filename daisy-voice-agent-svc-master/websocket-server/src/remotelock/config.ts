import config from '../config';
import { RemoteLockConfigurationError } from './errors';

/**
 * Dextr's OAuth Application credentials, shared across every hotel. See
 * README's RemoteLock section — hotels never hold these themselves.
 */
export function getRemoteLockClientCredentials(): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = config.REMOTELOCK_CLIENT_ID;
  const clientSecret = config.REMOTELOCK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new RemoteLockConfigurationError(
      'RemoteLock OAuth is not configured. Missing: REMOTELOCK_CLIENT_ID and/or REMOTELOCK_CLIENT_SECRET',
    );
  }

  return { clientId, clientSecret };
}
