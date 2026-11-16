jest.mock('@/calry/services/calryCredentials', () => ({
  resolveCalryCredentials: jest.fn(),
}));

jest.mock('@/services/hotel/hotelService', () => ({
  hotelService: {
    getHotelById: jest.fn(),
    getHotelByBusinessId: jest.fn(),
  },
}));

jest.mock('@/services/hotelConfiguration/hotelConfigurationService', () => ({
  hotelConfigurationService: {
    getHotelConfigurationByHotelId: jest.fn(),
    // Null auth config => not Opera-backed => the unified Calry path.
    getExternalAuthConfigByHotelId: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('@/utils/kpiLogger', () => ({
  ...jest.requireActual('@/utils/kpiLogger'),
  logKpi: jest.fn(),
}));

import { resolveCalryCredentials } from '@/calry/services/calryCredentials';
import { CalryReservationService } from '@/calry/services/reservationService';
import { CalryCredentials } from '@/calry/types';
import { Reservation as ReservationDTO } from '@/dtos/Reservation';
import { BadRequestError } from '@/errors/BadRequestError';
import { hotelService } from '@/services/hotel/hotelService';
import { hotelConfigurationService } from '@/services/hotelConfiguration/hotelConfigurationService';
import { KpiStat, logKpi } from '@/utils/kpiLogger';

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
  assistant_phone_number: '+15551234567',
};

const mockResolveCredentials = resolveCalryCredentials as jest.Mock;
const mockGetHotelById = hotelService.getHotelById as jest.Mock;
const mockGetHotelByBusinessId = hotelService.getHotelByBusinessId as jest.Mock;
const mockGetHotelConfig =
  hotelConfigurationService.getHotelConfigurationByHotelId as jest.Mock;
const mockLogKpi = logKpi as jest.Mock;

function buildReservation(
  overrides: Partial<ReservationDTO> = {},
): ReservationDTO {
  return {
    id: 'reservation-uuid-1',
    booking_id: 'DEXTR-1',
    external_id: '9961197',
    hotel_id: 'hotel-uuid-1',
    business_id: '212815',
    room_id: '341959',
    phone_number: '+19876543210',
    check_in: new Date('2026-09-01T00:00:00.000Z'),
    check_out: new Date('2026-09-03T00:00:00.000Z'),
    num_adults: 2,
    num_children: 1,
    num_pets: 0,
    hotel: HOTEL,
    ...overrides,
  } as unknown as ReservationDTO;
}

function buildQuoteResponse() {
  return {
    propertyId: '212815',
    roomTypeId: '341959',
    currency: 'USD',
    ratePlans: [
      {
        ratePlanId: 'BAR',
        totalPrice: 600,
        basePrice: { totalBasePrice: 540 },
        fee: { totalFee: 20 },
        tax: { totalTax: 40 },
      },
    ],
  };
}

describe('CalryReservationService modification and cancellation', () => {
  let client: {
    updateReservation: jest.Mock;
    getQuote: jest.Mock;
    getAvailability: jest.Mock;
  };
  let service: CalryReservationService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveCredentials.mockResolvedValue(CREDENTIALS);
    mockGetHotelById.mockResolvedValue(HOTEL);
    mockGetHotelByBusinessId.mockResolvedValue(HOTEL);
    mockGetHotelConfig.mockResolvedValue(null);

    client = {
      updateReservation: jest.fn().mockResolvedValue(undefined),
      getQuote: jest.fn().mockResolvedValue(buildQuoteResponse()),
      getAvailability: jest.fn().mockResolvedValue({
        propertyId: '212815',
        roomTypeId: '341959',
        dateWiseAvailability: [
          { date: '2026-09-01', status: 'AVAILABLE', unitsAvailable: 2 },
          { date: '2026-09-02', status: 'AVAILABLE', unitsAvailable: 2 },
          { date: '2026-09-03', status: 'AVAILABLE', unitsAvailable: 2 },
          { date: '2026-09-04', status: 'AVAILABLE', unitsAvailable: 2 },
        ],
      }),
    };
    service = new CalryReservationService(client as never);
  });

  describe('modifyReservation', () => {
    it('sends the new dates and guest counts, then re-quotes the stay', async () => {
      const quote = await service.modifyReservation(
        buildReservation(),
        '2026-09-01',
        '2026-09-04',
        null,
      );

      expect(client.updateReservation).toHaveBeenCalledWith(
        {
          reservationId: '9961197',
          arrivalDate: '2026-09-01',
          departureDate: '2026-09-04',
          numberOfAdults: 2,
          numberOfChildren: 1,
          numberOfGuests: 3,
          numberOfPets: 0,
        },
        CREDENTIALS,
      );
      expect(quote.total_amount).toBe(600);
    });

    it('emits the booking-modified KPI', async () => {
      await service.modifyReservation(
        buildReservation(),
        '2026-09-01',
        '2026-09-04',
        null,
      );

      expect(mockLogKpi).toHaveBeenCalledWith(
        expect.objectContaining({ stat: KpiStat.PmsBookingModified }),
      );
    });

    it('refuses a room move, which Calry cannot express', async () => {
      await expect(
        service.modifyReservation(
          buildReservation(),
          '2026-09-01',
          '2026-09-04',
          null,
          '999999',
        ),
      ).rejects.toBeInstanceOf(BadRequestError);

      expect(client.updateReservation).not.toHaveBeenCalled();
    });

    it('allows the same room type to be passed explicitly', async () => {
      await service.modifyReservation(
        buildReservation(),
        '2026-09-01',
        '2026-09-04',
        null,
        '341959',
      );

      expect(client.updateReservation).toHaveBeenCalled();
    });

    it('requires an external id', async () => {
      await expect(
        service.modifyReservation(
          buildReservation({ external_id: undefined }),
          '2026-09-01',
          '2026-09-04',
          null,
        ),
      ).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('cancelReservation', () => {
    it('cancels by setting the status, since Calry has no cancel endpoint', async () => {
      const result = await service.cancelReservation({
        business_id: '212815',
        external_id: '9961197',
        internal_id: 'reservation-uuid-1',
        reason: 'Guest request',
      });

      expect(client.updateReservation).toHaveBeenCalledWith(
        { reservationId: '9961197', status: 'CANCELLED' },
        CREDENTIALS,
      );
      expect(result).toEqual({ status: true, reservation_id: '9961197' });
    });

    it('emits the booking-cancelled KPI', async () => {
      await service.cancelReservation({
        business_id: '212815',
        external_id: '9961197',
        internal_id: 'reservation-uuid-1',
      });

      expect(mockLogKpi).toHaveBeenCalledWith(
        expect.objectContaining({ stat: KpiStat.PmsBookingCancelled }),
      );
    });

    it('requires an external id', async () => {
      await expect(
        service.cancelReservation({
          business_id: '212815',
          external_id: '',
          internal_id: 'reservation-uuid-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('cancelExternalDirectReservation', () => {
    it('routes through the same status update', async () => {
      const result = await service.cancelExternalDirectReservation(
        buildReservation(),
        'Guest request',
      );

      expect(client.updateReservation).toHaveBeenCalledWith(
        { reservationId: '9961197', status: 'CANCELLED' },
        CREDENTIALS,
      );
      expect(result.status).toBe(true);
    });
  });

  describe('getExternalModificationInfo', () => {
    it('reports no change and skips the PMS when the dates are unchanged', async () => {
      const info = await service.getExternalModificationInfo(
        buildReservation(),
        '2026-09-01',
        '2026-09-03',
      );

      expect(info.scenario).toBe('same_dates');
      expect(info.pricingDelta).toBe(0);
      expect(client.getAvailability).not.toHaveBeenCalled();
    });

    it('prices an extension against the stored quote', async () => {
      const reservation = buildReservation({
        quote: { quote_object: { total_amount: 412.5 } },
      } as unknown as Partial<ReservationDTO>);

      const info = await service.getExternalModificationInfo(
        reservation,
        '2026-09-01',
        '2026-09-04',
      );

      expect(info.scenario).toBe('stay_extension');
      expect(info.pricingDelta).toBe(187.5);
      expect(info.available).toBe(true);
    });

    it('reports unavailable when a new night is sold out', async () => {
      client.getAvailability.mockResolvedValue({
        propertyId: '212815',
        roomTypeId: '341959',
        dateWiseAvailability: [
          { date: '2026-09-01', status: 'AVAILABLE', unitsAvailable: 2 },
          { date: '2026-09-02', status: 'AVAILABLE', unitsAvailable: 2 },
          { date: '2026-09-03', status: 'NOT_AVAILABLE', unitsAvailable: 0 },
        ],
      });

      const info = await service.getExternalModificationInfo(
        buildReservation(),
        '2026-09-01',
        '2026-09-04',
      );

      expect(info.available).toBe(false);
      expect(client.getQuote).not.toHaveBeenCalled();
    });

    it('does not count the nights the guest already holds against inventory', async () => {
      client.getAvailability.mockResolvedValue({
        propertyId: '212815',
        roomTypeId: '341959',
        dateWiseAvailability: [
          // Sold out only because this guest holds them.
          { date: '2026-09-01', status: 'NOT_AVAILABLE', unitsAvailable: 0 },
          { date: '2026-09-02', status: 'NOT_AVAILABLE', unitsAvailable: 0 },
          { date: '2026-09-03', status: 'AVAILABLE', unitsAvailable: 1 },
        ],
      });

      const info = await service.getExternalModificationInfo(
        buildReservation(),
        '2026-09-01',
        '2026-09-04',
      );

      expect(info.available).toBe(true);
    });

    it('refuses a room move', async () => {
      await expect(
        service.getExternalModificationInfo(
          buildReservation(),
          '2026-09-01',
          '2026-09-04',
          '999999',
        ),
      ).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('modifyExternalDirectReservation', () => {
    it('applies the new dates when the range is available', async () => {
      await service.modifyExternalDirectReservation(
        buildReservation(),
        '2026-09-01',
        '2026-09-04',
      );

      expect(client.updateReservation).toHaveBeenCalledWith(
        {
          reservationId: '9961197',
          arrivalDate: '2026-09-01',
          departureDate: '2026-09-04',
        },
        CREDENTIALS,
      );
    });

    it('does not touch the PMS when the dates are unchanged', async () => {
      await service.modifyExternalDirectReservation(
        buildReservation(),
        '2026-09-01',
        '2026-09-03',
      );

      expect(client.updateReservation).not.toHaveBeenCalled();
    });
  });
});
