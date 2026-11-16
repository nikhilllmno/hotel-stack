import { Knex } from 'knex';
import { AddressRepository } from '../../repositories/AddressRepository';
import { BookingReviewRepository } from '../../repositories/BookingReviewRepository';
import { ChannelRepository } from '../../repositories/ChannelRepository';
import { CustomerRepository } from '../../repositories/CustomerRepository';
import { HotelConfigurationRepository } from '../../repositories/HotelConfigurationRepository';
import { HotelRepository } from '../../repositories/HotelRepository';
import { PaymentReservationRepository } from '../../repositories/PaymentReservationRepository';
import { QuoteRepository } from '../../repositories/QuoteRepository';
import { ReservationRepository } from '../../repositories/ReservationRepository';
import { ChannelService } from '../../services/channel/channelService';
import { CustomerService } from '../../services/customer/customerService';
import { HotelService } from '../../services/hotel/hotelService';
import { HotelConfigurationService } from '../../services/hotelConfiguration/hotelConfigurationService';
import { PaymentService } from '../../services/payment/paymentService';
import { QuoteService } from '../../services/quote/quoteService';
import { RoomReservationService } from '../../services/roomReservation/roomReservationService';
import {
  createExternalServiceStubs,
  CreateExternalServiceStubsOptions,
  ExternalServiceStubs,
} from './createExternalServiceStubs';
import {
  createTestPaymentService,
  TestPaymentServiceBundle,
} from './createTestPaymentService';

export interface CreateTestRoomReservationServiceOptions {
  knex: Knex;
  externalStubs?: CreateExternalServiceStubsOptions;
  paymentBundle?: TestPaymentServiceBundle;
  paymentService?: PaymentService;
  reservationRepository?: ReservationRepository;
}

export interface TestRoomReservationServiceBundle {
  externalStubs: ExternalServiceStubs;
  paymentBundle: TestPaymentServiceBundle;
  service: RoomReservationService;
}

export function createTestRoomReservationService(
  options: CreateTestRoomReservationServiceOptions,
): TestRoomReservationServiceBundle {
  const externalStubs = createExternalServiceStubs(options.externalStubs);
  const paymentBundle =
    options.paymentBundle ??
    createTestPaymentService({
      externalStubs: options.externalStubs,
      knex: options.knex,
    });
  const paymentService = options.paymentService ?? paymentBundle.paymentService;

  const reservationRepository =
    options.reservationRepository ?? new ReservationRepository(options.knex);
  const paymentReservationRepository = new PaymentReservationRepository(
    options.knex,
  );
  const hotelRepository = new HotelRepository(options.knex);
  const hotelConfigurationRepository = new HotelConfigurationRepository(
    options.knex,
  );

  const hotelService = new HotelService(
    hotelRepository,
    hotelConfigurationRepository,
  );
  const customerService = new CustomerService({
    addressRepository: new AddressRepository(options.knex),
    customerRepository: new CustomerRepository(options.knex),
  });
  const quoteService = new QuoteService(new QuoteRepository(options.knex));
  const hotelConfigurationService = new HotelConfigurationService(
    hotelConfigurationRepository,
  );
  const channelService = new ChannelService(
    new ChannelRepository(options.knex),
  );
  const bookingReviewRepository = new BookingReviewRepository(options.knex);

  const service = new RoomReservationService(
    paymentService,
    externalStubs.resNexusService,
    reservationRepository,
    customerService,
    quoteService,
    hotelService,
    hotelConfigurationService,
    externalStubs.smsService,
    externalStubs.discountService,
    paymentReservationRepository,
    externalStubs.notificationFactory,
    channelService,
    externalStubs.pmsServiceFactory,
    bookingReviewRepository,
    externalStubs.cardVerifier,
  );

  return {
    externalStubs,
    paymentBundle,
    service,
  };
}
