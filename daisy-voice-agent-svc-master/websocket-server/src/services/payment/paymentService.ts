import authorizeNetService from '../../authorizeNet/services/authorizeNetService';
import { authorizeNetTokenService } from '../../authorizeNet/services/AuthorizeNetTokenService';
import logger from '../../utils/logger';
import {
  paymentLinkSMSTemplate,
  paymentReminderSMSTemplate,
} from '../messaging/messageTemplates';
import type { Shift4Service } from '../shift4/shift4Service';
import type { StripeService } from '../stripe/stripeService';

import { Payment } from '../../models/Payment';
import { PaymentRepository } from '../../repositories/PaymentRepository';
import stripeService from '../stripe/stripeService';

import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Knex } from 'knex';
import _ from 'lodash';
import Stripe from 'stripe';
import { operaFolioService } from '../../calry/services/operaFolioService';
import config from '../../config';
import { SOURCE } from '../../constants/source';
import db from '../../database/connection';
import { CardMetadata } from '../../dtos/Customer';
import { PaymentStatus } from '../../dtos/enum/PaymentStatus';
import { RefundStatus } from '../../dtos/enum/RefundStatus';
import { SessionType } from '../../dtos/enum/SessionType';
import {
  CreateInvoiceItemParams,
  CreateInvoiceParams,
  CreatePaymentIntentResponse,
  UpdateInvoiceParams,
} from '../../dtos/Payment';
import {
  PaymentRefundInfo,
  PaymentRefundParams,
  RefundedPaymentInfo,
  RefundFailure,
  RefundProcessResult,
} from '../../dtos/refund/RefundDto';
import { BadRequestError } from '../../errors/BadRequestError';
import { BaseError } from '../../errors/BaseError';
import { NoDataError } from '../../errors/NoDataError';
import { paymentEvents } from '../../events/paymentEvents';
import { smsEvents } from '../../events/smsEvents';
import mewsPaymentProviderServiceDefault, {
  MewsPaymentProviderService,
} from '../../mews/services/MewsPaymentProviderService';
import { MewsPaymentState } from '../../mews/types';
import { PaymentReservationRepository } from '../../repositories/PaymentReservationRepository';
import reservationRepository from '../../repositories/ReservationRepository';
import { Country, PaymentProvider } from '../../types/enums';
import { TwilioConfiguration } from '../../types/hotelConfiguration';
import { PaymentCreationMetadata, PaymentMetadata } from '../../types/payment';
import {
  CardPresent,
  Shift4RefundTransactionRequest,
  Shift4RefundTransactionResponse,
  Shift4ResponseCode,
} from '../../types/shift4';
import {
  formatCurrencyAmount,
  generateInvoiceId,
  getSecureReviewUrl,
  roundCurrency,
  validatePhoneWithTwilio,
} from '../../utils/helper';
import { KpiStat, logKpi } from '../../utils/kpiLogger';
import { validPaymentPreStatus } from '../../validators/validPaymentPreStatus';
import {
  HotelConfigurationService,
  hotelConfigurationService as hotelConfigurationServiceDefault,
} from '../hotelConfiguration/hotelConfigurationService';
import { SMSNotificationService } from '../notification/smsNotificationService';
import {
  NotificationPayload,
  NotificationSMSContent,
} from '../notification/types';
import shift4Service from '../shift4/shift4Service';
import {
  IPaymentProviderService,
  PaymentLinkResponse,
} from './IPaymentProviderService';
import paymentProviderFactory, {
  PaymentProviderFactory,
} from './PaymentProviderFactory';
dayjs.extend(utc);
dayjs.extend(timezone);

export interface CreatePaymentParams {
  amount: number;
  currency: string;
  description: string;
  metadata: PaymentCreationMetadata;
  sessionType: SessionType;
  payment_provider: PaymentProvider;
  connectedAccountId?: string;
}

/**
 * Creates a payment record and generates a payment link
 * @param params Payment parameters
 * @returns The created payment record
 */
/**
 * Providers whose "payment link" is a Dextr review page URL rather than a page
 * hosted by the provider. Nothing exists on their side to deactivate, so
 * disabling one is a local flag update and never an outbound call.
 */
const REVIEW_PAGE_LINK_PROVIDERS: ReadonlySet<PaymentProvider> = new Set([
  PaymentProvider.MEWS,
  PaymentProvider.OPERA,
  PaymentProvider.AUTHORIZE_NET,
]);

export class PaymentService {
  private static instance: PaymentService | null = null;

  private constructor(
    private smsService: SMSNotificationService,
    private stripeService: StripeService,
    private shift4Service: Shift4Service,
    private mewsPaymentProviderService: MewsPaymentProviderService,
    private paymentRepository: PaymentRepository,
    private paymentReservationRepository: PaymentReservationRepository,
    private paymentProviderFactory: PaymentProviderFactory,
    private hotelConfigurationService: HotelConfigurationService,
  ) {}

  /**
   * Returns the singleton instance, creating it if needed.
   */
  public static getInstance(
    smsServiceParam: SMSNotificationService = new SMSNotificationService(),
    stripeServiceParam: StripeService = stripeService,
    shift4ServiceParam: Shift4Service = shift4Service,
    mewsPaymentProviderServiceParam: MewsPaymentProviderService = mewsPaymentProviderServiceDefault,
    paymentRepositoryParam: PaymentRepository = new PaymentRepository(),
    paymentReservationRepositoryParam: PaymentReservationRepository = new PaymentReservationRepository(),
    hotelConfigurationServiceParam: HotelConfigurationService = hotelConfigurationServiceDefault,
  ): PaymentService {
    if (!PaymentService.instance) {
      PaymentService.instance = new PaymentService(
        smsServiceParam,
        stripeServiceParam,
        shift4ServiceParam,
        mewsPaymentProviderServiceParam,
        paymentRepositoryParam,
        paymentReservationRepositoryParam,
        paymentProviderFactory,
        hotelConfigurationServiceParam,
      );
    }
    return PaymentService.instance;
  }

  public static createForTest(deps: {
    smsService: SMSNotificationService;
    stripeService: StripeService;
    shift4Service: Shift4Service;
    mewsPaymentProviderService: MewsPaymentProviderService;
    paymentRepository: PaymentRepository;
    paymentReservationRepository: PaymentReservationRepository;
    paymentProviderFactory: PaymentProviderFactory;
    hotelConfigurationService: HotelConfigurationService;
  }): PaymentService {
    return new PaymentService(
      deps.smsService,
      deps.stripeService,
      deps.shift4Service,
      deps.mewsPaymentProviderService,
      deps.paymentRepository,
      deps.paymentReservationRepository,
      deps.paymentProviderFactory,
      deps.hotelConfigurationService,
    );
  }

  async updatePaymentById(
    paymentId: string,
    paymentData: Partial<Payment>,
    transaction?: Knex.Transaction,
  ) {
    try {
      const payment = await this.paymentRepository.findById(
        paymentId,
        transaction,
      );
      if (_.isEmpty(payment)) {
        throw new NoDataError(
          `updatePaymentById:: No payment found for paymentId ${paymentId}`,
        );
      }
      const newData: Partial<
        Omit<Payment, 'id' | 'created_at' | 'updated_at'>
      > = {
        ...paymentData,
      };
      const updatedPayment = await this.paymentRepository.update(
        payment.id,
        newData,
        transaction,
      );
      return updatedPayment;
    } catch (error) {
      logger.error(
        `updatePaymentById:: Error updating payment status for payment ${paymentId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Updates the status of a payment
   * @param paymentId The ID of the payment to update
   * @param status The new status
   * @returns The updated payment record
   */
  async updatePaymentStatusById(
    paymentId: string,
    status: PaymentStatus,
    transaction?: Knex.Transaction,
  ) {
    try {
      const payment = await this.paymentRepository.findById(
        paymentId,
        transaction,
      );
      if (_.isEmpty(payment)) {
        throw new NoDataError(
          `updatePaymentStatusById:: No payment found for paymentId ${paymentId}`,
        );
      }

      const updatedPayments = await this.updatePaymentStatus(
        [payment.id],
        status,
        transaction,
      );
      return updatedPayments?.[0];
    } catch (error) {
      logger.error(
        `UpdatePaymentStatusById:: Error updating payment status for payment ${paymentId}: ${JSON.stringify(error)}`,
      );
      throw error;
    }
  }

  async updatePaymentStatus(
    paymentIds: string[],
    status: PaymentStatus,
    transaction?: Knex.Transaction,
  ): Promise<Payment[] | null> {
    try {
      const uniquePaymentIds = _.uniq(paymentIds);
      const payments = await this.paymentRepository.findByIds(
        uniquePaymentIds,
        [],
        transaction,
      );
      if (_.isEmpty(payments)) {
        throw new NoDataError(
          `updatePaymentStatus:: No payments found for paymentIds: ${JSON.stringify(paymentIds)}`,
        );
      }
      if (payments.length !== uniquePaymentIds.length) {
        const notFoundPaymentIds = _.difference(
          uniquePaymentIds,
          _.map(payments, 'id'),
        );
        throw new BadRequestError(
          `updatePaymentStatus:: payments not found for paymentIds: ${JSON.stringify(notFoundPaymentIds)}`,
        );
      }
      const paymentMap = _.keyBy(payments, 'id');
      const invalidPayments = _.filter(uniquePaymentIds, (paymentId) => {
        const currentStatus = paymentMap[paymentId].payment_status;
        return !validPaymentPreStatus[status]?.includes(currentStatus);
      }).map((paymentId) => ({
        id: paymentId,
        currentStatus: paymentMap[paymentId].payment_status,
      }));

      if (!_.isEmpty(invalidPayments)) {
        const errorDetails = invalidPayments
          .map((p) => `Payment ID: ${p.id}, Current Status: ${p.currentStatus}`)
          .join('\n');
        throw new BadRequestError(
          `updatePaymentStatus:: Cannot change payment_status to ${status}. Invalid transitions for:\n${errorDetails}`,
        );
      }

      return await this.paymentRepository.updateMany(
        uniquePaymentIds,
        { payment_status: status },
        transaction,
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * Gets a payment by payment ID
   * @param paymentId The payment ID to find payment for
   * @param transaction Optional database transaction
   * @returns The payment record or null if not found
   */
  async getPaymentById(
    paymentId: string,
    transaction?: Knex.Transaction,
  ): Promise<Payment | null> {
    try {
      if (!paymentId) {
        return null;
      }
      const payment = await this.paymentRepository.findById(
        paymentId,
        transaction,
      );
      return payment;
    } catch (error) {
      logger.error(
        `getPaymentById: Error finding payment for payment ${paymentId}: ${JSON.stringify(error)}`,
      );
      throw new NoDataError(
        `getPaymentById: No payment found for payment ${paymentId}`,
      );
    }
  }

  async findPaymentByInvoiceId(invoiceId: string): Promise<Payment | null> {
    return this.paymentRepository.findByInvoiceId(invoiceId);
  }

  /**
   * Gets payments by payment IDs
   * @param paymentIds The payment IDs to find payments for
   * @returns The payment records
   */
  async findPaymentsByIds(
    paymentIds: string[],
    statuses: PaymentStatus[] = [],
    transaction?: Knex.Transaction,
  ): Promise<Payment[]> {
    try {
      if (_.isEmpty(paymentIds)) {
        return [];
      }
      const payments = await this.paymentRepository.findByIds(
        paymentIds,
        statuses,
        transaction,
      );
      return payments;
    } catch (error) {
      logger.error(
        `findPaymentsByIds: Error finding payments for payment IDs ${JSON.stringify(paymentIds)}: ${JSON.stringify(error)}`,
      );
      throw error;
    }
  }

  /**
   * Updates the refund amount for a payment
   * @param paymentId The ID of the payment to update
   * @param refundAmount The amount to set as refunded
   * @param transaction Optional database transaction
   * @returns The updated payment record
   */
  async updatePaymentRefundAmount(
    paymentId: string,
    refundAmount: number,
    transaction?: Knex.Transaction,
  ): Promise<Payment | null> {
    try {
      const payment = await this.paymentRepository.findById(
        paymentId,
        transaction,
      );
      if (_.isEmpty(payment)) {
        throw new NoDataError(
          `updatePaymentRefundAmount:: No payment found for paymentId ${paymentId}`,
        );
      }

      const updatedPayment = await this.paymentRepository.update(
        payment.id,
        { amount_refunded: refundAmount },
        transaction,
      );
      return updatedPayment;
    } catch (error) {
      logger.error(
        `updatePaymentRefundAmount:: Error updating refund amount for payment ${paymentId}: ${JSON.stringify(error)}`,
      );
      throw error;
    }
  }

  /**
   * Creates a payment record without a payment link
   * @param amount The amount to be charged
   * @param currency The currency of the amount
   * @returns The created payment record
   */
  async createPaymentWithoutLink(
    data: Omit<
      Payment,
      | 'id'
      | 'created_at'
      | 'updated_at'
      | 'payment_link'
      | 'booking_confirmation_id'
    >,
    transaction?: Knex.Transaction,
  ): Promise<Payment> {
    const paymentRecord: Payment | null = await this.paymentRepository.create(
      data,
      transaction,
    );

    if (!paymentRecord) {
      throw new BaseError('Failed to create payment record');
    }

    return paymentRecord;
  }

  async linkPaymentToReservations(
    paymentId: string,
    reservationIds: string[],
    transaction?: Knex.Transaction,
  ) {
    return this.paymentReservationRepository.linkPaymentToReservations(
      paymentId,
      reservationIds,
      transaction,
    );
  }

  /**
   * Upserts the metadata for a payment
   * @param paymentId The ID of the payment to update
   * @param metadata The metadata object to set
   * @param transaction Optional database transaction
   * @returns The updated payment record
   */
  async updatePaymentMetadata(
    paymentId: string,
    metadata: any,
    transaction?: Knex.Transaction,
  ): Promise<Payment | null> {
    try {
      const payment = await this.paymentRepository.findById(
        paymentId,
        transaction,
      );
      if (_.isEmpty(payment)) {
        throw new NoDataError(
          `updatePaymentMetadata:: No payment found for paymentId ${paymentId}`,
        );
      }

      const updatedPayment = await this.paymentRepository.update(
        payment.id,
        { metadata: { ...payment.metadata, ...metadata } },
        transaction,
      );
      return updatedPayment;
    } catch (error) {
      logger.error(
        `updatePaymentMetadata:: Error updating metadata for payment ${paymentId}: ${JSON.stringify(error)}`,
      );
      throw error;
    }
  }

  /**
   * Processes a refund for a payment
   * @param paymentId The ID of the payment to refund
   * @param refundAmount The amount to refund
   * @param metadata Optional metadata for the refund
   * @param transaction Optional database transaction
   * @returns The updated payment record
   */
  async processRefund(
    paymentId: string,
    refundAmount: number,
    metadata?: any,
    transaction?: Knex.Transaction,
  ): Promise<Payment | null> {
    try {
      const payment = await this.paymentRepository.findById(
        paymentId,
        transaction,
      );
      if (_.isEmpty(payment)) {
        throw new NoDataError(
          `processRefund:: No payment found for paymentId ${paymentId}`,
        );
      }

      // Validate refund amount
      const totalRefunded = roundCurrency(
        (payment.amount_refunded || 0) + refundAmount,
      );
      if (totalRefunded > roundCurrency(payment.amount_charged)) {
        throw new BadRequestError(
          `processRefund:: Refund amount exceeds payment amount. Payment: ${roundCurrency(payment.amount_charged)}, Total refund: ${roundCurrency(totalRefunded)}`,
        );
      }

      const updateData: Partial<
        Omit<Payment, 'id' | 'created_at' | 'updated_at'>
      > = {
        amount_refunded: totalRefunded,
        payment_status: PaymentStatus.REFUNDED,
      };

      // Add refund information to metadata
      if (metadata || payment.metadata) {
        const existingMetadata = payment.metadata || {};
        const refundMetadata = {
          ...existingMetadata,
          ...metadata,
        };
        updateData.metadata = refundMetadata;
      }

      const updatedPayment = await this.paymentRepository.update(
        payment.id,
        updateData,
        transaction,
      );
      return updatedPayment;
    } catch (error) {
      logger.error(
        `processRefund:: Error processing refund for payment ${paymentId}: ${JSON.stringify(error)}`,
      );
      throw error;
    }
  }

  /**
   * Checks if a payment_link_id already exists in the database.
   *
   * @param paymentLinkId The payment link ID to check
   * @param trx Database transaction
   * @returns True if the payment_link_id exists, false otherwise
   */
  private async paymentLinkIdExists(
    paymentLinkId: string,
    trx: Knex.Transaction,
  ): Promise<boolean> {
    const result = await this.paymentRepository.findByPaymentLinkId(
      paymentLinkId,
      trx,
    );
    return !!result;
  }

  /**
   * Creates a payment link with retry logic for duplicate payment_link_id.
   * This is primarily needed for Shift4 where invoice IDs (payment_link_id) are generated client-side,
   * and we need to ensure uniqueness by retrying with a new ID if a duplicate is detected.
   *
   * @param paymentProviderService The payment provider service instance
   * @param amount Payment amount
   * @param currency Payment currency
   * @param description Payment description
   * @param paymentMetadata Payment metadata
   * @param trx Database transaction
   * @returns Payment link object with url and id
   */
  private async createPaymentLinkWithRetry(
    paymentProviderService: IPaymentProviderService,
    amount: number,
    currency: string,
    description: string,
    paymentMetadata: PaymentMetadata,
    trx: Knex.Transaction,
    connectedAccountId?: string,
  ): Promise<PaymentLinkResponse> {
    let retryCount = 0;
    const maxRetries = config.PAYMENT_LINK_ID_MAX_RETRIES;

    while (retryCount <= maxRetries) {
      const paymentLink = await paymentProviderService.createPaymentLink({
        amount,
        currency,
        description,
        metadata: paymentMetadata,
        connectedAccountId,
      });

      const exists = await this.paymentLinkIdExists(paymentLink.id, trx);

      if (!exists) {
        return paymentLink;
      }

      if (retryCount < maxRetries) {
        retryCount++;
        logger.warn(
          `createPaymentLinkWithRetry: Duplicate payment_link_id detected, retrying (${retryCount}/${maxRetries})`,
        );
        continue;
      }

      throw new BaseError(
        `Failed to generate unique payment_link_id after ${maxRetries + 1} attempts`,
      );
    }

    throw new BaseError(
      `Failed to generate unique payment_link_id after ${maxRetries + 1} attempts`,
    );
  }

  /**
   * Phase 1: Create DB payment record and PMS payment link (no notifications).
   */
  async createPayment(
    params: CreatePaymentParams,
    transaction?: Knex.Transaction,
  ): Promise<{ paymentRecord: Payment; paymentMetadata: PaymentMetadata }> {
    const { amount, currency, description, metadata, connectedAccountId } =
      params;
    let trx: Knex.Transaction | undefined;
    try {
      trx = transaction || (await db.transaction());
      const paymentProvider = params.payment_provider;
      if (!paymentProvider) {
        throw new BadRequestError(
          `createPayment: payment provider not present`,
        );
      }
      let paymentRecord: Payment | null = await this.paymentRepository.create(
        {
          hotel_id: metadata.hotel_id,
          amount_charged: amount,
          currency,
          payment_status: PaymentStatus.PENDING,
          payment_provider: paymentProvider,
          metadata,
        },
        trx,
      );

      if (!paymentRecord) {
        throw new BaseError('Failed to create payment record');
      }

      const paymentMetadata: PaymentMetadata = {
        ..._.cloneDeep(metadata),
        payment_id: paymentRecord.id,
      };

      let paymentLink: PaymentLinkResponse;

      // amount=0 with a Stripe provider: no upfront charge — create a Checkout
      // Session in setup mode to capture card details for later autocharge.
      if (amount === 0 && paymentProvider === PaymentProvider.STRIPE) {
        paymentLink = await this.stripeService.createSetupCheckoutSession({
          currency,
          metadata: paymentMetadata,
          connectedAccountId,
        });
      } else {
        const paymentProviderService =
          await this.paymentProviderFactory.getPaymentService(
            metadata.hotel_id,
          );

        paymentLink = await this.createPaymentLinkWithRetry(
          paymentProviderService,
          amount,
          currency,
          description,
          paymentMetadata,
          trx,
          connectedAccountId,
        );
      }

      const updateData: Partial<Payment> = {
        payment_link: paymentLink.url,
        payment_link_id: paymentLink.id,
      };

      paymentRecord = await this.paymentRepository.update(
        paymentRecord.id,
        updateData,
        trx,
      );

      if (!paymentRecord) {
        throw new NoDataError(
          'Failed to update payment link, payment record not found for payment id: ' +
            paymentRecord!.id,
        );
      }

      if (!transaction) {
        await trx.commit();
      }

      return { paymentRecord, paymentMetadata };
    } catch (error) {
      if (!transaction && trx) {
        await trx.rollback();
      }
      logger.error(
        `createPayment:: Error creating payment: ${JSON.stringify(error)}`,
      );
      throw error;
    }
  }

  async sendPaymentNotifications(
    sessionId: string,
    paymentRecord: Payment,
    sessionType: SessionType,
    metadata: PaymentMetadata,
    customerPhone: string,
    smsAgentEnabled: boolean,
    bookingReviewId: string,
    twilioConfiguration: TwilioConfiguration | null | undefined,
  ): Promise<void> {
    try {
      // Only send payment links for CALL sessions
      if (sessionType !== SessionType.CALL) return;
      if (!paymentRecord?.payment_link) return;

      if (!metadata.hotel_name) {
        throw new BadRequestError(
          `sendPaymentNotifications:: No hotel name provided for payment ${paymentRecord.id}`,
        );
      }
      if (!metadata.hotel_phone_number) {
        throw new BadRequestError(
          `sendPaymentNotifications:: No assistant phone number provided for hotel ${metadata.hotel_name}`,
        );
      }
      if (!metadata.hotel_sms_number) {
        throw new BadRequestError(
          `sendPaymentNotifications:: No SMS number provided for hotel ${metadata.hotel_name}`,
        );
      }

      // Validate customer phone number for payment link (must be a valid Twilio number)
      try {
        await validatePhoneWithTwilio(
          customerPhone,
          twilioConfiguration,
          metadata.hotel_country,
        );
      } catch (error) {
        throw new BadRequestError(
          `Invalid customer phone number ${customerPhone} for payment link SMS`,
        );
      }

      const secureUrl = getSecureReviewUrl(
        bookingReviewId,
        metadata.hotel_name,
      );

      const smsBody = paymentLinkSMSTemplate(
        metadata.hotel_name,
        secureUrl,
        config.REVIEW_TIMEOUT,
        metadata.hotel_internal_phone_number || metadata.hotel_phone_number,
        metadata.hotel_country,
        smsAgentEnabled,
      );

      const smsContent: NotificationSMSContent = {
        message: smsBody,
        from: metadata.hotel_sms_number,
        twilioConfiguration,
      };
      const smsPayload: NotificationPayload = {
        recipient: customerPhone,
        content: smsContent,
      };

      const smsResult = await this.smsService.sendMessage(smsPayload);
      logger.info(
        `sendPaymentNotifications: Payment link SMS sent to ${customerPhone} for payment ${paymentRecord.id}`,
      );

      if (smsResult) {
        smsEvents.emitSmsSent({
          sessionId,
          message: smsContent.message,
          from: smsContent.from,
          to: customerPhone,
          callerPhoneNumber: customerPhone,
          assistantPhoneNumber: metadata.hotel_phone_number,
          timestamp: new Date(),
          hotelSmsNumber: metadata.hotel_sms_number,
          smsAgentEnabled,
          hotelId: metadata.hotel_id,
        });

        logKpi({
          stat: KpiStat.PaymentLinkSent,
          value: 1,
          contextName: 'sendPaymentNotifications',
          clientId: metadata.hotel_phone_number,
          contextId: paymentRecord.id,
        });
        logKpi({
          stat: KpiStat.PaymentLinkSentAmount,
          value: paymentRecord.amount_charged,
          contextName: 'sendPaymentNotifications',
          clientId: metadata.hotel_phone_number,
          contextId: paymentRecord.id,
        });
      }
    } catch (error) {
      logger.error(
        `sendPaymentNotifications: Error while sending payment notification: ${JSON.stringify(error)}`,
      );
      throw error;
    }
  }

  generatePaymentDescription(check_in: string, check_out: string) {
    return `Room reservation from ${check_in} to ${check_out}`;
  }

  /**
   * Creates a payment intent and charges the customer directly
   * @param params Payment intent parameters
   * @returns The payment result
   */
  async createAndChargePaymentIntent(
    params: {
      amount: number;
      currency: string;
      description: string;
      customerId: string;
      metadata: PaymentCreationMetadata;
      connectedAccountId?: string;
      payment_provider: PaymentProvider;
    },
    reservationIds: string[],
    transaction?: Knex.Transaction,
  ): Promise<CreatePaymentIntentResponse> {
    const {
      amount,
      currency,
      description,
      customerId,
      metadata,
      connectedAccountId,
      payment_provider,
    } = params;
    const trx = transaction || (await db.transaction());
    try {
      // Create payment record first
      let paymentRecord: Payment | null = await this.paymentRepository.create(
        {
          hotel_id: metadata.hotel_id,
          amount_charged: amount,
          currency,
          payment_status: PaymentStatus.PENDING,
          payment_provider: payment_provider,
          metadata,
        },
        trx,
      );
      if (!paymentRecord) {
        throw new BaseError('Failed to create payment record');
      }

      await this.paymentReservationRepository.linkPaymentToReservations(
        paymentRecord.id,
        reservationIds,
        trx,
      );

      // Create and charge payment intent
      this.stripeService
        .createPaymentIntent({
          amount,
          currency,
          description,
          customer_id: customerId,
          metadata: {
            ...metadata,
            payment_id: paymentRecord.id,
            source: SOURCE,
            action: 'manual_charge',
          },
          connectedAccountId,
        })
        .then(async (paymentIntent) => {
          logger.info(
            `createAndChargePaymentIntent: Payment intent ${paymentIntent?.id ?? ''} created and charged for payment ${paymentRecord?.id ?? ''}`,
          );
        })
        .catch(async (error) => {
          // Handle failure - update payment to FAILED
          logger.error(
            `createAndChargePaymentIntent: Error charging payment for payment ${paymentRecord?.id ?? ''}: ${JSON.stringify(error)}`,
          );
          try {
            await this.paymentRepository.update(paymentRecord.id, {
              payment_status: PaymentStatus.FAILED,
            });
          } catch (updateError) {
            logger.error(
              `createAndChargePaymentIntent: Error updating payment status to FAILED for payment ${paymentRecord!.id}: ${JSON.stringify(updateError)}`,
            );
          }
        });

      if (!transaction) {
        await trx.commit();
      }
      return {
        paymentRecord,
        success: true,
      };
    } catch (error) {
      if (!transaction) {
        await trx.rollback();
      }
      logger.error(
        `createAndChargePaymentIntent: Error charging payment: ${JSON.stringify(error)}`,
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Returns payment IDs associated with the given reservation IDs.
   */
  async getPaymentIdsByReservationIds(
    reservationIds: string[],
  ): Promise<string[]> {
    return this.paymentRepository.findPaymentIdsByReservationIds(
      reservationIds,
    );
  }

  /**
   * Returns full payment objects with their reservation IDs and hotel ID.
   */
  async getPaymentsWithReservationsAndHotelId(
    paymentIds: string[],
    transaction?: Knex.Transaction,
  ): Promise<Array<Payment & { reservation_ids: string[]; hotel_id: string }>> {
    return this.paymentRepository.findPaymentsWithReservationsAndHotelId(
      paymentIds,
      transaction,
    );
  }

  /**
   * Returns pending payments with a payment link tied to inactive reservations.
   */
  async getPendingPaymentsWithInactiveReservations(): Promise<
    Array<Payment & { reservation_ids: string[]; hotel_id: string }>
  > {
    return this.paymentRepository.findPendingPaymentsWithInactiveReservations();
  }

  /**
   * Cancels provided payments only (Stripe deactivation + set payment_status=CANCELLED).
   * Does NOT change reservation statuses.
   */
  async cancelPayments(
    paymentIds: string[],
    disablePaymentLink?: boolean,
    parentTransaction?: Knex.Transaction,
  ): Promise<{
    processed: number;
    cancelled: number;
    errors: { payment_id: string; message: string }[];
  }> {
    const errors: { payment_id: string; message: string }[] = [];
    const payments =
      await this.paymentRepository.findPaymentsWithReservationsAndHotelId(
        paymentIds,
        parentTransaction,
      );
    if (!payments?.length) return { processed: 0, cancelled: 0, errors };
    if (disablePaymentLink) {
      const disableResult = await this.disablePaymentLink(paymentIds);
      errors.push(...disableResult.errors);
    }

    const paymentsToCancel = payments.filter((p) =>
      [PaymentStatus.PENDING, PaymentStatus.FAILED].includes(p.payment_status),
    );

    // Batch DB updates in a single transaction
    const trx =
      parentTransaction ?? (await this.paymentRepository.startTransaction());
    try {
      const updatedPayments = paymentsToCancel?.length
        ? await this.updatePaymentStatus(
            paymentsToCancel.map((p) => p.id),
            PaymentStatus.CANCELLED,
            trx,
          )
        : [];
      if (!parentTransaction) {
        await trx.commit();
      }
      return {
        processed: payments.length,
        cancelled: updatedPayments?.length ?? 0,
        errors,
      };
    } catch (error) {
      if (!parentTransaction) {
        await trx.rollback();
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error cancelling payments:', error);
      throw new BaseError(`Failed to cancel payments: ${message}`);
    }
  }

  async disablePaymentLink(
    paymentIds: string[],
  ): Promise<{ errors: { payment_id: string; message: string }[] }> {
    // Deactivate payment resources per payment with retries and capture failures
    const errors: { payment_id: string; message: string }[] = [];
    const maxAttempts = 1;
    const backoffForAttempt = (attempt: number) =>
      200 * Math.pow(2, attempt - 1); // 200ms, 400ms, 800ms
    const payments =
      await this.paymentRepository.findPaymentsWithReservationsAndHotelId(
        paymentIds,
      );

    // Pre-fetch payment account IDs for all unique hotels to avoid N+1 queries
    // inside Promise.all which can exhaust the connection pool.
    const paymentsToLookup = payments.filter(
      (p) =>
        p.payment_provider !== PaymentProvider.SHIFT4 &&
        !REVIEW_PAGE_LINK_PROVIDERS.has(p.payment_provider) &&
        p.payment_link &&
        p.payment_link_id &&
        !p.payment_link_disabled,
    );
    const uniqueHotelIds = [
      ...new Set(paymentsToLookup.map((p) => p.hotel_id).filter(Boolean)),
    ];
    const paymentAccountIdMap = new Map<string, string | undefined>();
    for (const hid of uniqueHotelIds) {
      try {
        const accountId =
          await this.hotelConfigurationService.getPaymentAccountIdByHotelId(
            hid,
          );
        paymentAccountIdMap.set(hid, accountId ?? undefined);
      } catch (error) {
        logger.error(
          `disablePaymentLink: Error getting payment account ID for hotel ${hid}: ${error}`,
        );
        errors.push({
          payment_id: '',
          message: `Error getting payment account ID: ${error}`,
        });
        continue;
      }
    }

    await Promise.all(
      payments.map(async (p) => {
        // If there is no payment_link, there is nothing to disable; treat as success
        if (!p.payment_link || !p.payment_link_id) {
          return;
        }

        // Ignore if already disabled
        if (p.payment_link_disabled) {
          return;
        }

        // Nothing is hosted externally for these, so the link dies with the
        // flag. Returning here keeps the dispatch below about real hosted
        // links, and stops a review page URL reaching Stripe, which would be
        // asked to deactivate a link id it never issued.
        if (REVIEW_PAGE_LINK_PROVIDERS.has(p.payment_provider)) {
          await this.paymentRepository.update(p.id, {
            payment_link_disabled: true,
          });
          return;
        }

        const hotelId = p.hotel_id;
        const paymentProvider = p.payment_provider;

        const aggregateErrors: string[] = [];
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            if (paymentProvider === PaymentProvider.SHIFT4) {
              // Disable Shift4 payment link
              await this.shift4Service.disablePaymentLink(p.payment_link_id);
              // Mark payment link as disabled in database
              await this.paymentRepository.update(p.id, {
                payment_link_disabled: true,
              });
              return;
            } else {
              // Default to Stripe
              // If a connected account exists, disable the payment link with the connected account.
              // The product and price will be deactivated in the connected account.
              // If no connected account exists, disable the payment link with the platform account.
              // The product and price will be deactivated in the platform account.
              if (!p.payment_link_id) {
                return;
              }
              const connectedAccountID = paymentAccountIdMap.get(hotelId);
              const result =
                await this.stripeService.deactivatePaymentResources(
                  p.payment_link_id,
                  connectedAccountID,
                );
              // Record any non-fatal Stripe errors (e.g., price/product failures)
              if (result.errors?.length) {
                for (const msg of result.errors) {
                  errors.push({ payment_id: p.id, message: `stripe: ${msg}` });
                }
              }
              if (!result.linkDisabled) {
                throw new Error(
                  `Payment link ${result.paymentLinkId} was not disabled`,
                );
              }
              // Mark payment link as disabled in database
              await this.paymentRepository.update(p.id, {
                payment_link_disabled: true,
              });
              // Success if link disabled
              return;
            }
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'Unknown error';
            aggregateErrors.push(message);
            logger.error(
              `Attempt ${attempt} to deactivate ${paymentProvider} resources for payment ${p.id} failed:`,
              err,
            );
            if (attempt < maxAttempts) {
              await new Promise((r) =>
                setTimeout(r, backoffForAttempt(attempt)),
              );
            }
          }
        }
        // All attempts failed
        errors.push({
          payment_id: p.id,
          message: `Failed to deactivate ${paymentProvider} payment link after ${maxAttempts} attempts: ${aggregateErrors.join(' | ')}`,
        });
      }),
    );
    return { errors };
  }

  async sendPaymentReminderSMS(
    paymentId: string,
    toPhone: string,
    firstName: string,
    hotelName: string,
    url: string,
    minutesLeft: number,
    hotelPhoneNumber: string,
    reminderNumber: number,
    hotelSmsNumber: string,
    hotelCountry: Country,
    sessionId: string,
    type: SessionType,
    smsAgentEnabled: boolean,
    hotelId: string,
    hotelInternalPhoneNumber?: string,
    twilioConfiguration?: TwilioConfiguration | null,
  ) {
    try {
      const identifier = url.split('/').pop();
      const hotelPath = (hotelName || 'hotels')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
      const secureUrl = `${config.SECURE_URL}/${hotelPath}/${identifier}`;
      const paymentUrl = [
        SessionType.CALL,
        SessionType.CHAT,
        SessionType.SMS,
      ].includes(type)
        ? secureUrl
        : url;

      if (!firstName) {
        throw new BadRequestError(
          `sendPaymentReminderSMS:: No first name provided for customer. Payment ID: ${paymentId}`,
        );
      }
      if (!hotelName) {
        throw new BadRequestError(
          `sendPaymentReminderSMS:: No hotel name provided for hotel. Payment ID: ${paymentId}`,
        );
      }
      if (!hotelPhoneNumber) {
        throw new BadRequestError(
          `sendPaymentReminderSMS:: No assistant phone number provided for hotel. Payment ID: ${paymentId}`,
        );
      }
      if (!hotelSmsNumber) {
        throw new BadRequestError(
          `sendPaymentReminderSMS:: No SMS number provided for hotel. Payment ID: ${paymentId}`,
        );
      }
      if (!hotelCountry) {
        throw new BadRequestError(
          `sendPaymentReminderSMS:: No country provided for hotel. Payment ID: ${paymentId}`,
        );
      }
      if (!hotelId) {
        throw new BadRequestError(
          `sendPaymentReminderSMS:: No hotel ID provided for hotel. Payment ID: ${paymentId}`,
        );
      }

      const body = paymentReminderSMSTemplate(
        firstName,
        hotelName,
        paymentUrl,
        minutesLeft,
        hotelInternalPhoneNumber || hotelPhoneNumber,
        hotelCountry,
        reminderNumber,
        smsAgentEnabled,
      );
      const smsContent: NotificationSMSContent = {
        message: body,
        from: hotelSmsNumber,
        twilioConfiguration,
      };
      const smsPayload: NotificationPayload = {
        recipient: toPhone,
        content: smsContent,
      };
      const smsResult = await this.smsService.sendMessage(smsPayload);
      if (smsResult) {
        smsEvents.emitSmsSent({
          sessionId,
          message: smsContent.message,
          from: smsContent.from,
          to: toPhone,
          callerPhoneNumber: toPhone,
          assistantPhoneNumber: hotelPhoneNumber,
          timestamp: new Date(),
          hotelSmsNumber,
          smsAgentEnabled,
          hotelId,
        });
      }
      await this.paymentRepository.updateNotificationCount(paymentId);
    } catch (error) {
      logger.error(
        `Error sending payment reminder SMS: ${JSON.stringify(error)}`,
      );
      throw error;
    }
  }

  public async findPaymentWithReservationsByPaymentId(paymentId: string) {
    return this.paymentRepository.findByPaymentIdWithReservations(paymentId);
  }

  /**
   * Generate a unique invoice ID for Shift4 payments
   * Checks database to ensure uniqueness
   * @returns Unique 10-digit invoice ID
   */
  async generateUniqueInvoiceId(): Promise<string> {
    const maxAttempts = 50;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const invoiceId = generateInvoiceId();

      // Check if this invoice ID already exists in payments table
      const existingPayment =
        await this.findPaymentWithReservationsByPaymentLinkSuffix(invoiceId);

      if (!existingPayment) {
        return invoiceId;
      }

      attempts++;
      logger.warn(
        `generateUniqueInvoiceId: Invoice ID ${invoiceId} already exists, attempt ${attempts}/${maxAttempts}`,
      );
    }

    throw new BaseError(
      'Failed to generate unique invoice ID after maximum attempts',
    );
  }

  public async findPaymentWithReservationsByPaymentLinkSuffix(
    paymentLinkSuffix: string,
  ) {
    // Try Shift4 first: the suffix is the payment_link_id
    let payment =
      await this.paymentRepository.findByPaymentLinkIdWithReservations(
        paymentLinkSuffix,
      );

    if (payment) {
      return payment;
    }

    // Fall back to Stripe: construct the full payment link URL
    const paymentBaseUrl = config.STRIPE_PAYMENT_LINK_URL;
    const paymentLink = `${paymentBaseUrl}/${paymentLinkSuffix}`;
    return this.paymentRepository.findByPaymentLinkWithReservations(
      paymentLink,
    );
  }

  /**
   * Creates an auto-finalize invoice for auto-charge functionality
   * @param params Invoice creation parameters
   * @returns Created invoice
   */
  async createInvoice(params: CreateInvoiceParams) {
    try {
      logger.info(
        `Creating auto-charge invoice for customer ${params.customer_id}`,
      );
      return await this.stripeService.createInvoice(params);
    } catch (error) {
      logger.error('createInvoice: Error creating auto-charge invoice:', error);
      throw error;
    }
  }

  /**
   * Processes a refund for a booking
   */
  async processBookingRefund(params: {
    refundablePayments: PaymentRefundInfo[];
    requestedRefundAmount: number;
    refundableAmount: number;
    reason?: string;
    initiatedBy?: string;
    connectedAccountId?: string;
    cardMetadata?: CardMetadata | null | undefined;
    checkInDate: Date;
    checkOutDate: Date;
    hotelCheckInTime?: string;
    hotelCheckOutTime?: string;
  }): Promise<RefundProcessResult> {
    const {
      refundablePayments,
      requestedRefundAmount,
      refundableAmount,
      reason,
      connectedAccountId,
      cardMetadata,
      checkInDate,
      checkOutDate,
      hotelCheckInTime,
      hotelCheckOutTime,
    } = params;

    try {
      if (requestedRefundAmount > refundableAmount) {
        throw new BadRequestError(
          `Requested refund amount ${roundCurrency(requestedRefundAmount)} exceeds refundable amount ${roundCurrency(refundableAmount)}`,
        );
      }

      // Select payments using first-fit algorithm (sorted by refundable amount)
      const selectedPayments = await this.selectPaymentsForRefund(
        refundablePayments,
        requestedRefundAmount,
      );

      const refundedPayments: RefundedPaymentInfo[] = [];
      const failedRefunds: RefundFailure[] = [];
      let totalRefunded = 0;

      // Process refunds for selected payments
      for (const { payment, refundAmount } of selectedPayments) {
        try {
          const paymentProvider = payment.paymentProvider;

          if (paymentProvider === PaymentProvider.STRIPE) {
            await this.initiateStripeRefund({
              payment,
              refundAmount,
              reason,
              connectedAccountId,
            });
          } else if (paymentProvider === PaymentProvider.SHIFT4) {
            await this.initiateShift4Refund({
              payment,
              refundAmount,
              reason,
              cardMetadata,
              checkInDate,
              checkOutDate,
              hotelCheckInTime,
              hotelCheckOutTime,
            });
          } else if (paymentProvider === PaymentProvider.MEWS) {
            await this.initiateMewsRefund({
              payment,
              refundAmount,
              reason,
            });
          } else if (paymentProvider === PaymentProvider.AUTHORIZE_NET) {
            await this.initiateAuthorizeNetRefund({
              payment,
              refundAmount,
              cardMetadata,
            });
          } else if (paymentProvider === PaymentProvider.OPERA) {
            await this.initiateOperaRefund({
              payment,
              refundAmount,
              reason,
            });
          } else {
            throw new BadRequestError(
              `Unsupported payment provider: ${paymentProvider}`,
            );
          }

          refundedPayments.push({
            paymentId: payment.paymentId,
            refundAmount,
            status: 'processing',
          });

          totalRefunded = roundCurrency(totalRefunded + refundAmount);

          logger.info(
            `Refund initiated for payment ${payment.paymentId}: ${roundCurrency(refundAmount)}`,
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          logger.error(
            `Failed to process refund for payment ${payment.paymentId}:`,
            error,
          );

          failedRefunds.push({
            paymentId: payment.paymentId,
            error: errorMessage,
            refundAmount,
          });
        }
      }

      return {
        success: failedRefunds.length === 0,
        totalRefundAmount: totalRefunded,
        selectedPayments: refundedPayments,
        failedRefunds: failedRefunds.length > 0 ? failedRefunds : undefined,
      };
    } catch (error) {
      logger.error(`processBookingRefund: Error processing refund:`, error);
      throw error;
    }
  }

  /**
   * Creates an invoice item for an existing invoice
   * @param params Invoice item parameters
   * @returns Created invoice item
   */
  async createInvoiceItem(params: CreateInvoiceItemParams) {
    try {
      logger.info(`Creating invoice item for invoice ${params.invoice}`);
      return await this.stripeService.createInvoiceItem(params);
    } catch (error) {
      logger.error('createInvoiceItem: Error creating invoice item:', error);
      throw error;
    }
  }

  async updateAutoCharge(invoiceId: string, params: UpdateInvoiceParams) {
    try {
      const invoice = await this.stripeService.getInvoiceByInvoiceId(
        invoiceId,
        params.connectedAccountId,
      );
      if (invoice.status === 'paid' || invoice.status === 'void') {
        logger.info(
          `updateAutoCharge: Invoice ${invoiceId} is already ${invoice.status}, no action can be performed.`,
        );
        return invoice;
      }
      logger.info(`Updating auto-charge invoice ${invoiceId}`);
      return await this.stripeService.updateInvoice(invoiceId, params);
    } catch (error) {
      logger.error(
        'updateAutoCharge: Error updating auto-charge invoice:',
        error,
      );
      throw error;
    }
  }

  async disableAutoCharge(invoiceId: string, connectedAccountId?: string) {
    try {
      logger.info(`Disabling auto-charge for invoice ${invoiceId}`);
      return await this.updateAutoCharge(invoiceId, {
        auto_finalize_at: undefined,
        auto_advance: false,
        connectedAccountId,
      });
    } catch (error) {
      logger.error(
        'disableAutoCharge: Error disabling auto-charge invoice:',
        error,
      );
      throw error;
    }
  }

  async getInvoiceByInvoiceId(
    invoiceId: string,
    connectedAccountId?: string,
  ): Promise<Stripe.Invoice> {
    return this.stripeService.getInvoiceByInvoiceId(
      invoiceId,
      connectedAccountId,
    );
  }

  async voidInvoice(
    invoiceId: string,
    connectedAccountId?: string,
  ): Promise<Stripe.Invoice> {
    return this.stripeService.voidInvoice(invoiceId, connectedAccountId);
  }

  /**
   * Gets refundable payments for reservation IDs
   */
  async getRefundablePaymentsByReservationIds(
    reservationIds: string[],
    hotelId: string,
    hotelTimezone: string,
  ): Promise<PaymentRefundInfo[]> {
    try {
      const paymentIds =
        await this.paymentReservationRepository.getPaymentIdsByReservationIds(
          reservationIds,
        );
      const uniquePaymentIds = [...new Set(paymentIds)];

      const uniquePayments = await this.paymentRepository.findByIds(
        uniquePaymentIds,
        [
          PaymentStatus.COMPLETED,
          PaymentStatus.REFUNDED,
          PaymentStatus.REFUND_FAILED,
        ],
      );

      const refundablePayments = uniquePayments.filter((payment) => {
        const refundableAmount =
          payment.amount_charged - (payment.amount_refunded || 0);
        return refundableAmount > 0 && payment.booking_confirmation_id; // Ensure booking_confirmation_id exists
      });

      return refundablePayments.map((payment) => ({
        paymentId: payment.id,
        amountCharged: payment.amount_charged,
        amountRefunded: payment.amount_refunded || 0,
        refundableAmount:
          payment.amount_charged - (payment.amount_refunded || 0),
        paymentStatus: payment.payment_status,
        createdAt: payment.created_at!,
        bookingConfirmationId: payment.booking_confirmation_id,
        paymentProvider: payment.payment_provider,
        hotelId,
        hotelTimezone,
      }));
    } catch (error) {
      logger.error(
        `getRefundablePaymentsByReservationIds: Error getting refundable payments for reservation IDs ${JSON.stringify(reservationIds)}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Updates the amount of an invoice item for a given invoice
   * Assumes the invoice has only one invoice item
   * @param invoiceId The invoice ID
   * @param amount The new amount in dollars
   * @param currency The currency code (e.g., 'usd')
   * @param description Optional new description for the invoice item
   * @param connectedAccountID Optional connected account ID
   * @returns Updated invoice item
   */
  async updateInvoiceItemAmountByInvoiceId(
    invoiceId: string,
    amount: number,
    currency: string,
    description?: string,
    connectedAccountID?: string,
  ) {
    try {
      logger.info(
        `Updating invoice item amount for invoice ${invoiceId} to ${formatCurrencyAmount(currency, amount)}`,
      );
      return await this.stripeService.updateInvoiceItemAmountByInvoiceId(
        invoiceId,
        amount,
        description,
        connectedAccountID,
      );
    } catch (error) {
      logger.error(
        'updateInvoiceItemAmountByInvoiceId: Error updating invoice item amount:',
        error,
      );
      throw error;
    }
  }

  /**
   * Selects payments for refund using first-fit algorithm (sorted by refundable amount)
   */
  private async selectPaymentsForRefund(
    refundablePayments: PaymentRefundInfo[],
    requestedAmount: number,
  ): Promise<Array<{ payment: PaymentRefundInfo; refundAmount: number }>> {
    const selectedPayments: Array<{
      payment: PaymentRefundInfo;
      refundAmount: number;
    }> = [];
    let remainingAmount = roundCurrency(requestedAmount);

    // Sort by refundable amount (largest first) as requested
    const sortedPayments = refundablePayments
      .filter((p) => p.refundableAmount > 0)
      .sort((a, b) => b.refundableAmount - a.refundableAmount);

    for (const payment of sortedPayments) {
      if (remainingAmount <= 0) break;

      const refundFromThisPayment = roundCurrency(
        Math.min(remainingAmount, payment.refundableAmount),
      );

      selectedPayments.push({
        payment,
        refundAmount: refundFromThisPayment,
      });

      remainingAmount = roundCurrency(remainingAmount - refundFromThisPayment);
    }

    if (remainingAmount > 0) {
      throw new BadRequestError(
        `Insufficient refundable amount. Requested: ${roundCurrency(requestedAmount)}, Available: ${roundCurrency(requestedAmount - remainingAmount)}`,
      );
    }

    return selectedPayments;
  }

  /**
   * Initiates a Stripe refund for a payment
   */
  async initiateStripeRefund(params: PaymentRefundParams): Promise<Payment> {
    const { payment, refundAmount, reason, connectedAccountId } = params;

    try {
      // Update payment status to REFUND_IN_PROGRESS
      const updatedPayment =
        await this.paymentRepository.updatePaymentForRefund(
          payment.paymentId,
          0,
          PaymentStatus.REFUND_IN_PROGRESS,
          {
            refund_initiated_at: new Date(),
            refund_reason: reason || 'Customer request',
          },
        );

      if (!updatedPayment) {
        throw new NoDataError(`Payment not found for ID ${payment.paymentId}`);
      }

      // Create refund in Stripe
      try {
        await this.stripeService.createRefund({
          chargeId: payment.bookingConfirmationId,
          amount: Math.floor(refundAmount * 100), // Convert to cents
          metadata: {
            payment_id: payment.paymentId,
            charge_id: payment.bookingConfirmationId || '',
            refund_amount: refundAmount.toString(),
            reason: reason || 'Customer request',
          },
          connectedAccountId,
        });
      } catch (error) {
        logger.error(
          `initiateStripeRefund: Error creating refund in Stripe for payment ${payment.paymentId}:`,
          error,
        );
        await this.paymentRepository.updatePaymentForRefund(
          payment.paymentId,
          0,
          PaymentStatus.REFUND_FAILED,
          {
            refund_failed_at: new Date(),
            refund_status: RefundStatus.FAILED,
            refund_failure_reason:
              error instanceof Error ? error.message : 'Unknown error',
          },
        );
        throw error;
      }

      return updatedPayment;
    } catch (error) {
      logger.error(
        `initiateStripeRefund: Error initiating refund for payment ${payment.paymentId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Initiates a Shift4 refund for a payment
   */
  async initiateShift4Refund(params: {
    payment: PaymentRefundInfo;
    refundAmount: number;
    reason?: string;
    cardMetadata?: CardMetadata | null | undefined;
    checkInDate: Date;
    checkOutDate: Date;
    hotelCheckInTime?: string;
    hotelCheckOutTime?: string;
  }): Promise<Payment | null> {
    const {
      payment,
      refundAmount,
      reason,
      cardMetadata,
      checkInDate,
      checkOutDate,
      hotelCheckInTime,
      hotelCheckOutTime,
    } = params;

    // Validate card metadata upfront
    if (
      !cardMetadata?.token ||
      !cardMetadata?.expiration_month ||
      !cardMetadata?.expiration_year
    ) {
      throw new BadRequestError(
        'initiateShift4Refund: Card token and expiration date are required for Shift4 refund',
      );
    }

    // Get hotel-specific Shift4 access token from payment metadata or config
    const hotelId = payment.hotelId;
    const hotelShift4Config = config.HOTEL_SHIFT4_CONFIG?.[hotelId];
    const accessToken = hotelShift4Config?.accessToken;

    if (!accessToken) {
      throw new BadRequestError(
        'initiateShift4Refund: Shift4 access token not configured for this hotel',
      );
    }

    // Step 1: Update payment status to REFUND_IN_PROGRESS in a transaction
    let refundInProgressUpdatedPayment: Payment | null;
    const firstTransaction = await this.paymentRepository.startTransaction();

    try {
      refundInProgressUpdatedPayment =
        await this.paymentRepository.updatePaymentForRefund(
          payment.paymentId,
          0,
          PaymentStatus.REFUND_IN_PROGRESS,
          {
            refund_initiated_at: new Date(),
            refund_reason: reason || 'Customer request',
          },
          firstTransaction,
        );

      if (!refundInProgressUpdatedPayment) {
        throw new NoDataError(
          `initiateShift4Refund: Payment not found for ID ${payment.paymentId}`,
        );
      }
      if (!refundInProgressUpdatedPayment.booking_confirmation_id) {
        throw new NoDataError(
          `initiateShift4Refund: booking_confirmation_id not found for payment ${payment.paymentId}`,
        );
      }

      await firstTransaction.commit();
      logger.info(`Payment ${payment.paymentId} updated to REFUND_IN_PROGRESS`);
    } catch (error) {
      await firstTransaction.rollback();
      logger.error(
        `initiateShift4Refund: Error updating payment to REFUND_IN_PROGRESS:`,
        error,
      );
      throw error;
    }

    // Step 2: Build hotel transaction details from provided reservation data
    const { arrivalDateTime, departureDateTime } =
      this.buildReservationDateTimes(
        checkInDate,
        checkOutDate,
        payment.hotelTimezone,
        hotelCheckInTime,
        hotelCheckOutTime,
      );

    // Step 3: Generate unique invoice ID and call Shift4 API (outside transaction)
    let refundResponse: Shift4RefundTransactionResponse;
    let refundInvoiceId: string;

    try {
      refundInvoiceId = await this.generateUniqueInvoiceId();

      // Prepare Shift4 refund request
      const refundRequest: Shift4RefundTransactionRequest = {
        dateTime: dayjs()
          .tz(payment.hotelTimezone)
          .format('YYYY-MM-DDTHH:mm:ss.SSSZ'),
        amount: {
          total: refundAmount,
          tax: 0,
        },
        card: {
          present: CardPresent.NO,
          token: {
            value: cardMetadata.token,
          },
          expirationDate: parseInt(
            `${cardMetadata.expiration_month}${cardMetadata.expiration_year.slice(-2)}`,
          ),
        },
        transaction: {
          invoice: refundInvoiceId,
          originalInvoice:
            refundInProgressUpdatedPayment.booking_confirmation_id,
          notes: reason || 'Customer refund request',
          hotel: {
            arrivalDateTime,
            departureDateTime,
          },
        },
      };

      // Call Shift4 API to process refund (outside transaction)
      refundResponse = await shift4Service.refundTransaction(
        refundRequest,
        accessToken,
      );
    } catch (error) {
      // API call failed - update payment to REFUND_FAILED
      logger.error(
        `initiateShift4Refund: Shift4 API call failed for payment ${payment.paymentId}:`,
        error,
      );

      const failureTransaction =
        await this.paymentRepository.startTransaction();
      try {
        await this.paymentRepository.updatePaymentForRefund(
          payment.paymentId,
          0,
          PaymentStatus.REFUND_FAILED,
          {
            refund_failed_at: new Date(),
            refund_status: RefundStatus.FAILED,
            refund_failure_reason:
              error instanceof Error ? error.message : 'API call failed',
          },
          failureTransaction,
        );
        await failureTransaction.commit();
      } catch (updateError) {
        await failureTransaction.rollback();
        logger.error(
          `initiateShift4Refund: Error updating payment to REFUND_FAILED:`,
          updateError,
        );
      }
      throw error;
    }

    // Step 3: Process API response and update payment to final status in a new transaction
    const secondTransaction = await this.paymentRepository.startTransaction();
    let refundedPayment: Payment | null = null;
    let transactionCompleted = false;

    try {
      if (refundResponse.result && refundResponse.result.length > 0) {
        const result = refundResponse.result[0];
        const responseCode = result.transaction.responseCode;

        if (
          [
            Shift4ResponseCode.APPROVED,
            Shift4ResponseCode.APPROVED_CEILING,
          ].includes(responseCode)
        ) {
          // Refund approved - update payment status and store refund invoice ID in metadata
          const currentMetadata = refundInProgressUpdatedPayment.metadata;
          const refundInvoiceIds =
            currentMetadata?.shift4_refund_invoice_data || [];
          refundInvoiceIds.push({
            invoice_id: refundInvoiceId,
            amount: refundAmount,
            timestamp: new Date().toISOString(),
            reason: reason || 'Customer request',
          });

          refundedPayment = await this.paymentRepository.updatePaymentForRefund(
            payment.paymentId,
            refundAmount,
            PaymentStatus.REFUNDED,
            {
              refund_completed_at: new Date(),
              refund_status: RefundStatus.COMPLETED,
              ...currentMetadata,
              shift4_refund_invoice_data: refundInvoiceIds,
            },
            secondTransaction,
          );

          await secondTransaction.commit();
          paymentEvents.emitRefundCompleted({ paymentId: payment.paymentId });
          transactionCompleted = true;
          logger.info(
            `Shift4 refund approved for payment ${payment.paymentId}, refund invoice: ${refundInvoiceId}`,
          );
        } else {
          // Refund declined or error
          await this.paymentRepository.updatePaymentForRefund(
            payment.paymentId,
            0,
            PaymentStatus.REFUND_FAILED,
            {
              refund_failed_at: new Date(),
              refund_status: RefundStatus.FAILED,
              refund_failure_reason:
                result.transaction.hostResponse?.reasonDescription ||
                'Refund declined',
            },
            secondTransaction,
          );
          await secondTransaction.commit();
          transactionCompleted = true;
          throw new BadRequestError(
            `Shift4 refund declined: ${result.transaction.hostResponse?.reasonDescription || 'Unknown reason'}`,
          );
        }
      } else {
        throw new BadRequestError('Invalid Shift4 refund response');
      }

      return refundedPayment;
    } catch (error) {
      if (!transactionCompleted) {
        await secondTransaction.rollback();
      }
      logger.error(
        `initiateShift4Refund: Error processing refund response for payment ${payment.paymentId}:`,
        error,
      );

      // Update payment to REFUND_FAILED if not already updated
      if (!transactionCompleted) {
        try {
          await this.paymentRepository.updatePaymentForRefund(
            payment.paymentId,
            0,
            PaymentStatus.REFUND_FAILED,
            {
              refund_failed_at: new Date(),
              refund_status: RefundStatus.FAILED,
              refund_failure_reason:
                error instanceof Error ? error.message : 'Unknown error',
            },
          );
        } catch (updateError) {
          logger.error(
            `initiateShift4Refund: Error updating payment status to REFUND_FAILED:`,
            updateError,
          );
        }
      }

      throw error;
    }
  }

  async initiateMewsRefund(params: {
    payment: PaymentRefundInfo;
    refundAmount: number;
    reason?: string;
  }): Promise<void> {
    const { payment, refundAmount, reason } = params;

    const fullPayment = await this.paymentRepository.findById(
      payment.paymentId,
    );
    if (!fullPayment) {
      throw new NoDataError(
        `initiateMewsRefund: Payment not found for ID ${payment.paymentId}`,
      );
    }

    const mewsPaymentId = fullPayment.booking_confirmation_id;
    if (!mewsPaymentId) {
      throw new BadRequestError(
        `initiateMewsRefund: booking_confirmation_id (Mews PaymentId) not found for payment ${payment.paymentId}`,
      );
    }

    const metadata = fullPayment.metadata;
    const mewsAccountId = metadata?.mews_account_id;
    if (!mewsAccountId) {
      throw new BadRequestError(
        `initiateMewsRefund: mews_account_id not found in payment metadata for payment ${payment.paymentId}`,
      );
    }

    try {
      const refundResponse =
        await this.mewsPaymentProviderService.refundCardPaymentByHotelId({
          hotelId: payment.hotelId,
          mewsPaymentId,
          mewsAccountId,
          reason: reason || 'Customer request',
          amount: refundAmount,
        });

      logger.info(
        `initiateMewsRefund: Refund response for payment ${payment.paymentId}`,
        { state: refundResponse.State, refundId: refundResponse.RefundId },
      );

      let newStatus: PaymentStatus;
      if (refundResponse.State === MewsPaymentState.CHARGED) {
        newStatus = PaymentStatus.REFUNDED;
      } else if (
        refundResponse.State === MewsPaymentState.FAILED ||
        refundResponse.State === MewsPaymentState.CANCELED
      ) {
        newStatus = PaymentStatus.REFUND_FAILED;
      } else {
        newStatus = PaymentStatus.REFUND_IN_PROGRESS;
      }

      await this.paymentRepository.updatePaymentForRefund(
        payment.paymentId,
        refundAmount,
        newStatus,
        {
          refund_initiated_at: new Date(),
          refund_reason: reason || 'Customer request',
        },
      );

      if (newStatus === PaymentStatus.REFUNDED) {
        paymentEvents.emitRefundCompleted({ paymentId: payment.paymentId });
      }
    } catch (error) {
      logger.error(
        `initiateMewsRefund: Error processing refund for payment ${payment.paymentId}:`,
        error,
      );

      try {
        await this.paymentRepository.updatePaymentForRefund(
          payment.paymentId,
          0,
          PaymentStatus.REFUND_FAILED,
          {},
        );
      } catch (updateError) {
        logger.error(
          `initiateMewsRefund: Error updating payment status to REFUND_FAILED:`,
          updateError,
        );
      }

      throw error;
    }
  }

  async initiateAuthorizeNetRefund(params: {
    payment: PaymentRefundInfo;
    refundAmount: number;
    cardMetadata?: CardMetadata | null;
  }): Promise<void> {
    const { payment, refundAmount, cardMetadata } = params;

    const fullPayment = await this.paymentRepository.findById(
      payment.paymentId,
    );
    if (!fullPayment) {
      throw new NoDataError(
        `initiateAuthorizeNetRefund: Payment not found for ID ${payment.paymentId}`,
      );
    }

    const refTransId = fullPayment.booking_confirmation_id;
    if (!refTransId) {
      throw new BadRequestError(
        `initiateAuthorizeNetRefund: booking_confirmation_id (transactionId) not found for payment ${payment.paymentId}`,
      );
    }

    const lastFour = cardMetadata?.authnet_last_four;
    if (!lastFour) {
      throw new BadRequestError(
        `initiateAuthorizeNetRefund: authnet_last_four not found in card metadata for payment ${payment.paymentId}`,
      );
    }

    const accessToken = await authorizeNetTokenService.getAccessTokenForHotel(
      payment.hotelId,
    );

    try {
      await this.paymentRepository.updatePaymentForRefund(
        payment.paymentId,
        0,
        PaymentStatus.REFUND_IN_PROGRESS,
        { refund_initiated_at: new Date() },
      );

      const refundResult = await authorizeNetService.refundTransaction(
        accessToken,
        refundAmount,
        refTransId,
        lastFour,
      );

      logger.info(
        `initiateAuthorizeNetRefund: Refund succeeded for payment ${payment.paymentId}`,
        { refundTransId: refundResult.transactionId },
      );

      await this.paymentRepository.updatePaymentForRefund(
        payment.paymentId,
        refundAmount,
        PaymentStatus.REFUNDED,
        { refund_initiated_at: new Date() },
      );

      paymentEvents.emitRefundCompleted({ paymentId: payment.paymentId });
    } catch (error) {
      logger.error(
        `initiateAuthorizeNetRefund: Error processing refund for payment ${payment.paymentId}:`,
        error,
      );

      try {
        await this.paymentRepository.updatePaymentForRefund(
          payment.paymentId,
          0,
          PaymentStatus.REFUND_FAILED,
          {},
        );
      } catch (updateError) {
        logger.error(
          `initiateAuthorizeNetRefund: Error updating payment status to REFUND_FAILED:`,
          updateError,
        );
      }

      throw error;
    }
  }

  /**
   * Refunds an Opera-settled payment by posting a negative payment to the
   * folio, on the same card method Opera settled — that is what returns the
   * money through OPI. Opera has no refund endpoint, and a negative *charge*
   * moves the balance the wrong way (it adds credit rather than removing it).
   *
   * Unlike the Stripe/Shift4 path — where a folio post only *records* money
   * that already moved elsewhere and a failure is swallowed — this posting IS
   * the refund, so a failure must surface.
   */
  async initiateOperaRefund(params: {
    payment: PaymentRefundInfo;
    refundAmount: number;
    reason?: string;
  }): Promise<void> {
    const { payment, refundAmount, reason } = params;

    const authConfig =
      await this.hotelConfigurationService.getExternalAuthConfigByHotelId(
        payment.hotelId,
      );

    const fullPayment = await this.paymentRepository.findById(
      payment.paymentId,
    );
    const reservationIds = (
      await this.paymentReservationRepository.findByPaymentId(payment.paymentId)
    ).map((link) => link.reservation_id);
    const reservations =
      await reservationRepository.findManyByIds(reservationIds);
    const reservationId = reservations.find((r) => r.external_id)?.external_id;
    if (!reservationId) {
      throw new BadRequestError(
        `initiateOperaRefund: No Opera reservation id found for payment ${payment.paymentId}`,
      );
    }

    try {
      const postingId = await operaFolioService.postRefund({
        hotelId: payment.hotelId,
        reservationId,
        amount: refundAmount,
        currency: fullPayment?.currency || 'USD',
        paymentMethodCode: authConfig?.operaCardPaymentMethodCode ?? 'VA',
        postingReference: `Dextr refund ${payment.paymentId.slice(0, 8)}`,
      });

      logger.info(
        `initiateOperaRefund: Refund posted for payment ${payment.paymentId}`,
        { opera_posting_id: postingId, reservationId },
      );

      await this.paymentRepository.updatePaymentForRefund(
        payment.paymentId,
        refundAmount,
        PaymentStatus.REFUNDED,
        {
          refund_initiated_at: new Date(),
          refund_reason: reason || 'Customer request',
        },
      );

      paymentEvents.emitRefundCompleted({ paymentId: payment.paymentId });
    } catch (error) {
      logger.error(
        `initiateOperaRefund: Error processing refund for payment ${payment.paymentId}:`,
        error,
      );

      try {
        await this.paymentRepository.updatePaymentForRefund(
          payment.paymentId,
          0,
          PaymentStatus.REFUND_FAILED,
          {},
        );
      } catch (updateError) {
        logger.error(
          `initiateOperaRefund: Error updating payment status to REFUND_FAILED:`,
          updateError,
        );
      }

      throw error;
    }
  }

  /**
   * Builds arrival and departure datetimes from reservation dates and hotel configuration times
   */
  private buildReservationDateTimes(
    checkInDate: Date,
    checkOutDate: Date,
    hotelTimezone: string,
    hotelCheckInTime?: string,
    hotelCheckOutTime?: string,
  ): { arrivalDateTime: string; departureDateTime: string } {
    const checkInTime = hotelCheckInTime || config.DEFAULT_CHECK_IN_TIME;
    const checkOutTime = hotelCheckOutTime || config.DEFAULT_CHECK_OUT_TIME;

    const arrivalDateTime = dayjs
      .tz(checkInDate, hotelTimezone)
      .hour(parseInt(checkInTime.split(':')[0]))
      .minute(parseInt(checkInTime.split(':')[1]))
      .second(parseInt(checkInTime.split(':')[2] || '0'))
      .format('YYYY-MM-DDTHH:mm:ss.SSSZ');

    const departureDateTime = dayjs
      .tz(checkOutDate, hotelTimezone)
      .hour(parseInt(checkOutTime.split(':')[0]))
      .minute(parseInt(checkOutTime.split(':')[1]))
      .second(parseInt(checkOutTime.split(':')[2] || '0'))
      .format('YYYY-MM-DDTHH:mm:ss.SSSZ');

    if (!arrivalDateTime || !departureDateTime) {
      throw new BadRequestError(
        'buildReservationDateTimes: Cannot generate arrivalDateTime or departureDateTime',
      );
    }

    return { arrivalDateTime, departureDateTime };
  }

  /**
   * Handles successful refund webhook
   */
  async handleRefundWebhookSuccess(
    chargeId: string,
    refund: Stripe.Refund,
  ): Promise<void> {
    try {
      const payment =
        await this.paymentRepository.findByStripeChargeOrPaymentIntent(
          chargeId,
        );
      if (!payment) {
        logger.warn(
          `handleRefundWebhookSuccess: Payment not found for charge ${chargeId}`,
        );
        return;
      }

      const refundAmount = roundCurrency(refund.amount / 100); // Convert from cents
      const totalRefunded = roundCurrency(
        (payment.amount_refunded || 0) + refundAmount,
      );

      await this.paymentRepository.updatePaymentForRefund(
        payment.id,
        refundAmount,
        PaymentStatus.REFUNDED,
        {
          stripe_refund_id: refund.id,
          refund_completed_at: new Date(),
          refund_status: RefundStatus.COMPLETED,
        },
      );

      logger.info(
        `Refund completed for payment ${payment.id}: ${roundCurrency(refundAmount)}, total refunded: ${roundCurrency(totalRefunded)}`,
      );
    } catch (error) {
      logger.error(
        `handleRefundWebhookSuccess: Error handling refund success for charge ${chargeId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Handles failed refund webhook
   */
  async handleRefundWebhookFailure(
    chargeId: string,
    failure_reason?: string,
  ): Promise<void> {
    try {
      const payment =
        await this.paymentRepository.findByStripeChargeOrPaymentIntent(
          chargeId,
        );
      if (!payment) {
        logger.warn(
          `handleRefundWebhookFailure: Payment not found for charge ${chargeId}`,
        );
        return;
      }

      await this.paymentRepository.updatePaymentForRefund(
        payment.id,
        0,
        PaymentStatus.REFUND_FAILED,
        {
          refund_failed_at: new Date(),
          refund_status: RefundStatus.FAILED,
          refund_failure_reason: failure_reason || 'Unknown error',
        },
      );
    } catch (err) {
      logger.error(
        `handleRefundWebhookFailure: Error handling refund failure for refund ${chargeId}:`,
        err,
      );
    }
  }
}

const paymentService = PaymentService.getInstance();
export default paymentService;
