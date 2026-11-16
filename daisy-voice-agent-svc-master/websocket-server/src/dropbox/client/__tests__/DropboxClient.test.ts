/* global afterEach, beforeEach, describe, expect, Headers, it, jest, Response, URLSearchParams */
import config from '@/config';
import { DropboxClient, FetchFn } from '@/dropbox/client/DropboxClient';
import { getDropboxCredentials } from '@/dropbox/config';
import { DropboxAPIError, DropboxConfigurationError } from '@/dropbox/errors';

const CREDENTIALS = {
  appKey: 'test-app-key',
  appSecret: 'test-app-secret',
  refreshToken: 'test-refresh-token',
};
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const FILE_URL =
  'https://content.dropboxapi.com/2/sharing/get_shared_link_file';
const LINK =
  'https://www.dropbox.com/scl/fi/abc123/Lockbox%20Log.xlsm?rlkey=k&dl=0';
const OTHER_LINK =
  'https://www.dropbox.com/scl/fi/def456/Other.xlsm?rlkey=j&dl=0';

type FetchInit = NonNullable<Parameters<FetchFn>[1]>;
type FetchResponse = Awaited<ReturnType<FetchFn>>;
type FetchCall = { url: string; init: FetchInit };

function jsonResponse(status: number, body: unknown): FetchResponse {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * A fake Dropbox: hands out access tokens in sequence and serves files by
 * link. Each call builds a fresh Response, since a body can only be read once.
 */
function fakeDropbox(
  options: {
    tokenResponse?: () => FetchResponse;
    fileResponse?: (link: string) => FetchResponse;
    expiresIn?: number;
  } = {},
) {
  const calls: FetchCall[] = [];
  let tokensIssued = 0;
  const fetchFn = jest.fn(async (input: unknown, init?: FetchInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    if (url === TOKEN_URL) {
      if (options.tokenResponse) return options.tokenResponse();
      tokensIssued += 1;
      return jsonResponse(200, {
        access_token: `access-token-${tokensIssued}`,
        token_type: 'bearer',
        expires_in: options.expiresIn ?? 14400,
      });
    }
    const link = JSON.parse(
      new Headers(init?.headers).get('Dropbox-API-Arg') ?? '{}',
    ).url as string;
    if (options.fileResponse) return options.fileResponse(link);
    return new Response(`bytes of ${link}`, { status: 200 });
  });

  const tokenCalls = () => calls.filter((call) => call.url === TOKEN_URL);
  const fileCalls = () => calls.filter((call) => call.url === FILE_URL);
  return { fetchFn: fetchFn as unknown as FetchFn, tokenCalls, fileCalls };
}

function header(call: FetchCall, name: string): string | null {
  return new Headers(call.init.headers).get(name);
}

describe('DropboxClient', () => {
  let nowMs: number;
  const now = () => nowMs;

  beforeEach(() => {
    nowMs = Date.UTC(2026, 9, 28, 6, 0, 0);
  });

  function client(fetchFn: FetchFn) {
    return new DropboxClient(fetchFn, () => CREDENTIALS, now);
  }

  it('exchanges the refresh token, then downloads the shared link file', async () => {
    const dropbox = fakeDropbox();

    const bytes = await client(dropbox.fetchFn).getSharedLinkFile(LINK);

    expect(bytes.toString()).toBe(`bytes of ${LINK}`);

    const [tokenCall] = dropbox.tokenCalls();
    expect(tokenCall.init.method).toBe('POST');
    expect(header(tokenCall, 'Authorization')).toBe(
      `Basic ${Buffer.from('test-app-key:test-app-secret').toString('base64')}`,
    );
    expect(header(tokenCall, 'Content-Type')).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(
      Object.fromEntries(new URLSearchParams(String(tokenCall.init.body))),
    ).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'test-refresh-token',
    });

    const [fileCall] = dropbox.fileCalls();
    expect(fileCall.init.method).toBe('POST');
    expect(header(fileCall, 'Authorization')).toBe('Bearer access-token-1');
    expect(JSON.parse(header(fileCall, 'Dropbox-API-Arg') ?? '')).toEqual({
      url: LINK,
    });
    expect(fileCall.init.body).toBeUndefined();

    for (const call of [tokenCall, fileCall]) {
      expect(header(call, 'User-Agent')).toMatch(/^Dextr-Daisy\//);
      expect(call.init.signal).toBeDefined();
    }
  });

  it('serves a link from cache for 60 seconds, then downloads it again', async () => {
    const dropbox = fakeDropbox();
    const dropboxClient = client(dropbox.fetchFn);

    await dropboxClient.getSharedLinkFile(LINK);
    nowMs += 59_000;
    await dropboxClient.getSharedLinkFile(LINK);
    expect(dropbox.fileCalls()).toHaveLength(1);

    nowMs += 2_000;
    await dropboxClient.getSharedLinkFile(LINK);
    expect(dropbox.fileCalls()).toHaveLength(2);
  });

  it('caches each link separately', async () => {
    const dropbox = fakeDropbox();
    const dropboxClient = client(dropbox.fetchFn);

    const first = await dropboxClient.getSharedLinkFile(LINK);
    const second = await dropboxClient.getSharedLinkFile(OTHER_LINK);

    expect(first.toString()).toBe(`bytes of ${LINK}`);
    expect(second.toString()).toBe(`bytes of ${OTHER_LINK}`);
    expect(dropbox.fileCalls()).toHaveLength(2);
  });

  it('shares one token exchange and one download between concurrent calls', async () => {
    const dropbox = fakeDropbox();
    const dropboxClient = client(dropbox.fetchFn);

    const results = await Promise.all([
      dropboxClient.getSharedLinkFile(LINK),
      dropboxClient.getSharedLinkFile(LINK),
      dropboxClient.getSharedLinkFile(LINK),
    ]);

    expect(results.map(String)).toEqual(Array(3).fill(`bytes of ${LINK}`));
    expect(dropbox.tokenCalls()).toHaveLength(1);
    expect(dropbox.fileCalls()).toHaveLength(1);
  });

  it('reuses the access token until 5 minutes before it expires', async () => {
    const dropbox = fakeDropbox({ expiresIn: 3600 });
    const dropboxClient = client(dropbox.fetchFn);

    await dropboxClient.getSharedLinkFile(LINK);
    nowMs += 54 * 60_000;
    await dropboxClient.getSharedLinkFile(OTHER_LINK);
    expect(dropbox.tokenCalls()).toHaveLength(1);

    nowMs += 2 * 60_000;
    await dropboxClient.getSharedLinkFile(LINK);
    expect(dropbox.tokenCalls()).toHaveLength(2);
    expect(header(dropbox.fileCalls()[2], 'Authorization')).toBe(
      'Bearer access-token-2',
    );
  });

  it('escapes non-ASCII characters in Dropbox-API-Arg', async () => {
    const dropbox = fakeDropbox();
    const link = 'https://www.dropbox.com/scl/fi/abc/Café.xlsm?dl=0';

    await client(dropbox.fetchFn).getSharedLinkFile(link);

    const arg = header(dropbox.fileCalls()[0], 'Dropbox-API-Arg') ?? '';
    expect(arg).toContain('Caf\\u00e9.xlsm');
    expect(JSON.parse(arg)).toEqual({ url: link });
  });

  it('reports a rejected refresh token without echoing any secret', async () => {
    const dropbox = fakeDropbox({
      tokenResponse: () =>
        jsonResponse(400, {
          error: 'invalid_grant',
          error_description: 'refresh token is invalid or revoked',
        }),
    });

    const error = await client(dropbox.fetchFn)
      .getSharedLinkFile(LINK)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DropboxAPIError);
    expect((error as DropboxAPIError).statusCode).toBe(400);
    expect((error as Error).message).toBe(
      'Dropbox token refresh failed (400): refresh token is invalid or revoked',
    );
    for (const secret of Object.values(CREDENTIALS)) {
      expect((error as Error).message).not.toContain(secret);
    }
    expect((error as Error).message).not.toContain(LINK);
    expect(dropbox.fileCalls()).toHaveLength(0);
  });

  it("reports Dropbox's error summary when the link can't be read, and caches nothing", async () => {
    let status = 409;
    const dropbox = fakeDropbox({
      fileResponse: () =>
        status === 409
          ? jsonResponse(409, {
              error_summary: 'shared_link_access_denied/..',
              error: { '.tag': 'shared_link_access_denied' },
            })
          : new Response('fresh bytes', { status: 200 }),
    });
    const dropboxClient = client(dropbox.fetchFn);

    await expect(dropboxClient.getSharedLinkFile(LINK)).rejects.toThrow(
      'Dropbox get_shared_link_file failed (409): shared_link_access_denied/..',
    );

    status = 200;
    const bytes = await dropboxClient.getSharedLinkFile(LINK);
    expect(bytes.toString()).toBe('fresh bytes');
  });

  it('drops a token Dropbox rejects, so the next call exchanges again', async () => {
    let rejectNext = true;
    const dropbox = fakeDropbox({
      fileResponse: () => {
        if (rejectNext) {
          rejectNext = false;
          return jsonResponse(401, { error_summary: 'expired_access_token/' });
        }
        return new Response('bytes', { status: 200 });
      },
    });
    const dropboxClient = client(dropbox.fetchFn);

    await expect(dropboxClient.getSharedLinkFile(LINK)).rejects.toThrow(
      DropboxAPIError,
    );
    await dropboxClient.getSharedLinkFile(LINK);

    expect(dropbox.tokenCalls()).toHaveLength(2);
    expect(header(dropbox.fileCalls()[1], 'Authorization')).toBe(
      'Bearer access-token-2',
    );
  });

  it('wraps network failures and timeouts', async () => {
    const fetchFn = jest
      .fn()
      .mockRejectedValue(
        new Error('The operation was aborted due to timeout'),
      ) as unknown as FetchFn;

    await expect(client(fetchFn).getSharedLinkFile(LINK)).rejects.toThrow(
      'Dropbox oauth2/token request failed: The operation was aborted due to timeout',
    );
  });

  it('fails on a token response without an access token', async () => {
    const dropbox = fakeDropbox({
      tokenResponse: () => jsonResponse(200, { token_type: 'bearer' }),
    });

    await expect(
      client(dropbox.fetchFn).getSharedLinkFile(LINK),
    ).rejects.toThrow('Dropbox token response did not contain an access_token');
  });
});

describe('getDropboxCredentials', () => {
  const original = {
    DROPBOX_APP_KEY: config.DROPBOX_APP_KEY,
    DROPBOX_APP_SECRET: config.DROPBOX_APP_SECRET,
    DROPBOX_REFRESH_TOKEN: config.DROPBOX_REFRESH_TOKEN,
  };

  afterEach(() => {
    Object.assign(config, original);
  });

  it('names every missing variable', () => {
    Object.assign(config, {
      DROPBOX_APP_KEY: 'key',
      DROPBOX_APP_SECRET: '',
      DROPBOX_REFRESH_TOKEN: '',
    });

    expect(() => getDropboxCredentials()).toThrow(DropboxConfigurationError);
    expect(() => getDropboxCredentials()).toThrow(
      'Dropbox is not configured. Missing: DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN',
    );
  });

  it('returns the configured app and refresh token', () => {
    Object.assign(config, {
      DROPBOX_APP_KEY: 'key',
      DROPBOX_APP_SECRET: 'secret',
      DROPBOX_REFRESH_TOKEN: 'refresh',
    });

    expect(getDropboxCredentials()).toEqual({
      appKey: 'key',
      appSecret: 'secret',
      refreshToken: 'refresh',
    });
  });

  it('surfaces a missing configuration through the client', async () => {
    Object.assign(config, {
      DROPBOX_APP_KEY: '',
      DROPBOX_APP_SECRET: '',
      DROPBOX_REFRESH_TOKEN: '',
    });
    const fetchFn = jest.fn() as unknown as FetchFn;

    await expect(
      new DropboxClient(fetchFn).getSharedLinkFile(LINK),
    ).rejects.toThrow(DropboxConfigurationError);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
