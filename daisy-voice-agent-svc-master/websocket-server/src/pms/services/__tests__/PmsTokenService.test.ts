import { TokenError } from '@/errors/TokenError';
import {
  HotelRefreshResult,
  PmsTokenService,
} from '@/pms/services/PmsTokenService';
import { HotelConfigurationRepository } from '@/repositories/HotelConfigurationRepository';
import { encrypt } from '@/utils/encryption';

class TestPmsTokenService extends PmsTokenService {
  async refreshToken(): Promise<HotelRefreshResult[]> {
    throw new Error('not implemented in test');
  }
}

describe('PmsTokenService.getActiveToken', () => {
  const mockRepository = {
    findExternalAuthConfigByHotelId: jest.fn(),
  };

  let service: TestPmsTokenService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TestPmsTokenService(
      'test-provider',
      mockRepository as unknown as HotelConfigurationRepository,
    );
  });

  it('decrypts and returns the apiToken from external_auth_config', async () => {
    mockRepository.findExternalAuthConfigByHotelId.mockResolvedValue({
      apiToken: encrypt('bearer-token-123'),
      disabledAt: null,
    });

    const token = await service.getActiveToken('hotel-uuid-1');

    expect(token).toBe('bearer-token-123');
    expect(mockRepository.findExternalAuthConfigByHotelId).toHaveBeenCalledWith(
      'hotel-uuid-1',
    );
  });

  it('throws TokenError when the hotel has no external_auth_config', async () => {
    mockRepository.findExternalAuthConfigByHotelId.mockResolvedValue(null);

    await expect(service.getActiveToken('hotel-uuid-1')).rejects.toThrow(
      TokenError,
    );
  });

  it('throws TokenError when external_auth_config has no apiToken', async () => {
    mockRepository.findExternalAuthConfigByHotelId.mockResolvedValue({
      disabledAt: null,
    });

    await expect(service.getActiveToken('hotel-uuid-1')).rejects.toThrow(
      TokenError,
    );
  });

  it('wraps repository failures in a TokenError', async () => {
    mockRepository.findExternalAuthConfigByHotelId.mockRejectedValue(
      new Error('db unavailable'),
    );

    await expect(service.getActiveToken('hotel-uuid-1')).rejects.toThrow(
      TokenError,
    );
  });
});
