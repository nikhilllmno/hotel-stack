import type { Request, Response } from 'express';
import { RemoteLockAPIError } from '../../remotelock/errors/RemoteLockAPIError';
import { RemoteLockConfigurationError } from '../../remotelock/errors/RemoteLockConfigurationError';
import { RemoteLockOAuthController } from '../remoteLockOAuthController';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

function createResponse() {
  const res = {} as Response & {
    statusCode?: number;
    body?: unknown;
  };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response['status'];
  res.json = jest.fn((payload: unknown) => {
    res.body = payload;
    return res;
  }) as unknown as Response['json'];
  res.type = jest.fn(() => res) as unknown as Response['type'];
  res.send = jest.fn((payload: unknown) => {
    res.body = payload;
    return res;
  }) as unknown as Response['send'];
  return res;
}

function createRequest(query: Record<string, unknown>) {
  return { query } as unknown as Request;
}

describe('RemoteLockOAuthController.callback', () => {
  const mockOAuthService = { exchangeCodeForToken: jest.fn() };
  let controller: RemoteLockOAuthController;
  let res: ReturnType<typeof createResponse>;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new RemoteLockOAuthController(mockOAuthService as any);
    res = createResponse();
  });

  it('200s on a successful exchange', async () => {
    mockOAuthService.exchangeCodeForToken.mockResolvedValue({
      access_token: 'at',
      refresh_token: 'rt',
      user: {},
    });

    await controller.callback(createRequest({ code: 'auth-code' }), res);

    expect(mockOAuthService.exchangeCodeForToken).toHaveBeenCalledWith(
      'auth-code',
    );
    expect(res.statusCode).toBe(200);
    // Rendered as a page, not JSON — a hotel's browser lands here.
    expect(res.type).toHaveBeenCalledWith('html');
    expect(res.body).toContain('RemoteLock is connected to Dextr');
  });

  it('ignores any state RemoteLock happens to send back', async () => {
    mockOAuthService.exchangeCodeForToken.mockResolvedValue({
      access_token: 'at',
      refresh_token: 'rt',
      user: {},
    });

    await controller.callback(
      createRequest({ code: 'auth-code', state: '' }),
      res,
    );

    expect(mockOAuthService.exchangeCodeForToken).toHaveBeenCalledWith(
      'auth-code',
    );
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 when the code query param is missing', async () => {
    await controller.callback(createRequest({}), res);

    expect(mockOAuthService.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });

  it('surfaces the RemoteLockAPIError status code when RemoteLock rejects the code', async () => {
    mockOAuthService.exchangeCodeForToken.mockRejectedValue(
      new RemoteLockAPIError('RemoteLock rejected the authorization code', 400),
    );

    await controller.callback(createRequest({ code: 'bad-code' }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      message: 'RemoteLock rejected the authorization code',
      statusCode: 400,
    });
  });

  it('surfaces the RemoteLockConfigurationError status code', async () => {
    mockOAuthService.exchangeCodeForToken.mockRejectedValue(
      new RemoteLockConfigurationError(
        'REMOTELOCK_CLIENT_ID is not configured',
      ),
    );

    await controller.callback(createRequest({ code: 'auth-code' }), res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      message: 'REMOTELOCK_CLIENT_ID is not configured',
      statusCode: 500,
    });
  });
});
