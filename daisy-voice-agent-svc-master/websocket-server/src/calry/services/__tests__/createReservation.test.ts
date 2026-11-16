jest.mock('@/calry/services/calryCredentials', () => ({
  resolveCalryCredentials: jest.fn(),
}));

jest.mock('@/services/hotelConfiguration/hotelConfigurationService', () => ({
  hotelConfigurationService: {
    getHotelConfigurationByHotelId: jest.fn().mockResolvedValue(null),
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
import { CalryCredentials, CalryReservation } from '@/calry/types';
import { Customer } from '@/dtos/Customer';
import { Quote } from '@/dtos/Quote';
import { Reservation as ReservationDTO } from '@/dtos/Reservation';
import { CreateReservationParams } from '@/pms/types/IPMSReservationService';
import { KpiStat, logKpi } from '@/utils/kpiLogger';

const CREDENTIALS: CalryCredentials = {
  propertyId: '212815',
  apiToken: 'calry_token_abc',
  workspaceId: 'workspace-1',
  integrationAccountId: 'integration-account-1',
  hotelId: 'hotel-uuid-1',
};

const mockResolveCredentials = resolveCalryCredentials as jest.Mock;
const mockLogKpi = logKpi as jest.Mock;

function buildCreated(overrides: Partial<CalryReservation> = {}) {
  return {
    id: '9961197',
    arrivalDate: '2026-09-01',
    departureDate: '2026-09-03',
    status: 'CONFIRMED',
    totalPrice: 412.5,
    currency: 'USD',
    finances: { totalPrice: 412.5, currency: 'USD' },
    ...overrides,
  } as CalryReservation;
}

function buildParams(
  overrides: Partial<CreateReservationParams> = {},
): CreateReservationParams {
  const reservation = {
    id: 'reservation-uuid-1',
    booking_id: 'DEXTR-1',
    hotel_id: 'hotel-uuid-1',
    business_id: '212815',
    room_id: '341959',
    check_in: new Date('2026-09-01T00:00:00.000Z'),
    check_out: new Date('2026-09-03T00:00:00.000Z'),
    num_adults: 2,
    num_children: 1,
    num_pets: 1,
    customer_special_request: 'Late arrival',
    hotel: { currency: 'USD', assistant_phone_number: '+15551234567' },
  } as unknown as ReservationDTO;

  const customer = {
    first_name: 'Alice',
    last_name: 'Johnson',
    email: 'alice@example.com',
    phone_number: '+19876543210',
    address: {
      address_first_line: '456 Oak Lane',
      city: 'Laketown',
      state_or_province: 'Lakestate',
      postal_code: '67890',
      country: 'US',
    },
  } as Customer;

  const quote = {
    total_amount: 412.5,
    quote_object: { currency: 'USD' },
  } as unknown as Quote;

  return {
    reservation,
    customer,
    quote,
    notes_from_partner: 'Number of Pets = 1;',
    ...overrides,
  };
}

describe('CalryReservationService.createReservation', () => {
  let client: { createReservation: jest.Mock };
  let service: CalryReservationService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveCredentials.mockResolvedValue(CREDENTIALS);
    client = { createReservation: jest.fn().mockResolvedValue(buildCreated()) };
    service = new CalryReservationService(client as never);
  });

  it('maps the reservation and customer onto Calry write-side field names', async () => {
    await service.createReservation(buildParams());

    expect(client.createReservation).toHaveBeenCalledWith(
      {
        propertyId: '212815',
        roomTypeId: '341959',
        arrivalDate: '2026-09-01',
        departureDate: '2026-09-03',
        guest: {
          firstName: 'Alice',
          lastName: 'Johnson',
          email: 'alice@example.com',
          phone: '+19876543210',
          address: {
            line1: '456 Oak Lane',
            city: 'Laketown',
            state: 'Lakestate',
            postalCode: '67890',
            country: 'US',
          },
        },
        status: 'confirmed',
        numberOfGuests: 3,
        numberOfAdults: 2,
        numberOfChildren: 1,
        numberOfPets: 1,
        totalPrice: 412.5,
        currency: 'USD',
        notes: 'Number of Pets = 1;',
        comments: 'Late arrival',
      },
      CREDENTIALS,
    );
  });

  it('returns the Calry reservation id as both the internal and public identifier', async () => {
    const result = await service.createReservation(buildParams());

    expect(result).toEqual({
      reservation_id: '9961197',
      external_public_id: '9961197',
      notes_from_partner: 'Number of Pets = 1;',
    });
  });

  it('emits the booking-created KPI', async () => {
    await service.createReservation(buildParams());

    expect(mockLogKpi).toHaveBeenCalledWith(
      expect.objectContaining({
        stat: KpiStat.PmsBookingCreated,
        contextId: '9961197',
      }),
    );
  });

  it('does not flag a price mismatch when the PMS booked the quoted total', async () => {
    await service.createReservation(buildParams());

    expect(mockLogKpi).not.toHaveBeenCalledWith(
      expect.objectContaining({ stat: KpiStat.PmsQuotedPriceMismatch }),
    );
  });

  it('flags a price mismatch when the PMS applied a different rate than the one quoted', async () => {
    client.createReservation.mockResolvedValue(
      buildCreated({ finances: { totalPrice: 470 } }),
    );

    const result = await service.createReservation(buildParams());

    // The booking still succeeds — the guest has already been told it is
    // confirmed — but the drift is recorded.
    expect(result.reservation_id).toBe('9961197');
    expect(mockLogKpi).toHaveBeenCalledWith(
      expect.objectContaining({
        stat: KpiStat.PmsQuotedPriceMismatch,
        contextId: '9961197',
      }),
    );
  });

  it('ignores sub-cent differences between the quoted and booked totals', async () => {
    client.createReservation.mockResolvedValue(
      buildCreated({ finances: { totalPrice: 412.5049 } }),
    );

    await service.createReservation(buildParams());

    expect(mockLogKpi).not.toHaveBeenCalledWith(
      expect.objectContaining({ stat: KpiStat.PmsQuotedPriceMismatch }),
    );
  });

  it('cannot check the price when Calry returns no total, and does not guess', async () => {
    client.createReservation.mockResolvedValue(
      buildCreated({ finances: undefined, totalPrice: undefined }),
    );

    await service.createReservation(buildParams());

    expect(mockLogKpi).not.toHaveBeenCalledWith(
      expect.objectContaining({ stat: KpiStat.PmsQuotedPriceMismatch }),
    );
  });

  it('omits notes and comments when there are none', async () => {
    await service.createReservation(
      buildParams({
        notes_from_partner: undefined,
        reservation: {
          ...buildParams().reservation,
          customer_special_request: undefined,
        },
      }),
    );

    const payload = client.createReservation.mock.calls[0][0];
    expect(payload).not.toHaveProperty('notes');
    expect(payload).not.toHaveProperty('comments');
  });
});
