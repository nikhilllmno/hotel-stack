import { AuthorizeNetService } from '../../authorizeNet/services/authorizeNetService';
import { PMSServiceFactory } from '../../pms/PMSServiceFactory';
import { ResNexusService } from '../../resNexus/service/reservation/reservationService';
import { DiscountService } from '../../services/discount/discountService';
import {
  ChatServiceResolver,
  TelegramNotificationService,
} from '../../services/notification';
import { SMSNotificationService } from '../../services/notification/smsNotificationService';
import type { Shift4Service } from '../../services/shift4/shift4Service';
import type { StripeService } from '../../services/stripe/stripeService';
import { createStubShift4Service } from '../mocks/stubShift4Service';
import {
  createStubStripeService,
  StubStripeServiceMethods,
  StubStripeServiceOptions,
} from '../mocks/stubStripeService';
import { StubPmsReservationService } from './StubPmsReservationService';

export interface ExternalServiceStubs {
  cardVerifier: jest.Mocked<Pick<AuthorizeNetService, 'verifyCard'>>;
  discountService: DiscountService;
  pmsReservationService: StubPmsReservationService;
  pmsServiceFactory: PMSServiceFactory;
  resNexusService: ResNexusService;
  shift4Service: jest.Mocked<
    Pick<
      Shift4Service,
      'createPaymentLink' | 'disablePaymentLink' | 'saleTransaction'
    >
  >;
  smsService: SMSNotificationService;
  stripeService: jest.Mocked<Pick<StripeService, StubStripeServiceMethods>>;
  /** Chat service every hotel resolves to (hotel.notification_type is ignored) */
  telegramNotificationService: TelegramNotificationService;
  notificationFactory: ChatServiceResolver;
}

export interface CreateExternalServiceStubsOptions {
  cardVerifier?: jest.Mocked<Pick<AuthorizeNetService, 'verifyCard'>>;
  discountService?: DiscountService;
  pmsReservationService?: StubPmsReservationService;
  pmsServiceFactory?: PMSServiceFactory;
  resNexusService?: ResNexusService;
  shift4Service?: jest.Mocked<
    Pick<
      Shift4Service,
      'createPaymentLink' | 'disablePaymentLink' | 'saleTransaction'
    >
  >;
  smsService?: SMSNotificationService;
  stripeServiceOptions?: StubStripeServiceOptions;
  stripeService?: jest.Mocked<Pick<StripeService, StubStripeServiceMethods>>;
  telegramNotificationService?: TelegramNotificationService;
}

function createNoopDiscountService(): DiscountService {
  return {
    createDiscount: jest.fn(),
    getAllActiveDiscounts: jest.fn().mockResolvedValue([]),
    getDiscountByReservationId: jest.fn().mockResolvedValue(null),
    getUnusedDiscountByPhoneNumberAndHotelId: jest.fn().mockResolvedValue(null),
    linkDiscountToReservation: jest.fn().mockResolvedValue(null),
    markDiscountsAsDeleted: jest.fn().mockResolvedValue(0),
    updateDiscount: jest.fn().mockResolvedValue(null),
  } as unknown as DiscountService;
}

function createNoopResNexusService(): ResNexusService {
  return new Proxy({} as ResNexusService, {
    get(_target, property) {
      if (property === 'then') {
        return undefined;
      }

      return jest.fn().mockResolvedValue(undefined);
    },
  });
}

function createNoopSmsService(): SMSNotificationService {
  return {
    sendMessage: jest.fn().mockResolvedValue('sms_test_sid'),
  } as unknown as SMSNotificationService;
}

function createNoopTelegramService(): TelegramNotificationService {
  return {
    sendMessage: jest.fn().mockResolvedValue(1),
  } as unknown as TelegramNotificationService;
}

export function createExternalServiceStubs(
  options: CreateExternalServiceStubsOptions = {},
): ExternalServiceStubs {
  const pmsReservationService =
    options.pmsReservationService ?? new StubPmsReservationService();
  const pmsServiceFactory =
    options.pmsServiceFactory ??
    ({
      getReservationService: jest.fn().mockResolvedValue(pmsReservationService),
    } as unknown as PMSServiceFactory);

  const telegramNotificationService =
    options.telegramNotificationService ?? createNoopTelegramService();

  return {
    cardVerifier: options.cardVerifier ?? {
      verifyCard: jest.fn().mockResolvedValue('approved'),
    },
    discountService: options.discountService ?? createNoopDiscountService(),
    pmsReservationService,
    pmsServiceFactory,
    resNexusService: options.resNexusService ?? createNoopResNexusService(),
    shift4Service: options.shift4Service ?? createStubShift4Service(),
    smsService: options.smsService ?? createNoopSmsService(),
    stripeService:
      options.stripeService ??
      createStubStripeService(options.stripeServiceOptions),
    telegramNotificationService,
    notificationFactory: {
      getChatService: jest.fn().mockReturnValue(telegramNotificationService),
    },
  };
}
