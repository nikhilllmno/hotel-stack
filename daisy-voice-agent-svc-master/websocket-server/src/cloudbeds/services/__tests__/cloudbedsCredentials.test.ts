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

import { CloudbedsConfigurationError } from '@/cloudbeds/errors/CloudbedsConfigurationError';
import { CloudbedsIntegrationDisabledError } from '@/cloudbeds/errors/CloudbedsIntegrationDisabledError';
import { resolveCloudbedsCredentials } from '@/cloudbeds/services/cloudbedsCredentials';
import { Hotel } from '@/dtos/Hotel';
import { hotelService } from '@/services/hotel/hotelService';
import { hotelConfigurationService } from '@/services/hotelConfiguration/hotelConfigurationService';
import { Country, PaymentProvider } from '@/types/enums';
import { encrypt } from '@/utils/encryption';

function buildHotel(overrides: Partial<Hotel> = {}): Hotel {
  return {
    id: 'hotel-uuid-1',
    name: 'Test Hotel',
    business_id: '12345',
    pms_provider: 'cloudbeds',
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
    payment_provider: PaymentProvider.SHIFT4,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

const mockGetExternalAuthConfigByHotelId =
  hotelConfigurationService.getExternalAuthConfigByHotelId as jest.Mock;
const mockGetHotelById = hotelService.getHotelById as jest.Mock;

const ENCRYPTED_TOKEN = encrypt('cbat_still_configured_token');

describe('resolveCloudbedsCredentials', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetExternalAuthConfigByHotelId.mockResolvedValue({
      apiToken: ENCRYPTED_TOKEN,
      disabledAt: null,
    });
  });

  it('resolves and decrypts credentials from external_auth_config when the integration is enabled', async () => {
    const hotel = buildHotel();

    const credentials = await resolveCloudbedsCredentials(hotel);

    expect(credentials).toEqual({
      propertyID: '12345',
      apiToken: 'cbat_still_configured_token',
      hotelId: 'hotel-uuid-1',
    });
  });

  it('looks up the hotel by id when given a hotel id string', async () => {
    const hotel = buildHotel();
    mockGetHotelById.mockResolvedValue(hotel);

    const credentials = await resolveCloudbedsCredentials('hotel-uuid-1');

    expect(mockGetHotelById).toHaveBeenCalledWith('hotel-uuid-1');
    expect(credentials.apiToken).toBe('cbat_still_configured_token');
  });

  it('blocks credential resolution once the integration is disabled, even though apiToken is still present', async () => {
    const hotel = buildHotel();
    mockGetExternalAuthConfigByHotelId.mockResolvedValue({
      apiToken: ENCRYPTED_TOKEN,
      disabledAt: '2026-08-01T00:00:00.000Z',
    });

    await expect(resolveCloudbedsCredentials(hotel)).rejects.toThrow(
      CloudbedsIntegrationDisabledError,
    );
    await expect(resolveCloudbedsCredentials(hotel)).rejects.toThrow(
      /Cloudbeds integration disabled/,
    );
  });

  it('throws CloudbedsConfigurationError when the hotel has no business_id', async () => {
    const hotel = buildHotel({ business_id: '' });

    await expect(resolveCloudbedsCredentials(hotel)).rejects.toThrow(
      CloudbedsConfigurationError,
    );
  });

  it('throws CloudbedsConfigurationError when the hotel has no external_auth_config', async () => {
    mockGetExternalAuthConfigByHotelId.mockResolvedValue(null);
    const hotel = buildHotel({ id: 'hotel-without-token' });

    await expect(resolveCloudbedsCredentials(hotel)).rejects.toThrow(
      CloudbedsConfigurationError,
    );
  });
});
