// Shared RemoteLock values live in .env.test. These two are only needed by
// this suite, so they stay local to it.
process.env.REMOTELOCK_OAUTH_REDIRECT_URI =
  'https://daisy.test/remotelock/oauth/callback';
process.env.DEXTR_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/dextr-alerts';
process.env.DEXTR_SLACK_ALERT_MENTION_USER_IDS = 'U123,U456';

import axios from 'axios';

jest.mock('axios');

const mockGetUser = jest.fn();
jest.mock('@/remotelock/client/RemoteLockClient', () => ({
  RemoteLockClient: {
    forAccessToken: jest.fn(() => ({ getUser: mockGetUser })),
  },
}));

import config from '@/config';
import { RemoteLockClient } from '@/remotelock/client/RemoteLockClient';
import { RemoteLockAPIError } from '@/remotelock/errors/RemoteLockAPIError';
import { RemoteLockOAuthService } from '@/remotelock/services/oauthService';

const mockedAxiosPost = axios.post as jest.Mock;

const USER = {
  type: 'user',
  id: 'user-1',
  attributes: {
    name: 'Seaside Inn',
    email: 'ops@seaside.test',
    handle: 'seaside',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    primary_account_id: 'account-1',
    default_account_id: 'account-1',
  },
};

describe('RemoteLockOAuthService.exchangeCodeForToken', () => {
  let service: RemoteLockOAuthService;
  let slackService: { sendMessage: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxiosPost.mockReset();
    mockGetUser.mockResolvedValue(USER);
    slackService = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    service = new RemoteLockOAuthService(slackService as any);
  });

  it('exchanges the code using Dextr-level client credentials', async () => {
    mockedAxiosPost.mockResolvedValue({
      data: { access_token: 'new-at', refresh_token: 'new-rt' },
    });

    await service.exchangeCodeForToken('auth-code');

    expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
    const [url, body] = mockedAxiosPost.mock.calls[0];
    expect(url).toBe('https://connect.remotelock.test/oauth/token');
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=auth-code');
    expect(body).toContain('client_id=daisy-client-id');
    expect(body).toContain('client_secret=daisy-client-secret');
  });

  it('identifies the authorizing account with the freshly issued token', async () => {
    mockedAxiosPost.mockResolvedValue({
      data: { access_token: 'new-at', refresh_token: 'new-rt' },
    });

    const result = await service.exchangeCodeForToken('auth-code');

    // Scoped by token, not hotel — the hotel is exactly what isn't known yet.
    expect(RemoteLockClient.forAccessToken).toHaveBeenCalledWith('new-at');
    expect(result).toEqual({
      access_token: 'new-at',
      refresh_token: 'new-rt',
      user: USER,
    });
  });

  it('alerts Slack with the account details and the plaintext token pair', async () => {
    mockedAxiosPost.mockResolvedValue({
      data: { access_token: 'new-at', refresh_token: 'new-rt' },
    });

    await service.exchangeCodeForToken('auth-code');

    expect(slackService.sendMessage).toHaveBeenCalledTimes(1);
    const [payload] = slackService.sendMessage.mock.calls[0];
    expect(payload.recipient).toBe(config.DEXTR_SLACK_WEBHOOK_URL);

    const message = payload.content.message as string;
    expect(message).toContain('ops@seaside.test');
    expect(message).toContain('account-1');
    expect(message).toContain('<@U123> <@U456>');
    // Self-contained handoff: the pair is in the alert, not just the logs.
    expect(message).toContain('new-at');
    expect(message).toContain('new-rt');
  });

  it('still returns the token pair when the user lookup fails', async () => {
    mockedAxiosPost.mockResolvedValue({
      data: { access_token: 'new-at', refresh_token: 'new-rt' },
    });
    mockGetUser.mockRejectedValue(new Error('401 Unauthorized'));

    const result = await service.exchangeCodeForToken('auth-code');

    expect(result.access_token).toBe('new-at');
    expect(result.refresh_token).toBe('new-rt');
    expect(result.user).toBeNull();
    // Still alerted, flagged as unidentified, and still carrying the pair —
    // it can't be re-obtained without the hotel authorizing again.
    const [payload] = slackService.sendMessage.mock.calls[0];
    expect(payload.content.message).toContain('could not be identified');
    expect(payload.content.message).toContain('new-rt');
  });

  it('does not fail the callback when the Slack post fails', async () => {
    mockedAxiosPost.mockResolvedValue({
      data: { access_token: 'new-at', refresh_token: 'new-rt' },
    });
    slackService.sendMessage.mockRejectedValue(new Error('slack down'));

    await expect(
      service.exchangeCodeForToken('auth-code'),
    ).resolves.toMatchObject({ access_token: 'new-at' });
  });

  it('surfaces a 400 RemoteLockAPIError when RemoteLock rejects the code', async () => {
    const axiosError = Object.assign(new Error('Bad Request'), {
      isAxiosError: true,
      response: { status: 400 },
    });
    mockedAxiosPost.mockRejectedValue(axiosError);
    (axios.isAxiosError as unknown as jest.Mock) = jest
      .fn()
      .mockReturnValue(true);

    await expect(
      service.exchangeCodeForToken('bad-code'),
    ).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('throws RemoteLockAPIError when the token response is missing the refresh token', async () => {
    mockedAxiosPost.mockResolvedValue({ data: { access_token: 'only-at' } });

    await expect(service.exchangeCodeForToken('auth-code')).rejects.toThrow(
      RemoteLockAPIError,
    );
  });
});
