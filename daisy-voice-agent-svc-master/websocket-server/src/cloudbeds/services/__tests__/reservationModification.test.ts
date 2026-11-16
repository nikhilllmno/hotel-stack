jest.mock('@/services/hotel/hotelService', () => ({
  hotelService: {
    getHotelById: jest.fn(),
    getHotelByBusinessId: jest.fn(),
    getHotelWithConfigurationsAndChannels: jest.fn(),
  },
}));

jest.mock('@/services/hotelConfiguration/hotelConfigurationService', () => ({
  hotelConfigurationService: {
    getHotelConfigurationByHotelId: jest.fn(),
    getExternalAuthConfigByHotelId: jest.fn().mockResolvedValue({
      apiToken: jest
        .requireActual('@/utils/encryption')
        .encrypt('cbat_test_token'),
      disabledAt: null,
    }),
  },
}));

jest.mock('@/utils/httpClient', () => ({
  createHttpClient: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  })),
}));

import { CloudbedsClient } from '@/cloudbeds/client/CloudbedsClient';
import { CloudbedsReservationService } from '@/cloudbeds/services/reservationService';
import { Reservation as ReservationDTO } from '@/dtos/Reservation';
import { Hotel } from '@/models/Hotel';
import { hotelService } from '@/services/hotel/hotelService';
import { hotelConfigurationService } from '@/services/hotelConfiguration/hotelConfigurationService';
import { Country, PaymentProvider } from '@/types/enums';

function buildHotel(overrides: Partial<Hotel> = {}): Hotel {
  return {
    id: 'hotel-uuid-1',
    name: 'Test Hotel',
    business_id: 'prop-123',
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
    currency: '$',
    payment_provider: PaymentProvider.NOT_APPLICABLE,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function buildReservation(
  overrides: Partial<ReservationDTO> = {},
): ReservationDTO {
  return {
    id: 'res-uuid-1',
    booking_id: 'BK12345',
    external_id: 'CB-RES-001',
    external_public_id: 'CB-RES-001',
    hotel_id: 'hotel-uuid-1',
    business_id: 'prop-123',
    pms_provider: 'cloudbeds',
    status: 'ACTIVE',
    check_in: new Date('2026-10-20'),
    check_out: new Date('2026-10-22'),
    room_id: 674377,
    room_type: 'Deluxe Queen',
    num_adults: 2,
    num_children: 0,
    num_pets: 0,
    phone_number: '+14085551234',
    type: 'CALL',
    rate_id: '3074692',
    rate_code: null,
    hotel: buildHotel(),
    ...overrides,
  } as ReservationDTO;
}

function buildRateResponse(overrides: Record<string, unknown> = {}) {
  return {
    rateID: '3074692',
    roomRate: '338.00',
    totalRate: '338.00',
    roomsAvailable: '10',
    isDerived: false,
    parentRateID: null,
    parentRatePlanID: null,
    parentRatePlanNamePublic: null,
    parentRatePlanNamePrivate: null,
    roomRateDetailed: [
      {
        date: '2026-10-20',
        rate: '159.00',
        totalRate: '159.00',
        roomsAvailable: '10',
        closedToArrival: false,
        closedToDeparture: false,
        blocked: false,
        minLos: '1',
        maxLos: '0',
      },
      {
        date: '2026-10-21',
        rate: '179.00',
        totalRate: '179.00',
        roomsAvailable: '10',
        closedToArrival: false,
        closedToDeparture: false,
        blocked: false,
        minLos: '1',
        maxLos: '0',
      },
    ],
    ...overrides,
  };
}

function buildTaxesAndFees() {
  return [
    {
      name: 'Tax',
      code: '',
      amount: 10,
      amountType: 'percentage',
      inclusiveOrExclusive: 'exclusive',
      type: 'tax',
      taxID: '821017',
      availableFor: ['rate'],
      isDeleted: false,
      createdAt: '2026-01-01',
      expiredAt: null,
      isRoomTypeRestricted: false,
      roomTypes: [],
    },
  ];
}

describe('CloudbedsReservationService — Modification', () => {
  const hotel = buildHotel();
  let service: CloudbedsReservationService;
  let client: CloudbedsClient;
  let putReservationSpy: jest.SpyInstance;
  let getRateSpy: jest.SpyInstance;
  let getReservationSpy: jest.SpyInstance;
  let getTaxesAndFeesSpy: jest.SpyInstance;
  let getItemsSpy: jest.SpyInstance;

  const noAddonReservationResponse = {
    propertyID: 'prop-123',
    reservationID: 'CB-RES-001',
    status: 'confirmed',
    balanceDetailed: { additionalItems: 0, grandTotal: 338, paid: 0 },
  };

  beforeEach(() => {
    client = new CloudbedsClient();
    service = new CloudbedsReservationService(client);

    putReservationSpy = jest.spyOn(client, 'putReservation');
    getRateSpy = jest.spyOn(client, 'getRate');
    getReservationSpy = jest.spyOn(client, 'getReservation');
    getTaxesAndFeesSpy = jest.spyOn(client, 'getTaxesAndFees');
    getItemsSpy = jest.spyOn(client, 'getItems');

    getReservationSpy.mockResolvedValue(noAddonReservationResponse);

    (hotelService.getHotelById as jest.Mock).mockResolvedValue(hotel);
    (hotelService.getHotelByBusinessId as jest.Mock).mockResolvedValue(hotel);
    (
      hotelConfigurationService.getHotelConfigurationByHotelId as jest.Mock
    ).mockResolvedValue({
      pet_fee_configuration: null,
    });

    getTaxesAndFeesSpy.mockResolvedValue(buildTaxesAndFees());
    getItemsSpy.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==================== modifyReservation ====================

  describe('modifyReservation', () => {
    it('calls putReservation and returns updated quote for date change', async () => {
      const reservation = buildReservation();
      const newRate = buildRateResponse({
        roomRate: '835.00',
        totalRate: '835.00',
        roomRateDetailed: [
          {
            date: '2026-10-20',
            rate: '159.00',
            totalRate: '159.00',
            roomsAvailable: '9',
          },
          {
            date: '2026-10-21',
            rate: '159.00',
            totalRate: '159.00',
            roomsAvailable: '9',
          },
          {
            date: '2026-10-22',
            rate: '159.00',
            totalRate: '159.00',
            roomsAvailable: '9',
          },
          {
            date: '2026-10-23',
            rate: '179.00',
            totalRate: '179.00',
            roomsAvailable: '9',
          },
          {
            date: '2026-10-24',
            rate: '179.00',
            totalRate: '179.00',
            roomsAvailable: '9',
          },
        ],
      });

      putReservationSpy.mockResolvedValue({});
      getRateSpy.mockResolvedValue(newRate);

      const quote = await service.modifyReservation(
        reservation,
        '2026-10-20',
        '2026-10-25',
        null,
      );

      expect(putReservationSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          propertyID: 'prop-123',
          reservationID: 'CB-RES-001',
          rooms: [
            expect.objectContaining({
              roomTypeID: '674377',
              checkinDate: '2026-10-20',
              checkoutDate: '2026-10-25',
              adults: 2,
              children: 0,
            }),
          ],
        }),
        expect.objectContaining({ apiToken: 'cbat_test_token' }),
      );

      expect(quote.base_rate).toBe(835);
      expect(quote.total_amount).toBeGreaterThan(835);
    });

    it('calls putReservation with new room type for room change', async () => {
      const reservation = buildReservation();
      const newRate = buildRateResponse({ rateID: '3074693' });

      putReservationSpy.mockResolvedValue({});
      getRateSpy.mockResolvedValue(newRate);

      await service.modifyReservation(
        reservation,
        '2026-10-20',
        '2026-10-22',
        null,
        674378,
      );

      expect(putReservationSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          rooms: [
            expect.objectContaining({
              roomTypeID: '674378',
            }),
          ],
        }),
        expect.anything(),
      );
    });

    it('includes rateID when newRateId is provided', async () => {
      const reservation = buildReservation();
      putReservationSpy.mockResolvedValue({});
      getRateSpy.mockResolvedValue(buildRateResponse());

      await service.modifyReservation(
        reservation,
        '2026-10-20',
        '2026-10-22',
        null,
        674378,
        12345,
      );

      expect(putReservationSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          rooms: [
            expect.objectContaining({
              rateID: '12345',
            }),
          ],
        }),
        expect.anything(),
      );
    });

    it('throws when external_id is missing', async () => {
      const reservation = buildReservation({ external_id: undefined });

      await expect(
        service.modifyReservation(
          reservation,
          '2026-10-20',
          '2026-10-22',
          null,
        ),
      ).rejects.toThrow(/external_id is required/);
    });

    it('throws when hotel_id is missing', async () => {
      const reservation = buildReservation({
        hotel_id: undefined,
        hotel: undefined,
      } as unknown as Partial<ReservationDTO>);

      await expect(
        service.modifyReservation(
          reservation,
          '2026-10-20',
          '2026-10-22',
          null,
        ),
      ).rejects.toThrow(/hotel_id is required/);
    });
  });

  // ==================== getExternalModificationInfo ====================

  describe('getExternalModificationInfo', () => {
    it('returns same_dates scenario when dates have not changed', async () => {
      const reservation = buildReservation();

      const info = await service.getExternalModificationInfo(
        reservation,
        '2026-10-20',
        '2026-10-22',
      );

      expect(info.scenario).toBe('same_dates');
      expect(info.pricingDelta).toBe(0);
      expect(info.available).toBe(true);
      expect(getRateSpy).not.toHaveBeenCalled();
    });

    it('returns stay_extension scenario with pricing for only the new dates', async () => {
      const reservation = buildReservation();
      // getRate is now only called for the new dates (Oct 22–25)
      const newDatesRate = buildRateResponse({
        totalRate: '517.00',
        roomRateDetailed: [
          {
            date: '2026-10-22',
            rate: '159.00',
            totalRate: '159.00',
            roomsAvailable: '9',
          },
          {
            date: '2026-10-23',
            rate: '179.00',
            totalRate: '179.00',
            roomsAvailable: '9',
          },
          {
            date: '2026-10-24',
            rate: '179.00',
            totalRate: '179.00',
            roomsAvailable: '9',
          },
        ],
      });
      getRateSpy.mockResolvedValue(newDatesRate);

      const info = await service.getExternalModificationInfo(
        reservation,
        '2026-10-20',
        '2026-10-25',
      );

      expect(info.scenario).toBe('stay_extension');
      expect(info.pricingDelta).toBe(517);
      expect(info.available).toBe(true);
      expect(info.newDateBreakdown).toHaveLength(3);
      expect(info.newDateBreakdown.map((d) => d.date)).toEqual([
        '2026-10-22',
        '2026-10-23',
        '2026-10-24',
      ]);
      // Verify getRate was called for new dates only
      expect(getRateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: '2026-10-22',
          endDate: '2026-10-25',
        }),
        expect.anything(),
      );
    });

    it('returns stay_reduction scenario with pricingDelta 0 and skips rate fetch', async () => {
      const reservation = buildReservation({
        check_in: new Date('2026-10-20'),
        check_out: new Date('2026-10-25'),
      });

      const info = await service.getExternalModificationInfo(
        reservation,
        '2026-10-20',
        '2026-10-22',
      );

      expect(info.scenario).toBe('stay_reduction');
      expect(info.pricingDelta).toBe(0);
      expect(info.available).toBe(true);
      expect(getRateSpy).not.toHaveBeenCalled();
    });

    it('returns not available when room has 0 availability', async () => {
      const reservation = buildReservation();
      getRateSpy.mockResolvedValue(buildRateResponse({ roomsAvailable: 0 }));

      const info = await service.getExternalModificationInfo(
        reservation,
        '2026-10-20',
        '2026-10-25',
      );

      expect(info.available).toBe(false);
      expect(info.pricingDelta).toBe(0);
    });

    it('returns not available when getRate throws', async () => {
      const reservation = buildReservation();
      getRateSpy.mockRejectedValue(new Error('API error'));

      const info = await service.getExternalModificationInfo(
        reservation,
        '2026-10-20',
        '2026-10-25',
      );

      expect(info.available).toBe(false);
      expect(info.pricingDelta).toBe(0);
    });

    it('returns non_overlapping scenario with full pricing (all dates are new)', async () => {
      const reservation = buildReservation();
      getRateSpy.mockResolvedValue(
        buildRateResponse({
          roomRateDetailed: [
            {
              date: '2026-11-01',
              rate: '159.00',
              totalRate: '159.00',
              roomsAvailable: '10',
            },
            {
              date: '2026-11-02',
              rate: '179.00',
              totalRate: '179.00',
              roomsAvailable: '10',
            },
          ],
        }),
      );

      const info = await service.getExternalModificationInfo(
        reservation,
        '2026-11-01',
        '2026-11-03',
      );

      expect(info.scenario).toBe('non_overlapping');
      expect(info.available).toBe(true);
      expect(info.pricingDelta).toBe(338);
      expect(info.newDateBreakdown).toHaveLength(2);
    });
  });

  // ==================== modifyExternalDirectReservation ====================

  describe('modifyExternalDirectReservation', () => {
    it('checks info first, then calls putReservation for date change', async () => {
      const reservation = buildReservation();
      // getRate is now only called for the new dates (Oct 22–25)
      const newDatesRate = buildRateResponse({
        totalRate: '517.00',
        roomRateDetailed: [
          {
            date: '2026-10-22',
            rate: '159.00',
            totalRate: '159.00',
            roomsAvailable: '9',
          },
          {
            date: '2026-10-23',
            rate: '179.00',
            totalRate: '179.00',
            roomsAvailable: '9',
          },
          {
            date: '2026-10-24',
            rate: '179.00',
            totalRate: '179.00',
            roomsAvailable: '9',
          },
        ],
      });

      putReservationSpy.mockResolvedValue({});
      getRateSpy.mockResolvedValue(newDatesRate);

      const info = await service.modifyExternalDirectReservation(
        reservation,
        '2026-10-20',
        '2026-10-25',
      );

      expect(putReservationSpy).toHaveBeenCalledTimes(1);
      expect(info.scenario).toBe('stay_extension');
      expect(info.pricingDelta).toBe(517);
      expect(info.available).toBe(true);
    });

    it('skips putReservation when dates have not changed (same_dates)', async () => {
      const reservation = buildReservation();

      const info = await service.modifyExternalDirectReservation(
        reservation,
        '2026-10-20',
        '2026-10-22',
      );

      expect(putReservationSpy).not.toHaveBeenCalled();
      expect(info.scenario).toBe('same_dates');
      expect(info.pricingDelta).toBe(0);
    });

    it('skips putReservation when room is not available', async () => {
      const reservation = buildReservation();
      getRateSpy.mockResolvedValue(buildRateResponse({ roomsAvailable: 0 }));

      const info = await service.modifyExternalDirectReservation(
        reservation,
        '2026-10-20',
        '2026-10-25',
      );

      expect(putReservationSpy).not.toHaveBeenCalled();
      expect(info.available).toBe(false);
    });

    it('calls putReservation for room change even with same dates', async () => {
      const reservation = buildReservation();
      putReservationSpy.mockResolvedValue({});
      getRateSpy.mockResolvedValue(buildRateResponse());

      const info = await service.modifyExternalDirectReservation(
        reservation,
        '2026-10-20',
        '2026-10-22',
        674378,
      );

      expect(putReservationSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          rooms: [expect.objectContaining({ roomTypeID: '674378' })],
        }),
        expect.anything(),
      );
      expect(info.room_type_id).toBe(674378);
      // All dates are "new" for a room change — full pricing
      expect(info.pricingDelta).toBe(338);
      expect(info.newDateBreakdown).toHaveLength(2);
    });

    it('sets rate_id when rate change is requested', async () => {
      const reservation = buildReservation();
      putReservationSpy.mockResolvedValue({});
      getRateSpy.mockResolvedValue(buildRateResponse());

      const info = await service.modifyExternalDirectReservation(
        reservation,
        '2026-10-20',
        '2026-10-22',
        674378,
        99999,
      );

      expect(info.rate_id).toBe(99999);
    });

    it('throws when external_id is missing', async () => {
      const reservation = buildReservation({ external_id: undefined });

      await expect(
        service.modifyExternalDirectReservation(
          reservation,
          '2026-10-20',
          '2026-10-25',
        ),
      ).rejects.toThrow(/external_id is required/);
    });

    it('throws when hotel_id is missing and dates differ', async () => {
      const reservation = buildReservation({
        hotel_id: undefined,
        hotel: undefined,
      } as unknown as Partial<ReservationDTO>);

      await expect(
        service.modifyExternalDirectReservation(
          reservation,
          '2026-10-20',
          '2026-10-25',
        ),
      ).rejects.toThrow(/hotel_id is required/);
    });

    it('throws when newRateId is provided without newRoomTypeId', async () => {
      const reservation = buildReservation();

      await expect(
        service.modifyExternalDirectReservation(
          reservation,
          '2026-10-20',
          '2026-10-22',
          undefined,
          99999,
        ),
      ).rejects.toThrow(/newRateId can only be specified when newRoomTypeId/);
    });

    it('throws when reservation has additional items (add-ons)', async () => {
      const reservation = buildReservation();
      getReservationSpy.mockResolvedValue({
        ...noAddonReservationResponse,
        balanceDetailed: { additionalItems: 80, grandTotal: 418, paid: 0 },
      });

      await expect(
        service.modifyExternalDirectReservation(
          reservation,
          '2026-10-20',
          '2026-10-25',
        ),
      ).rejects.toThrow(/additional items.*cannot be modified/);

      expect(putReservationSpy).not.toHaveBeenCalled();
    });

    it('proceeds when additionalItems is 0', async () => {
      const reservation = buildReservation();
      getReservationSpy.mockResolvedValue(noAddonReservationResponse);
      putReservationSpy.mockResolvedValue({});
      getRateSpy.mockResolvedValue(
        buildRateResponse({
          roomRateDetailed: [
            {
              date: '2026-10-22',
              rate: '159.00',
              totalRate: '159.00',
              roomsAvailable: '9',
            },
          ],
        }),
      );

      const info = await service.modifyExternalDirectReservation(
        reservation,
        '2026-10-20',
        '2026-10-23',
      );

      expect(info.available).toBe(true);
      expect(putReservationSpy).toHaveBeenCalled();
    });
  });

  // ==================== getQuoteForModification ====================

  describe('getQuoteForModification', () => {
    it('returns quote with pricing for new dates', async () => {
      const reservation = buildReservation();
      getRateSpy.mockResolvedValue(buildRateResponse());

      const quote = await service.getQuoteForModification(
        reservation,
        '2026-10-20',
        '2026-10-22',
        null,
      );

      expect(quote.base_rate).toBe(338);
      expect(quote.taxes).toBeGreaterThan(0);
      expect(quote.total_amount).toBeGreaterThan(338);
      expect(quote.currency).toBe('$');
    });

    it('sets amountCharged to 0 for not_applicable payment provider', async () => {
      const reservation = buildReservation();
      getRateSpy.mockResolvedValue(buildRateResponse());

      const quote = await service.getQuoteForModification(
        reservation,
        '2026-10-20',
        '2026-10-22',
        null,
      );

      expect(quote.amountCharged).toBe(0);
    });

    it('still returns a quote even when roomsAvailable is 0 (availability is checked by orchestrator)', async () => {
      const reservation = buildReservation();
      getRateSpy.mockResolvedValue(buildRateResponse({ roomsAvailable: '0' }));

      const quote = await service.getQuoteForModification(
        reservation,
        '2026-10-20',
        '2026-10-22',
        null,
      );

      expect(quote.base_rate).toBe(338);
    });

    it('uses new room type id when provided', async () => {
      const reservation = buildReservation({ room_id: 674378 });
      getRateSpy.mockResolvedValue(buildRateResponse({ rateID: '3074693' }));

      const quote = await service.getQuoteForModification(
        reservation,
        '2026-10-20',
        '2026-10-22',
        null,
      );

      expect(getRateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ roomTypeID: '674378' }),
        expect.anything(),
      );
      expect(quote.base_rate).toBe(338);
    });

    it('retains existing per-night pricing for overlapping dates and only fetches new dates', async () => {
      const reservation = buildReservation({
        quote: {
          id: 'q1',
          reservation_id: 'res-uuid-1',
          base_rate: 338,
          taxes: 33.8,
          fees: 0,
          amount_charged: 0,
          total_amount: 371.8,
          quote_object: {
            base_rate: 338,
            taxes: 33.8,
            fees: 0,
            total_amount: 371.8,
            amountCharged: 0,
            room_type_id: 674377,
            raw_response: {
              rateID: '3074692',
              isDerived: false,
              roomRate: 338,
              totalRate: 338,
              roomsAvailable: 10,
              daysOfWeek: null,
              roomRateDetailed: [
                {
                  date: '2026-10-20',
                  rate: 159,
                  totalRate: 159,
                  roomsAvailable: 10,
                  closedToArrival: false,
                  closedToDeparture: false,
                  minLos: 1,
                  maxLos: 0,
                },
                {
                  date: '2026-10-21',
                  rate: 179,
                  totalRate: 179,
                  roomsAvailable: 10,
                  closedToArrival: false,
                  closedToDeparture: false,
                  minLos: 1,
                  maxLos: 0,
                },
              ],
            },
          },
          created_at: new Date(),
          updated_at: new Date(),
        },
      } as unknown as Partial<ReservationDTO>);

      // Only the extension dates (Oct 22–24) should be fetched
      getRateSpy.mockResolvedValue(
        buildRateResponse({
          roomRateDetailed: [
            {
              date: '2026-10-22',
              rate: '159.00',
              totalRate: '159.00',
              roomsAvailable: '9',
            },
            {
              date: '2026-10-23',
              rate: '179.00',
              totalRate: '179.00',
              roomsAvailable: '9',
            },
            {
              date: '2026-10-24',
              rate: '179.00',
              totalRate: '179.00',
              roomsAvailable: '9',
            },
          ],
        }),
      );

      const quote = await service.getQuoteForModification(
        reservation,
        '2026-10-20',
        '2026-10-25',
        null,
      );

      // getRate should only be called for the new dates Oct 22–25 (checkout exclusive)
      expect(getRateSpy).toHaveBeenCalledTimes(1);
      expect(getRateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: '2026-10-22',
          endDate: '2026-10-25',
        }),
        expect.anything(),
      );

      // 159 + 179 (retained) + 159 + 179 + 179 (fresh) = 855
      expect(quote.base_rate).toBe(855);
    });

    it('fetches all dates when room type changed', async () => {
      const reservation = buildReservation({
        room_id: 674378, // new room type
        quote: {
          id: 'q1',
          reservation_id: 'res-uuid-1',
          base_rate: 338,
          taxes: 33.8,
          fees: 0,
          amount_charged: 0,
          total_amount: 371.8,
          quote_object: {
            base_rate: 338,
            taxes: 33.8,
            fees: 0,
            total_amount: 371.8,
            amountCharged: 0,
            room_type_id: 674377, // old room type
            raw_response: {
              rateID: '3074692',
              isDerived: false,
              roomRate: 338,
              totalRate: 338,
              roomsAvailable: 10,
              daysOfWeek: null,
              roomRateDetailed: [
                {
                  date: '2026-10-20',
                  rate: 159,
                  totalRate: 159,
                  roomsAvailable: 10,
                  closedToArrival: false,
                  closedToDeparture: false,
                  minLos: 1,
                  maxLos: 0,
                },
                {
                  date: '2026-10-21',
                  rate: 179,
                  totalRate: 179,
                  roomsAvailable: 10,
                  closedToArrival: false,
                  closedToDeparture: false,
                  minLos: 1,
                  maxLos: 0,
                },
              ],
            },
          },
          created_at: new Date(),
          updated_at: new Date(),
        },
      } as unknown as Partial<ReservationDTO>);

      getRateSpy.mockResolvedValue(buildRateResponse());

      await service.getQuoteForModification(
        reservation,
        '2026-10-20',
        '2026-10-22',
        null,
      );

      // Room changed — all dates must be fetched fresh
      expect(getRateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          roomTypeID: '674378',
          startDate: '2026-10-20',
          endDate: '2026-10-22',
        }),
        expect.anything(),
      );
    });

    it('retains existing pricing for stay reduction without calling getRate', async () => {
      const reservation = buildReservation({
        check_in: new Date('2026-10-20'),
        check_out: new Date('2026-10-25'),
        quote: {
          id: 'q1',
          reservation_id: 'res-uuid-1',
          base_rate: 855,
          taxes: 85.5,
          fees: 0,
          amount_charged: 0,
          total_amount: 940.5,
          quote_object: {
            base_rate: 855,
            taxes: 85.5,
            fees: 0,
            total_amount: 940.5,
            amountCharged: 0,
            room_type_id: 674377,
            raw_response: {
              rateID: '3074692',
              isDerived: false,
              roomRate: 855,
              totalRate: 855,
              roomsAvailable: 10,
              daysOfWeek: null,
              roomRateDetailed: [
                {
                  date: '2026-10-20',
                  rate: 159,
                  totalRate: 159,
                  roomsAvailable: 10,
                  closedToArrival: false,
                  closedToDeparture: false,
                  minLos: 1,
                  maxLos: 0,
                },
                {
                  date: '2026-10-21',
                  rate: 179,
                  totalRate: 179,
                  roomsAvailable: 10,
                  closedToArrival: false,
                  closedToDeparture: false,
                  minLos: 1,
                  maxLos: 0,
                },
                {
                  date: '2026-10-22',
                  rate: 159,
                  totalRate: 159,
                  roomsAvailable: 10,
                  closedToArrival: false,
                  closedToDeparture: false,
                  minLos: 1,
                  maxLos: 0,
                },
                {
                  date: '2026-10-23',
                  rate: 179,
                  totalRate: 179,
                  roomsAvailable: 10,
                  closedToArrival: false,
                  closedToDeparture: false,
                  minLos: 1,
                  maxLos: 0,
                },
                {
                  date: '2026-10-24',
                  rate: 179,
                  totalRate: 179,
                  roomsAvailable: 10,
                  closedToArrival: false,
                  closedToDeparture: false,
                  minLos: 1,
                  maxLos: 0,
                },
              ],
            },
          },
          created_at: new Date(),
          updated_at: new Date(),
        },
      } as unknown as Partial<ReservationDTO>);

      const quote = await service.getQuoteForModification(
        reservation,
        '2026-10-20',
        '2026-10-22',
        null,
      );

      // All dates are retained — no rate fetch needed
      expect(getRateSpy).not.toHaveBeenCalled();
      // Only Oct 20 (159) + Oct 21 (179) = 338
      expect(quote.base_rate).toBe(338);
    });
  });

  // ==================== tax truncation (Cloudbeds parity) ====================

  // Cloudbeds truncates each tax/fee line to two decimals; Dextr must produce
  // the identical grand total so both systems store the same number and there
  // is no cent-level drift to reconcile. Both cases below are real bookings
  // verified against Cloudbeds' folio.
  describe('tax truncation matches Cloudbeds folio', () => {
    // Two percentage taxes: 6.57% and 8.45%.
    const twoTaxes = [
      {
        name: 'City Tax',
        code: '',
        amount: 6.57,
        amountType: 'percentage',
        inclusiveOrExclusive: 'exclusive',
        type: 'tax',
        taxID: '900001',
        availableFor: ['rate'],
        isDeleted: false,
        createdAt: '2026-01-01',
        expiredAt: null,
        isRoomTypeRestricted: false,
        roomTypes: [],
      },
      {
        name: 'State Tax',
        code: '',
        amount: 8.45,
        amountType: 'percentage',
        inclusiveOrExclusive: 'exclusive',
        type: 'tax',
        taxID: '900002',
        availableFor: ['rate'],
        isDeleted: false,
        createdAt: '2026-01-01',
        expiredAt: null,
        isRoomTypeRestricted: false,
        roomTypes: [],
      },
    ];

    function singleNightRate(rate: string) {
      return buildRateResponse({
        roomRate: rate,
        totalRate: rate,
        roomRateDetailed: [
          {
            date: '2026-10-20',
            rate,
            totalRate: rate,
            roomsAvailable: '10',
          },
        ],
      });
    }

    it('base 259.32 with 6.57% + 8.45% truncates to 38.94, not 38.96', async () => {
      // 259.32 * 6.57% = 17.037324 -> 17.03  (ceiling would give 17.04)
      // 259.32 * 8.45% = 21.912540 -> 21.91  (ceiling would give 21.92)
      getTaxesAndFeesSpy.mockResolvedValue(twoTaxes);
      putReservationSpy.mockResolvedValue({});
      getRateSpy.mockResolvedValue(singleNightRate('259.32'));

      const quote = await service.modifyReservation(
        buildReservation(),
        '2026-10-20',
        '2026-10-21',
        null,
      );

      expect(quote.base_rate).toBe(259.32);
      expect(quote.taxes).toBe(38.94);
      expect(quote.total_amount).toBe(298.26);
    });

    it('base 120 with 6.57% + 8.45% truncates to a 138.02 total, not 138.03', async () => {
      // 120 * 6.57% = 7.884 -> 7.88  (ceiling would give 7.89)
      // 120 * 8.45% = 10.14  -> 10.14 (already an exact cent)
      getTaxesAndFeesSpy.mockResolvedValue(twoTaxes);
      putReservationSpy.mockResolvedValue({});
      getRateSpy.mockResolvedValue(singleNightRate('120.00'));

      const quote = await service.modifyReservation(
        buildReservation(),
        '2026-10-20',
        '2026-10-21',
        null,
      );

      expect(quote.base_rate).toBe(120);
      expect(quote.taxes).toBe(18.02);
      expect(quote.total_amount).toBe(138.02);
    });

    it('truncates each tax line independently, not the summed raw amount', async () => {
      // 1.00 * 6.57% = 0.0657 -> 0.06  and  1.00 * 8.45% = 0.0845 -> 0.08
      // Per-line truncation totals 0.14; truncating the raw sum
      // (0.0657 + 0.0845 = 0.1502) would give 0.15. This is the only case
      // where the two strategies diverge, so it guards the per-line behaviour.
      getTaxesAndFeesSpy.mockResolvedValue(twoTaxes);
      putReservationSpy.mockResolvedValue({});
      getRateSpy.mockResolvedValue(singleNightRate('1.00'));

      const quote = await service.modifyReservation(
        buildReservation(),
        '2026-10-20',
        '2026-10-21',
        null,
      );

      expect(quote.base_rate).toBe(1);
      expect(quote.taxes).toBe(0.14);
      expect(quote.total_amount).toBe(1.14);
    });
  });
});
