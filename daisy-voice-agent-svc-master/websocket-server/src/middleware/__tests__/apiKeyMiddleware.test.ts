import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import config from '../../config';
import { KpiStat, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import {
  apiKeyMiddleware,
  logMissingOrInvalidApiKey,
} from '../apiKeyMiddleware';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../utils/kpiLogger', () => ({
  ...jest.requireActual('../../utils/kpiLogger'),
  logKpi: jest.fn(),
}));

const mockedLogger = logger as jest.Mocked<typeof logger>;
const mockedLogKpi = logKpi as jest.MockedFunction<typeof logKpi>;

function createRequest(apiKey?: string): Request {
  return {
    method: 'POST',
    baseUrl: '/daisy',
    path: '/rooms',
    ip: '203.0.113.10',
    headers: {
      'user-agent': 'jest-agent',
      ...(apiKey === undefined ? {} : { 'x-api-key': apiKey }),
    },
  } as unknown as Request;
}

function invokeApiKeyMiddleware(apiKey?: string) {
  const req = createRequest(apiKey);

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  const next = jest.fn();

  apiKeyMiddleware(req, res, next);

  return { status, json, next };
}

const expectedRequestMeta = JSON.stringify({
  method: 'POST',
  route: '/daisy/rooms',
  ip: '203.0.113.10',
  userAgent: 'jest-agent',
});

function fingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 8);
}

describe('apiKeyMiddleware', () => {
  const originalActiveKeys = config.DAISY_INBOUND_API_KEYS;
  const originalExpiredKeys = config.DAISY_INBOUND_API_KEYS_EXPIRED;

  beforeEach(() => {
    Object.assign(config, {
      DAISY_INBOUND_API_KEYS: ['active-key-a', 'active-key-b'],
      DAISY_INBOUND_API_KEYS_EXPIRED: ['expired-key-1234'],
    });
    jest.clearAllMocks();
  });

  afterAll(() => {
    Object.assign(config, {
      DAISY_INBOUND_API_KEYS: originalActiveKeys,
      DAISY_INBOUND_API_KEYS_EXPIRED: originalExpiredKeys,
    });
  });

  test('accepts any active key without logging', () => {
    const { next, status } = invokeApiKeyMiddleware('active-key-b');

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
    expect(mockedLogger.warn).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
    expect(mockedLogKpi).not.toHaveBeenCalled();
  });

  test('accepts an expired key and logs a warning with only its fingerprint', () => {
    const { next, status } = invokeApiKeyMiddleware('expired-key-1234');

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      `Expired x-api-key accepted (fingerprint ${fingerprint('expired-key-1234')}) ${expectedRequestMeta}`,
    );
    expect(mockedLogger.error).not.toHaveBeenCalled();
    expect(mockedLogKpi).toHaveBeenCalledWith({
      stat: KpiStat.AuthApiKeyExpiredAccepted,
      value: 1,
      contextName: 'apiKeyMiddleware',
      contextId: '/daisy/rooms',
    });
  });

  test('rejects an unknown key with 403 and logs it', () => {
    const { next, status, json } = invokeApiKeyMiddleware('wrong-key');

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'Invalid API key' });
    expect(mockedLogger.error).toHaveBeenCalledWith(
      `Request has invalid x-api-key header (fingerprint ${fingerprint('wrong-key')}) ${expectedRequestMeta}`,
    );
    expect(mockedLogKpi).toHaveBeenCalledWith(
      expect.objectContaining({ stat: KpiStat.AuthApiKeyRejected }),
    );
  });

  test('rejects a missing header with 401 and logs it', () => {
    const { next, status, json } = invokeApiKeyMiddleware();

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Missing x-api-key header' });
    expect(mockedLogger.error).toHaveBeenCalledWith(
      `Request missing x-api-key header ${expectedRequestMeta}`,
    );
    expect(mockedLogKpi).toHaveBeenCalledWith(
      expect.objectContaining({ stat: KpiStat.AuthApiKeyRejected }),
    );
  });

  test('never logs any part of a short expired key', () => {
    Object.assign(config, { DAISY_INBOUND_API_KEYS_EXPIRED: ['xyz'] });

    const { next } = invokeApiKeyMiddleware('xyz');

    expect(next).toHaveBeenCalledTimes(1);
    const [warning] = mockedLogger.warn.mock.calls[0];
    expect(warning).toContain(`fingerprint ${fingerprint('xyz')}`);
    expect(warning).not.toContain('xyz');
  });

  test('returns 500 when no active key is configured, even for an expired key', () => {
    Object.assign(config, { DAISY_INBOUND_API_KEYS: [] });

    const { next, status, json } = invokeApiKeyMiddleware('expired-key-1234');

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: 'DAISY_INBOUND_API_KEYS is not configured',
    });
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });
});

describe('logMissingOrInvalidApiKey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('logs the missing-header message when x-api-key is absent', () => {
    logMissingOrInvalidApiKey(createRequest());

    expect(mockedLogger.error).toHaveBeenCalledWith(
      `Request missing x-api-key header ${expectedRequestMeta}`,
    );
  });

  test('logs the invalid-header message when x-api-key is present', () => {
    logMissingOrInvalidApiKey(createRequest('wrong-key'));

    expect(mockedLogger.error).toHaveBeenCalledWith(
      `Request has invalid x-api-key header (fingerprint ${fingerprint('wrong-key')}) ${expectedRequestMeta}`,
    );
  });
});
