process.env.STAYNTOUCH_BASE_URL = 'https://api.stayntouch.test/connect';

import { HotelService } from '@/services/hotel/hotelService';
import { HotelConfigurationService } from '@/services/hotelConfiguration/hotelConfigurationService';
import { StayntouchReservationService } from '@/stayntouch/services/reservationService';
import { GetRateResponse } from '@/stayntouch/types/GetRateResponse';

const HOTEL_ID = '11111111-1111-1111-1111-111111111111';
const STAYNTOUCH_HOTEL_ID = 1001;

const cachedRates: GetRateResponse[] = [
  {
    id: 1,
    code: 'BAR',
    name: 'Best Available Rate',
    hotel_id: STAYNTOUCH_HOTEL_ID,
  },
  { id: 2, code: 'AAA', name: 'AAA Rate', hotel_id: STAYNTOUCH_HOTEL_ID },
];

const apiRates: GetRateResponse[] = [
  {
    id: 3,
    code: 'GOV',
    name: 'Government Rate',
    hotel_id: STAYNTOUCH_HOTEL_ID,
  },
];

describe('StayntouchReservationService.getHotelRatesWithCache (via getRateIdByCode)', () => {
  let service: StayntouchReservationService;
  let mockHotelService: { getCachedHotelRates: jest.Mock };
  let getHotelRatesSpy: jest.SpyInstance;

  beforeEach(() => {
    mockHotelService = {
      getCachedHotelRates: jest.fn(),
    };

    service = new StayntouchReservationService(
      HOTEL_ID,
      mockHotelService as unknown as HotelService,
      {} as HotelConfigurationService,
    );

    getHotelRatesSpy = jest
      .spyOn(service['client'], 'getHotelRates')
      .mockResolvedValue(apiRates);
  });

  afterEach(() => {
    getHotelRatesSpy.mockRestore();
  });

  it('returns cached rates from DB and does not call the API', async () => {
    mockHotelService.getCachedHotelRates.mockResolvedValue(cachedRates);

    const rateId = await service.getRateIdByCode(STAYNTOUCH_HOTEL_ID, 'BAR');

    expect(rateId).toBe(1);
    expect(mockHotelService.getCachedHotelRates).toHaveBeenCalledWith(HOTEL_ID);
    expect(getHotelRatesSpy).not.toHaveBeenCalled();
  });

  it('falls back to the API when DB returns null', async () => {
    mockHotelService.getCachedHotelRates.mockResolvedValue(null);

    const rateId = await service.getRateIdByCode(STAYNTOUCH_HOTEL_ID, 'GOV');

    expect(rateId).toBe(3);
    expect(getHotelRatesSpy).toHaveBeenCalledWith(STAYNTOUCH_HOTEL_ID);
  });

  it('falls back to the API when DB returns an empty array', async () => {
    mockHotelService.getCachedHotelRates.mockResolvedValue([]);

    const rateId = await service.getRateIdByCode(STAYNTOUCH_HOTEL_ID, 'GOV');

    expect(rateId).toBe(3);
    expect(getHotelRatesSpy).toHaveBeenCalledWith(STAYNTOUCH_HOTEL_ID);
  });

  it('falls back to the API when DB throws an error', async () => {
    mockHotelService.getCachedHotelRates.mockRejectedValue(
      new Error('DB connection lost'),
    );

    const rateId = await service.getRateIdByCode(STAYNTOUCH_HOTEL_ID, 'GOV');

    expect(rateId).toBe(3);
    expect(getHotelRatesSpy).toHaveBeenCalledWith(STAYNTOUCH_HOTEL_ID);
  });

  it('returns undefined when rate code is not found in either cache or API', async () => {
    mockHotelService.getCachedHotelRates.mockResolvedValue(cachedRates);

    const rateId = await service.getRateIdByCode(
      STAYNTOUCH_HOTEL_ID,
      'NONEXISTENT',
    );

    expect(rateId).toBeUndefined();
  });
});
