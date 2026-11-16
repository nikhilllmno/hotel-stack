/* global AbortSignal, URLSearchParams */
/**
 * Read-only Dropbox API client for files hotels share with Dextr's Dropbox
 * account.
 *
 * Auth: Dextr's app key/secret plus a long-lived refresh token (see
 * `getDropboxCredentials`). The refresh token is exchanged for a short-lived
 * access token, which is cached in memory until shortly before it expires.
 * Dropbox does not rotate the refresh token on this grant, so nothing is
 * written back anywhere.
 *
 * Errors are thrown as `DropboxAPIError` / `DropboxConfigurationError`; their
 * messages carry Dropbox's error summary, never a token or the shared link.
 */

import { createHash } from 'node:crypto';
import logger from '../../utils/logger';
import {
  createKeyedSingleFlightRunner,
  createSingleFlightRunner,
} from '../../utils/single-flight';
import { DropboxCredentials, getDropboxCredentials } from '../config';
import { DropboxAPIError } from '../errors';

const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const SHARED_LINK_FILE_URL =
  'https://content.dropboxapi.com/2/sharing/get_shared_link_file';
const USER_AGENT = 'Dextr-Daisy/1.0 (+https://dextr.ai)';

/**
 * Callers are live voice calls, so a hung Dropbox request has to fail well
 * inside the agent's tool timeout instead of running to API_TIMEOUT.
 */
const REQUEST_TIMEOUT_MS = 10_000;
/** Access tokens are replaced this long before Dropbox says they expire. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;
/** Used when a token response has no expires_in; Dropbox issues 4-hour tokens. */
const DEFAULT_TOKEN_LIFETIME_SECONDS = 4 * 60 * 60;
/**
 * A downloaded file is reused for this long: a burst of calls costs one
 * download, and an edit the hotel saves is picked up within a minute.
 */
const FILE_CACHE_TTL_MS = 60_000;

export type FetchFn = typeof fetch;
type FetchResponse = Awaited<ReturnType<FetchFn>>;

interface DropboxRequest {
  headers: Record<string, string>;
  body?: string;
}

interface DropboxTokenResponse {
  access_token?: string;
  expires_in?: number;
}

/**
 * Identifies a shared link in logs without writing it out, since a shared
 * link can grant read access to the file on its own.
 */
export function sharedLinkFingerprint(sharedLink: string): string {
  return createHash('sha256').update(sharedLink).digest('hex').slice(0, 8);
}

/** Dropbox reads Dropbox-API-Arg as ASCII, so non-ASCII must be \u-escaped. */
function toHeaderSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

async function describeErrorBody(response: FetchResponse): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const summary =
      parsed.error_summary ?? parsed.error_description ?? parsed.error;
    if (typeof summary === 'string') return summary;
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return text.slice(0, 200) || 'no error body';
}

export class DropboxClient {
  private accessToken: { value: string; refreshAt: number } | null = null;
  private readonly tokenRequests = createSingleFlightRunner();
  private readonly fileCache = new Map<
    string,
    { bytes: Buffer; expiresAt: number }
  >();
  private readonly fileDownloads = createKeyedSingleFlightRunner();

  /**
   * `fetchFn`, `getCredentials` and `now` are injected so tests can stub the
   * HTTP layer, the credentials and the clock.
   */
  constructor(
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
    private readonly getCredentials: () => DropboxCredentials = getDropboxCredentials,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Returns the current version of the file a shared link points to. Cached
   * per link for {@link FILE_CACHE_TTL_MS}; concurrent misses for one link
   * share a single download.
   */
  async getSharedLinkFile(sharedLink: string): Promise<Buffer> {
    const cached = this.fileCache.get(sharedLink);
    if (cached && cached.expiresAt > this.now()) {
      return cached.bytes;
    }

    return this.fileDownloads.run(sharedLink, async () => {
      const bytes = await this.downloadSharedLinkFile(sharedLink);
      this.fileCache.set(sharedLink, {
        bytes,
        expiresAt: this.now() + FILE_CACHE_TTL_MS,
      });
      return bytes;
    });
  }

  private async downloadSharedLinkFile(sharedLink: string): Promise<Buffer> {
    const accessToken = await this.getAccessToken();
    const startedAt = this.now();
    const response = await this.post(
      'get_shared_link_file',
      SHARED_LINK_FILE_URL,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Dropbox-API-Arg': toHeaderSafeJson({ url: sharedLink }),
        },
      },
    );

    if (!response.ok) {
      if (response.status === 401) {
        // Revoked or expired early: drop it so the next call exchanges again.
        this.accessToken = null;
      }
      throw new DropboxAPIError(
        `Dropbox get_shared_link_file failed (${response.status}): ${await describeErrorBody(response)}`,
        response.status,
      );
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    logger.info('DropboxClient: shared link file downloaded', {
      link: sharedLinkFingerprint(sharedLink),
      bytes: bytes.length,
      durationMs: this.now() - startedAt,
    });
    return bytes;
  }

  private async getAccessToken(): Promise<string> {
    const current = this.accessToken;
    if (current && current.refreshAt > this.now()) {
      return current.value;
    }

    return this.tokenRequests.run(async () => {
      const token = await this.requestAccessToken();
      this.accessToken = token;
      return token.value;
    });
  }

  private async requestAccessToken(): Promise<{
    value: string;
    refreshAt: number;
  }> {
    const { appKey, appSecret, refreshToken } = this.getCredentials();
    const basicAuth = Buffer.from(`${appKey}:${appSecret}`).toString('base64');

    const response = await this.post('oauth2/token', TOKEN_URL, {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!response.ok) {
      throw new DropboxAPIError(
        `Dropbox token refresh failed (${response.status}): ${await describeErrorBody(response)}`,
        response.status,
      );
    }

    const body = (await response.json()) as DropboxTokenResponse;
    if (!body.access_token) {
      throw new DropboxAPIError(
        'Dropbox token response did not contain an access_token',
      );
    }

    const lifetimeMs =
      (body.expires_in ?? DEFAULT_TOKEN_LIFETIME_SECONDS) * 1000;
    return {
      value: body.access_token,
      refreshAt: this.now() + lifetimeMs - TOKEN_REFRESH_MARGIN_MS,
    };
  }

  private async post(
    operation: string,
    url: string,
    request: DropboxRequest,
  ): Promise<FetchResponse> {
    try {
      return await this.fetchFn(url, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, ...request.headers },
        body: request.body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new DropboxAPIError(
        `Dropbox ${operation} request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const dropboxClient = new DropboxClient();
