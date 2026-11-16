process.env.STAYNTOUCH_BASE_URL = 'https://api.stayntouch.test/connect';

import { Hotel } from '@/models/Hotel';
import { hotelService } from '@/services/hotel/hotelService';
import { StayntouchClient } from '@/stayntouch/client/StayntouchClient';
import { StayntouchReservationService } from '@/stayntouch/services/reservationService';
import { GetReservationResponse } from '@/stayntouch/types/GetReservationResponse';
import { Country, PaymentProvider } from '@/types/enums';

jest.mock('@/services/hotel/hotelService', () => ({
  hotelService: {
    getHotelWithConfigurationsAndChannels: jest.fn(),
  },
}));

function buildHotel(): Hotel {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Test Hotel',
    business_id: '1001',
    pms_provider: 'stayntouch',
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
  };
}

function buildReservation(params: {
  id: number;
  firstName: string;
  lastName: string;
}): GetReservationResponse {
  return {
    id: params.id,
    hotel_id: 1001,
    confirmation_number: `CONF-${params.id}`,
    currency_code: 'USD',
    status: 'RESERVED',
    arrival_date: '2026-06-01',
    arrival_time: '15:00',
    departure_date: '2026-06-03',
    departure_time: '11:00',
    booking_origin_code: 'WEB',
    booker_email: 'guest@test.com',
    created_time: '2026-05-01T12:00:00Z',
    updated_time: '2026-05-01T12:00:00Z',
    deposit_amount: 0,
    market_segment_code: 'LEISURE',
    promotion_code: '',
    segment_code: '',
    source_code: 'WEB',
    purpose_of_stay_code: 'LEISURE',
    tax_exempt: false,
    upsell_applied: false,
    early_check_in_applied: false,
    late_check_out_applied: false,
    restrict_post: false,
    do_not_move: false,
    guests: [
      {
        id: params.id,
        is_primary: true,
        is_child: false,
        is_infant: false,
        first_name: params.firstName,
        last_name: params.lastName,
        email: 'guest@test.com',
        is_vip: false,
        mobile_phone: '+15550001111',
        opted_promotional_emails: false,
        is_flagged: false,
      },
    ],
  };
}

describe('StayntouchReservationService.lookupReservationsByGuestQueryFromPms', () => {
  const hotel = buildHotel();
  let service: StayntouchReservationService;
  let searchReservationsSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new StayntouchReservationService(hotel.id);
    searchReservationsSpy = jest.spyOn(
      StayntouchClient.prototype,
      'searchReservations',
    );
    (
      hotelService.getHotelWithConfigurationsAndChannels as jest.Mock
    ).mockResolvedValue({
      configuration: null,
    });
  });

  afterEach(() => {
    searchReservationsSpy.mockRestore();
  });

  it('returns empty results when trimmed name is shorter than 2 characters', async () => {
    const results = await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      ' R ',
    );

    expect(results).toEqual([]);
    expect(searchReservationsSpy).not.toHaveBeenCalled();
  });

  it('searches by trimmed last_name for a single token', async () => {
    searchReservationsSpy.mockResolvedValue({
      results: [
        buildReservation({ id: 1, firstName: 'Reece', lastName: 'Roper' }),
      ],
      total_count: 1,
    });

    const results = await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      '  Roper  ',
    );

    expect(searchReservationsSpy).toHaveBeenCalledWith(
      1001,
      expect.objectContaining({
        last_name: 'Roper',
        page: 1,
        per_page: 50,
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        date_filter: 'arrival',
        date_operator: 'gte',
      }),
    );
    expect(results).toHaveLength(1);
    expect(results[0].customer.last_name).toBe('Roper');
  });

  it('searches by last name and filters by first name for multi-token input', async () => {
    searchReservationsSpy.mockResolvedValue({
      results: [
        buildReservation({ id: 1, firstName: 'Reece', lastName: 'Roper' }),
        buildReservation({ id: 2, firstName: 'Jane', lastName: 'Roper' }),
      ],
      total_count: 2,
    });

    const results = await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      '  Reece Roper  ',
    );

    expect(searchReservationsSpy).toHaveBeenCalledWith(
      1001,
      expect.objectContaining({
        last_name: 'Roper',
        page: 1,
        per_page: 50,
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        date_filter: 'arrival',
        date_operator: 'gte',
      }),
    );
    expect(results).toHaveLength(1);
    expect(results[0].customer.first_name).toBe('Reece');
    expect(results[0].customer.last_name).toBe('Roper');
  });

  it('fetches additional search pages in parallel when total_count exceeds per_page', async () => {
    searchReservationsSpy.mockImplementation(
      (_hotelId, params: { page?: number }) => {
        const page = params.page ?? 1;
        if (page === 1) {
          return Promise.resolve({
            results: Array.from({ length: 50 }, (_, i) =>
              buildReservation({
                id: i + 1,
                firstName: 'Guest',
                lastName: 'Smith',
              }),
            ),
            total_count: 75,
          });
        }
        if (page === 2) {
          return Promise.resolve({
            results: Array.from({ length: 25 }, (_, i) =>
              buildReservation({
                id: i + 51,
                firstName: 'Guest',
                lastName: 'Smith',
              }),
            ),
            total_count: 75,
          });
        }
        return Promise.resolve({ results: [], total_count: 75 });
      },
    );

    const results = await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      'Smith',
    );

    expect(searchReservationsSpy).toHaveBeenCalledTimes(2);
    expect(searchReservationsSpy).toHaveBeenCalledWith(
      1001,
      expect.objectContaining({
        last_name: 'Smith',
        page: 1,
        per_page: 50,
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        date_filter: 'arrival',
        date_operator: 'gte',
      }),
    );
    expect(searchReservationsSpy).toHaveBeenCalledWith(
      1001,
      expect.objectContaining({
        last_name: 'Smith',
        page: 2,
        per_page: 50,
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        date_filter: 'arrival',
        date_operator: 'gte',
      }),
    );
    expect(results).toHaveLength(75);
  });
});
