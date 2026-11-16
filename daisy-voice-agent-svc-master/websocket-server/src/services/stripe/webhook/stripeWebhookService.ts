import dayjs from 'dayjs';
import { isEmpty } from 'lodash';
import Stripe from 'stripe';
import { recordCollectedPaymentInOpera } from '../../../calry/services/operaPaymentRecorder';
import cloudbedsClient from '../../../cloudbeds/client/CloudbedsClient';
import { CloudbedsConfigurationError } from '../../../cloudbeds/errors';
import { resolveCloudbedsCredentials } from '../../../cloudbeds/services/cloudbedsCredentials';
import { CloudbedsPaymentType } from '../../../cloudbeds/types';
import config from '../../../config';
import { SOURCE } from '../../../constants/source';
import db from '../../../database/connection';
import { EscalationStatus } from '../../../dtos/enum/EscalationStatus';
import { PaymentStatus } from '../../../dtos/enum/PaymentStatus';
import { Reservation as ReservationDto } from '../../../dtos/Reservation';
import { BadRequestError } from '../../../errors/BadRequestError';
import { NoDataError } from '../../../errors/NoDataError';
import { UnauthorizedError } from '../../../errors/UnauthorizedError';
import { smsEvents } from '../../../events/smsEvents';
import hostawayClient from '../../../hostaway/client/hostawayClient';
import { HostawayApiError } from '../../../hostaway/errors/HostawayApiError';
import { HostawayOfflineChargeRequest } from '../../../hostaway/types/OfflineCharge';
import { Payment } from '../../../models/Payment';
import { PmsProvider } from '../../../types/enums';
import { PaymentMetadata } from '../../../types/payment';
import {
  convertToPhoneNumber,
  formatCurrencyAmount,
  formatDateToWords,
  resolveSmsTargetPhoneNumber,
  roundCurrency,
} from '../../../utils/helper';
import { KpiStat, logKpi } from '../../../utils/kpiLogger';
import logger from '../../../utils/logger';
import { setRequestContext } from '../../../utils/requestContext';
import { getReservationTotalAmount } from '../../../utils/reservation';
import customerService, {
  CustomerService,
} from '../../customer/customerService';
import escalationService, {
  EscalationService,
} from '../../escalation/escalationService';
import {
  HotelConfigurationService,
  hotelConfigurationService,
} from '../../hotelConfiguration/hotelConfigurationService';
import {
  bookingConfirmedSMSTemplate,
  guestAutoChargedSMSTemplate,
  paymentSuccessSMSTemplate,
} from '../../messaging/messageTemplates';
import {
  ChatServiceResolver,
  notificationFactory,
} from '../../notification/notificationFactory';
import { SMSNotificationService } from '../../notification/smsNotificationService';
import {
  NotificationPayload,
  NotificationSMSContent,
} from '../../notification/types';
import paymentService, { PaymentService } from '../../payment/paymentService';
import roomReservationService, {
  RoomReservationService,
} from '../../roomReservation/roomReservationService';
import {
  BookingPaymentNote,
  noPaymentBookingConfirmedTemplate,
  PaymentStatusMessage,
  paymentStatusTemplate,
} from '../../vapi/constants/telegramTemplates/paymentStatusTemplate';
import stripeService, { StripeService } from '../stripeService';
import { StripeWebhookEventType } from './StripeWebhookEventType';

interface StripeWebhookServiceParams {
  paymentService: PaymentService;
  stripeService: StripeService;
  roomReservationService: RoomReservationService;
  notificationFactory: ChatServiceResolver;
  smsService: SMSNotificationService;
  customerService: CustomerService;
  hotelConfigurationService: HotelConfigurationService;
  escalationService: EscalationService;
}

export class StripeWebhookService {
  private paymentService: PaymentService;
  private stripeService: StripeService;
  private roomReservationService: RoomReservationService;
  private notificationFactory: ChatServiceResolver;
  private smsService: SMSNotificationService;
  private customerService: CustomerService;
  private hotelConfigurationService: HotelConfigurationService;
  private escalationService: EscalationService;
  constructor(
    private readonly stripeWebhookSecret: string,
    {
      paymentService,
      stripeService,
      roomReservationService,
      notificationFactory,
      smsService,
      customerService,
      hotelConfigurationService,
      escalationService,
    }: StripeWebhookServiceParams,
  ) {
    if (!stripeWebhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is required');
    }

    // Initialize services
    this.paymentService = paymentService;
    this.stripeService = stripeService;
    this.roomReservationService = roomReservationService;
    this.notificationFactory = notificationFactory;
    this.smsService = smsService;
    this.customerService = customerService;
    this.hotelConfigurationService = hotelConfigurationService;
    this.escalationService = escalationService;
  }

  /**
   * Handles incoming Stripe webhook events
   */
  public async handleWebhookEvent(
    payload: Buffer | string,
    signature: string,
  ): Promise<void> {
    try {
      const event = this.verifyWebhookSignature(payload, signature);
      await this.processStripeEvent(event);
    } catch (error) {
      const err = error as Error;
      logger.error(`Webhook processing failed: ${err.message}`);
      throw error;
    }
  }

  /**
   * Handles incoming Stripe webhook events
   */
  public async handleConnectedAccountWebhookEvent(
    payload: Buffer | string,
    signature: string,
  ): Promise<void> {
    try {
      const event = this.verifyConnectedAccountWebhookSignature(
        payload,
        signature,
      );
      await this.processStripeEvent(event);
    } catch (error) {
      const err = error as Error;
      logger.error(
        `handleConnectedAccountWebhookEvent: Webhook processing failed: ${err.message}`,
      );
      throw error;
    }
  }

  /**
   * For platform account
   * Verifies the webhook signature and returns the event
   */
  private verifyWebhookSignature(
    payload: Buffer | string,
    signature: string,
  ): Stripe.Event {
    if (!signature) {
      throw new UnauthorizedError('Missing Stripe signature');
    }

    try {
      return this.stripeService.constructWebhookEvent(
        payload,
        signature,
        this.stripeWebhookSecret,
      ) as Stripe.Event;
    } catch (err) {
      const error = err as Error;
      logger.error(`Webhook signature verification failed: ${error.message}`);
      throw err;
    }
  }

  /**
   * For connected account
   * Verifies the webhook signature and returns the event
   */
  private verifyConnectedAccountWebhookSignature(
    payload: Buffer | string,
    signature: string,
  ): Stripe.Event {
    if (!signature) {
      throw new BadRequestError(
        'verifyConnectedAccountWebhookSignature: Missing Stripe signature',
      );
    }

    try {
      return this.stripeService.constructWebhookEvent(
        payload,
        signature,
        config.STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET,
      ) as Stripe.Event;
    } catch (err) {
      const error = err as Error;
      logger.error(
        `verifyConnectedAccountWebhookSignature: Webhook signature verification failed: ${error.message}`,
      );
      throw err;
    }
  }

  /**
   * Seeds the request context with the hotel this event belongs to.
   *
   * Stripe webhooks do not pass through `validatePhoneNumber`, so the context
   * established by `requestContextMiddleware` carries only a requestId and
   * every `logKpi` in this file falls back to the `'??'` client-id sentinel.
   * Booking metadata already travels on every Daisy-originated Stripe object,
   * so seeding from it attributes the KPI emits without touching a call site.
   *
   * Safe to call with missing metadata: the fields stay undefined and
   * `resolveKpiClientId` falls through to the same sentinel as before.
   */
  private setKpiHotelContext(metadata?: PaymentMetadata | null): void {
    if (!metadata) {
      return;
    }
    setRequestContext({
      assistantPhoneNumber: metadata.hotel_phone_number,
      hotelId: metadata.hotel_id,
    });
  }

  /**
   * Processes different types of Stripe events
   */
  private async processStripeEvent(event: Stripe.Event): Promise<void> {
    const eventType = event.type;
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const connectedAccountID = event.context; // Only present if the event was fired from a connected acount

    logger.info(`Processing Stripe event: ${eventType}`, {
      eventId: event.id,
      paymentIntentId: paymentIntent.id,
    });

    switch (eventType) {
      case StripeWebhookEventType.PaymentIntentSucceeded:
        await this.handlePaymentIntentSucceeded(
          paymentIntent,
          connectedAccountID,
        );
        break;
      case StripeWebhookEventType.PaymentIntentFailed:
        await this.handlePaymentIntentFailed(paymentIntent);
        break;
      case StripeWebhookEventType.PaymentIntentCanceled:
        logger.info(
          `Payment intent cancellation received for payment intent ${paymentIntent.id} and reservation ${paymentIntent.metadata?.reservationId ?? ''}`,
        );
        break;
      case StripeWebhookEventType.InvoicePaymentPaid:
        await this.handleInvoicePaymentSucceeded(
          event.data.object as Stripe.InvoicePayment,
          connectedAccountID,
        );
        break;
      case StripeWebhookEventType.InvoicePaymentFailed:
        await this.handleInvoicePaymentFailed(
          event.data.object as Stripe.Invoice,
        );
        break;
      case StripeWebhookEventType.RefundUpdated:
        await this.handleRefundUpdated(event.data.object as Stripe.Refund);
        break;
      case StripeWebhookEventType.CheckoutSessionCompleted: {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'setup') {
          await this.handleSetupSessionCompleted(session, connectedAccountID);
        } else {
          logger.debug(
            `Ignoring checkout.session.completed with mode=${session.mode}`,
          );
        }
        break;
      }
      default:
        logger.debug(`Unhandled event type: ${eventType}`, {
          eventId: event.id,
        });
    }
  }

  /**
   * Handles successful payment intent by updating the
   * payment status and creating a resnexus reservation
   */
  private async handlePaymentIntentSucceeded(
    paymentIntent: Stripe.PaymentIntent,
    connectedAccountID?: string,
  ): Promise<void> {
    const {
      id: paymentIntentId,
      metadata,
      latest_charge,
      customer,
      payment_method,
    } = paymentIntent;

    const typedMetadata = metadata as unknown as PaymentMetadata;
    this.setKpiHotelContext(typedMetadata);
    let connectedAccountId = connectedAccountID;
    if (!connectedAccountId && typedMetadata.hotel_id) {
      connectedAccountId =
        (await this.hotelConfigurationService.getPaymentAccountIdByHotelId(
          typedMetadata.hotel_id,
        )) ?? undefined;
    }

    const source = typedMetadata.source;
    if (
      !source ||
      typeof source !== 'string' ||
      source.toLowerCase() !== SOURCE.toLowerCase()
    ) {
      // ignore events from other services such as Alfred.
      logger.warn(
        `handlePaymentIntentSucceeded: Payment intent ${paymentIntentId || ''} / payment ID ${typedMetadata?.payment_id || ''} is not from Daisy`,
      );
      return;
    }

    const paymentId = typedMetadata?.payment_id;
    if (!paymentId) {
      // ignore events from other services such as Alfred.
      logger.warn(
        `handlePaymentIntentSucceeded: Payment ID not found in metadata`,
      );
      return;
    }

    let payment = await this.paymentService.getPaymentById(paymentId);
    if (!payment) {
      throw new NoDataError(
        `handlePaymentIntentSucceeded: Payment not found for payment ${paymentId}`,
      );
    }
    logger.info(`Payment intent succeeded for payment ${paymentId}`);

    try {
      if (typedMetadata.customer_id && customer) {
        await this.customerService.updateCustomer(typedMetadata.customer_id, {
          payment_provider_customer_id: customer as string,
        });

        // Update default payment method for the customer for future payments
        if (payment_method) {
          this.stripeService
            .updateCustomerDefaultPaymentMethod(
              customer as string,
              payment_method as string,
              connectedAccountId,
            )
            .catch((error) => {
              logger.error(
                `handlePaymentIntentSucceeded: Failed to update default payment method for customer ${typedMetadata.customer_id} with Stripe customer ID ${customer as String}: ${error}`,
              );
            });
        }
      }
      logger.info(
        `handlePaymentIntentSucceeded: Updated customer ${typedMetadata.customer_id} with Stripe customer ID ${customer as String}`,
      );
    } catch (error) {
      logger.error(
        `handlePaymentIntentSucceeded: Failed to update customer ${typedMetadata.customer_id} with Stripe customer ID ${customer as String}: ${error}`,
      );
    }
    // Update payment status in the database
    const transaction = await db.transaction();
    try {
      const paymentDataToUpdate: Partial<Payment> = {
        booking_confirmation_id: this.extractLatestChargeId(latest_charge),
        payment_link_disabled: true,
      };
      await this.paymentService.updatePaymentById(
        paymentId,
        paymentDataToUpdate,
        transaction,
      );
      await this.paymentService.updatePaymentStatusById(
        paymentId,
        PaymentStatus.COMPLETED,
        transaction,
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      logger.error(
        `handlePaymentIntentSucceeded: Error updating payment status in the database: ${JSON.stringify(error)}`,
      );
      throw error;
    }

    logKpi({
      stat: KpiStat.PaymentSuccess,
      value: 1,
      contextName: 'handlePaymentIntentSucceeded',
      contextId: paymentId,
    });

    try {
      const reservations =
        await this.roomReservationService.getReservationsByPaymentId(paymentId);
      logger.info(
        `handlePaymentIntentSucceeded: Reservation found ${JSON.stringify(reservations)}`,
      );

      // Update reservation payment status based on payment information
      await this.roomReservationService.updateReservationPaymentStatusFromPaymentInfo(
        reservations,
        'CREDIT',
      );

      if (isEmpty(reservations)) {
        throw new NoDataError(
          'handlePaymentIntentSucceeded: No active reservations found',
        );
      }

      const hotel = reservations[0].hotel;
      if (!hotel) {
        throw new NoDataError(
          `handlePaymentIntentSucceeded: No hotel found for reservation having payment ${paymentId}`,
        );
      }

      const hotelConfig =
        await this.hotelConfigurationService.getHotelConfigurationByHotelId(
          hotel.id,
        );

      const currency = hotel.currency;
      payment.amount_charged = roundCurrency(Number(payment.amount_charged));

      if (typedMetadata.action === 'manual_charge') {
        await this.roomReservationService.updateResnexusNotesForPaymentUpdate(
          reservations,
        );
        await this.createHostawayOfflineCharges(
          reservations,
          payment.amount_charged,
          hotel.currency,
        );
        const manualPaymentMethodId =
          typeof payment_method === 'string'
            ? payment_method
            : (payment_method?.id ?? undefined);
        await this.createCloudbedsPayments(
          reservations,
          payment.amount_charged,
          hotel.currency,
          manualPaymentMethodId,
          connectedAccountId,
        );
        return;
      }

      // Disable the payment link on Stripe
      if (payment.payment_link_id) {
        await this.stripeService.disablePaymentLink(
          payment.payment_link_id,
          connectedAccountId,
        );
      }

      // Use the roomReservationService to create PMS reservations
      // This handles both single and multi-room reservations
      let createdReservations: ReservationDto[] = [];
      try {
        createdReservations =
          await this.roomReservationService.finalizePmsReservations(
            reservations,
          );
      } catch (error) {
        logger.error(
          `handlePaymentIntentSucceeded: Error creating PMS reservations: ${JSON.stringify(error)}`,
        );
        try {
          await this.escalationService.handleEscalation(
            {
              phone_number: reservations[0].phone_number,
              full_name: `${reservations[0].customer.first_name} ${reservations[0].customer.last_name}`,
              message: `Payment of ${formatCurrencyAmount(currency, payment.amount_charged)} collected from customer but failed to create reservation. Please check the reservation details and take action.\nCheck-in: ${dayjs(reservations[0].check_in).format('DD/MM/YYYY')}\nCheck-out: ${dayjs(reservations[0].check_out).format('DD/MM/YYYY')}`,
              session_id: reservations[0].session_id ?? '',
              status: EscalationStatus.OPEN,
            },
            hotel.assistant_phone_number,
          );
        } catch (escalationError) {
          logger.error(
            `handlePaymentIntentSucceeded: Error sending escalation notification: ${JSON.stringify(escalationError)}`,
          );
        }
        throw error;
      }
      const guestFacingBookingIds = createdReservations
        .map((r) => r.external_public_id || r.external_id)
        .filter((id): id is string => Boolean(id));

      // Create offline charges in Hostaway for each reservation
      await this.createHostawayOfflineCharges(
        reservations,
        payment.amount_charged,
        hotel.currency,
      );
      // Record advance deposit in Cloudbeds if hotel uses Cloudbeds (no-op for other PMS)
      const intentPaymentMethodId =
        typeof payment_method === 'string'
          ? payment_method
          : (payment_method?.id ?? undefined);
      await this.createCloudbedsPayments(
        reservations,
        payment.amount_charged,
        hotel.currency,
        intentPaymentMethodId,
        connectedAccountId,
      );
      // Record the deposit on the Opera folio if the hotel is Opera-backed
      // through Calry (no-op for other PMS)
      await recordCollectedPaymentInOpera({
        reservations,
        currency: hotel.currency,
        payment,
      });
      const totalAmount = reservations.reduce(
        (acc, reservation) =>
          roundCurrency(acc + getReservationTotalAmount(reservation)),
        0,
      );

      //triggers telegram message for successful payment
      try {
        const message: PaymentStatusMessage = {
          status: PaymentStatus.COMPLETED,
          amount: roundCurrency(Number(payment.amount_charged)),
          bookingId: guestFacingBookingIds.length
            ? guestFacingBookingIds.join(', ')
            : null,
          guestFirstName: reservations[0].customer.first_name || '',
          guestLastName: reservations[0].customer.last_name || '',
          startDate: reservations[0].check_in,
          endDate: reservations[0].check_out,
          phoneNumber: reservations[0].phone_number,
          currency,
          totalAmount,
          sessionType: reservations[0].type,
        };

        const htmlMessage = paymentStatusTemplate(message);

        // Create notification payload for the notification service
        const notificationPayload: NotificationPayload = {
          recipient: hotel.telegram_alerts_group_id,
          content: {
            message: htmlMessage,
            parseMode: 'HTML',
          },
        };

        await this.notificationFactory
          .getChatService(hotel.notification_type)
          .sendMessage(notificationPayload);
        logger.info(
          `Telegram payment status message sent successfully: paymentId=${paymentId}`,
        );

        const smsBody = paymentSuccessSMSTemplate(
          formatDateToWords(dayjs(reservations[0].check_in), false),
          formatDateToWords(dayjs(reservations[0].check_out)),
          reservations[0].customer.email || '',
          roundCurrency(payment.amount_charged), // Rounded to 2 decimal places since Stripe follows this approach
          currency,
          guestFacingBookingIds.length
            ? guestFacingBookingIds.join(', ')
            : undefined,
        );

        const smsContent: NotificationSMSContent = {
          message: smsBody,
          from: convertToPhoneNumber(hotel.sms_number)!,
          twilioConfiguration: hotelConfig?.twilio_configuration,
        };
        const smsRecipientPhoneNumber = await resolveSmsTargetPhoneNumber(
          reservations[0].customer.phone_number,
          reservations[0].phone_number,
          hotelConfig?.twilio_configuration,
          hotel.country,
          false,
        );
        if (!smsRecipientPhoneNumber) {
          logger.warn(
            `Stripe webhook: No valid phone number for payment confirmation: paymentId=${paymentId}`,
          );
        } else {
          const smsPayload: NotificationPayload = {
            recipient: convertToPhoneNumber(smsRecipientPhoneNumber)!,
            content: smsContent,
          };

          const smsResult = await this.smsService.sendMessage(smsPayload);
          logger.info(
            `SMS payment confirmation sent successfully: paymentId=${paymentId}`,
          );

          if (smsResult) {
            smsEvents.emitSmsSent({
              sessionId: reservations[0].session_id,
              message: smsContent.message,
              from: hotel.sms_number,
              to: smsRecipientPhoneNumber,
              callerPhoneNumber: reservations[0].phone_number,
              assistantPhoneNumber: hotel.assistant_phone_number,
              timestamp: new Date(),
              hotelSmsNumber: hotel.sms_number,
              smsAgentEnabled: hotelConfig?.sms_agent_enabled || false,
              hotelId: hotel.id,
            });
          }
        }
      } catch (error) {
        logger.error(
          `Failed to send payment status message: paymentId=${paymentId}, error=${error}`,
        );
      }
    } catch (error) {
      const err = error as Error;
      logger.error(
        `Error processing successful payment: paymentIntentId=${paymentIntentId}, error=${err.message}`,
      );
      throw error;
    }
  }

  /**
   * Handles failed payment intent
   */
  private async handlePaymentIntentFailed(
    paymentIntent: Stripe.PaymentIntent,
  ): Promise<void> {
    const {
      id: paymentIntentId,
      last_payment_error,
      metadata,
      latest_charge,
    } = paymentIntent;
    this.setKpiHotelContext(metadata as unknown as PaymentMetadata);
    const paymentId = metadata?.paymentId;

    const source = metadata.source;
    if (
      !source ||
      typeof source !== 'string' ||
      source.toLowerCase() !== SOURCE.toLowerCase()
    ) {
      // ignore events from other services such as Alfred.
      logger.warn(
        `handlePaymentIntentFailed: Payment intent ${paymentIntentId || ''} / payment ID ${paymentId || ''} is not from Daisy`,
      );
      return;
    }

    let payment = await this.paymentService.getPaymentById(paymentId);
    if (!payment) {
      // ignore events from other services such as Alfred.
      logger.warn(
        `handlePaymentIntentFailed: Payment not found for payment ${paymentId}`,
      );
      return;
    }

    const transaction = await db.transaction();
    try {
      await this.paymentService.updatePaymentById(
        paymentId,
        {
          booking_confirmation_id: this.extractLatestChargeId(latest_charge),
        },
        transaction,
      );
      await this.paymentService.updatePaymentStatusById(
        paymentId,
        PaymentStatus.FAILED,
        transaction,
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    logKpi({
      stat: KpiStat.PaymentFailed,
      value: 1,
      contextName: 'handlePaymentIntentFailed',
      contextId: paymentId,
    });

    try {
      const reservations =
        await this.roomReservationService.getReservationsByPaymentId(paymentId);

      if (isEmpty(reservations)) {
        throw new NoDataError(
          'handlePaymentIntentFailed: No active reservations found',
        );
      }

      const hotel = reservations[0].hotel;
      if (!hotel) {
        throw new NoDataError(
          `handlePaymentIntentFailed: No hotel found for payment ${paymentId}`,
        );
      }
      const currency = hotel.currency;
      const totalAmount = reservations.reduce(
        (acc, reservation) =>
          roundCurrency(acc + getReservationTotalAmount(reservation)),
        0,
      );
      payment.amount_charged = roundCurrency(Number(payment.amount_charged));
      try {
        const message: PaymentStatusMessage = {
          status: PaymentStatus.FAILED,
          phoneNumber: reservations[0].phone_number,
          amount: roundCurrency(Number(payment.amount_charged)),
          bookingId: null, // failed payments won't have a booking ID
          guestFirstName: reservations[0].customer.first_name || '',
          guestLastName: reservations[0].customer.last_name || '',
          startDate: reservations[0].check_in,
          endDate: reservations[0].check_out,
          currency,
          totalAmount,
          sessionType: reservations[0].type,
        };

        const htmlMessage = paymentStatusTemplate(message);

        // Create notification payload for the notification service
        const notificationPayload: NotificationPayload = {
          recipient: hotel.telegram_alerts_group_id,
          content: {
            message: htmlMessage,
            parseMode: 'HTML',
          },
        };

        await this.notificationFactory
          .getChatService(hotel.notification_type)
          .sendMessage(notificationPayload);

        logger.info(
          `handlePaymentIntentFailed: Telegram payment status message sent successfully: paymentIntentId=${paymentIntentId}`,
        );
      } catch (error) {
        logger.error(
          `handlePaymentIntentFailed: Failed to send Telegram payment status message: paymentIntentId=${paymentIntentId}, error=${error}`,
        );
      }

      logger.warn(
        `Payment failed: paymentIntentId=${paymentIntentId}, error=${last_payment_error?.message || 'Unknown error'}`,
      );
    } catch (error) {
      const err = error as Error;
      logger.error(
        `Error processing failed payment: paymentIntentId=${paymentIntentId}, error=${err.message}`,
      );
      throw error;
    }
  }

  /**
   * Handles invoice payment succeeded event (same logic as payment_intent.succeeded for invoices)
   */
  private async handleInvoicePaymentSucceeded(
    invoicePayment: Stripe.InvoicePayment,
    connectedAccountId?: string,
  ): Promise<void> {
    try {
      const invoiceId = invoicePayment.invoice as string;
      const invoice = await this.stripeService.getInvoiceByInvoiceId(
        invoiceId,
        connectedAccountId,
      );
      const paymentIntent = await this.stripeService.getPaymentIntentById(
        invoicePayment.payment.payment_intent as string,
        connectedAccountId,
      );
      const metadata = invoice.metadata as unknown as PaymentMetadata;
      this.setKpiHotelContext(metadata);
      const paymentId = metadata?.payment_id;

      if (!paymentId) {
        logger.warn(
          `handleInvoicePaymentSucceeded: Payment ID not found in invoice metadata for invoice ${invoiceId}`,
        );
        return;
      }

      logger.info(
        `Invoice payment succeeded for payment ${paymentId}, invoice ${invoiceId}`,
      );

      const transaction = await db.transaction();
      try {
        const paymentDataToUpdate: Partial<Payment> = {
          booking_confirmation_id: paymentIntent.latest_charge
            ? this.extractLatestChargeId(paymentIntent.latest_charge)
            : undefined,
        };
        await this.paymentService.updatePaymentById(
          paymentId,
          paymentDataToUpdate,
          transaction,
        );
        await this.paymentService.updatePaymentStatusById(
          paymentId,
          PaymentStatus.COMPLETED,
          transaction,
        );
        await transaction.commit();
        const reservations =
          await this.roomReservationService.getReservationsByPaymentId(
            paymentId,
          );
        // Send payment receipt to customer
        const firstReservation = reservations[0];
        const hotel = firstReservation.hotel!;
        const hotelConfig =
          await this.hotelConfigurationService.getHotelConfigurationByHotelId(
            hotel.id,
          );
        try {
          const toPhone = await resolveSmsTargetPhoneNumber(
            firstReservation.customer.phone_number,
            firstReservation.phone_number,
            hotelConfig?.twilio_configuration,
            hotel.country,
            false,
          );
          if (!toPhone) {
            logger.warn(
              `handleInvoicePaymentSucceeded: No valid phone number for payment ${paymentId}`,
            );
          } else {
            const smsContent = {
              message: guestAutoChargedSMSTemplate(
                invoice.amount_paid / 100,
                firstReservation,
              ),
              from: hotel.sms_number,
              twilioConfiguration: hotelConfig?.twilio_configuration,
            };
            const smsResult = await this.smsService.sendMessage({
              recipient: toPhone,
              content: smsContent,
            });
            if (smsResult) {
              smsEvents.emitSmsSent({
                sessionId: firstReservation.session_id,
                message: smsContent.message,
                from: hotel.sms_number,
                to: toPhone,
                callerPhoneNumber: firstReservation.phone_number,
                assistantPhoneNumber: hotel.assistant_phone_number,
                timestamp: new Date(),
                hotelSmsNumber: hotel.sms_number,
                smsAgentEnabled: hotelConfig?.sms_agent_enabled || false,
                hotelId: hotel.id,
              });
            }
          }
        } catch (error) {
          logger.error(
            `handleInvoicePaymentSucceeded: Failed to send guest notification SMS for booking ${firstReservation.booking_id}, invoice ${invoiceId}: ${error}`,
          );
        }
        // Update reservation payment status
        await this.roomReservationService.updateReservationPaymentStatusFromPaymentInfo(
          reservations,
          'CREDIT',
        );

        await this.roomReservationService.updateResnexusNotesForPaymentUpdate(
          reservations,
        );

        // Create offline charges in Hostaway for each reservation
        await this.createHostawayOfflineCharges(
          reservations,
          invoice.amount_paid / 100,
          hotel.currency,
          true,
        );
        // Record the autocharge (remaining balance) in Cloudbeds if hotel uses Cloudbeds (no-op for other PMS)
        const invoicePaymentMethodId =
          typeof paymentIntent.payment_method === 'string'
            ? paymentIntent.payment_method
            : (paymentIntent.payment_method?.id ?? undefined);
        await this.createCloudbedsPayments(
          reservations,
          invoice.amount_paid / 100,
          hotel.currency,
          invoicePaymentMethodId,
          connectedAccountId,
          true,
        );
        // Record the autocharge on the Opera folio if the hotel is Opera-backed
        // through Calry (no-op for other PMS)
        const autoChargedPayment =
          await this.paymentService.getPaymentById(paymentId);
        if (autoChargedPayment) {
          await recordCollectedPaymentInOpera({
            reservations,
            currency: hotel.currency,
            payment: autoChargedPayment,
            isAutoCharge: true,
          });
        }
      } catch (error) {
        await transaction.rollback();
        logger.error(
          `handleInvoicePaymentSucceeded: Error updating payment status: ${JSON.stringify(error)}`,
        );
        throw error;
      }

      try {
        // Get reservations and process them (same as payment_intent.succeeded)
        const reservations =
          await this.roomReservationService.getReservationsByPaymentId(
            paymentId,
          );
        if (!reservations || reservations.length === 0) {
          throw new NoDataError(
            `handleInvoicePaymentSucceeded: No reservations found for payment ${paymentId}`,
          );
        }

        logKpi({
          stat: KpiStat.PaymentAutochargeSucceeded,
          value: 1,
          contextName: 'handleInvoicePaymentSucceeded',
          contextId: paymentId,
        });
        logKpi({
          stat: KpiStat.PaymentAutochargeSucceededAmount,
          value: invoice.amount_paid / 100,
          contextName: 'handleInvoicePaymentSucceeded',
          contextId: paymentId,
        });

        logger.info(
          `handleInvoicePaymentSucceeded: Successfully processed invoice payment for ${reservations.length} reservations`,
        );
      } catch (error) {
        logger.error(
          `handleInvoicePaymentSucceeded: Error processing successful invoice payment: paymentId=${paymentId}, error=${error}`,
        );
      }
    } catch (error) {
      const err = error as Error;
      logger.error(
        `Error processing invoice payment succeeded: invoiceId=${invoicePayment.invoice as string}, error=${err.message}`,
      );
      throw error;
    }
  }

  /**
   * Handles invoice payment failed event
   */
  private async handleInvoicePaymentFailed(
    invoice: Stripe.Invoice,
  ): Promise<void> {
    try {
      const invoiceId = invoice.id;
      const metadata = invoice.metadata as unknown as PaymentMetadata;
      this.setKpiHotelContext(metadata);
      const paymentId = metadata?.payment_id;

      if (!paymentId) {
        logger.warn(
          `handleInvoicePaymentFailed: Payment ID not found in invoice metadata for invoice ${invoiceId}`,
        );
        return;
      }

      logger.info(
        `Invoice payment failed for payment ${paymentId}, invoice ${invoiceId}`,
      );

      const transaction = await db.transaction();
      try {
        await this.paymentService.updatePaymentStatusById(
          paymentId,
          PaymentStatus.FAILED,
          transaction,
        );
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        logger.error(
          `handleInvoicePaymentFailed: Error updating payment status: ${JSON.stringify(error)}`,
        );
        throw error;
      }

      logKpi({
        stat: KpiStat.PaymentAutochargeFailed,
        value: 1,
        contextName: 'handleInvoicePaymentFailed',
        contextId: paymentId,
      });

      logger.info(
        `handleInvoicePaymentFailed: Payment marked as failed for payment ${paymentId}`,
      );

      try {
        const reservations =
          await this.roomReservationService.getReservationsByPaymentId(
            paymentId,
          );

        if (isEmpty(reservations)) {
          logger.warn(
            `handleInvoicePaymentFailed: No reservations found for payment ${paymentId}, skipping Telegram notification`,
          );
          return;
        }

        const hotel = reservations[0].hotel;
        if (!hotel || !hotel.telegram_alerts_group_id) {
          logger.warn(
            `handleInvoicePaymentFailed: No hotel or Telegram alerts group ID found for payment ${paymentId}, skipping Telegram notification`,
          );
          return;
        }

        const payment = await this.paymentService.getPaymentById(paymentId);
        const currency = hotel.currency;
        const totalAmount = reservations.reduce(
          (acc, reservation) =>
            roundCurrency(acc + getReservationTotalAmount(reservation)),
          0,
        );

        const message: PaymentStatusMessage = {
          status: PaymentStatus.FAILED,
          phoneNumber: reservations[0].phone_number,
          amount: roundCurrency(Number(payment?.amount_charged ?? 0)),
          bookingId: reservations[0].booking_id || null,
          guestFirstName: reservations[0].customer.first_name || '',
          guestLastName: reservations[0].customer.last_name || '',
          startDate: reservations[0].check_in,
          endDate: reservations[0].check_out,
          currency,
          totalAmount,
          sessionType: reservations[0].type,
          isAutoCharge: true,
        };

        const htmlMessage = paymentStatusTemplate(message);

        const notificationPayload: NotificationPayload = {
          recipient: hotel.telegram_alerts_group_id,
          content: {
            message: htmlMessage,
            parseMode: 'HTML',
          },
        };

        await this.notificationFactory
          .getChatService(hotel.notification_type)
          .sendMessage(notificationPayload);
        logger.info(
          `handleInvoicePaymentFailed: Telegram notification sent for payment ${paymentId}`,
        );
      } catch (notifyError) {
        logger.error(
          `handleInvoicePaymentFailed: Failed to send Telegram notification for payment ${paymentId}: ${notifyError}`,
        );
      }
    } catch (error) {
      const err = error as Error;
      logger.error(
        `Error processing invoice payment failed: invoiceId=${invoice.id}, error=${err.message}`,
      );
      throw error;
    }
  }

  private extractLatestChargeId(
    latest_charge?: Stripe.Charge | string | null,
  ): string {
    if (!latest_charge) {
      return '';
    }

    if (
      typeof latest_charge === 'object' &&
      latest_charge !== null &&
      'object' in latest_charge &&
      latest_charge.object === 'charge'
    ) {
      return latest_charge.id;
    }

    if (typeof latest_charge === 'string') {
      return latest_charge;
    }

    return JSON.stringify(latest_charge);
  }

  /**
   * Handles refund.updated webhook event
   */
  private async handleRefundUpdated(refund: Stripe.Refund): Promise<void> {
    try {
      logger.info(
        `Processing refund.updated event for refund ${refund.id} with status ${refund.status}`,
      );
      if (
        refund.metadata &&
        refund.metadata.source?.toLowerCase() !== SOURCE.toLowerCase()
      ) {
        logger.info(
          `Ignoring refund.updated event for refund ${refund.id} as it is not initiated by Daisy`,
        );
        return;
      }
      let chargeId: string;
      if (typeof refund.charge === 'string') {
        chargeId = refund.charge;
      } else if (refund.charge && typeof refund.charge === 'object') {
        chargeId = refund.charge.id;
      } else {
        throw new Error(`Invalid charge information in refund ${refund.id}`);
      }

      if (refund.status === 'succeeded') {
        await this.paymentService.handleRefundWebhookSuccess(chargeId, refund);
        const payment_id = refund.metadata?.payment_id;
        if (!payment_id) {
          throw new NoDataError(
            `Payment ID not found in refund metadata for refund ${refund.id}`,
          );
        }
        const reservations =
          await this.roomReservationService.getReservationsByPaymentId(
            payment_id,
          );
        await this.roomReservationService.updateReservationPaymentStatusFromPaymentInfo(
          reservations,
          'REFUND',
        );
        await this.roomReservationService.updateResnexusNotesForPaymentUpdate(
          reservations,
        );
        await this.roomReservationService.createCloudbedsNotesForRefund(
          reservations,
          payment_id,
          refund,
        );

        logKpi({
          stat: KpiStat.PaymentRefundSucceeded,
          value: 1,
          contextName: 'handleRefundUpdated',
          contextId: payment_id,
        });

        logger.info(
          `Successfully processed refund success for refund ${refund.id}`,
        );
      } else if (refund.status === 'failed') {
        await this.paymentService.handleRefundWebhookFailure(
          chargeId,
          refund.failure_reason,
        );

        logKpi({
          stat: KpiStat.PaymentRefundFailed,
          value: 1,
          contextName: 'handleRefundUpdated',
          contextId: refund.metadata?.payment_id,
        });

        logger.info(
          `Successfully processed refund failure for refund ${refund.id}`,
        );
      } else {
        logger.info(
          `Refund ${refund.id} has status ${refund.status}, no action taken`,
        );
      }
    } catch (error) {
      const err = error as Error;
      logger.error(
        `Error processing refund.updated event for refund ${refund.id}: ${err.message}`,
      );
      throw error;
    }
  }

  /**
   * Creates offline charges in Hostaway for each reservation after Stripe payment collection
   * @param reservations - Array of reservations to create charges for
   * @param totalAmountCharged - Total amount charged via Stripe
   * @param currency - Currency code (e.g., 'USD')
   * @param isAutoCharge - When true, posts each reservation's remaining
   *   balance (total - deposit already charged) instead of the deposit
   *   amount, and skips reservations with no remaining balance.
   */
  private async createHostawayOfflineCharges(
    reservations: ReservationDto[],
    amountCharged: number,
    currency: string,
    isAutoCharge = false,
  ): Promise<void> {
    try {
      if (reservations.length === 0) {
        logger.warn(
          'No reservations provided for Hostaway offline charge creation',
        );
        return;
      }
      if (reservations[0].pms_provider !== PmsProvider.HOSTAWAY) {
        logger.warn(
          'Reservations are not from Hostaway, skipping offline charge creation',
        );
        return;
      }

      logger.info(
        `Creating Hostaway offline charges for ${reservations.length} reservation(s)`,
      );
      let balance = roundCurrency(amountCharged);
      for (const reservation of reservations) {
        const externalId = reservation.external_id;

        if (!externalId) {
          logger.warn(
            `Skipping offline charge creation for reservation ${reservation.id} - no external_id (Hostaway reservation ID)`,
          );
          continue;
        }

        const hostawayReservationId = parseInt(externalId, 10);
        if (isNaN(hostawayReservationId)) {
          logger.error(
            `Invalid Hostaway reservation ID for reservation ${reservation.id}: ${externalId}`,
          );
          throw new HostawayApiError(
            `Invalid Hostaway reservation ID for reservation ${reservation.id}: ${externalId}`,
          );
        }
        const chargeAmount = this.computeChargeAmount(
          reservation,
          isAutoCharge,
        );
        if (chargeAmount === null) {
          logger.warn(
            `Skipping Hostaway offline charge for reservation ${reservation.id} - no remaining balance to charge`,
          );
          continue;
        }
        const hotelTimezone = reservation.hotel?.timezone || 'UTC';
        balance -= chargeAmount;
        if (balance < 0) {
          logger.warn(
            `Balance is negative (${roundCurrency(balance)}) for reservation ${reservation.id})`,
          );
        }
        try {
          const offlineChargeData: HostawayOfflineChargeRequest = {
            title: 'Stripe Payment',
            description: `Payment collected via Stripe for booking ${reservation.booking_id}`,
            amount: chargeAmount,
            paymentMethod: 'credit_card' as const,
            status: 'paid' as const,
            scheduledDate: dayjs()
              .tz(hotelTimezone)
              .format('YYYY-MM-DD HH:mm:ss'),
          };

          const response = await hostawayClient.createOfflineCharge(
            hostawayReservationId,
            offlineChargeData,
          );

          logger.info(
            `Created Hostaway offline charge for reservation ${reservation.id} (Hostaway ID: ${hostawayReservationId}): charge ID ${response.result.id}, amount ${formatCurrencyAmount(currency, chargeAmount)}`,
          );
        } catch (error) {
          logger.error(
            `Failed to create Hostaway offline charge for reservation ${reservation.id} (Hostaway ID: ${hostawayReservationId}):`,
            error,
          );
          throw new HostawayApiError(
            `Failed to create Hostaway offline charge for reservation ${reservation.id} (Hostaway ID: ${hostawayReservationId}): ${error}`,
          );
        }
      }

      logger.info(
        `Completed Hostaway offline charge creation for ${reservations.length} reservation(s)`,
      );
    } catch (error) {
      logger.error('Error in createHostawayOfflineCharges:', error);
      throw error;
    }
  }

  /**
   * Computes the amount to record with the PMS for a reservation's Stripe
   * charge. For deposit/manual-charge flows (`isAutoCharge` false), this is
   * the reservation's `quote.amount_charged` (the deposit). For autocharge,
   * it's the remaining balance (room total minus the deposit already
   * charged), since the deposit was already recorded when it was collected.
   * Returns `null` when autocharge has no remaining balance to record.
   */
  private computeChargeAmount(
    reservation: ReservationDto,
    isAutoCharge: boolean,
  ): number | null {
    const depositAmount = roundCurrency(
      Number(reservation.quote?.amount_charged ?? 0),
    );
    if (!isAutoCharge) {
      return depositAmount;
    }
    const remainingAmount = roundCurrency(
      getReservationTotalAmount(reservation) - depositAmount,
    );
    return remainingAmount > 0 ? remainingAmount : null;
  }

  /**
   * Maps a Stripe card brand to the Cloudbeds `cardCode` accepted by a
   * property. Fetches `getPaymentMethods` to validate the card is supported,
   * then matches against the static Stripe→Cloudbeds brand map.
   *
   * Returns `{ paymentType, cardType, cardNumber }` on success, or `undefined`
   * when the payment method cannot be resolved (errors are logged, never
   * rethrown so that the deposit still posts with fallback values).
   */
  private async resolveCloudbedsCardInfo(
    stripePaymentMethodId: string,
    propertyID: string,
    apiToken: string,
    hotelId: string,
    connectedAccountId?: string,
  ): Promise<
    | {
        paymentType: CloudbedsPaymentType;
        cardType?: string;
        cardNumber: string;
      }
    | undefined
  > {
    // Stripe card brand → Cloudbeds cardCode (credit payments only)
    const STRIPE_BRAND_TO_CLOUDBEDS_CODE: Record<string, string> = {
      visa: 'visa',
      mastercard: 'master',
      amex: 'amex',
      discover: 'Discover',
      diners: 'diners',
      unionpay: 'union_pay',
    };

    // Stripe card.funding → desired Cloudbeds `method` value.
    // The `type` field in postPayment must match a `method` from getPaymentMethods.
    // Anything other than credit/debit uses the 'other' method.
    const STRIPE_FUNDING_TO_CLOUDBEDS_METHOD: Record<string, string> = {
      credit: 'credit',
      debit: 'debit',
    };

    try {
      const [stripePaymentMethod, cloudbedsPaymentMethods] = await Promise.all([
        this.stripeService.getPaymentMethodById(
          stripePaymentMethodId,
          connectedAccountId,
        ),
        cloudbedsClient.getPaymentMethods(
          { propertyID },
          { apiToken, hotelId },
        ),
      ]);

      const card = stripePaymentMethod.card;
      if (!card) {
        logger.warn(
          'resolveCloudbedsCardInfo: Stripe payment method has no card details',
          {
            paymentMethodId: stripePaymentMethodId,
            type: stripePaymentMethod.type,
          },
        );
        return undefined;
      }

      const funding = card.funding as string;
      const desiredMethod =
        STRIPE_FUNDING_TO_CLOUDBEDS_METHOD[funding] ?? 'other';

      // Validate the desired method is supported by this property; fall back to 'other'.
      const supportedMethods = cloudbedsPaymentMethods.methods.map(
        (m) => m.method,
      );
      const paymentType: CloudbedsPaymentType = supportedMethods.includes(
        desiredMethod,
      )
        ? desiredMethod
        : 'other';

      if (!supportedMethods.includes(desiredMethod)) {
        logger.warn(
          'resolveCloudbedsCardInfo: Desired method not supported by property, falling back to other',
          {
            hotelId,
            desiredMethod,
            supportedMethods,
          },
        );
      }

      // cardType is only applicable for credit payments
      let cardType: string | undefined;
      if (paymentType === 'credit') {
        const stripeBrand = card.brand.toLowerCase();
        const mappedCode = STRIPE_BRAND_TO_CLOUDBEDS_CODE[stripeBrand];
        const creditMethod = cloudbedsPaymentMethods.methods.find(
          (m) => m.method === 'credit',
        );
        const acceptedCodes =
          creditMethod?.cardTypes?.map((ct) => ct.cardCode.toLowerCase()) ?? [];
        cardType =
          mappedCode && acceptedCodes.includes(mappedCode.toLowerCase())
            ? mappedCode
            : (mappedCode ?? stripeBrand);
      }

      logger.info('resolveCloudbedsCardInfo: Resolved card info', {
        hotelId,
        funding,
        paymentType,
        cardType: cardType ?? 'n/a',
        last4: card.last4,
      });

      return { paymentType, cardType, cardNumber: card.last4 };
    } catch (error) {
      logger.error(
        'resolveCloudbedsCardInfo: Failed to resolve card info, postPayment will use fallback values',
        {
          hotelId,
          paymentMethodId: stripePaymentMethodId,
          error: (error as Error).message,
        },
      );
      return undefined;
    }
  }

  /**
   * Records Stripe-driven charges in Cloudbeds via `POST /postPayment`.
   *
   * When `stripePaymentMethodId` is provided, fetches the Stripe payment
   * method and maps the card brand to the Cloudbeds card code via
   * `getPaymentMethods` so the advance deposit is recorded with the correct
   * card type. Falls back to an empty `cardType` when resolution fails so
   * the deposit is never blocked by a card-mapping error.
   *
   * Mirrors `createHostawayOfflineCharges`: skips the call entirely when
   * the hotel is not on Cloudbeds, and logs / skips any reservation missing
   * a Cloudbeds `external_id` (reservationID).
   *
   * For the deposit/manual-charge flows (`isAutoCharge` false), each
   * reservation posts its own `quote.amount_charged` (the deposit). For the
   * autocharge flow (`isAutoCharge` true), each reservation posts its
   * remaining balance (total cost minus the deposit already charged) since
   * the deposit was already recorded in Cloudbeds when it was collected.
   */
  private async createCloudbedsPayments(
    reservations: ReservationDto[],
    amountCharged: number,
    currency: string,
    stripePaymentMethodId?: string,
    connectedAccountId?: string,
    isAutoCharge = false,
  ): Promise<void> {
    if (reservations.length === 0) {
      logger.warn(
        'createCloudbedsPayments: No reservations provided, skipping',
      );
      return;
    }
    if (reservations[0].pms_provider !== PmsProvider.CLOUDBEDS) {
      return;
    }

    logger.info(
      `createCloudbedsPayments: Recording Cloudbeds payments for ${reservations.length} reservation(s)`,
    );

    amountCharged = roundCurrency(amountCharged);
    const hotel = reservations[0].hotel;
    if (!hotel?.id) {
      throw new CloudbedsConfigurationError(
        'createCloudbedsPayments: Reservation is missing its hotel',
      );
    }
    const { propertyID, apiToken } = await resolveCloudbedsCredentials(hotel);

    // Resolve card type once for all reservations in this batch
    const cardInfo = stripePaymentMethodId
      ? await this.resolveCloudbedsCardInfo(
          stripePaymentMethodId,
          String(propertyID),
          apiToken,
          hotel?.id,
          connectedAccountId,
        )
      : undefined;

    let balance = amountCharged;
    for (const reservation of reservations) {
      const externalId = reservation.external_id;
      if (!externalId) {
        logger.warn(
          `createCloudbedsPayments: Skipping reservation ${reservation.id} - no external_id (Cloudbeds reservationID)`,
        );
        continue;
      }

      const chargeAmount = this.computeChargeAmount(reservation, isAutoCharge);
      if (chargeAmount === null) {
        logger.warn(
          `createCloudbedsPayments: Skipping reservation ${reservation.id} - no remaining balance to charge`,
        );
        continue;
      }
      balance -= chargeAmount;
      if (balance < 0) {
        logger.warn(
          `createCloudbedsPayments: Balance went negative (${roundCurrency(balance)}) for reservation ${reservation.id}`,
        );
      }

      try {
        const resolvedType = cardInfo?.paymentType ?? 'other';
        const response = await cloudbedsClient.postPayment(
          {
            propertyID: String(propertyID),
            reservationID: externalId,
            type: resolvedType,
            amount: chargeAmount,
            description: `payment made via Dextr for reservation ${externalId}`,
            // cardType and cardNumber are only relevant for credit payments
            ...(resolvedType === 'credit' && cardInfo?.cardType
              ? { cardType: cardInfo.cardType }
              : {}),
          },
          { apiToken, hotelId: hotel?.id },
        );

        logger.info(
          `createCloudbedsPayments: Recorded Cloudbeds payment ${response.paymentID} for reservation ${reservation.id} ` +
            `(Cloudbeds ID: ${externalId}, amount: ${formatCurrencyAmount(currency, chargeAmount)}, type: ${resolvedType}, cardType: ${cardInfo?.cardType || 'n/a'})`,
        );
      } catch (error) {
        logger.error(
          `createCloudbedsPayments: Failed to record payment for reservation ${reservation.id} (Cloudbeds ID: ${externalId})`,
          error,
        );
      }
    }

    logger.info(
      `createCloudbedsPayments: Completed recording for ${reservations.length} reservation(s)`,
    );
  }

  /**
   * Handles a completed Checkout Session in setup mode (zero-deposit flow).
   *
   * This is the card-only capture path: no payment was collected. The handler:
   * 1. Retrieves the underlying SetupIntent to get the saved payment_method
   * 2. Stores the Stripe customer ID on the customer record
   * 3. Sets the payment method as the customer's default (required for invoice-based autocharge)
   * 4. Marks the payment record as COMPLETED (amount = 0)
   * 5. Finalizes PMS reservations (creates booking, sets ACTIVE)
   * 6. Autocharge for the full amount is set up inside finalizePmsReservations
   * 7. Sends confirmation notifications with AUTO_CHARGE_LATER note
   */
  private async handleSetupSessionCompleted(
    session: Stripe.Checkout.Session,
    connectedAccountID?: string,
  ): Promise<void> {
    // The setup_intent_data.metadata carries our booking metadata
    const setupIntentId = session.setup_intent as string;
    if (!setupIntentId) {
      logger.warn(
        `handleSetupSessionCompleted: No setup_intent on session ${session.id}`,
      );
      return;
    }

    let connectedAccountId = connectedAccountID;
    if (!connectedAccountId && session.metadata?.hotel_id) {
      connectedAccountId =
        (await this.hotelConfigurationService.getPaymentAccountIdByHotelId(
          session.metadata.hotel_id,
        )) ?? undefined;
    }

    // Retrieve the SetupIntent to get payment_method and metadata
    const setupIntent = await this.stripeService.getSetupIntent(
      setupIntentId,
      connectedAccountId,
    );

    const typedMetadata =
      setupIntent.metadata as unknown as PaymentMetadata | null;
    this.setKpiHotelContext(typedMetadata);
    const source = typedMetadata?.source;
    if (
      !source ||
      typeof source !== 'string' ||
      source.toLowerCase() !== SOURCE.toLowerCase()
    ) {
      logger.warn(
        `handleSetupSessionCompleted: Setup session ${session.id} is not from Daisy, ignoring`,
      );
      return;
    }

    const paymentId = typedMetadata?.payment_id;
    if (!paymentId) {
      logger.warn(
        `handleSetupSessionCompleted: No payment_id in metadata for session ${session.id}`,
      );
      return;
    }

    const payment = await this.paymentService.getPaymentById(paymentId);
    if (!payment) {
      throw new NoDataError(
        `handleSetupSessionCompleted: Payment not found for payment ${paymentId}`,
      );
    }
    logger.info(
      `handleSetupSessionCompleted: Processing setup session for payment ${paymentId}`,
    );

    // 1. Store Stripe customer ID and set default payment method
    const stripeCustomerId = session.customer as string | null;
    const paymentMethodId = setupIntent.payment_method as string | null;

    if (typedMetadata.customer_id && stripeCustomerId) {
      try {
        await this.customerService.updateCustomer(typedMetadata.customer_id, {
          payment_provider_customer_id: stripeCustomerId,
        });
        logger.info(
          `handleSetupSessionCompleted: Updated customer ${typedMetadata.customer_id} with Stripe customer ID ${stripeCustomerId}`,
        );
      } catch (error) {
        logger.error(
          `handleSetupSessionCompleted: Failed to update customer ${typedMetadata.customer_id} with Stripe customer ID: ${error}`,
        );
      }

      // Update default payment method for the customer in Stripe for future payments
      if (paymentMethodId) {
        try {
          await this.stripeService.updateCustomerDefaultPaymentMethod(
            stripeCustomerId,
            paymentMethodId,
            connectedAccountId,
          );
          logger.info(
            `handleSetupSessionCompleted: Set default payment method ${paymentMethodId} for Stripe customer ${stripeCustomerId}`,
          );
        } catch (error) {
          logger.error(
            `handleSetupSessionCompleted: Failed to set default payment method: ${error}`,
          );
        }
      }
    }

    // 2. Mark payment as COMPLETED (amount = 0, card captured)
    const transaction = await db.transaction();
    try {
      await this.paymentService.updatePaymentById(
        paymentId,
        { payment_link_disabled: true },
        transaction,
      );
      await this.paymentService.updatePaymentStatusById(
        paymentId,
        PaymentStatus.COMPLETED,
        transaction,
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      logger.error(
        `handleSetupSessionCompleted: Error updating payment status: ${JSON.stringify(error)}`,
      );
      throw error;
    }

    logKpi({
      stat: KpiStat.PaymentSetupSessionCompleted,
      value: 1,
      contextName: 'handleSetupSessionCompleted',
      contextId: paymentId,
    });

    // 3. Finalize PMS reservations (creates PMS booking, sets ACTIVE, sets up autocharge)
    try {
      const reservations =
        await this.roomReservationService.getReservationsByPaymentId(paymentId);

      if (isEmpty(reservations)) {
        throw new NoDataError(
          `handleSetupSessionCompleted: No reservations found for payment ${paymentId}`,
        );
      }

      const hotel = reservations[0].hotel;
      if (!hotel) {
        throw new NoDataError(
          `handleSetupSessionCompleted: No hotel found for reservation having payment ${paymentId}`,
        );
      }

      // finalizePmsReservations creates PMS booking, sets status = ACTIVE,
      // and sets up autocharge for the full amount (since amountCharged = 0 < totalAmount)
      let createdReservations: ReservationDto[] = [];
      try {
        createdReservations =
          await this.roomReservationService.finalizePmsReservations(
            reservations,
          );
      } catch (error) {
        const escalationMessage = `Card captured (no deposit) but failed to create reservation. Please check and take action.\nCheck-in: ${dayjs(reservations[0].check_in).format('DD/MM/YYYY')}\nCheck-out: ${dayjs(reservations[0].check_out).format('DD/MM/YYYY')}`;

        logger.error(
          `handleSetupSessionCompleted: Error creating PMS reservations: escalationMessage: ${escalationMessage}\nerror: ${JSON.stringify(error)}`,
        );
        try {
          await this.escalationService.handleEscalation(
            {
              phone_number: reservations[0].phone_number,
              full_name: `${reservations[0].customer.first_name} ${reservations[0].customer.last_name}`,
              message: `Card captured (no deposit) but failed to create reservation. Please check and take action.\nCheck-in: ${dayjs(reservations[0].check_in).format('DD/MM/YYYY')}\nCheck-out: ${dayjs(reservations[0].check_out).format('DD/MM/YYYY')}`,
              session_id: reservations[0].session_id ?? '',
              status: EscalationStatus.OPEN,
            },
            hotel.assistant_phone_number,
          );
        } catch (escalationError) {
          logger.error(
            `handleSetupSessionCompleted: Error sending escalation: ${JSON.stringify(escalationError)}`,
          );
        }
        throw error;
      }

      // 4. Send notifications with AUTO_CHARGE_LATER note
      const guestFacingBookingIds = createdReservations
        .map((r) => r.external_public_id || r.external_id)
        .filter((id): id is string => Boolean(id));

      const totalAmount = roundCurrency(
        reservations.reduce((acc, r) => acc + getReservationTotalAmount(r), 0),
      );

      // Telegram: booking confirmed with AUTO_CHARGE_LATER note
      try {
        const telegramMessage = noPaymentBookingConfirmedTemplate({
          phoneNumber: reservations[0].phone_number,
          bookingId: guestFacingBookingIds.length
            ? guestFacingBookingIds.join(', ')
            : null,
          guestFirstName: reservations[0].customer?.first_name || '',
          guestLastName: reservations[0].customer?.last_name || '',
          startDate: reservations[0].check_in,
          endDate: reservations[0].check_out,
          totalAmount,
          sessionType: reservations[0].type,
          paymentNote: BookingPaymentNote.AUTO_CHARGE_LATER,
          currency: hotel.currency,
        });

        await this.notificationFactory
          .getChatService(hotel.notification_type)
          .sendMessage({
            recipient: hotel.telegram_alerts_group_id,
            content: { message: telegramMessage, parseMode: 'HTML' },
          });
        logger.info(
          `handleSetupSessionCompleted: Telegram notification sent for payment ${paymentId}`,
        );
      } catch (error) {
        logger.error(
          `handleSetupSessionCompleted: Failed to send Telegram notification: ${error}`,
        );
      }

      // Guest SMS: booking confirmed
      try {
        const hotelConfig =
          await this.hotelConfigurationService.getHotelConfigurationByHotelId(
            hotel.id,
          );

        const smsBody = bookingConfirmedSMSTemplate(
          formatDateToWords(dayjs(reservations[0].check_in), false),
          formatDateToWords(dayjs(reservations[0].check_out)),
          reservations[0].customer?.email || '',
          guestFacingBookingIds.length
            ? guestFacingBookingIds.join(', ')
            : undefined,
        );

        const smsRecipientPhoneNumber = await resolveSmsTargetPhoneNumber(
          reservations[0].customer?.phone_number,
          reservations[0].phone_number,
          hotelConfig?.twilio_configuration,
          hotel.country,
          false,
        );

        if (smsRecipientPhoneNumber) {
          const smsPayload: NotificationPayload = {
            recipient: convertToPhoneNumber(smsRecipientPhoneNumber)!,
            content: {
              message: smsBody,
              from: convertToPhoneNumber(hotel.sms_number)!,
              twilioConfiguration: hotelConfig?.twilio_configuration,
            },
          };
          const smsResult = await this.smsService.sendMessage(smsPayload);

          if (smsResult) {
            smsEvents.emitSmsSent({
              sessionId: reservations[0].session_id,
              message: smsBody,
              from: hotel.sms_number,
              to: smsRecipientPhoneNumber,
              callerPhoneNumber: reservations[0].phone_number,
              assistantPhoneNumber: hotel.assistant_phone_number,
              timestamp: new Date(),
              hotelSmsNumber: hotel.sms_number,
              smsAgentEnabled: hotelConfig?.sms_agent_enabled || false,
              hotelId: hotel.id,
            });
          }
        }
        logger.info(
          `handleSetupSessionCompleted: SMS confirmation sent for payment ${paymentId}`,
        );
      } catch (error) {
        logger.error(
          `handleSetupSessionCompleted: Failed to send SMS confirmation: ${error}`,
        );
      }
    } catch (error) {
      logger.error(
        `handleSetupSessionCompleted: Error processing setup session: ${JSON.stringify(error)}`,
      );
      throw error;
    }
  }

  /**
   * Handles an expired Checkout Session in setup mode.
   * Marks the associated payment as FAILED and sends a Telegram alert.
   */
}
// Create singleton instances of notification services
const smsService = new SMSNotificationService();

// Export the singleton instance
export const stripeWebhookService = new StripeWebhookService(
  config.STRIPE_WEBHOOK_SECRET,
  {
    paymentService,
    stripeService,
    roomReservationService,
    notificationFactory,
    smsService,
    customerService,
    hotelConfigurationService,
    escalationService,
  },
);
