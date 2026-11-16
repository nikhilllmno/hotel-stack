import axios from 'axios';

jest.mock('axios');

jest.mock('@/utils/encryption', () => ({
  encrypt: (v: string) => `enc(${v})`,
  decrypt: (v: string) => v.replace(/^enc\(|\)$/g, ''),
}));

import { RemoteLockTokenService } from '@/remotelock/services/tokenService';

const mockedAxiosPost = axios.post as jest.Mock;

function makeRepo() {
  return {
    findHotelIdsWithRemoteLockRefreshToken: jest
      .fn()
      .mockResolvedValue(['hotel-a', 'hotel-b']),
    findExternalAuthConfigByHotelId: jest.fn(),
    updateExternalAuthConfigRemoteLockTokensByHotelId: jest
      .fn()
      .mockResolvedValue(1),
  };
}

describe('RemoteLockTokenService.refreshToken', () => {
  beforeEach(() => {
    mockedAxiosPost.mockReset();
  });

  it('stores the new access token and the rotated refresh token per hotel', async () => {
    const repo = makeRepo();
    repo.findExternalAuthConfigByHotelId.mockResolvedValue({
      remotelock_refresh_token: 'enc(old-rt)',
    });
    mockedAxiosPost.mockResolvedValue({
      data: { access_token: 'new-at', refresh_token: 'new-rt' },
    });

    const service = new RemoteLockTokenService(repo as any);
    const results = await service.refreshToken();

    expect(results).toEqual(
      expect.arrayContaining([
        { hotelId: 'hotel-a', success: true },
        { hotelId: 'hotel-b', success: true },
      ]),
    );
    // Both hotels refreshed.
    expect(mockedAxiosPost).toHaveBeenCalledTimes(2);
    // Access token + rotated refresh token stored encrypted in a single write.
    expect(
      repo.updateExternalAuthConfigRemoteLockTokensByHotelId,
    ).toHaveBeenCalledWith('hotel-a', 'enc(new-at)', 'enc(new-rt)');
    // Sends grant_type=refresh_token with the decrypted stored token, using
    // Dextr's single Application credentials rather than per-hotel ones.
    const [, body] = mockedAxiosPost.mock.calls[0];
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=old-rt');
    expect(body).toContain('client_id=daisy-client-id');
    expect(body).toContain('client_secret=daisy-client-secret');
  });

  it('isolates per-hotel failure: one hotel failing does not block the other', async () => {
    const repo = makeRepo();
    repo.findExternalAuthConfigByHotelId.mockImplementation((hotelId: string) =>
      Promise.resolve(
        hotelId === 'hotel-a'
          ? {}
          : { remotelock_refresh_token: 'enc(old-rt)' },
      ),
    );
    mockedAxiosPost.mockResolvedValue({
      data: { access_token: 'b-at', refresh_token: 'b-rt' },
    });

    const service = new RemoteLockTokenService(repo as any);
    const results = await service.refreshToken();

    expect(results).toEqual(
      expect.arrayContaining([
        { hotelId: 'hotel-b', success: true },
        expect.objectContaining({ hotelId: 'hotel-a', success: false }),
      ]),
    );
    expect(
      repo.updateExternalAuthConfigRemoteLockTokensByHotelId,
    ).toHaveBeenCalledWith('hotel-b', 'enc(b-at)', 'enc(b-rt)');
    expect(
      repo.updateExternalAuthConfigRemoteLockTokensByHotelId,
    ).not.toHaveBeenCalledWith('hotel-a', expect.anything(), expect.anything());
  });

  it('throws when no hotel has a RemoteLock refresh token stored', async () => {
    const repo = makeRepo();
    repo.findHotelIdsWithRemoteLockRefreshToken.mockResolvedValue([]);

    const service = new RemoteLockTokenService(repo as any);

    await expect(service.refreshToken()).rejects.toThrow(
      /No hotels have a RemoteLock refresh token stored/,
    );
    expect(mockedAxiosPost).not.toHaveBeenCalled();
  });

  it('throws when every hotel fails', async () => {
    const repo = makeRepo();
    repo.findExternalAuthConfigByHotelId.mockResolvedValue(null);

    const service = new RemoteLockTokenService(repo as any);

    await expect(service.refreshToken()).rejects.toThrow(
      /Token refresh failed for every hotel/,
    );
  });

  it('never re-exchanges a refresh token after a failed exchange (single-use rotation)', async () => {
    const repo = makeRepo();
    repo.findExternalAuthConfigByHotelId.mockResolvedValue({
      remotelock_refresh_token: 'enc(old-rt)',
    });
    mockedAxiosPost.mockRejectedValue(new Error('RemoteLock 400'));

    const service = new RemoteLockTokenService(repo as any);

    await expect(service.refreshToken()).rejects.toThrow(
      /Token refresh failed for every hotel/,
    );
    // One exchange attempt per hotel — retrying would resend a spent token.
    expect(mockedAxiosPost).toHaveBeenCalledTimes(2);
  });

  it('retries only the DB write, reusing the tokens already exchanged', async () => {
    const repo = makeRepo();
    repo.findExternalAuthConfigByHotelId.mockResolvedValue({
      remotelock_refresh_token: 'enc(old-rt)',
    });
    mockedAxiosPost.mockResolvedValue({
      data: { access_token: 'new-at', refresh_token: 'new-rt' },
    });
    repo.updateExternalAuthConfigRemoteLockTokensByHotelId
      .mockRejectedValueOnce(new Error('DB blip'))
      .mockResolvedValue(1);

    const service = new RemoteLockTokenService(repo as any);
    const results = await service.refreshToken();

    expect(results).toEqual(
      expect.arrayContaining([{ hotelId: 'hotel-a', success: true }]),
    );
    // Write retried without a second exchange for that hotel.
    expect(mockedAxiosPost).toHaveBeenCalledTimes(2);
    expect(
      repo.updateExternalAuthConfigRemoteLockTokensByHotelId,
    ).toHaveBeenCalledTimes(3);
    expect(
      repo.updateExternalAuthConfigRemoteLockTokensByHotelId,
    ).toHaveBeenCalledWith('hotel-a', 'enc(new-at)', 'enc(new-rt)');
  });

  it('surfaces a reseed instruction when the rotated tokens cannot be stored at all', async () => {
    const repo = makeRepo();
    repo.findExternalAuthConfigByHotelId.mockResolvedValue({
      remotelock_refresh_token: 'enc(old-rt)',
    });
    mockedAxiosPost.mockResolvedValue({
      data: { access_token: 'new-at', refresh_token: 'new-rt' },
    });
    repo.updateExternalAuthConfigRemoteLockTokensByHotelId.mockRejectedValue(
      new Error('DB down'),
    );

    const service = new RemoteLockTokenService(repo as any);

    await expect(service.refreshToken()).rejects.toThrow(
      /Token refresh failed for every hotel/,
    );
    // 3 write attempts per hotel, still only 1 exchange each.
    expect(
      repo.updateExternalAuthConfigRemoteLockTokensByHotelId,
    ).toHaveBeenCalledTimes(6);
    expect(mockedAxiosPost).toHaveBeenCalledTimes(2);
  });

  it('fails the hotel when the token write matches no row', async () => {
    const repo = makeRepo();
    repo.findExternalAuthConfigByHotelId.mockResolvedValue({
      remotelock_refresh_token: 'enc(old-rt)',
    });
    mockedAxiosPost.mockResolvedValue({
      data: { access_token: 'new-at', refresh_token: 'new-rt' },
    });
    // A soft delete between listing the hotels and the write.
    repo.updateExternalAuthConfigRemoteLockTokensByHotelId.mockResolvedValue(0);

    const service = new RemoteLockTokenService(repo as any);

    // Reporting success here would strand the hotel silently — the old refresh
    // token is already spent and the new pair went nowhere.
    await expect(service.refreshToken()).rejects.toThrow(
      /Token refresh failed for every hotel/,
    );
  });

  it('keeps the access token when RemoteLock returns no rotated refresh token', async () => {
    const repo = makeRepo();
    repo.findExternalAuthConfigByHotelId.mockResolvedValue({
      remotelock_refresh_token: 'enc(old-rt)',
    });
    mockedAxiosPost.mockResolvedValue({
      data: { access_token: 'new-at' },
    });

    const service = new RemoteLockTokenService(repo as any);

    await expect(service.refreshToken()).rejects.toThrow(
      /Token refresh failed for every hotel/,
    );
    // The spent refresh token is rewritten unchanged, but the usable access
    // token is stored rather than dropped — that is the operator's reseed window.
    expect(
      repo.updateExternalAuthConfigRemoteLockTokensByHotelId,
    ).toHaveBeenCalledWith('hotel-a', 'enc(new-at)', 'enc(old-rt)');
  });
});

describe('RemoteLockTokenService.getActiveToken', () => {
  it('reads the RemoteLock access token, not the PMS-shared apiToken', async () => {
    const repo = makeRepo();
    repo.findExternalAuthConfigByHotelId.mockResolvedValue({
      apiToken: 'enc(mews-at)',
      remotelock_access_token: 'enc(rl-at)',
    });

    const service = new RemoteLockTokenService(repo as any);
    const token = await service.getActiveToken('hotel-a');

    expect(token).toBe('rl-at');
    expect(repo.findExternalAuthConfigByHotelId).toHaveBeenCalledWith(
      'hotel-a',
    );
  });

  it('throws when no RemoteLock access token is stored, even if a PMS apiToken exists', async () => {
    const repo = makeRepo();
    repo.findExternalAuthConfigByHotelId.mockResolvedValue({
      apiToken: 'enc(mews-at)',
    });

    const service = new RemoteLockTokenService(repo as any);

    await expect(service.getActiveToken('hotel-a')).rejects.toThrow(
      /No RemoteLock access token available/,
    );
  });
});
