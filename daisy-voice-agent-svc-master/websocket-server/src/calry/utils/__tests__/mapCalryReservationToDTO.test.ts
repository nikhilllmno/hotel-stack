import { CalryReservation } from '@/calry/types';
import { mapCalryReservationToDTO } from '@/calry/utils/mapCalryReservationToDTO';
import { ReservationSource } from '@/dtos/enum/ReservationSource';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import { Hotel } from '@/models/Hotel';
import { PmsProvider } from '@/types/enums';

const HOTEL = {
  id: 'hotel-uuid-1',
  business_id: '212815',
  currency: 'USD',
  pms_provider: 'calry',
} as unknown as Hotel;

function buildCalryReservation(
  overrides: Partial<CalryReservation> = {},
): CalryReservation {
  return {
    id: '23609077',
    createdAt: '2026-01-23T22:30:18.000Z',
    updatedAt: '2026-01-23T22:30:18.000Z',
    arrivalDate: '2026-09-01',
    departureDate: '2026-09-03',
    roomTypeIds: ['341959'],
    numberOfGuests: 3,
    numberOfAdults: 2,
    numberOfChildren: 1,
    numberOfPets: 1,
    status: 'CONFIRMED',
    source: 'DIRECT',
    totalPrice: 950,
    currency: 'USD',
    notes: 'Need a crib',
    primaryGuest: {
      nameFirst: 'Alice',
      nameLast: 'Johnson',
      emails: ['alice@example.com'],
      mobileNumbers: ['+19876543210'],
      addresses: {
        line1: '456 Oak Lane',
        city: 'Laketown',
        state: 'Lakestate',
        postal_code: '67890',
        country: 'US',
      },
    },
    ...overrides,
  };
}

describe('mapCalryReservationToDTO', () => {
  it('maps the core reservation fields', () => {
    const dto = mapCalryReservationToDTO(buildCalryReservation(), HOTEL, null);

    expect(dto).toMatchObject({
      id: '23609077',
      booking_id: '23609077',
      external_id: '23609077',
      external_public_id: '23609077',
      room_id: '341959',
      business_id: '212815',
      hotel_id: 'hotel-uuid-1',
      pms_provider: PmsProvider.CALRY,
      type: SessionType.EXTERNAL,
      status: ReservationStatus.ACTIVE,
      num_adults: 2,
      num_children: 1,
      num_pets: 1,
      notes_from_partner: 'Need a crib',
    });
    expect(dto.check_in.toISOString()).toContain('2026-09-01');
    expect(dto.check_out.toISOString()).toContain('2026-09-03');
  });

  it('translates the read-side guest field names onto the customer', () => {
    const dto = mapCalryReservationToDTO(buildCalryReservation(), HOTEL, null);

    expect(dto.customer).toEqual({
      phone_number: '+19876543210',
      hotel_id: 'hotel-uuid-1',
      first_name: 'Alice',
      last_name: 'Johnson',
      email: 'alice@example.com',
      address: {
        address_first_line: '456 Oak Lane',
        city: 'Laketown',
        state_or_province: 'Lakestate',
        postal_code: '67890',
        country: 'US',
      },
      billing_address: null,
    });
  });

  it('carries no rate identity, since Calry cannot bind one', () => {
    const dto = mapCalryReservationToDTO(buildCalryReservation(), HOTEL, null);

    expect(dto.rate_code).toBeNull();
    expect(dto.rate_id).toBeNull();
  });

  it.each([
    ['CANCELLED', ReservationStatus.CANCELLED],
    ['cancelled', ReservationStatus.CANCELLED],
    ['confirmed', ReservationStatus.ACTIVE],
    ['CONFIRMED', ReservationStatus.ACTIVE],
    ['new', ReservationStatus.INACTIVE],
    ['INQUIRY', ReservationStatus.INACTIVE],
  ])('normalises the case-inconsistent status %s', (status, expected) => {
    const dto = mapCalryReservationToDTO(
      buildCalryReservation({ status }),
      HOTEL,
      null,
    );

    expect(dto.status).toBe(expected);
  });

  it.each([
    ['DIRECT', ReservationSource.DIRECT_HOTEL_RESERVATION],
    ['direct', ReservationSource.DIRECT_HOTEL_RESERVATION],
    ['AIRBNB', ReservationSource.THIRD_PARTY_RESERVATION],
    [undefined, ReservationSource.THIRD_PARTY_RESERVATION],
  ])('normalises the source %s', (source, expected) => {
    const dto = mapCalryReservationToDTO(
      buildCalryReservation({ source }),
      HOTEL,
      null,
    );

    expect(dto.reservation_source).toBe(expected);
  });

  it('tolerates a reservation with no guest block', () => {
    const dto = mapCalryReservationToDTO(
      buildCalryReservation({ primaryGuest: undefined }),
      HOTEL,
      null,
    );

    expect(dto.customer).toEqual({
      phone_number: '',
      hotel_id: 'hotel-uuid-1',
    });
  });

  it('leaves the address null when the guest has none', () => {
    const dto = mapCalryReservationToDTO(
      buildCalryReservation({
        primaryGuest: { nameFirst: 'Alice', mobileNumbers: ['+19876543210'] },
      }),
      HOTEL,
      null,
    );

    expect(dto.customer.address).toBeNull();
  });

  it('falls back to the guest count when adults are not broken out', () => {
    const dto = mapCalryReservationToDTO(
      buildCalryReservation({ numberOfAdults: undefined }),
      HOTEL,
      null,
    );

    expect(dto.num_adults).toBe(3);
  });

  it('refuses a reservation with an unusable arrival date', () => {
    expect(() =>
      mapCalryReservationToDTO(
        buildCalryReservation({ arrivalDate: '' }),
        HOTEL,
        null,
      ),
    ).toThrow(/Invalid arrivalDate/);
  });
});
