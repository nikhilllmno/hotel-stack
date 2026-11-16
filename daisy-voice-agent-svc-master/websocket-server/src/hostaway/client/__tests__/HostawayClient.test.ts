jest.mock('@/utils/httpClient', () => ({
  createHttpClient: jest.fn(() => ({
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  })),
}));

jest.mock('@/config', () => ({
  __esModule: true,
  default: {
    HOSTAWAY_API_BASE_URL: 'https://api.hostaway.test',
    HOSTAWAY_ACCESS_TOKEN: 'test-access-token',
    HOSTAWAY_PROVIDER_ID: 'test-provider-id',
    API_TIMEOUT: 10000,
  },
}));

import config from '@/config';
import { BadRequestError } from '@/errors/BadRequestError';
import { HostawayClient } from '@/hostaway/client/hostawayClient';

describe('HostawayClient constructor', () => {
  const validConfig = {
    HOSTAWAY_API_BASE_URL: 'https://api.hostaway.test',
    HOSTAWAY_ACCESS_TOKEN: 'test-access-token',
    HOSTAWAY_PROVIDER_ID: 'test-provider-id',
    API_TIMEOUT: 10000,
  };

  beforeEach(() => {
    Object.assign(config, validConfig);
  });

  it('constructs successfully when required env vars are present', () => {
    expect(() => new HostawayClient()).not.toThrow();
  });

  it('throws BadRequestError when HOSTAWAY_ACCESS_TOKEN is missing', () => {
    (config as { HOSTAWAY_ACCESS_TOKEN?: string }).HOSTAWAY_ACCESS_TOKEN =
      undefined;

    expect(() => new HostawayClient()).toThrow(BadRequestError);
    expect(() => new HostawayClient()).toThrow(
      'HOSTAWAY_ACCESS_TOKEN environment variable is required',
    );
  });

  it('throws BadRequestError when HOSTAWAY_PROVIDER_ID is missing', () => {
    (config as { HOSTAWAY_PROVIDER_ID?: string }).HOSTAWAY_PROVIDER_ID =
      undefined;

    expect(() => new HostawayClient()).toThrow(BadRequestError);
    expect(() => new HostawayClient()).toThrow(
      'HOSTAWAY_PROVIDER_ID environment variable is required',
    );
  });
});
