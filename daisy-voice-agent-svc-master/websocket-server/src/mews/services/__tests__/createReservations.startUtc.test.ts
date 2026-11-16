jest.mock('@/mews/client/MewsClient', () => ({
  mewsClient: {
    getAgeCategories: jest.fn(),
    getResourceCategories: jest.fn(),
    getRates: jest.fn(),
    addReservations: jest.fn(),
  },
}));

import { Reservation as ReservationDTO } from '@/dtos/Reservation';
import { mewsClient } from '@/mews/client/MewsClient';
import { MewsPastStartUtcError } from '@/mews/errors';
import { MewsReservationService } from '@/mews/services/reservationService';
import {
  MewsAgeCategory,
  MewsCredentials,
  MewsRate,
  MewsResourceCategory,
  MewsService,
} from '@/mews/types';
import { Hotel } from '@/models/Hotel';
import { CreateReservationParams } from '@/pms/types/IPMSReservationService';
import { HotelService } from '@/services/hotel/hotelService';

const HOTEL_ID = 'hotel-1';
const SERVICE_ID = 'service-stay';
const OTHER_SERVICE_ID = 'service-apartment';
const CATEGORY_ID = 'category-double-queen';
const OTHER_CATEGORY_ID = 'category-apartment';
const RATE_ID = 'rate-standard';
const AGE_CATEGORY_ID = 'age-adult';

const CREDENTIALS: MewsCredentials = {
  clientToken: 'ct',
  accessToken: 'at',
  client: 'Test 1.0.0',
};

function buildService(
  id: string,
  startOffset: string | null,
  timeUnitPeriod = 'Day',
): MewsService {
  return {
    Id: id,
    EnterpriseId: 'enterprise-1',
    IsActive: true,
    Names: { 'en-US': 'Stay' },
    Data: {
      Discriminator: 'Bookable',
      Value: {
        ...(startOffset !== null && { StartOffset: startOffset }),
        EndOffset: 'P0M0DT11H0M0S',
        TimeUnitPeriod: timeUnitPeriod,
      },
    },
  };
}

function buildHotel(): Hotel {
  return {
    id: HOTEL_ID,
    timezone: 'America/New_York',
    assistant_phone_number: '+15550000001',
  } as Hotel;
}

function buildReservation(
  overrides: Partial<ReservationDTO> = {},
): ReservationDTO {
  return {
    id: 'reservation-1',
    booking_id: 'BK1001',
    hotel_id: HOTEL_ID,
    room_id: CATEGORY_ID,
    check_in: '2026-09-15',
    check_out: '2026-09-16',
    num_adults: 2,
    num_children: 0,
    payments: [{ metadata: { mews_account_id: 'customer-1' } }],
    quote: { quote_object: { rate_id: RATE_ID } },
    ...overrides,
  } as unknown as ReservationDTO;
}

function toParams(reservation: ReservationDTO): CreateReservationParams {
  return {
    reservation,
    customer: reservation.customer,
    quote: reservation.quote!,
  } as unknown as CreateReservationParams;
}

function buildCategory(id: string, serviceId: string): MewsResourceCategory {
  return { Id: id, ServiceId: serviceId } as MewsResourceCategory;
}

function makeService(): MewsReservationService {
  const hotelService = {
    getHotelById: jest.fn().mockResolvedValue(buildHotel()),
  } as unknown as HotelService;
  return new MewsReservationService(hotelService);
}

/** The payload the service handed to reservations/add. */
function capturedReservations() {
  return (mewsClient.addReservations as jest.Mock).mock.calls[0][0]
    .Reservations;
}

beforeEach(() => {
  jest.clearAllMocks();

  // Pin "now" to the start of the check-in day so the service's
  // assertReservationStartsInFuture guard treats the hardcoded StartUtc values
  // (midnight and 15:00 America/New_York on 2026-09-15) as future, regardless
  // of when this suite actually runs.
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-15T00:00:00.000Z'));

  (mewsClient.getAgeCategories as jest.Mock).mockResolvedValue([
    {
      Id: AGE_CATEGORY_ID,
      ServiceId: SERVICE_ID,
      Classification: 'Adult',
    },
    {
      Id: AGE_CATEGORY_ID,
      ServiceId: OTHER_SERVICE_ID,
      Classification: 'Adult',
    },
  ] as unknown as MewsAgeCategory[]);

  (mewsClient.getResourceCategories as jest.Mock).mockResolvedValue([
    buildCategory(CATEGORY_ID, SERVICE_ID),
    buildCategory(OTHER_CATEGORY_ID, OTHER_SERVICE_ID),
  ]);

  (mewsClient.getRates as jest.Mock).mockResolvedValue([
    {
      Id: RATE_ID,
      ServiceId: SERVICE_ID,
      IsActive: true,
      IsEnabled: true,
      IsDefault: true,
    },
    {
      Id: RATE_ID,
      ServiceId: OTHER_SERVICE_ID,
      IsActive: true,
      IsEnabled: true,
      IsDefault: true,
    },
  ] as unknown as MewsRate[]);

  (mewsClient.addReservations as jest.Mock).mockResolvedValue({
    Reservations: [
      {
        Identifier: 'BK1001',
        Reservation: { Id: 'mews-res-1', Number: '1001' },
      },
      {
        Identifier: 'BK1002',
        Reservation: { Id: 'mews-res-2', Number: '1002' },
      },
    ],
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('createReservations StartUtc', () => {
  it("uses the service's StartOffset for StartUtc and leaves EndUtc on the unit boundary", async () => {
    await makeService().createReservations(
      [toParams(buildReservation())],
      CREDENTIALS,
      [buildService(SERVICE_ID, 'P0M0DT15H0M0S')],
      true,
    );

    const [item] = capturedReservations();
    // 15:00 America/New_York on the check-in date, not local midnight.
    expect(item.StartUtc).toBe('2026-09-15T19:00:00.000Z');
    expect(item.EndUtc).toBe('2026-09-16T04:00:00.000Z');
  });

  it('applies the same StartUtc to an attached pet product', async () => {
    await makeService().createReservations(
      [
        toParams(
          buildReservation({
            quote: {
              quote_object: {
                rate_id: RATE_ID,
                pet_product_id: 'pet-product-1',
                pet_product_count: 2,
              },
            },
          } as unknown as Partial<ReservationDTO>),
        ),
      ],
      CREDENTIALS,
      [buildService(SERVICE_ID, 'P0M0DT15H0M0S')],
      true,
    );

    const [item] = capturedReservations();
    expect(item.ProductOrders[0].StartUtc).toBe(item.StartUtc);
    expect(item.ProductOrders[0].EndUtc).toBe(item.EndUtc);
  });

  it('falls back to hotel midnight when the offset is missing', async () => {
    await makeService().createReservations(
      [toParams(buildReservation())],
      CREDENTIALS,
      [buildService(SERVICE_ID, null)],
      true,
    );

    expect(capturedReservations()[0].StartUtc).toBe('2026-09-15T04:00:00.000Z');
    expect(mewsClient.addReservations).toHaveBeenCalled();
  });

  it('falls back to hotel midnight when the offset is unparseable', async () => {
    await makeService().createReservations(
      [toParams(buildReservation())],
      CREDENTIALS,
      [buildService(SERVICE_ID, 'not-a-duration')],
      true,
    );

    expect(capturedReservations()[0].StartUtc).toBe('2026-09-15T04:00:00.000Z');
    expect(mewsClient.addReservations).toHaveBeenCalled();
  });

  // Offsets are resolved per room inside the loop. A cross-service group would
  // be the interesting case, but createReservations rejects those outright, so
  // this only pins that every room in the group gets the offset applied.
  it('applies the offset to every room in a multi-room group', async () => {
    const service = makeService();
    (mewsClient.getResourceCategories as jest.Mock).mockResolvedValue([
      buildCategory(CATEGORY_ID, SERVICE_ID),
      buildCategory(OTHER_CATEGORY_ID, SERVICE_ID),
    ]);

    await service.createReservations(
      [
        toParams(buildReservation()),
        toParams(
          buildReservation({
            id: 'reservation-2',
            booking_id: 'BK1002',
            room_id: OTHER_CATEGORY_ID,
          }),
        ),
      ],
      CREDENTIALS,
      [buildService(SERVICE_ID, 'P0M0DT15H0M0S')],
      true,
    );

    const items = capturedReservations();
    expect(items).toHaveLength(2);
    expect(items[0].StartUtc).toBe('2026-09-15T19:00:00.000Z');
    expect(items[1].StartUtc).toBe('2026-09-15T19:00:00.000Z');
  });

  it('ignores the offset when the time unit is not Day', async () => {
    await makeService().createReservations(
      [toParams(buildReservation())],
      CREDENTIALS,
      [buildService(SERVICE_ID, 'P0M0DT15H0M0S', 'Hour')],
      true,
    );

    expect(capturedReservations()[0].StartUtc).toBe('2026-09-15T04:00:00.000Z');
  });

  it('refuses to call Mews when the computed start has already passed', async () => {
    await expect(
      makeService().createReservations(
        [
          toParams(
            buildReservation({
              check_in: '2020-01-10',
              check_out: '2020-01-11',
            } as unknown as Partial<ReservationDTO>),
          ),
        ],
        CREDENTIALS,
        [buildService(SERVICE_ID, 'P0M0DT15H0M0S')],
        true,
      ),
    ).rejects.toThrow(MewsPastStartUtcError);

    expect(mewsClient.addReservations).not.toHaveBeenCalled();
  });
});
