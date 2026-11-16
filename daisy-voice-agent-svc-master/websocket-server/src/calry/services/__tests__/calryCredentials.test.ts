jest.mock('@/services/hotel/hotelService', () => ({
  hotelService: {
    getHotelById: jest.fn(),
  },
}));

jest.mock('@/services/hotelConfiguration/hotelConfigurationService', () => ({
  hotelConfigurationService: {
    getExternalAuthConfigByHotelId: jest.fn(),
  },
}));

import { CalryConfigurationError } from '@/calry/errors/CalryConfigurationError';
import { CalryIntegrationDisabledError } from '@/calry/errors/CalryIntegrationDisabledError';
import { resolveCalryCredentials } from '@/calry/services/calryCredentials';
import config from '@/config';
import { Hotel } from '@/dtos/Hotel';
import { hotelService } from '@/services/hotel/hotelService';
import { hotelConfigurationService } from '@/services/hotelConfiguration/hotelConfigurationService';
import { Country, PaymentProvider } from '@/types/enums';
import { encrypt } from '@/utils/encryption';

function buildHotel(overrides: Partial<Hotel> = {}): Hotel {
  return {
    id: 'hotel-uuid-1',
    name: 'Test Hotel',
    business_id: '212815',
    pms_provider: 'calry',
    assistant_phone_number: '+15551234567',
    country: Country.US,
    timezone: 'America/New_York',
    telegram_check_in_group_id: 'group-1',
    telegram_alerts_group_id: 'group-2',
    sms_number: '+15551234567',
    internal_phone_number: '+15551234568',
    url: 'https://hotel.test',
    address: '1 Test St',
    image_url: 'https://hotel.test/image.png',
    currency: 'USD',
    payment_provider: PaymentProvider.NOT_APPLICABLE,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

const mockGetExternalAuthConfigByHotelId =
  hotelConfigurationService.getExternalAuthConfigByHotelId as jest.Mock;
const mockGetHotelById = hotelService.getHotelById as jest.Mock;

const ENCRYPTED_TOKEN = encrypt('calry_token_abc');
const ORIGINAL_WORKSPACE_ID = config.CALRY_WORKSPACE_ID;

describe('resolveCalryCredentials', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.CALRY_WORKSPACE_ID = 'workspace-1';
    mockGetExternalAuthConfigByHotelId.mockResolvedValue({
      apiToken: ENCRYPTED_TOKEN,
      integrationAccountId: 'integration-account-1',
      disabledAt: null,
    });
  });

  afterAll(() => {
    config.CALRY_WORKSPACE_ID = ORIGINAL_WORKSPACE_ID;
  });

  it('resolves and decrypts credentials, combining per-hotel config with the global workspace', async () => {
    const credentials = await resolveCalryCredentials(buildHotel());

    expect(credentials).toEqual({
      propertyId: '212815',
      apiToken: 'calry_token_abc',
      workspaceId: 'workspace-1',
      integrationAccountId: 'integration-account-1',
      hotelId: 'hotel-uuid-1',
    });
  });

  it('looks the hotel up when given an id rather than a hotel', async () => {
    mockGetHotelById.mockResolvedValue(buildHotel());

    const credentials = await resolveCalryCredentials('hotel-uuid-1');

    expect(mockGetHotelById).toHaveBeenCalledWith('hotel-uuid-1');
    expect(credentials.propertyId).toBe('212815');
  });

  it('refuses a hotel with no business_id', async () => {
    await expect(
      resolveCalryCredentials(buildHotel({ business_id: '' })),
    ).rejects.toBeInstanceOf(CalryConfigurationError);
  });

  it('refuses when the workspace is not configured', async () => {
    config.CALRY_WORKSPACE_ID = '';

    await expect(resolveCalryCredentials(buildHotel())).rejects.toBeInstanceOf(
      CalryConfigurationError,
    );
  });

  it('refuses when the api token is missing', async () => {
    mockGetExternalAuthConfigByHotelId.mockResolvedValue(null);

    await expect(resolveCalryCredentials(buildHotel())).rejects.toBeInstanceOf(
      CalryConfigurationError,
    );
  });

  it('refuses when integrationAccountId is missing, since calls cannot be routed without it', async () => {
    mockGetExternalAuthConfigByHotelId.mockResolvedValue({
      apiToken: ENCRYPTED_TOKEN,
      disabledAt: null,
    });

    await expect(resolveCalryCredentials(buildHotel())).rejects.toBeInstanceOf(
      CalryConfigurationError,
    );
  });

  it('refuses a disabled integration even though the token is still present', async () => {
    mockGetExternalAuthConfigByHotelId.mockResolvedValue({
      apiToken: ENCRYPTED_TOKEN,
      integrationAccountId: 'integration-account-1',
      disabledAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(resolveCalryCredentials(buildHotel())).rejects.toBeInstanceOf(
      CalryIntegrationDisabledError,
    );
  });
});
