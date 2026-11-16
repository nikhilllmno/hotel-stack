jest.mock('@/calry/services/calryCredentials', () => ({
  resolveCalryCredentials: jest.fn(),
}));

jest.mock('@/services/hotel/hotelService', () => ({
  hotelService: {
    getHotelWithConfigurationsAndChannels: jest.fn(),
  },
}));

import { resolveCalryCredentials } from '@/calry/services/calryCredentials';
import { CalryReservationService } from '@/calry/services/reservationService';
import { CalryCredentials } from '@/calry/types';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { Hotel } from '@/models/Hotel';
import { hotelService } from '@/services/hotel/hotelService';
import { PmsProvider } from '@/types/enums';

const CREDENTIALS: CalryCredentials = {
  propertyId: '212815',
  apiToken: 'calry_token_abc',
  workspaceId: 'workspace-1',
  integrationAccountId: 'integration-account-1',
  hotelId: 'hotel-uuid-1',
};

const HOTEL = {
  id: 'hotel-uuid-1',
  business_id: '212815',
  currency: 'USD',
  pms_provider: 'calry',
} as unknown as Hotel;

const mockResolveCredentials = resolveCalryCredentials as jest.Mock;
const mockGetHotelWithConfig =
  hotelService.getHotelWithConfigurationsAndChannels as jest.Mock;

describe('CalryReservationService.lookupReservationsById', () => {
  let client: { getReservation: jest.Mock };
  let service: CalryReservationService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveCredentials.mockResolvedValue(CREDENTIALS);
    mockGetHotelWithConfig.mockResolvedValue({ configuration: null });

    client = {
      getReservation: jest.fn().mockResolvedValue({
        id: '9961197',
        arrivalDate: '2026-09-01',
        departureDate: '2026-09-03',
        roomTypeIds: ['341959'],
        status: 'CONFIRMED',
        numberOfAdults: 2,
        primaryGuest: { mobileNumbers: ['+19876543210'] },
      }),
    };
    service = new CalryReservationService(client as never);
  });

  it('returns the reservation mapped onto the shared DTO', async () => {
    const result = await service.lookupReservationsById(HOTEL, '9961197');

    expect(client.getReservation).toHaveBeenCalledWith('9961197', CREDENTIALS);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: '9961197',
      external_id: '9961197',
      pms_provider: PmsProvider.CALRY,
      status: ReservationStatus.ACTIVE,
    });
  });

  it('returns nothing rather than throwing when the lookup fails', async () => {
    client.getReservation.mockRejectedValue(new Error('404 not found'));

    await expect(
      service.lookupReservationsById(HOTEL, 'does-not-exist'),
    ).resolves.toEqual([]);
  });
});
