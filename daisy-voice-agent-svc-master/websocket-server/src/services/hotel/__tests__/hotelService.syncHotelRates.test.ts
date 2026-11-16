import { Hotel } from '@/models/Hotel';
import { HotelConfigurationRepository } from '@/repositories/HotelConfigurationRepository';
import { HotelRepository } from '@/repositories/HotelRepository';
import { HotelService } from '@/services/hotel/hotelService';
import { StayntouchClient } from '@/stayntouch/client/StayntouchClient';
import { GetRateResponse } from '@/stayntouch/types/GetRateResponse';
import { PmsProvider } from '@/types/enums';

jest.mock('@/stayntouch/client/StayntouchClient');

const HOTEL_ID = '11111111-1111-1111-1111-111111111111';
const BUSINESS_ID = '1001';

const mockRates: GetRateResponse[] = [
  { id: 1, code: 'BAR', name: 'Best Available Rate', hotel_id: 1001 },
  { id: 2, code: 'AAA', name: 'AAA Rate', hotel_id: 1001 },
];

function buildHotel(overrides: Partial<Hotel> = {}): Hotel {
  return {
    id: HOTEL_ID,
    name: 'Test Hotel',
    business_id: BUSINESS_ID,
    pms_provider: PmsProvider.STAYNTOUCH,
    ...overrides,
  } as Hotel;
}

describe('HotelService.getCachedHotelRates', () => {
  let service: HotelService;
  let mockHotelConfigRepo: jest.Mocked<
    Pick<HotelConfigurationRepository, 'findHotelRatesByHotelId'>
  >;

  beforeEach(() => {
    mockHotelConfigRepo = {
      findHotelRatesByHotelId: jest.fn(),
    };

    service = new HotelService(
      {} as HotelRepository,
      mockHotelConfigRepo as unknown as HotelConfigurationRepository,
    );
  });

  it('returns cached rates when they exist in DB', async () => {
    mockHotelConfigRepo.findHotelRatesByHotelId.mockResolvedValue(mockRates);

    const result = await service.getCachedHotelRates(HOTEL_ID);

    expect(result).toEqual(mockRates);
    expect(mockHotelConfigRepo.findHotelRatesByHotelId).toHaveBeenCalledWith(
      HOTEL_ID,
    );
  });

  it('returns null when no rates are cached', async () => {
    mockHotelConfigRepo.findHotelRatesByHotelId.mockResolvedValue(null);

    const result = await service.getCachedHotelRates(HOTEL_ID);

    expect(result).toBeNull();
  });
});

describe('HotelService.syncHotelRatesForStayntouchHotels', () => {
  let service: HotelService;
  let mockHotelRepo: jest.Mocked<Pick<HotelRepository, 'findByPmsProvider'>>;
  let mockHotelConfigRepo: jest.Mocked<
    Pick<HotelConfigurationRepository, 'updateHotelRatesByHotelId'>
  >;
  let mockGetHotelRates: jest.Mock;

  beforeEach(() => {
    mockGetHotelRates = jest.fn().mockResolvedValue(mockRates);
    (
      StayntouchClient as jest.MockedClass<typeof StayntouchClient>
    ).mockImplementation(
      () =>
        ({
          getHotelRates: mockGetHotelRates,
        }) as unknown as StayntouchClient,
    );

    mockHotelRepo = {
      findByPmsProvider: jest.fn(),
    };

    mockHotelConfigRepo = {
      updateHotelRatesByHotelId: jest.fn().mockResolvedValue(1),
    };

    service = new HotelService(
      mockHotelRepo as unknown as HotelRepository,
      mockHotelConfigRepo as unknown as HotelConfigurationRepository,
    );
  });

  it('fetches rates from API and stores them in DB for each hotel', async () => {
    const hotel = buildHotel();
    mockHotelRepo.findByPmsProvider.mockResolvedValue([hotel]);

    const results = await service.syncHotelRatesForStayntouchHotels();

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      hotelId: HOTEL_ID,
      hotelName: 'Test Hotel',
      success: true,
      ratesCount: 2,
    });
    expect(mockGetHotelRates).toHaveBeenCalledWith(1001);
    expect(mockHotelConfigRepo.updateHotelRatesByHotelId).toHaveBeenCalledWith(
      HOTEL_ID,
      mockRates,
    );
  });

  it('reports failure when a hotel has an invalid business_id', async () => {
    const hotel = buildHotel({ business_id: 'not-a-number' });
    mockHotelRepo.findByPmsProvider.mockResolvedValue([hotel]);

    const results = await service.syncHotelRatesForStayntouchHotels();

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('Invalid business_id');
    expect(mockGetHotelRates).not.toHaveBeenCalled();
  });

  it('reports failure when the API call throws', async () => {
    const hotel = buildHotel();
    mockHotelRepo.findByPmsProvider.mockResolvedValue([hotel]);
    mockGetHotelRates.mockRejectedValue(new Error('timeout'));

    const results = await service.syncHotelRatesForStayntouchHotels();

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('timeout');
  });

  it('handles mixed success and failure across multiple hotels', async () => {
    const goodHotel = buildHotel({
      id: 'hotel-good',
      name: 'Good Hotel',
      business_id: '100',
    });
    const badHotel = buildHotel({
      id: 'hotel-bad',
      name: 'Bad Hotel',
      business_id: 'invalid',
    });
    mockHotelRepo.findByPmsProvider.mockResolvedValue([goodHotel, badHotel]);

    const results = await service.syncHotelRatesForStayntouchHotels();

    expect(results).toHaveLength(2);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(results.filter((r) => !r.success)).toHaveLength(1);
  });

  it('returns empty array when no Stayntouch hotels exist', async () => {
    mockHotelRepo.findByPmsProvider.mockResolvedValue([]);

    const results = await service.syncHotelRatesForStayntouchHotels();

    expect(results).toEqual([]);
    expect(mockGetHotelRates).not.toHaveBeenCalled();
  });
});
