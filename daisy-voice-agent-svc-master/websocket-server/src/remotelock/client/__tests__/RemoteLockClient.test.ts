const mockGet = jest.fn();

jest.mock('@/utils/httpClient', () => ({
  createHttpClient: jest.fn(() => ({
    get: mockGet,
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  })),
}));

jest.mock('@/remotelock/services/tokenService', () => ({
  remoteLockTokenService: {
    getActiveToken: jest.fn().mockResolvedValue('test-token'),
  },
}));

import { RemoteLockClient } from '@/remotelock/client/RemoteLockClient';
import { RemoteLockAPIError } from '@/remotelock/errors';

describe('RemoteLockClient', () => {
  const hotelId = '22222222-2222-2222-2222-222222222222';
  let client: RemoteLockClient;

  beforeEach(() => {
    mockGet.mockReset();
    client = new RemoteLockClient(hotelId);
  });

  describe('getAllAccessPersons', () => {
    it('defaults to access_guest and returns data from a single page when total_pages is 1', async () => {
      const guest = {
        id: 'g1',
        type: 'access_guest',
        attributes: { name: 'Ann Smith', pin: '4567' },
      };
      mockGet.mockResolvedValue({
        data: { data: [guest], meta: { page: 1, total_pages: 1 } },
      });

      const result = await client.getAllAccessPersons();

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith('/access_persons', {
        params: { type: 'access_guest', page: 1, per_page: 50 },
      });
      expect(result).toEqual([guest]);
    });

    it('passes status/sort through and forwards a custom per_page', async () => {
      mockGet.mockResolvedValue({
        data: { data: [], meta: { page: 1, total_pages: 1 } },
      });

      await client.getAllAccessPersons({
        status: ['current', 'upcoming'],
        sort: 'starts_at',
        per_page: 25,
      });

      expect(mockGet).toHaveBeenCalledWith('/access_persons', {
        params: {
          type: 'access_guest',
          'attributes[status]': ['current', 'upcoming'],
          sort: 'starts_at',
          page: 1,
          per_page: 25,
        },
      });
    });

    it('loops through every page and aggregates all results', async () => {
      const guest1 = { id: 'g1', type: 'access_guest', attributes: {} };
      const guest2 = { id: 'g2', type: 'access_guest', attributes: {} };
      const guest3 = { id: 'g3', type: 'access_guest', attributes: {} };
      mockGet
        .mockResolvedValueOnce({
          data: { data: [guest1], meta: { page: 1, total_pages: 3 } },
        })
        .mockResolvedValueOnce({
          data: { data: [guest2], meta: { page: 2, total_pages: 3 } },
        })
        .mockResolvedValueOnce({
          data: { data: [guest3], meta: { page: 3, total_pages: 3 } },
        });

      const result = await client.getAllAccessPersons({
        type: 'access_guest',
      });

      expect(mockGet).toHaveBeenCalledTimes(3);
      expect(mockGet).toHaveBeenNthCalledWith(1, '/access_persons', {
        params: { type: 'access_guest', page: 1, per_page: 50 },
      });
      expect(mockGet).toHaveBeenNthCalledWith(2, '/access_persons', {
        params: { type: 'access_guest', page: 2, per_page: 50 },
      });
      expect(mockGet).toHaveBeenNthCalledWith(3, '/access_persons', {
        params: { type: 'access_guest', page: 3, per_page: 50 },
      });
      expect(result).toEqual([guest1, guest2, guest3]);
    });

    it('propagates RemoteLockAPIError from the interceptor', async () => {
      mockGet.mockRejectedValue(
        new RemoteLockAPIError('Resource not found', 404),
      );

      await expect(client.getAllAccessPersons()).rejects.toThrow(
        RemoteLockAPIError,
      );
    });
  });

  describe('getUser', () => {
    const user = {
      id: 'user-1',
      type: 'user',
      attributes: {
        name: 'Seaside Inn',
        email: 'ops@seaside.test',
        handle: 'seaside',
        primary_account_id: 'account-1',
        default_account_id: 'account-1',
      },
    };

    it('unwraps the single-resource envelope', async () => {
      mockGet.mockResolvedValue({ data: { data: user } });

      const result = await client.getUser();

      expect(mockGet).toHaveBeenCalledWith('/user');
      expect(result).toEqual(user);
    });

    it('propagates RemoteLockAPIError', async () => {
      mockGet.mockRejectedValue(
        new RemoteLockAPIError('Authentication failed', 401),
      );

      await expect(client.getUser()).rejects.toThrow(RemoteLockAPIError);
    });
  });

  describe('forAccessToken', () => {
    it('builds a client that works without a hotel id', async () => {
      mockGet.mockResolvedValue({ data: { data: { id: 'user-1' } } });

      const tokenScoped = RemoteLockClient.forAccessToken('raw-access-token');

      await expect(tokenScoped.getUser()).resolves.toEqual({ id: 'user-1' });
    });
  });
});
