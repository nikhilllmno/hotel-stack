import { PaymentStatus } from '@/dtos/enum/PaymentStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import { Reservation as ReservationDTO } from '@/dtos/Reservation';
import { ReservationRepository } from '@/repositories/ReservationRepository';
import autoChargeExecutorFactory from '@/services/payment/autoCharge/AutoChargeExecutorFactory';
import { IAutoChargeExecutor } from '@/services/payment/autoCharge/IAutoChargeExecutor';
import { installPgMemTestContextWithoutHotel } from '@/test/db/createPgMemTestContext';
import {
  createTestRoomReservationService,
  TestRoomReservationServiceBundle,
} from '@/test/stubs/createTestRoomReservationService';
import { PaymentProvider, PmsProvider } from '@/types/enums';
import { RoomReservationService } from '../roomReservationService';

function createMockReservation(
  overrides: Partial<ReservationDTO> = {},
): ReservationDTO {
  return {
    id: 'res-1',
    booking_id: 'BK123_1',
    hotel_id: 'hotel-1',
    phone_number: '+15551234567',
    type: SessionType.CALL,
    room_id: 101,
    room_type: 'Standard',
    business_id: '1001',
    pms_provider: PmsProvider.RESNEXUS,
    status: 'active' as any,
    check_in: new Date('2026-07-10') as any,
    check_out: new Date('2026-07-12') as any,
    num_adults: 2,
    num_children: 0,
    customer: { first_name: 'John', last_name: 'Doe' } as any,
    hotel: {
      id: 'hotel-1',
      payment_provider: PaymentProvider.SHIFT4,
      pms_provider: PmsProvider.RESNEXUS,
      currency: 'USD',
      telegram_alerts_group_id: 'tg-group-1',
    } as any,
    hotel_configuration: {
      payment_configuration: {
        auto_charge_max_retries: 3,
      },
    } as any,
    auto_charge: {
      is_enabled: true,
      amount: 100,
      payment_id: 'pay-1',
      finalizes_at: new Date('2026-07-01'),
      retry_count: 0,
    },
    payments: null,
    quote: null,
    discount: null,
    channel: null,
    ...overrides,
  };
}

describe('processDueAutoCharges retry logic', () => {
  const ctx = installPgMemTestContextWithoutHotel();
  let bundle: TestRoomReservationServiceBundle;
  let service: RoomReservationService;
  let reservationRepository: ReservationRepository;
  let findDueSpy: jest.SpyInstance;
  let updateManySpy: jest.SpyInstance;
  let getExecutorSpy: jest.SpyInstance;

  beforeEach(() => {
    reservationRepository = new ReservationRepository(ctx.knex);
    findDueSpy = jest
      .spyOn(reservationRepository, 'findReservationsWithDueAutoCharge')
      .mockResolvedValue([]);
    updateManySpy = jest
      .spyOn(reservationRepository, 'updateMany')
      .mockResolvedValue(null);

    bundle = createTestRoomReservationService({
      knex: ctx.knex,
      reservationRepository,
    });
    service = bundle.service;

    getExecutorSpy = jest.spyOn(autoChargeExecutorFactory, 'getExecutor');
  });

  afterEach(() => {
    getExecutorSpy.mockRestore();
  });

  function stubChargeFailure(providerResponseCode = 'D') {
    const executor: Partial<IAutoChargeExecutor> = {
      executeAutoCharge: jest.fn().mockResolvedValue({
        success: false,
        provider: PaymentProvider.SHIFT4,
        providerResponseCode,
      }),
    };
    getExecutorSpy.mockReturnValue(executor as IAutoChargeExecutor);
    return executor.executeAutoCharge as jest.Mock;
  }

  function stubChargeException() {
    const executor: Partial<IAutoChargeExecutor> = {
      executeAutoCharge: jest
        .fn()
        .mockRejectedValue(new Error('Network error')),
    };
    getExecutorSpy.mockReturnValue(executor as IAutoChargeExecutor);
    return executor.executeAutoCharge as jest.Mock;
  }

  function stubSetupAutoCharge() {
    return jest
      .spyOn(service, 'setupAutoCharge')
      .mockResolvedValue({ success: true, message: 'disabled' });
  }

  it('increments retry_count on first failure without sending Telegram', async () => {
    findDueSpy.mockResolvedValue([createMockReservation()]);
    stubChargeFailure();

    const result = await service.processDueAutoCharges();

    expect(result.failed).toBe(1);
    expect(updateManySpy).toHaveBeenCalledWith(
      ['res-1'],
      expect.objectContaining({
        auto_charge: expect.objectContaining({ retry_count: 1 }),
      }),
    );
    expect(
      bundle.externalStubs.telegramNotificationService.sendMessage,
    ).not.toHaveBeenCalled();
  });

  it('increments retry_count without Telegram when under the limit', async () => {
    findDueSpy.mockResolvedValue([
      createMockReservation({
        auto_charge: {
          is_enabled: true,
          amount: 100,
          payment_id: 'pay-1',
          finalizes_at: new Date('2026-07-01'),
          retry_count: 1,
        },
      }),
    ]);
    stubChargeFailure();

    await service.processDueAutoCharges();

    expect(updateManySpy).toHaveBeenCalledWith(
      ['res-1'],
      expect.objectContaining({
        auto_charge: expect.objectContaining({ retry_count: 2 }),
      }),
    );
    expect(
      bundle.externalStubs.telegramNotificationService.sendMessage,
    ).not.toHaveBeenCalled();
  });

  it('disables auto-charge and sends Telegram when retries exhausted', async () => {
    findDueSpy.mockResolvedValue([
      createMockReservation({
        auto_charge: {
          is_enabled: true,
          amount: 100,
          payment_id: 'pay-1',
          finalizes_at: new Date('2026-07-01'),
          retry_count: 2,
        },
      }),
    ]);
    stubChargeFailure();
    const setupSpy = stubSetupAutoCharge();

    const result = await service.processDueAutoCharges();

    expect(result.failed).toBe(1);
    expect(setupSpy).toHaveBeenCalledWith('BK123', 'hotel-1', {
      is_enabled: false,
    });
    expect(
      bundle.externalStubs.telegramNotificationService.sendMessage,
    ).toHaveBeenCalled();
  });

  it('respects hotel-specific auto_charge_max_retries setting', async () => {
    findDueSpy.mockResolvedValue([
      createMockReservation({
        hotel_configuration: {
          payment_configuration: {
            auto_charge_max_retries: 5,
          },
        } as any,
        auto_charge: {
          is_enabled: true,
          amount: 100,
          payment_id: 'pay-1',
          finalizes_at: new Date('2026-07-01'),
          retry_count: 3,
        },
      }),
    ]);
    stubChargeFailure();

    await service.processDueAutoCharges();

    // retry_count 3 -> 4, still under limit of 5
    expect(updateManySpy).toHaveBeenCalledWith(
      ['res-1'],
      expect.objectContaining({
        auto_charge: expect.objectContaining({ retry_count: 4 }),
      }),
    );
    expect(
      bundle.externalStubs.telegramNotificationService.sendMessage,
    ).not.toHaveBeenCalled();
  });

  it('defaults to 3 retries when hotel config has no auto_charge_max_retries', async () => {
    findDueSpy.mockResolvedValue([
      createMockReservation({
        hotel_configuration: {
          payment_configuration: {},
        } as any,
        auto_charge: {
          is_enabled: true,
          amount: 100,
          payment_id: 'pay-1',
          finalizes_at: new Date('2026-07-01'),
          retry_count: 2,
        },
      }),
    ]);
    stubChargeFailure();
    const setupSpy = stubSetupAutoCharge();

    await service.processDueAutoCharges();

    expect(setupSpy).toHaveBeenCalledWith('BK123', 'hotel-1', {
      is_enabled: false,
    });
    expect(
      bundle.externalStubs.telegramNotificationService.sendMessage,
    ).toHaveBeenCalled();
  });

  it('handles exception path with chargeSucceededAtGateway=false using retry logic', async () => {
    findDueSpy.mockResolvedValue([createMockReservation()]);
    stubChargeException();

    await service.processDueAutoCharges();

    expect(updateManySpy).toHaveBeenCalledWith(
      ['res-1'],
      expect.objectContaining({
        auto_charge: expect.objectContaining({ retry_count: 1 }),
      }),
    );
    expect(
      bundle.externalStubs.telegramNotificationService.sendMessage,
    ).not.toHaveBeenCalled();
  });

  it('updates retry_count for all reservations in a multi-room booking', async () => {
    const autoCharge = {
      is_enabled: true,
      amount: 200,
      payment_id: 'pay-1',
      finalizes_at: new Date('2026-07-01'),
      retry_count: 0,
    };
    findDueSpy.mockResolvedValue([
      createMockReservation({
        id: 'res-1',
        booking_id: 'BK123_1',
        auto_charge: autoCharge,
      }),
      createMockReservation({
        id: 'res-2',
        booking_id: 'BK123_2',
        auto_charge: autoCharge,
      }),
    ]);
    stubChargeFailure();

    await service.processDueAutoCharges();

    expect(updateManySpy).toHaveBeenCalledWith(
      ['res-1', 'res-2'],
      expect.objectContaining({
        auto_charge: expect.objectContaining({ retry_count: 1 }),
      }),
    );
  });

  it('returns empty results when no due reservations found', async () => {
    findDueSpy.mockResolvedValue([]);

    const result = await service.processDueAutoCharges();

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        processed: 0,
        succeeded: 0,
        failed: 0,
      }),
    );
  });
});

describe('paymentStatusTemplate retry info', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {
    paymentStatusTemplate,
  } = require('@/services/vapi/constants/telegramTemplates/paymentStatusTemplate');

  it('shows retries exhausted header when retryInfo is present', () => {
    const html = paymentStatusTemplate({
      status: PaymentStatus.FAILED,
      phoneNumber: '+15551234567',
      bookingId: 'BK123',
      amount: 100,
      guestFirstName: 'John',
      guestLastName: 'Doe',
      totalAmount: 200,
      sessionType: SessionType.CALL,
      isAutoCharge: true,
      retryInfo: { attempt: 3, maxRetries: 3 },
    });

    expect(html).toContain('Retries Exhausted (3/3)');
    expect(html).not.toContain('Auto-Charge Payment Failed');
  });

  it('shows standard auto-charge header when no retryInfo', () => {
    const html = paymentStatusTemplate({
      status: PaymentStatus.FAILED,
      phoneNumber: '+15551234567',
      bookingId: 'BK123',
      amount: 100,
      guestFirstName: 'John',
      guestLastName: 'Doe',
      totalAmount: 200,
      sessionType: SessionType.CALL,
      isAutoCharge: true,
    });

    expect(html).toContain('Auto-Charge Payment Failed');
    expect(html).not.toContain('Retries Exhausted');
  });
});
