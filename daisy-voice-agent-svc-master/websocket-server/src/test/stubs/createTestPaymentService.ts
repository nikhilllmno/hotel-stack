import { Knex } from 'knex';
import { MewsPaymentProviderService } from '../../mews/services/MewsPaymentProviderService';
import { HotelRepository } from '../../repositories/HotelRepository';
import { PaymentRepository } from '../../repositories/PaymentRepository';
import { PaymentReservationRepository } from '../../repositories/PaymentReservationRepository';
import { HotelService } from '../../services/hotel/hotelService';
import { HotelConfigurationService } from '../../services/hotelConfiguration/hotelConfigurationService';
import { SMSNotificationService } from '../../services/notification/smsNotificationService';
import { IPaymentProviderService } from '../../services/payment/IPaymentProviderService';
import { PaymentProviderFactory } from '../../services/payment/PaymentProviderFactory';
import { PaymentService } from '../../services/payment/paymentService';
import type { Shift4Service } from '../../services/shift4/shift4Service';
import type { StripeService } from '../../services/stripe/stripeService';
import {
  createExternalServiceStubs,
  CreateExternalServiceStubsOptions,
} from './createExternalServiceStubs';
import { StubPaymentProviderService } from './StubPaymentProviderService';

class TestPaymentProviderFactory extends PaymentProviderFactory {
  constructor(
    hotelService: HotelService,
    private paymentProviderService: IPaymentProviderService,
  ) {
    super(hotelService);
  }

  public async getPaymentService(
    _hotelId: string,
  ): Promise<IPaymentProviderService> {
    return this.paymentProviderService;
  }
}

export interface CreateTestPaymentServiceOptions {
  externalStubs?: CreateExternalServiceStubsOptions;
  knex: Knex;
  paymentProviderService?: StubPaymentProviderService;
}

export interface TestPaymentServiceBundle {
  paymentProviderService: StubPaymentProviderService;
  paymentService: PaymentService;
  stripeService: ReturnType<typeof createExternalServiceStubs>['stripeService'];
}

export function createTestPaymentService(
  options: CreateTestPaymentServiceOptions,
): TestPaymentServiceBundle {
  const externalStubs = createExternalServiceStubs(options.externalStubs);
  const paymentRepository = new PaymentRepository(options.knex);
  const paymentReservationRepository = new PaymentReservationRepository(
    options.knex,
  );
  const hotelService = new HotelService(new HotelRepository(options.knex));
  const paymentProviderService =
    options.paymentProviderService ?? new StubPaymentProviderService();
  const paymentProviderFactory = new TestPaymentProviderFactory(
    hotelService,
    paymentProviderService,
  );

  const stubMewsPaymentProviderService = {
    refundCardPaymentByHotelId: jest
      .fn()
      .mockResolvedValue({ State: 'Charged', RefundId: 'r_test' }),
  } as unknown as MewsPaymentProviderService;

  const stubHotelConfigurationService = {
    getHotelConfigurationByHotelId: jest.fn().mockResolvedValue(null),
    getPaymentAccountIdByHotelId: jest.fn().mockResolvedValue(null),
  } as unknown as HotelConfigurationService;

  const paymentService = PaymentService.createForTest({
    paymentProviderFactory,
    paymentRepository,
    paymentReservationRepository,
    shift4Service: externalStubs.shift4Service as unknown as Shift4Service,
    smsService: externalStubs.smsService as unknown as SMSNotificationService,
    stripeService: externalStubs.stripeService as unknown as StripeService,
    mewsPaymentProviderService: stubMewsPaymentProviderService,
    hotelConfigurationService: stubHotelConfigurationService,
  });

  return {
    paymentProviderService,
    paymentService,
    stripeService: externalStubs.stripeService,
  };
}
