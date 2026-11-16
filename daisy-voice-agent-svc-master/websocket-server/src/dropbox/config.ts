import config from '../config';
import { DropboxConfigurationError } from './errors';

export interface DropboxCredentials {
  appKey: string;
  appSecret: string;
  refreshToken: string;
}

/**
 * Dextr's read-only Dropbox app and the refresh token it was granted on
 * Dextr's own Dropbox account. Hotels share files with that account; they
 * never hold these. See README/lockbox/dropbox-excel-lockbox.md.
 */
export function getDropboxCredentials(): DropboxCredentials {
  const missing = [
    ['DROPBOX_APP_KEY', config.DROPBOX_APP_KEY],
    ['DROPBOX_APP_SECRET', config.DROPBOX_APP_SECRET],
    ['DROPBOX_REFRESH_TOKEN', config.DROPBOX_REFRESH_TOKEN],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new DropboxConfigurationError(
      `Dropbox is not configured. Missing: ${missing.join(', ')}`,
    );
  }

  return {
    appKey: config.DROPBOX_APP_KEY,
    appSecret: config.DROPBOX_APP_SECRET,
    refreshToken: config.DROPBOX_REFRESH_TOKEN,
  };
}
