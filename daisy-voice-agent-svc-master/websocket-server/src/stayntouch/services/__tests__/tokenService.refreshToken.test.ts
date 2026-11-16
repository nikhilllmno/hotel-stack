jest.mock('axios');

jest.mock('@/utils/encryption', () => ({
  encrypt: (v: string) => `enc(${v})`,
  decrypt: (v: string) => v.replace(/^enc\(|\)$/g, ''),
}));

import { HotelConfigurationRepository } from '@/repositories/HotelConfigurationRepository';
import { StayntouchTokenService } from '@/stayntouch/services/tokenService';
import axios from 'axios';

const mockedAxiosPost = axios.post as jest.Mock;

function makeRepo() {
  return {
    findHotelIdsWithOAuthClientCredentials: jest
      .fn()
      .mockResolvedValue(['hotel-a', 'hotel-b']),
    findExternalAuthConfigByHotelId: jest.fn(),
    updateExternalAuthConfigApiTokenByHotelId: jest.fn().mockResolvedValue(1),
  };
}

describe('StayntouchTokenService.refreshToken', () => {
  beforeEach(() => {
    mockedAxiosPost.mockReset();
  });

  it('reads OAuth credentials from DB and stores the refreshed bearer token per hotel', async () => {
    const repo = makeRepo();
    repo.findExternalAuthConfigByHotelId.mockResolvedValue({
      oauth_client_id: 'enc(client-id-1)',
      oauth_client_secret: 'enc(client-secret-1)',
    });
    mockedAxiosPost.mockResolvedValue({
      data: { access_token: 'fresh-bearer', token_type: 'Bearer' },
    });

    const service = new StayntouchTokenService(
      repo as unknown as HotelConfigurationRepository,
    );
    const results = await service.refreshToken();

    expect(results).toEqual(
      expect.arrayContaining([
        { hotelId: 'hotel-a', success: true },
        { hotelId: 'hotel-b', success: true },
      ]),
    );
    expect(mockedAxiosPost).toHaveBeenCalledTimes(2);
    expect(repo.updateExternalAuthConfigApiTokenByHotelId).toHaveBeenCalledWith(
      'hotel-a',
      'enc(fresh-bearer)',
    );
    expect(repo.updateExternalAuthConfigApiTokenByHotelId).toHaveBeenCalledWith(
      'hotel-b',
      'enc(fresh-bearer)',
    );

    const [, body] = mockedAxiosPost.mock.calls[0];
    expect(body).toMatchObject({
      client_id: 'client-id-1',
      client_secret: 'client-secret-1',
      grant_type: 'client_credentials',
    });
  });

  it('discovers hotels filtered by pms_provider=stayntouch', async () => {
    const repo = makeRepo();
    repo.findHotelIdsWithOAuthClientCredentials.mockResolvedValue([]);

    const service = new StayntouchTokenService(
      repo as unknown as HotelConfigurationRepository,
    );

    await expect(service.refreshToken()).rejects.toThrow(
      /No Stayntouch hotels have OAuth client credentials/,
    );
    expect(repo.findHotelIdsWithOAuthClientCredentials).toHaveBeenCalledWith(
      'stayntouch',
    );
  });

  it('isolates per-hotel failure: one hotel failing does not block the other', async () => {
    const repo = makeRepo();
    repo.findExternalAuthConfigByHotelId.mockImplementation((hotelId: string) =>
      Promise.resolve(
        hotelId === 'hotel-a'
          ? {}
          : {
              oauth_client_id: 'enc(cid)',
              oauth_client_secret: 'enc(csec)',
            },
      ),
    );
    mockedAxiosPost.mockResolvedValue({
      data: { access_token: 'b-token', token_type: 'Bearer' },
    });

    const service = new StayntouchTokenService(
      repo as unknown as HotelConfigurationRepository,
    );
    const results = await service.refreshToken();

    expect(results).toEqual(
      expect.arrayContaining([
        { hotelId: 'hotel-b', success: true },
        expect.objectContaining({ hotelId: 'hotel-a', success: false }),
      ]),
    );
    expect(repo.updateExternalAuthConfigApiTokenByHotelId).toHaveBeenCalledWith(
      'hotel-b',
      'enc(b-token)',
    );
    expect(
      repo.updateExternalAuthConfigApiTokenByHotelId,
    ).not.toHaveBeenCalledWith('hotel-a', expect.anything());
  });

  it('throws when no hotel has OAuth client credentials stored', async () => {
    const repo = makeRepo();
    repo.findHotelIdsWithOAuthClientCredentials.mockResolvedValue([]);

    const service = new StayntouchTokenService(
      repo as unknown as HotelConfigurationRepository,
    );

    await expect(service.refreshToken()).rejects.toThrow(
      /No Stayntouch hotels have OAuth client credentials/,
    );
    expect(mockedAxiosPost).not.toHaveBeenCalled();
  });

  it('throws when every hotel fails', async () => {
    const repo = makeRepo();
    repo.findExternalAuthConfigByHotelId.mockResolvedValue(null);

    const service = new StayntouchTokenService(
      repo as unknown as HotelConfigurationRepository,
    );

    await expect(service.refreshToken()).rejects.toThrow(
      /Token refresh failed for all Stayntouch hotels/,
    );
  });
});
