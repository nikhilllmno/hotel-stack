import { CloudbedsReservationService } from '@/cloudbeds/services/reservationService';
import { CloudbedsGetReservationResponseData } from '@/cloudbeds/types';
import config from '@/config';
import { PaymentStatus } from '@/dtos/enum/PaymentStatus';
import { ReservationSource } from '@/dtos/enum/ReservationSource';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import { DoorCodeRestrictedError } from '@/errors/DoorCodeRestrictedError';

import { HotelRepository } from '@/repositories/HotelRepository';
import {
  AlfredService,
  DoorCodeGuardContext,
  GetByExternalPartnerParams,
  GetByLastNameAndCheckoutParams,
} from '@/services/alfred/alfredService';
import { HotelService } from '@/services/hotel/hotelService';
import { HotelConfigurationService } from '@/services/hotelConfiguration/hotelConfigurationService';
import { RoomReservationService } from '@/services/roomReservation/roomReservationService';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import { seedOtherHotel } from '@/test/fixtures/reservationSeedFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { PmsProvider } from '@/types/enums';
import { AxiosInstance } from 'axios';
import dayjs from 'dayjs';
import { Knex } from 'knex';
import { randomUUID as uuidv4 } from 'node:crypto';

const PROSPECTOR_INN_ID = RESERVATION_FLOW_FIXTURE_IDS.hotelId;
const PROSPECTOR_INN_PHONE = RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber;
const CUSTOMER_PHONE = '+15559876543';
const RATE = 200;
const REJECTED_MESSAGE =
  'Door code unavailable until the reservation is fully paid';
const NO_RESERVATION_MESSAGE =
  'Door code unavailable — no matching reservation found';

interface SeedGuestReservationParams {
  checkIn: string;
  checkOut: string;
  lastName: string;
  externalId?: string;
  amountCharged?: number;
  paymentStatus?: PaymentStatus;
  status?: ReservationStatus;
}

async function seedGuestReservation(
  knex: Knex,
  params: SeedGuestReservationParams,
): Promise<{ bookingId: string }> {
  const now = new Date();
  const customerId = uuidv4();
  const reservationId = uuidv4();
  const bookingId = `BK-${reservationId.slice(0, 8)}`.toUpperCase();

  await knex('customers').insert({
    created_at: now,
    first_name: 'Test',
    hotel_id: PROSPECTOR_INN_ID,
    id: customerId,
    last_name: params.lastName,
    phone_number: CUSTOMER_PHONE,
    updated_at: now,
  });

  await knex('reservations').insert({
    booking_id: bookingId,
    business_id: Number(RESERVATION_FLOW_FIXTURE_IDS.businessId),
    check_in: params.checkIn,
    check_out: params.checkOut,
    created_at: now,
    customer_id: customerId,
    external_id: params.externalId ?? null,
    hotel_id: PROSPECTOR_INN_ID,
    id: reservationId,
    num_adults: 2,
    num_children: 0,
    phone_number: CUSTOMER_PHONE,
    room_id: 101,
    room_type: 'Standard',
    source: ReservationSource.DIRECT_HOTEL_RESERVATION,
    status: params.status ?? ReservationStatus.ACTIVE,
    type: SessionType.CALL,
    updated_at: now,
  });

  await knex('quotes').insert({
    id: uuidv4(),
    reservation_id: reservationId,
    base_rate: RATE,
    taxes: 0,
    fees: 0,
    amount_charged: RATE,
    quote_object: JSON.stringify({}),
    created_at: now,
    updated_at: now,
  });

  if (params.amountCharged !== undefined) {
    const paymentId = uuidv4();
    await knex('payments').insert({
      amount_charged: params.amountCharged,
      booking_confirmation_id: bookingId,
      created_at: now,
      currency: 'USD',
      hotel_id: PROSPECTOR_INN_ID,
      id: paymentId,
      notification_count: 0,
      payment_link: '',
      payment_link_id: '',
      payment_provider: 'STRIPE',
      payment_status: params.paymentStatus ?? PaymentStatus.COMPLETED,
      updated_at: now,
    });

    await knex('payment_reservations').insert({
      created_at: now,
      id: uuidv4(),
      payment_id: paymentId,
      reservation_id: reservationId,
      updated_at: now,
    });
  }

  return { bookingId };
}

function cloudbedsReservation(
  overrides: Partial<CloudbedsGetReservationResponseData> = {},
): CloudbedsGetReservationResponseData {
  return {
    reservationID: 'CB-1',
    status: 'checked_out',
    balance: 0,
    startDate: dayjs().add(1, 'day').format('YYYY-MM-DD'),
    endDate: dayjs().add(3, 'day').format('YYYY-MM-DD'),
    ...overrides,
  } as CloudbedsGetReservationResponseData;
}

describe('AlfredService.getDoorCodeByExternalPartner', () => {
  const ctx = installPgMemTestContext();
  let mockClient: jest.Mocked<Pick<AxiosInstance, 'get'>>;
  let hotelService: HotelService;
  let roomReservationService: RoomReservationService;
  let service: AlfredService;
  let cloudbedsReservationService: CloudbedsReservationService;
  let mockHotelConfigurationService: jest.Mocked<
    Pick<HotelConfigurationService, 'getHotelConfigurationByHotelId'>
  >;

  const externalIdParams: GetByExternalPartnerParams = {
    externalPartnerId: '9001',
    tenantId: 'prop_3fb02a4a-a393-4601-80ad-c43edb5bb5f7',
  };

  function lastNameParams(
    overrides: Partial<GetByLastNameAndCheckoutParams> = {},
  ): GetByLastNameAndCheckoutParams {
    return {
      lastName: 'Rivera',
      checkoutDate: dayjs().add(3, 'day').format('YYYY-MM-DD'),
      tenantId: 'prop_3fb02a4a-a393-4601-80ad-c43edb5bb5f7',
      ...overrides,
    };
  }

  const guardContext: DoorCodeGuardContext = {
    assistantPhoneNumber: PROSPECTOR_INN_PHONE,
    customerPhoneNumber: CUSTOMER_PHONE,
  };

  beforeEach(() => {
    config.PROSPECTOR_INN_ID = PROSPECTOR_INN_ID;
    mockClient = { get: jest.fn() };
    hotelService = new HotelService(new HotelRepository(ctx.knex));
    ({ service: roomReservationService } = createTestRoomReservationService({
      knex: ctx.knex,
    }));

    cloudbedsReservationService = new CloudbedsReservationService({} as never);

    mockHotelConfigurationService = {
      getHotelConfigurationByHotelId: jest.fn().mockResolvedValue(null),
    };

    service = new AlfredService(
      mockClient as unknown as AxiosInstance,
      hotelService,
      roomReservationService,
      cloudbedsReservationService,
      mockHotelConfigurationService as unknown as HotelConfigurationService,
    );
  });

  it('returns the door code for non-Prospector-Inn hotels without checking reservation state', async () => {
    await seedOtherHotel(ctx.knex);
    mockClient.get.mockResolvedValue({
      data: { external_partner_doorcode: '1234' },
    });

    const result = await service.getDoorCodeByExternalPartner(
      externalIdParams,
      {
        assistantPhoneNumber: '+15559998888',
        customerPhoneNumber: CUSTOMER_PHONE,
      },
    );

    expect(result.doorCode).toBe('1234');
  });

  describe('external partner id lookup', () => {
    it('authorizes using the DB reservation when it exists there, even if already checked out', async () => {
      await seedGuestReservation(ctx.knex, {
        checkIn: dayjs().subtract(5, 'day').format('YYYY-MM-DD'),
        checkOut: dayjs().subtract(1, 'day').format('YYYY-MM-DD'),
        lastName: 'Rivera',
        externalId: '9001',
        amountCharged: RATE,
      });
      mockClient.get.mockResolvedValue({
        data: { external_partner_doorcode: '1111' },
      });

      const result = await service.getDoorCodeByExternalPartner(
        externalIdParams,
        guardContext,
      );

      expect(result.doorCode).toBe('1111');
    });

    it('rejects when the DB reservation exists but is not fully paid', async () => {
      await seedGuestReservation(ctx.knex, {
        checkIn: dayjs().add(1, 'day').format('YYYY-MM-DD'),
        checkOut: dayjs().add(3, 'day').format('YYYY-MM-DD'),
        lastName: 'Rivera',
        externalId: '9001',
        amountCharged: RATE / 2,
      });

      const promise = service.getDoorCodeByExternalPartner(
        externalIdParams,
        guardContext,
      );

      await expect(promise).rejects.toBeInstanceOf(DoorCodeRestrictedError);
      await expect(promise).rejects.toThrow(REJECTED_MESSAGE);
    });

    it('rejects when the DB reservation exists but is cancelled, even if fully paid', async () => {
      await seedGuestReservation(ctx.knex, {
        checkIn: dayjs().add(1, 'day').format('YYYY-MM-DD'),
        checkOut: dayjs().add(3, 'day').format('YYYY-MM-DD'),
        lastName: 'Rivera',
        externalId: '9001',
        amountCharged: RATE,
        status: ReservationStatus.CANCELLED,
      });

      const promise = service.getDoorCodeByExternalPartner(
        externalIdParams,
        guardContext,
      );

      await expect(promise).rejects.toBeInstanceOf(DoorCodeRestrictedError);
      await expect(promise).rejects.toThrow(NO_RESERVATION_MESSAGE);
    });

    it('falls back to the Cloudbeds balance when not found in the DB', async () => {
      await ctx
        .knex('hotels')
        .where({ id: PROSPECTOR_INN_ID })
        .update({ pms_provider: PmsProvider.CLOUDBEDS });
      jest
        .spyOn(cloudbedsReservationService, 'getReservationByIdFromCloudbeds')
        .mockResolvedValue(
          cloudbedsReservation({ reservationID: '9001', balance: 0 }),
        );
      mockClient.get.mockResolvedValue({
        data: { external_partner_doorcode: '2222' },
      });

      const result = await service.getDoorCodeByExternalPartner(
        externalIdParams,
        guardContext,
      );

      expect(result.doorCode).toBe('2222');
      expect(
        cloudbedsReservationService.getReservationByIdFromCloudbeds,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ id: PROSPECTOR_INN_ID }),
        '9001',
      );
    });

    it('rejects when not found in the DB and the Cloudbeds balance is nonzero', async () => {
      await ctx
        .knex('hotels')
        .where({ id: PROSPECTOR_INN_ID })
        .update({ pms_provider: PmsProvider.CLOUDBEDS });
      jest
        .spyOn(cloudbedsReservationService, 'getReservationByIdFromCloudbeds')
        .mockResolvedValue(
          cloudbedsReservation({ reservationID: '9001', balance: 150 }),
        );

      const promise = service.getDoorCodeByExternalPartner(
        externalIdParams,
        guardContext,
      );

      await expect(promise).rejects.toBeInstanceOf(DoorCodeRestrictedError);
      await expect(promise).rejects.toThrow(REJECTED_MESSAGE);
    });

    it('authorizes when the Cloudbeds balance is a credit (below zero)', async () => {
      await ctx
        .knex('hotels')
        .where({ id: PROSPECTOR_INN_ID })
        .update({ pms_provider: PmsProvider.CLOUDBEDS });
      jest
        .spyOn(cloudbedsReservationService, 'getReservationByIdFromCloudbeds')
        .mockResolvedValue(
          cloudbedsReservation({ reservationID: '9001', balance: -25 }),
        );
      mockClient.get.mockResolvedValue({
        data: { external_partner_doorcode: '6161' },
      });

      const result = await service.getDoorCodeByExternalPartner(
        externalIdParams,
        guardContext,
      );

      expect(result.doorCode).toBe('6161');
    });

    it('rejects when the Cloudbeds balance is unknown (undefined)', async () => {
      await ctx
        .knex('hotels')
        .where({ id: PROSPECTOR_INN_ID })
        .update({ pms_provider: PmsProvider.CLOUDBEDS });
      jest
        .spyOn(cloudbedsReservationService, 'getReservationByIdFromCloudbeds')
        .mockResolvedValue(
          cloudbedsReservation({ reservationID: '9001', balance: undefined }),
        );

      const promise = service.getDoorCodeByExternalPartner(
        externalIdParams,
        guardContext,
      );

      await expect(promise).rejects.toBeInstanceOf(DoorCodeRestrictedError);
      await expect(promise).rejects.toThrow(REJECTED_MESSAGE);
    });

    it('surfaces an error when the DB fails and Cloudbeds finds nothing', async () => {
      await ctx
        .knex('hotels')
        .where({ id: PROSPECTOR_INN_ID })
        .update({ pms_provider: PmsProvider.CLOUDBEDS });
      jest
        .spyOn(roomReservationService, 'getReservationDetails')
        .mockRejectedValue(new Error('db down'));
      jest
        .spyOn(cloudbedsReservationService, 'getReservationByIdFromCloudbeds')
        .mockResolvedValue(null);

      const promise = service.getDoorCodeByExternalPartner(
        externalIdParams,
        guardContext,
      );

      await expect(promise).rejects.toThrow('db down');
      await expect(promise).rejects.not.toBeInstanceOf(DoorCodeRestrictedError);
    });

    it('rejects when not found in the DB or Cloudbeds', async () => {
      await ctx
        .knex('hotels')
        .where({ id: PROSPECTOR_INN_ID })
        .update({ pms_provider: PmsProvider.CLOUDBEDS });
      jest
        .spyOn(cloudbedsReservationService, 'getReservationByIdFromCloudbeds')
        .mockResolvedValue(null);

      const promise = service.getDoorCodeByExternalPartner(
        externalIdParams,
        guardContext,
      );

      await expect(promise).rejects.toBeInstanceOf(DoorCodeRestrictedError);
      await expect(promise).rejects.toThrow(NO_RESERVATION_MESSAGE);
    });

    it('does not consult Cloudbeds for non-Cloudbeds hotels when not found in the DB', async () => {
      const promise = service.getDoorCodeByExternalPartner(
        externalIdParams,
        guardContext,
      );

      await expect(promise).rejects.toBeInstanceOf(DoorCodeRestrictedError);
    });

    it('ignores a DB lookup error when Cloudbeds returns a paid reservation', async () => {
      await ctx
        .knex('hotels')
        .where({ id: PROSPECTOR_INN_ID })
        .update({ pms_provider: PmsProvider.CLOUDBEDS });
      jest
        .spyOn(roomReservationService, 'getReservationDetails')
        .mockRejectedValue(new Error('db down'));
      jest
        .spyOn(cloudbedsReservationService, 'getReservationByIdFromCloudbeds')
        .mockResolvedValue(
          cloudbedsReservation({ reservationID: '9001', balance: 0 }),
        );
      mockClient.get.mockResolvedValue({
        data: { external_partner_doorcode: '5555' },
      });

      const result = await service.getDoorCodeByExternalPartner(
        externalIdParams,
        guardContext,
      );

      expect(result.doorCode).toBe('5555');
    });

    it('surfaces an error when both the DB and Cloudbeds lookups fail', async () => {
      await ctx
        .knex('hotels')
        .where({ id: PROSPECTOR_INN_ID })
        .update({ pms_provider: PmsProvider.CLOUDBEDS });
      jest
        .spyOn(roomReservationService, 'getReservationDetails')
        .mockRejectedValue(new Error('db down'));
      jest
        .spyOn(cloudbedsReservationService, 'getReservationByIdFromCloudbeds')
        .mockRejectedValue(new Error('cloudbeds down'));

      const promise = service.getDoorCodeByExternalPartner(
        externalIdParams,
        guardContext,
      );

      await expect(promise).rejects.toThrow('db down');
      await expect(promise).rejects.not.toBeInstanceOf(DoorCodeRestrictedError);
    });
  });

  describe('checkout date + last name lookup', () => {
    it('authorizes an exact-match DB reservation, regardless of the caller phone number', async () => {
      const matchingCheckOut = dayjs().add(3, 'day').format('YYYY-MM-DD');
      await ctx.knex('customers').insert({
        created_at: new Date(),
        first_name: 'Test',
        hotel_id: PROSPECTOR_INN_ID,
        id: uuidv4(),
        last_name: 'Rivera',
        phone_number: '+15551112222', // not guardContext.customerPhoneNumber
        updated_at: new Date(),
      });
      const { bookingId } = await seedGuestReservation(ctx.knex, {
        checkIn: dayjs().add(1, 'day').format('YYYY-MM-DD'),
        checkOut: matchingCheckOut,
        lastName: 'Rivera',
        amountCharged: RATE,
      });
      mockClient.get.mockResolvedValue({
        data: [{ external_partner_doorcode: '3333' }],
      });

      const result = await service.getDoorCodeByExternalPartner(
        lastNameParams({ lastName: 'rivera', checkoutDate: matchingCheckOut }),
        guardContext,
      );

      expect(result.doorCode).toBe('3333');
      expect(bookingId).toBeDefined();
    });

    it('rejects when a same-named reservation exists but with a different checkout date', async () => {
      await seedGuestReservation(ctx.knex, {
        checkIn: dayjs().add(1, 'day').format('YYYY-MM-DD'),
        checkOut: dayjs().add(3, 'day').format('YYYY-MM-DD'),
        lastName: 'Rivera',
        amountCharged: RATE,
      });

      const promise = service.getDoorCodeByExternalPartner(
        lastNameParams({
          lastName: 'Rivera',
          checkoutDate: dayjs().add(10, 'day').format('YYYY-MM-DD'),
        }),
        guardContext,
      );

      await expect(promise).rejects.toBeInstanceOf(DoorCodeRestrictedError);
      await expect(promise).rejects.toThrow(NO_RESERVATION_MESSAGE);
    });

    it('rejects a merely similar (non-exact) last name — no fuzzy matching', async () => {
      const matchingCheckOut = dayjs().add(3, 'day').format('YYYY-MM-DD');
      await seedGuestReservation(ctx.knex, {
        checkIn: dayjs().add(1, 'day').format('YYYY-MM-DD'),
        checkOut: matchingCheckOut,
        lastName: 'Riviera',
        amountCharged: RATE,
      });

      const promise = service.getDoorCodeByExternalPartner(
        lastNameParams({ lastName: 'Rivera', checkoutDate: matchingCheckOut }),
        guardContext,
      );

      await expect(promise).rejects.toBeInstanceOf(DoorCodeRestrictedError);
      await expect(promise).rejects.toThrow(NO_RESERVATION_MESSAGE);
    });

    it('rejects when the exact-match DB reservation is not fully paid', async () => {
      const matchingCheckOut = dayjs().add(3, 'day').format('YYYY-MM-DD');
      await seedGuestReservation(ctx.knex, {
        checkIn: dayjs().add(1, 'day').format('YYYY-MM-DD'),
        checkOut: matchingCheckOut,
        lastName: 'Rivera',
        amountCharged: RATE / 2,
      });

      const promise = service.getDoorCodeByExternalPartner(
        lastNameParams({ lastName: 'Rivera', checkoutDate: matchingCheckOut }),
        guardContext,
      );

      await expect(promise).rejects.toBeInstanceOf(DoorCodeRestrictedError);
      await expect(promise).rejects.toThrow(REJECTED_MESSAGE);
    });

    it('consults Cloudbeds alongside the DB and still rejects an unpaid DB reservation', async () => {
      await ctx
        .knex('hotels')
        .where({ id: PROSPECTOR_INN_ID })
        .update({ pms_provider: PmsProvider.CLOUDBEDS });
      const matchingCheckOut = dayjs().add(3, 'day').format('YYYY-MM-DD');
      await seedGuestReservation(ctx.knex, {
        checkIn: dayjs().add(1, 'day').format('YYYY-MM-DD'),
        checkOut: matchingCheckOut,
        lastName: 'Rivera',
        amountCharged: RATE / 2,
      });
      const cloudbedsSpy = jest
        .spyOn(
          cloudbedsReservationService,
          'getReservationsByExactLastNameFromCloudbeds',
        )
        .mockResolvedValue([]);

      const promise = service.getDoorCodeByExternalPartner(
        lastNameParams({ lastName: 'Rivera', checkoutDate: matchingCheckOut }),
        guardContext,
      );

      await expect(promise).rejects.toBeInstanceOf(DoorCodeRestrictedError);
      await expect(promise).rejects.toThrow(REJECTED_MESSAGE);
      expect(cloudbedsSpy).toHaveBeenCalled();
    });

    it('de-duplicates a reservation returned by both sources, trusting the DB balance', async () => {
      await ctx
        .knex('hotels')
        .where({ id: PROSPECTOR_INN_ID })
        .update({ pms_provider: PmsProvider.CLOUDBEDS });
      const matchingCheckOut = dayjs().add(3, 'day').format('YYYY-MM-DD');
      await seedGuestReservation(ctx.knex, {
        checkIn: dayjs().add(1, 'day').format('YYYY-MM-DD'),
        checkOut: matchingCheckOut,
        lastName: 'Rivera',
        externalId: 'CB-DUP-1',
        amountCharged: RATE / 2, // unpaid in our DB
      });
      // Same booking, reported as paid by Cloudbeds — it must be dropped as a
      // duplicate so the DB's unpaid balance wins.
      jest
        .spyOn(
          cloudbedsReservationService,
          'getReservationsByExactLastNameFromCloudbeds',
        )
        .mockResolvedValue([
          cloudbedsReservation({
            reservationID: 'CB-DUP-1',
            endDate: matchingCheckOut,
            balance: 0,
          }),
        ]);

      const promise = service.getDoorCodeByExternalPartner(
        lastNameParams({ lastName: 'Rivera', checkoutDate: matchingCheckOut }),
        guardContext,
      );

      await expect(promise).rejects.toBeInstanceOf(DoorCodeRestrictedError);
      await expect(promise).rejects.toThrow(REJECTED_MESSAGE);
    });

    it('suppresses a cancelled DB booking even when Cloudbeds reports it as paid', async () => {
      await ctx
        .knex('hotels')
        .where({ id: PROSPECTOR_INN_ID })
        .update({ pms_provider: PmsProvider.CLOUDBEDS });
      const matchingCheckOut = dayjs().add(3, 'day').format('YYYY-MM-DD');
      await seedGuestReservation(ctx.knex, {
        checkIn: dayjs().add(1, 'day').format('YYYY-MM-DD'),
        checkOut: matchingCheckOut,
        lastName: 'Rivera',
        externalId: 'CB-DUP-2',
        amountCharged: RATE,
        status: ReservationStatus.CANCELLED,
      });
      jest
        .spyOn(
          cloudbedsReservationService,
          'getReservationsByExactLastNameFromCloudbeds',
        )
        .mockResolvedValue([
          cloudbedsReservation({
            reservationID: 'CB-DUP-2',
            endDate: matchingCheckOut,
            balance: 0,
            status: 'confirmed',
          }),
        ]);

      const promise = service.getDoorCodeByExternalPartner(
        lastNameParams({ lastName: 'Rivera', checkoutDate: matchingCheckOut }),
        guardContext,
      );

      await expect(promise).rejects.toBeInstanceOf(DoorCodeRestrictedError);
      await expect(promise).rejects.toThrow(NO_RESERVATION_MESSAGE);
    });

    it('rejects a cancelled Cloudbeds reservation even when paid', async () => {
      await ctx
        .knex('hotels')
        .where({ id: PROSPECTOR_INN_ID })
        .update({ pms_provider: PmsProvider.CLOUDBEDS });
      const matchingCheckOut = dayjs().add(3, 'day').format('YYYY-MM-DD');
      jest
        .spyOn(
          cloudbedsReservationService,
          'getReservationsByExactLastNameFromCloudbeds',
        )
        .mockResolvedValue([
          cloudbedsReservation({
            endDate: matchingCheckOut,
            balance: 0,
            status: 'canceled',
          }),
        ]);

      const promise = service.getDoorCodeByExternalPartner(
        lastNameParams({ lastName: 'Rivera', checkoutDate: matchingCheckOut }),
        guardContext,
      );

      await expect(promise).rejects.toBeInstanceOf(DoorCodeRestrictedError);
      await expect(promise).rejects.toThrow(NO_RESERVATION_MESSAGE);
    });

    it('falls back to the Cloudbeds balance when not found in the DB', async () => {
      await ctx
        .knex('hotels')
        .where({ id: PROSPECTOR_INN_ID })
        .update({ pms_provider: PmsProvider.CLOUDBEDS });
      const matchingCheckOut = dayjs().add(3, 'day').format('YYYY-MM-DD');
      jest
        .spyOn(
          cloudbedsReservationService,
          'getReservationsByExactLastNameFromCloudbeds',
        )
        .mockResolvedValue([
          cloudbedsReservation({ endDate: matchingCheckOut, balance: 0 }),
        ]);
      mockClient.get.mockResolvedValue({
        data: [{ external_partner_doorcode: '4444' }],
      });

      const result = await service.getDoorCodeByExternalPartner(
        lastNameParams({ lastName: 'Rivera', checkoutDate: matchingCheckOut }),
        guardContext,
      );

      expect(result.doorCode).toBe('4444');
    });

    it('rejects when the Cloudbeds match has a nonzero balance', async () => {
      await ctx
        .knex('hotels')
        .where({ id: PROSPECTOR_INN_ID })
        .update({ pms_provider: PmsProvider.CLOUDBEDS });
      const matchingCheckOut = dayjs().add(3, 'day').format('YYYY-MM-DD');
      jest
        .spyOn(
          cloudbedsReservationService,
          'getReservationsByExactLastNameFromCloudbeds',
        )
        .mockResolvedValue([
          cloudbedsReservation({ endDate: matchingCheckOut, balance: 99 }),
        ]);

      const promise = service.getDoorCodeByExternalPartner(
        lastNameParams({ lastName: 'Rivera', checkoutDate: matchingCheckOut }),
        guardContext,
      );

      await expect(promise).rejects.toBeInstanceOf(DoorCodeRestrictedError);
      await expect(promise).rejects.toThrow(REJECTED_MESSAGE);
    });

    it('rejects when the Cloudbeds match has a different checkout date', async () => {
      await ctx
        .knex('hotels')
        .where({ id: PROSPECTOR_INN_ID })
        .update({ pms_provider: PmsProvider.CLOUDBEDS });
      jest
        .spyOn(
          cloudbedsReservationService,
          'getReservationsByExactLastNameFromCloudbeds',
        )
        .mockResolvedValue([
          cloudbedsReservation({
            endDate: dayjs().add(20, 'day').format('YYYY-MM-DD'),
            balance: 0,
          }),
        ]);

      const promise = service.getDoorCodeByExternalPartner(
        lastNameParams(),
        guardContext,
      );

      await expect(promise).rejects.toBeInstanceOf(DoorCodeRestrictedError);
      await expect(promise).rejects.toThrow(NO_RESERVATION_MESSAGE);
    });

    it('rejects when not found in the DB or Cloudbeds', async () => {
      const promise = service.getDoorCodeByExternalPartner(
        lastNameParams(),
        guardContext,
      );

      await expect(promise).rejects.toBeInstanceOf(DoorCodeRestrictedError);
      await expect(promise).rejects.toThrow(NO_RESERVATION_MESSAGE);
    });
  });
});
