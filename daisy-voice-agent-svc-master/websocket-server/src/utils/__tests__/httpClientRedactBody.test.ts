const mockLoggerInfo = jest.fn();

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { createHttpClient } from '@/utils/httpClient';

const SECRET = 'value-that-must-not-be-logged';

describe('createHttpClient redactBody', () => {
  beforeEach(() => mockLoggerInfo.mockReset());

  function client(redactBody?: (body: unknown) => unknown) {
    return createHttpClient('stub', {
      baseURL: 'https://example.invalid/',
      redactBody,
      adapter: async (requestConfig) => ({
        config: requestConfig,
        data: { secret: SECRET },
        headers: {},
        status: 200,
        statusText: 'OK',
      }),
    });
  }

  function loggedBody(message: string): string {
    const call = mockLoggerInfo.mock.calls.find(([m]) => m === message);
    return (call?.[1] as { body: string }).body;
  }

  const drop = (body: unknown) => ({
    ...(body as Record<string, unknown>),
    secret: '[REDACTED]',
  });

  it('applies the stripper to the request body', async () => {
    await client(drop).post('anything', { id: 'BK-1', secret: SECRET });

    expect(loggedBody('stub Request')).not.toContain(SECRET);
    expect(loggedBody('stub Request')).toContain('BK-1');
  });

  it('applies it to the response body too', async () => {
    await client(drop).post('anything', { id: 'BK-1' });

    expect(loggedBody('stub Response')).not.toContain(SECRET);
  });

  it('applies the stripper to a body that is already a JSON string', async () => {
    await client(drop).post(
      'anything',
      JSON.stringify({ id: 'BK-1', secret: SECRET }),
      { headers: { 'Content-Type': 'application/json' } },
    );

    expect(loggedBody('stub Request')).not.toContain(SECRET);
    expect(loggedBody('stub Request')).toContain('BK-1');
  });

  it('does not log a body that is not JSON when a stripper is supplied', async () => {
    await client(drop).post('anything', `card_number=${SECRET}`);

    expect(loggedBody('stub Request')).toBe('[non-JSON body not logged]');
  });

  it('logs a body that is not JSON as is when no stripper is supplied', async () => {
    await client().post('anything', 'plain text body');

    expect(loggedBody('stub Request')).toBe('plain text body');
  });

  it('logs the body unchanged when no stripper is supplied', async () => {
    await client().post('anything', { id: 'BK-1', secret: SECRET });

    expect(loggedBody('stub Request')).toContain(SECRET);
  });
});
