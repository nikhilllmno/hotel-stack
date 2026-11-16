/* global beforeEach, describe, expect, it, jest, setTimeout */
import { SessionType } from '@/dtos/enum/SessionType';
import { NoDataError } from '@/errors/NoDataError';
import { PMSServiceFactory } from '@/pms/PMSServiceFactory';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { PaymentProvider, PmsProvider } from '@/types/enums';
import { CrossSellConfiguration } from '@/types/hotelConfiguration';
import { Knex } from 'knex';

const CALLER = '+15550001111';
const HOTEL_PHONE = RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber;

const HAVEN = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Haven DB name',
  assistant_phone_number: '+15550003333',
  pms_provider: PmsProvider.CLOUDBEDS,
  url: 'https://havenhotel.example',
};
const MANOR = {
  id: '44444444-4444-4444-8444-444444444444',
  name: 'Manor DB name',
  assistant_phone_number: '+15550004444',
  pms_provider: PmsProvider.RESNEXUS,
  url: 'https://manor.example',
};
const GETAWAY = {
  id: '55555555-5555-4555-8555-555555555555',
  name: 'Getaway DB name',
  assistant_phone_number: '+15550005555',
  pms_provider: PmsProvider.STAYNTOUCH,
  url: '',
};

const PARAMS = {
  start_date: '2026-11-20',
  end_date: '2026-11-22',
  num_adults: 4,
  num_children: 1,
  num_pets: 0,
};

const HAVEN_ROOM = {
  'Signature Juliet':
    'For 4 adults and 1 child, with check-in on 2026-11-20 and check-out on 2026-11-22, the Signature Juliet has a total of $612.40.',
};
const MANOR_ROOM = {
  room_id: 7,
  name: 'Balcony King Suite',
  number_of_units_available: 2,
  total_amount: 540,
};

async function seedSisterHotel(knex: Knex, hotel: typeof HAVEN) {
  const now = new Date();
  await knex('hotels').insert({
    ...hotel,
    business_id: 2000 + Number(hotel.id[0]),
    country: 'US',
    currency: '$',
    payment_provider: PaymentProvider.STRIPE,
    timezone: 'America/New_York',
    created_at: now,
    updated_at: now,
  });
}

async function setCrossSell(
  knex: Knex,
  config: CrossSellConfiguration | null,
): Promise<void> {
  await knex('hotel_configurations')
    .where({ hotel_id: RESERVATION_FLOW_FIXTURE_IDS.hotelId })
    .update({
      cross_sell_configuration: config ? JSON.stringify(config) : null,
    });
}

type LiteFn = jest.Mock<Promise<unknown>, unknown[]>;

function pmsStub(result: unknown | (() => Promise<unknown>)) {
  const respond = () =>
    typeof result === 'function'
      ? (result as () => Promise<unknown>)()
      : Promise.resolve(result);
  return {
    getRoomAvailabilityWithQuoteLite: jest.fn(respond) as LiteFn,
    getRoomAvailabilityWithQuoteLiteV2: jest.fn(respond) as LiteFn,
  };
}

function factoryFor(stubs: Record<string, ReturnType<typeof pmsStub>>) {
  return {
    getReservationService: jest.fn(async (hotelId: string) => {
      const stub = stubs[hotelId];
      if (!stub) throw new Error(`no PMS stub for ${hotelId}`);
      return stub;
    }),
  } as unknown as PMSServiceFactory & {
    getReservationService: jest.Mock;
  };
}

describe('RoomReservationService.checkSisterPropertyAvailability', () => {
  const ctx = installPgMemTestContext();

  beforeEach(async () => {
    await seedSisterHotel(ctx.knex, HAVEN);
    await seedSisterHotel(ctx.knex, MANOR);
    await seedSisterHotel(ctx.knex, GETAWAY);
  });

  function buildService(stubs: Record<string, ReturnType<typeof pmsStub>>) {
    const pmsServiceFactory = factoryFor(stubs);
    const { service } = createTestRoomReservationService({
      knex: ctx.knex,
      externalStubs: { pmsServiceFactory },
    });
    return { service, pmsServiceFactory };
  }

  it.each([
    ['there is no cross_sell_configuration', null],
    [
      'cross-sell is disabled',
      {
        enabled: false,
        check_all_sister_properties: true,
        sister_properties: [{ hotel_id: HAVEN.id, name: 'The Haven Hotel' }],
      },
    ],
    [
      'the sister list is empty',
      {
        enabled: true,
        check_all_sister_properties: true,
        sister_properties: [],
      },
    ],
    [
      'the sister list is empty (switch off)',
      { enabled: true, sister_properties: [] },
    ],
    [
      'cross-sell is disabled (switch off)',
      {
        enabled: false,
        sister_properties: [{ hotel_id: HAVEN.id, name: 'The Haven Hotel' }],
      },
    ],
    [
      'the only sister is the hotel itself',
      {
        enabled: true,
        check_all_sister_properties: true,
        sister_properties: [
          { hotel_id: RESERVATION_FLOW_FIXTURE_IDS.hotelId, name: 'Itself' },
        ],
      },
    ],
  ])('says cross-sell is not configured when %s', async (_label, config) => {
    await setCrossSell(ctx.knex, config);
    const { service, pmsServiceFactory } = buildService({});

    await expect(
      service.checkSisterPropertyAvailability(PARAMS, CALLER, HOTEL_PHONE),
    ).resolves.toEqual({
      cross_sell_available: false,
      results: [],
      message: 'Cross-sell is not configured for this hotel.',
    });
    expect(pmsServiceFactory.getReservationService).not.toHaveBeenCalled();
  });

  it('throws NoDataError when the calling hotel is unknown', async () => {
    const { service } = buildService({});
    await expect(
      service.checkSisterPropertyAvailability(PARAMS, CALLER, '+15559999999'),
    ).rejects.toBeInstanceOf(NoDataError);
  });

  it('returns availability and prices for every sister hotel, in configured order', async () => {
    await setCrossSell(ctx.knex, {
      enabled: true,
      check_all_sister_properties: true,
      sister_properties: [
        {
          hotel_id: HAVEN.id,
          name: 'The Haven Hotel',
          distance_miles: 2.5,
          phone_number: '(828) 555-0100',
          website: 'https://havenhotel.co',
        },
        { hotel_id: MANOR.id, name: 'The Blowing Rock Manor' },
      ],
    });
    const haven = pmsStub({ groups: [HAVEN_ROOM], discount: null });
    const manor = pmsStub({ groups: [MANOR_ROOM], discount: null });
    const { service } = buildService({ [HAVEN.id]: haven, [MANOR.id]: manor });

    const result = await service.checkSisterPropertyAvailability(
      PARAMS,
      CALLER,
      HOTEL_PHONE,
    );

    expect(result).toEqual({
      cross_sell_available: true,
      results: [
        {
          hotel_name: 'The Haven Hotel',
          hotel_phone_number: '(828) 555-0100',
          website: 'https://havenhotel.co',
          distance_miles: 2.5,
          available: true,
          groups: [HAVEN_ROOM],
        },
        {
          hotel_name: 'The Blowing Rock Manor',
          website: 'https://manor.example',
          available: true,
          groups: [MANOR_ROOM],
        },
      ],
      message:
        "The Haven Hotel (2.5 miles away, https://havenhotel.co) and The Blowing Rock Manor (https://manor.example) have availability for your dates. Rooms at a sister property can't be booked on this call: give the guest its website or phone number.",
    });
  });

  it("asks each sister hotel's own PMS, as a read-only lite check for the guest's dates and party", async () => {
    await setCrossSell(ctx.knex, {
      enabled: true,
      check_all_sister_properties: true,
      sister_properties: [
        { hotel_id: HAVEN.id, name: 'The Haven Hotel' },
        { hotel_id: MANOR.id, name: 'The Blowing Rock Manor' },
      ],
    });
    const haven = pmsStub({ groups: [] });
    const manor = pmsStub({ groups: [] });
    const { service, pmsServiceFactory } = buildService({
      [HAVEN.id]: haven,
      [MANOR.id]: manor,
    });

    await service.checkSisterPropertyAvailability(
      { ...PARAMS, num_children: undefined, num_pets: undefined },
      CALLER,
      HOTEL_PHONE,
    );

    expect(pmsServiceFactory.getReservationService.mock.calls).toEqual([
      [HAVEN.id],
      [MANOR.id],
    ]);
    const expectedParams = {
      start_date: PARAMS.start_date,
      end_date: PARAMS.end_date,
      num_adults: 4,
      num_children: 0,
      num_pets: 0,
      session_type: SessionType.CALL,
      booking_link: false,
    };
    // Cloudbeds uses the getAvailableRoomTypes path, like the Cloudbeds agents' own tool.
    expect(haven.getRoomAvailabilityWithQuoteLiteV2).toHaveBeenCalledWith(
      expectedParams,
      CALLER,
      HAVEN.assistant_phone_number,
      SessionType.CALL,
    );
    expect(haven.getRoomAvailabilityWithQuoteLite).not.toHaveBeenCalled();
    expect(manor.getRoomAvailabilityWithQuoteLite).toHaveBeenCalledWith(
      expectedParams,
      CALLER,
      MANOR.assistant_phone_number,
      SessionType.CALL,
    );
    expect(manor.getRoomAvailabilityWithQuoteLiteV2).not.toHaveBeenCalled();
  });

  it('returns the other sister hotels plus an error entry when one PMS fails', async () => {
    await setCrossSell(ctx.knex, {
      enabled: true,
      check_all_sister_properties: true,
      sister_properties: [
        { hotel_id: HAVEN.id, name: 'The Haven Hotel' },
        { hotel_id: MANOR.id, name: 'The Blowing Rock Manor' },
      ],
    });
    const haven = pmsStub(() => Promise.reject(new Error('Cloudbeds 503')));
    const manor = pmsStub({ groups: [MANOR_ROOM] });
    const { service } = buildService({ [HAVEN.id]: haven, [MANOR.id]: manor });

    const result = await service.checkSisterPropertyAvailability(
      PARAMS,
      CALLER,
      HOTEL_PHONE,
    );

    expect(result.cross_sell_available).toBe(true);
    expect(result.results).toEqual([
      {
        hotel_name: 'The Haven Hotel',
        website: 'https://havenhotel.example',
        available: false,
        error: 'Availability check failed for this property.',
      },
      {
        hotel_name: 'The Blowing Rock Manor',
        website: 'https://manor.example',
        available: true,
        groups: [MANOR_ROOM],
      },
    ]);
  });

  it('gives up on a sister hotel that takes longer than timeout_ms and still answers for the rest', async () => {
    await setCrossSell(ctx.knex, {
      enabled: true,
      check_all_sister_properties: true,
      timeout_ms: 50,
      sister_properties: [
        { hotel_id: HAVEN.id, name: 'The Haven Hotel' },
        { hotel_id: MANOR.id, name: 'The Blowing Rock Manor' },
      ],
    });
    const haven = pmsStub(() => new Promise(() => {}));
    const manor = pmsStub({ groups: [] });
    const { service } = buildService({ [HAVEN.id]: haven, [MANOR.id]: manor });

    const startedAt = Date.now();
    const result = await service.checkSisterPropertyAvailability(
      PARAMS,
      CALLER,
      HOTEL_PHONE,
    );

    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(result).toEqual({
      cross_sell_available: false,
      results: [
        {
          hotel_name: 'The Haven Hotel',
          website: 'https://havenhotel.example',
          available: false,
          error: 'Availability check timed out for this property.',
        },
        {
          hotel_name: 'The Blowing Rock Manor',
          website: 'https://manor.example',
          available: false,
        },
      ],
      message:
        "None of the other sister properties have availability for your dates. Availability couldn't be checked at The Haven Hotel (https://havenhotel.example) right now; the guest can check its website or call it directly.",
    });
  });

  it("doesn't start the PMS check for a sister hotel whose lookup outlasted timeout_ms", async () => {
    await setCrossSell(ctx.knex, {
      enabled: true,
      check_all_sister_properties: true,
      timeout_ms: 50,
      sister_properties: [{ hotel_id: HAVEN.id, name: 'The Haven Hotel' }],
    });
    const haven = pmsStub({ groups: [HAVEN_ROOM] });
    const { service, pmsServiceFactory } = buildService({ [HAVEN.id]: haven });
    const { hotelService } = service as unknown as {
      hotelService: { getHotelById: (id: string) => Promise<unknown> };
    };
    const realGetHotelById = hotelService.getHotelById.bind(hotelService);
    jest
      .spyOn(hotelService, 'getHotelById')
      .mockImplementation(
        (id: string) =>
          new Promise((resolve) =>
            setTimeout(() => resolve(realGetHotelById(id)), 150),
          ),
      );

    const result = await service.checkSisterPropertyAvailability(
      PARAMS,
      CALLER,
      HOTEL_PHONE,
    );
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(result.results).toEqual([
      {
        hotel_name: 'The Haven Hotel',
        available: false,
        error: 'Availability check timed out for this property.',
      },
    ]);
    expect(pmsServiceFactory.getReservationService).not.toHaveBeenCalled();
    expect(haven.getRoomAvailabilityWithQuoteLiteV2).not.toHaveBeenCalled();
  });

  it('reports a sister hotel id that is not in Daisy as an error entry', async () => {
    await setCrossSell(ctx.knex, {
      enabled: true,
      check_all_sister_properties: true,
      sister_properties: [
        {
          hotel_id: '99999999-9999-4999-8999-999999999999',
          name: 'Not Onboarded Inn',
          website: 'https://notonboarded.example',
        },
      ],
    });
    const { service } = buildService({});

    await expect(
      service.checkSisterPropertyAvailability(PARAMS, CALLER, HOTEL_PHONE),
    ).resolves.toEqual({
      cross_sell_available: false,
      results: [
        {
          hotel_name: 'Not Onboarded Inn',
          website: 'https://notonboarded.example',
          available: false,
          error: 'Availability check failed for this property.',
        },
      ],
      message:
        "Availability couldn't be checked at Not Onboarded Inn (https://notonboarded.example) right now; the guest can check its website or call it directly.",
    });
  });

  it('treats Stayntouch restriction-only groups as no availability, and passes date corrections through', async () => {
    await setCrossSell(ctx.knex, {
      enabled: true,
      check_all_sister_properties: true,
      sister_properties: [{ hotel_id: GETAWAY.id, name: 'The Getaway' }],
    });
    const getaway = pmsStub({
      groups: [
        {
          Townhome:
            'The Townhome is not available due to a 3-night minimum stay.',
        },
      ],
      date_correction_details: 'Check-in moved to today.',
    });
    const { service } = buildService({ [GETAWAY.id]: getaway });

    await expect(
      service.checkSisterPropertyAvailability(PARAMS, CALLER, HOTEL_PHONE),
    ).resolves.toEqual({
      cross_sell_available: false,
      results: [
        {
          hotel_name: 'The Getaway',
          available: false,
          date_correction_details: 'Check-in moved to today.',
        },
      ],
      message:
        'Unfortunately, none of the nearby sister properties have availability for your dates either.',
    });
  });

  it('skips the calling hotel if it is listed as its own sister', async () => {
    await setCrossSell(ctx.knex, {
      enabled: true,
      check_all_sister_properties: true,
      sister_properties: [
        { hotel_id: RESERVATION_FLOW_FIXTURE_IDS.hotelId, name: 'Itself' },
        { hotel_id: MANOR.id, name: 'The Blowing Rock Manor' },
      ],
    });
    const manor = pmsStub({ groups: [MANOR_ROOM] });
    const { service, pmsServiceFactory } = buildService({ [MANOR.id]: manor });

    const result = await service.checkSisterPropertyAvailability(
      PARAMS,
      CALLER,
      HOTEL_PHONE,
    );

    expect(result.results.map((r) => r.hotel_name)).toEqual([
      'The Blowing Rock Manor',
    ]);
    expect(pmsServiceFactory.getReservationService).toHaveBeenCalledTimes(1);
  });

  describe('without check_all_sister_properties (the original check, as Giri uses it)', () => {
    it.each([
      ['missing', undefined],
      ['false', false],
    ])(
      'with the switch %s, checks one sister hotel at a time with the lite check and stops at the first with a room',
      async (_label, checkAll) => {
        await setCrossSell(ctx.knex, {
          enabled: true,
          ...(checkAll !== undefined && {
            check_all_sister_properties: checkAll,
          }),
          sister_properties: [
            {
              hotel_id: HAVEN.id,
              name: 'The Haven Hotel',
              phone_number: '(828) 555-0100',
              website: 'https://havenhotel.co',
            },
            {
              hotel_id: MANOR.id,
              name: 'The Blowing Rock Manor',
              distance_miles: 1.2,
            },
            { hotel_id: GETAWAY.id, name: 'The Getaway' },
          ],
        });
        const haven = pmsStub({ groups: [] });
        const manor = pmsStub({ groups: [MANOR_ROOM] });
        const getaway = pmsStub({ groups: [HAVEN_ROOM] });
        const { service, pmsServiceFactory } = buildService({
          [HAVEN.id]: haven,
          [MANOR.id]: manor,
          [GETAWAY.id]: getaway,
        });

        await expect(
          service.checkSisterPropertyAvailability(PARAMS, CALLER, HOTEL_PHONE),
        ).resolves.toEqual({
          cross_sell_available: true,
          results: [
            {
              hotel_name: 'The Haven Hotel',
              hotel_phone_number: '(828) 555-0100',
              available: false,
            },
            {
              hotel_name: 'The Blowing Rock Manor',
              distance_miles: 1.2,
              available: true,
              groups: [MANOR_ROOM],
            },
          ],
          message:
            'The Blowing Rock Manor (1.2 miles away) has availability for your dates.',
        });
        expect(pmsServiceFactory.getReservationService.mock.calls).toEqual([
          [HAVEN.id],
          [MANOR.id],
        ]);
        // The original check uses the lite path for every PMS, Cloudbeds included.
        expect(haven.getRoomAvailabilityWithQuoteLite).toHaveBeenCalledWith(
          {
            start_date: PARAMS.start_date,
            end_date: PARAMS.end_date,
            num_adults: 4,
            num_children: 1,
            num_pets: 0,
            session_type: SessionType.CALL,
            booking_link: false,
          },
          CALLER,
          HAVEN.assistant_phone_number,
          SessionType.CALL,
        );
        expect(haven.getRoomAvailabilityWithQuoteLiteV2).not.toHaveBeenCalled();
        expect(getaway.getRoomAvailabilityWithQuoteLite).not.toHaveBeenCalled();
      },
    );

    it('keeps the original error entry and goes on to the next sister hotel when one PMS fails', async () => {
      await setCrossSell(ctx.knex, {
        enabled: true,
        timeout_ms: 1000,
        sister_properties: [
          { hotel_id: HAVEN.id, name: 'The Haven Hotel' },
          { hotel_id: MANOR.id, name: 'The Blowing Rock Manor' },
        ],
      });
      const haven = pmsStub(() => Promise.reject(new Error('Cloudbeds 503')));
      const manor = pmsStub({ groups: [] });
      const { service } = buildService({
        [HAVEN.id]: haven,
        [MANOR.id]: manor,
      });

      await expect(
        service.checkSisterPropertyAvailability(PARAMS, CALLER, HOTEL_PHONE),
      ).resolves.toEqual({
        cross_sell_available: false,
        results: [
          {
            hotel_name: 'The Haven Hotel',
            available: false,
            error: 'Availability check failed for this property.',
          },
          { hotel_name: 'The Blowing Rock Manor', available: false },
        ],
        message:
          'Unfortunately, none of the nearby sister properties have availability for your dates either.',
      });
    });
  });
});
