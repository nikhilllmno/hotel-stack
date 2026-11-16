import axios from 'axios';
import authorizeNetService, {
  AuthorizeNetService,
} from '../../authorizeNet/services/authorizeNetService';
import { authorizeNetTokenService } from '../../authorizeNet/services/AuthorizeNetTokenService';
import { operaCardAttachService } from '../../calry/services/operaCardAttachService';
import { operaCardTokenService } from '../../calry/services/operaCardTokenService';
import { operaFolioService } from '../../calry/services/operaFolioService';
import {
  recordCollectedPaymentInOpera,
  recordRefundInOpera,
} from '../../calry/services/operaPaymentRecorder';
import cloudbedsClient from '../../cloudbeds/client/CloudbedsClient';
import {
  CloudbedsAPIError,
  CloudbedsRoomUnavailableError,
} from '../../cloudbeds/errors';
import { resolveCloudbedsCredentials } from '../../cloudbeds/services/cloudbedsCredentials';
import cloudbedsSdkPaymentProviderService, {
  CloudbedsBalanceCharge,
} from '../../cloudbeds/services/CloudbedsSdkPaymentProviderService';
import { CloudbedsReservationService } from '../../cloudbeds/services/reservationService';
import config from '../../config';
import { ReservationLookupSource } from '../../dtos/enum/ReservationLookupSource';
import { ReservationSource } from '../../dtos/enum/ReservationSource';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import mewsPaymentProviderService from '../../mews/services/MewsPaymentProviderService';
import { MewsReservationService } from '../../mews/services/reservationService';
import { getMewsRequestId } from '../../mews/utils/mewsErrorUtils';
import {
  CheckSisterPropertyAvailabilityRequest,
  CreateMultiRoomReservationRequest,
  CreateRoomReservationRequest,
  CreateWebRoomReservationRequest,
  ModifyRoomReservationRequest,
} from '../../models/request/roomReservation';
import {
  CrossSellAvailabilityResponse,
  GroupDescription,
  GroupWithQuote,
  SisterPropertyAvailabilityResult,
} from '../../models/response/roomReservation';
import { ReservationRepository } from '../../repositories/ReservationRepository';
import resNexusService, {
  ResNexusService,
} from '../../resNexus/service/reservation/reservationService';
import {
  convertToModifyReservationRequest,
  generateResNexusPartnerNotes,
} from '../../resNexus/utils/helper';
import { StayntouchReservationService } from '../../stayntouch/services/reservationService';
import { RecordCCPaymentRequest } from '../../stayntouch/types';
import {
  Country,
  PaymentProvider,
  takesNoDextrPayment,
} from '../../types/enums';
import { OnboardingSmsResult } from '../../types/onboardingSms';
import {
  AutoChargeInfo,
  PricingBreakdown,
  ReservationDetails,
} from '../../types/reservation';
import {
  CardOnFileType,
  CardPresent,
  HotelPrimaryChargeType,
  HotelSpecialCode,
  Shift4CardTokenRequest,
  Shift4PreAuthResponse,
  Shift4ResponseCode,
  Shift4SaleTransactionRequest,
  Shift4SaleTransactionResult,
  Shift4ToStayntouchCardTypeMap,
  ThreeDSecureAuthenticationSource,
  TransactionAuthorizationRequestOptions,
} from '../../types/shift4';
import { withTimeoutWithFallback } from '../../utils/async';
import {
  adjustEndDateIfSameAsStartDate,
  appendPrefilledEmailToPaymentLink,
  computeQuoteTotal,
  convertToPhoneNumber,
  formatCurrencyAmount,
  formatPhoneNumber,
  generateBookingId,
  getSecureReviewUrl,
  isATrueValue,
  isMultiRoomReservation,
  numberToWords,
  parseYyMm,
  rateCalendarMonthWindow,
  resolveRateCalendarWindow,
  resolveSmsTargetPhoneNumber,
  roundCurrency,
  roundTaxRate,
  validatePhoneWithTwilio,
  validateReservationDates,
} from '../../utils/helper';
import { KpiStat, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import {
  createRequestContext,
  runWithContext,
} from '../../utils/requestContext';
import { cleanStringFields } from '../../utils/stringFormatter';
import { isTestPhone, TEST_RESERVATION_LIMIT } from '../../utils/testPhone';
import {
  OperaCardTokenRequest,
  ResNexusCardRequest,
} from '../../validators/cardSubmissionSchema';
import { CloudbedsCardTokenRequest } from '../../validators/cloudbedsCardTokenSchema';
import { MewsCardTokenRequest } from '../../validators/mewsCardTokenSchema';
import { validateReservationForCreation } from '../../validators/reservationCreationSchema';
import { validateShift4CustomerData } from '../../validators/shift4ValidationSchema';
import { CustomerService } from '../customer/customerService';
import autoChargeExecutorFactory from '../payment/autoCharge/AutoChargeExecutorFactory';
import { IAutoChargeExecutor } from '../payment/autoCharge/IAutoChargeExecutor';
import { logPaymentContext } from '../payment/logPaymentContext';
import paymentService, { PaymentService } from '../payment/paymentService';
import { shift4DelayedCharge } from '../shift4/Shift4AutoChargeExecutor';
import shift4Service from '../shift4/shift4Service';
import {
  buildTemplateVariables,
  enrichReservationsWithPolicySignaturePresignedUrl,
  isWithinTimeWindow,
  renderMessageTemplate,
  sanitizeDiscount,
  validateSameDayBooking,
} from './helper';
import {
  buildCrossSellMessage,
  CROSS_SELL_NOT_CONFIGURED,
  hasBookableGroups,
  SISTER_PROPERTY_CHECK_FAILED,
  SISTER_PROPERTY_CHECK_TIMED_OUT,
} from './sisterPropertyAvailability';

import {
  Customer,
  DeviceDetails,
  UpdateCustomerDataBeforePayment,
} from '../../dtos/Customer';

import {
  ChargeReservationRequest,
  ChargeReservationResponse,
  MarkPaymentCollectedRequest,
  MarkPaymentCollectedResponse,
} from '../../dtos/Payment';
import { Payment } from '../../models/Payment';
import { hotelService, HotelService } from '../hotel/hotelService';
import {
  HotelConfigurationService,
  hotelConfigurationService,
} from '../hotelConfiguration/hotelConfigurationService';
import quoteService, { QuoteService } from '../quote/quoteService';

// Import dayjs and its plugins
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Knex } from 'knex';
import _, { cloneDeep } from 'lodash';
import Stripe from 'stripe';
import { SOURCE } from '../../constants/source';
import db from '../../database/connection';
import {
  BookingSummaryV1,
  BookingSummaryV2,
} from '../../dtos/dashboard/bookingSummary';
import { ConversationSummary } from '../../dtos/dashboard/conversationSummary';
import {
  GroupedReservation,
  RoomDetail,
} from '../../dtos/dashboard/groupedReservation';
import { HotelReservationListResponse } from '../../dtos/dashboard/hotelReservationList';
import { Transcript } from '../../dtos/dashboard/transcript';
import { CancellationSource } from '../../dtos/enum/CancellationSource';
import { Currency } from '../../dtos/enum/Currency';
import { EscalationStatus } from '../../dtos/enum/EscalationStatus';
import {
  PaymentStatus,
  statusOfPaymentsToCancelAfterDisablingAutoCharge,
} from '../../dtos/enum/PaymentStatus';
import {
  hasNoDextrPayment,
  noDextrPaymentReason,
  ReservationPaymentStatus,
} from '../../dtos/enum/ReservationPaymentStatus';
import { SessionType } from '../../dtos/enum/SessionType';
import { Hotel } from '../../dtos/Hotel';
import { HotelConfiguration } from '../../dtos/HotelConfiguration';
import { Quote as QuoteDTO } from '../../dtos/Quote';
import {
  BookingRefundSummary,
  RefundProcessResult,
  RefundRequest,
} from '../../dtos/refund/RefundDto';
import {
  Reservation as ReservationDTO,
  ReservationWithPricingBreakdown,
  SetupAutoChargeRequest,
  SetupAutoChargeResponse,
} from '../../dtos/Reservation';
import { BadRequestError } from '../../errors/BadRequestError';
import { BaseError } from '../../errors/BaseError';
import { BookingNotCompletedError } from '../../errors/BookingNotCompletedError';
import { CardVerificationError } from '../../errors/CardVerificationError';
import { ExternalAPIError } from '../../errors/ExternalApiError';
import { NoDataError } from '../../errors/NoDataError';
import { PaymentSucceededProcessingFailedError } from '../../errors/PaymentSucceededProcessingFailedError';
import { PmsBookingOutcomeUnknownError } from '../../errors/PmsBookingOutcomeUnknownError';
import { Shift4Error } from '../../errors/Shift4Error';
import { smsEvents } from '../../events/smsEvents';
import { webReservationEvents } from '../../events/webReservationEvents';
import { Discount } from '../../models/Discount';
import { Quote } from '../../models/Quote';
import {
  GetAvailabilityRequestParams,
  GetRateCalendarRequestParams,
  GetSingleRoomAvailabilityRequestParams,
  GetWebAvailabilityRequestParams,
} from '../../models/request/availability';
import { Reservation as ReservationModel } from '../../models/Reservation';
import { Pagination } from '../../models/response/common';
import { RateCalendarResponse } from '../../models/response/rateCalendar';
import pmsServiceFactory, {
  PMSServiceFactory,
} from '../../pms/PMSServiceFactory';
import { ExternalModificationInfo } from '../../pms/types/ExternalModification';
import {
  IPMSReservationService,
  PmsCardDetails,
} from '../../pms/types/IPMSReservationService';
import { PMSQuote } from '../../pms/types/Quote';
import { PMSQuoteRequest } from '../../pms/types/QuoteRequest';
import { BookingReviewRepository } from '../../repositories/BookingReviewRepository';
import { PaymentReservationRepository } from '../../repositories/PaymentReservationRepository';
import { AutoChargeProcessingResult } from '../../types/autoCharge';
import {
  CheckInMessageAction,
  PmsProvider,
  PromiseSettledStatus,
} from '../../types/enums';
import {
  CrossSellConfiguration,
  DEFAULT_SISTER_PROPERTY_TIMEOUT_MS,
  isFullPaymentPolicy,
  OnboardingSmsConfiguration,
  SisterProperty,
  TwilioConfiguration,
} from '../../types/hotelConfiguration';
import { PaymentCreationMetadata, PaymentMetadata } from '../../types/payment';
import {
  generatePresignedUrl,
  uploadBufferToS3ReturnPath,
} from '../../utils/aws';
import { getPaginationUrls, GetRequestForPagination } from '../../utils/common';
import { formatDateToWords } from '../../utils/helper';
import {
  DeviceIpAndLocation,
  getDeviceIpAndLocation,
  RequestLikeForIp,
} from '../../utils/ipUtils';
import {
  getGuestFacingReservationId,
  getGuestFacingReservationIds,
  getReservationTotalAmount,
} from '../../utils/reservation';
import { AuthorizeNetCardTokenRequest } from '../../validators/authorizeNetCardTokenSchema';
import { validPaymentPreStatus } from '../../validators/validPaymentPreStatus';
import { validReservationPreStatus } from '../../validators/validReservationPreStatus';
import failedCardCheckLimiter from '../cardVerification/failedCardCheckLimiter';
import channelService, { ChannelService } from '../channel/channelService';
import conversationService from '../conversation/ConversationService';
import customerService from '../customer/customerService';
import { DiscountService, discountService } from '../discount/discountService';
import escalationService from '../escalation/escalationService';
import {
  bookingCancelledReviewRefundTelegramTemplate,
  bookingConfirmedSMSTemplate,
  bookingLinkSMSTemplate,
  bookingPartlyConfirmedSMSTemplate,
  externalDirectBookingCancelledReviewRefundTelegramTemplate,
  guestChargedSMSTemplate,
  guestRefundedSMSTemplate,
  paymentSuccessSMSTemplate,
  reservationCancelledByDashboardSMSTemplate,
  reservationCancelledByUserSMSTemplate,
  reservationModifiedPaymentTelegramTemplate,
  reservationModifiedRefundTelegramTemplate,
  reservationModifiedRoomChangeTelegramTemplate,
  reviewLinkSMSTemplate,
} from '../messaging/messageTemplates';
import {
  ChatNotificationType,
  ChatServiceResolver,
  notificationFactory,
} from '../notification';
import { SMSNotificationService } from '../notification/smsNotificationService';
import {
  NotificationPayload,
  NotificationSMSContent,
} from '../notification/types';
import {
  BookingConfirmedMessage,
  BookingPaymentNote,
  noPaymentBookingConfirmedTemplate,
  PaymentStatusMessage,
  paymentStatusTemplate,
} from '../vapi/constants/telegramTemplates/paymentStatusTemplate';

// Extend dayjs with plugins
dayjs.extend(utc);
dayjs.extend(timezone);

// The rate calendar is public and polled by hotel websites; a short cache keeps
// visitor traffic from turning into one PMS call per page view.
const RATE_CALENDAR_CACHE_TTL_MS = 10 * 60 * 1000;
const RATE_CALENDAR_CACHE_MAX_ENTRIES = 500;

/** The part of a PMS lite availability response the sister-hotel check reads. */
interface SisterPmsAvailability {
  groups?: GroupWithQuote[] | GroupDescription[];
  date_correction_details?: string;
}

interface ChargeProviderResult {
  success: boolean;
  paymentId?: string;
  chargeId?: string;
  paymentStatus?: string;
  errorMessage?: string;
  hotelConfiguration: HotelConfiguration | null | undefined;
  shift4SaleData?: Shift4SaleTransactionResult;
  shift4PaymentRecord?: Payment;
  transactionCommitted?: boolean;
}

function logAvailabilityError(message: string, error: unknown): void {
  if (axios.isAxiosError(error)) {
    logger.error(message, {
      status: error.response?.status,
      message: error.message,
      data: error.response?.data,
    });
  } else {
    logger.error(message, error);
  }
}

function shouldForceZeroDeposit(
  hotelId: string,
  roomIds: (string | number)[],
  callerPhone: string,
): boolean {
  const vineyardId = config.VINEYARD_HOTEL_ID;
  if (!vineyardId || hotelId !== vineyardId) return false;

  const vineyardConfig = config.VINEYARD_ZERO_DEPOSIT_CONFIG;
  if (!vineyardConfig || Object.keys(vineyardConfig).length === 0) return false;
  if (roomIds.length === 0) return false;

  return roomIds.every((roomId) => {
    const phones = vineyardConfig[String(roomId)];
    return phones !== undefined && phones.includes(callerPhone);
  });
}

/**
 * A PMS booking claim older than this belongs to a request that crashed
 * mid-booking, so its rooms are free to book or to sweep again.
 */
function pmsBookingClaimStaleBefore(): Date {
  return dayjs()
    .subtract(config.PMS_BOOKING_CLAIM_TTL_MINUTES, 'minute')
    .toDate();
}

/** The payment status for a reservation Dextr collects nothing for, or null when Dextr takes the payment. */
function noDextrPaymentStatusFor(
  provider: Hotel['payment_provider'],
  isForceZeroDeposit: boolean,
): ReservationPaymentStatus | null {
  if (provider === PaymentProvider.RESNEXUS) {
    return ReservationPaymentStatus.EXTERNALLY_MANAGED;
  }
  if (takesNoDextrPayment(provider) || isForceZeroDeposit) {
    return ReservationPaymentStatus.NOT_APPLICABLE;
  }
  return null;
}

/**
 * Most providers key their PMS property by a numeric id stored in
 * `business_id`. Mews uses an enterprise GUID and Calry an opaque property
 * id, so for those the hotel's own UUID is the usable identifier.
 */
function hasNonNumericBusinessId(hotel: Hotel): boolean {
  return (
    hotel.pms_provider === PmsProvider.MEWS ||
    hotel.pms_provider === PmsProvider.CALRY
  );
}

/** Cents a full payment may exceed Daisy's quote, so Cloudbeds' own rounding still settles the folio. */
const CLOUDBEDS_FULL_PAYMENT_ROUNDING = 0.05;

export class RoomReservationService {
  // Keyed by the whole months a window falls in (rateCalendarMonthWindow), and holds
  // the promise rather than the result, so overlapping and concurrent requests in the
  // same months share one PMS call. Failed loads are evicted so the next request retries.
  private readonly rateCalendarCache = new Map<
    string,
    { expiresAt: number; value: Promise<RateCalendarResponse> }
  >();

  private guestCheckinSummaryService?: {
    updateSummary(
      hotelId: string,
      action: CheckInMessageAction,
      bookingId?: string,
      originalAmount?: number,
    ): Promise<string | number | null>;
  }; // Interface to avoid circular dependency

  constructor(
    private paymentService: PaymentService,
    private resNexusService: ResNexusService,
    private reservationRepository: ReservationRepository,
    private customerService: CustomerService,
    private quoteService: QuoteService,
    private hotelService: HotelService,
    private hotelConfigurationService: HotelConfigurationService,
    private smsService: SMSNotificationService,
    private discountService: DiscountService,
    private paymentReservationRepository: PaymentReservationRepository,
    private notificationFactory: ChatServiceResolver,
    private channelService: ChannelService,
    private pmsServiceFactory: PMSServiceFactory,
    private bookingReviewRepository: BookingReviewRepository,
    private cardVerifier: Pick<AuthorizeNetService, 'verifyCard'>,
  ) {}

  async createReservationRecord(
    reservation: Omit<ReservationModel, 'id' | 'created_at' | 'updated_at'>,
    transaction?: Knex.Transaction,
  ): Promise<ReservationModel> {
    return this.reservationRepository.create(reservation, transaction);
  }

  async findReservationByHotelPmsAndExternalIdentifiers(
    hotelId: string,
    pmsProvider: string,
    externalId: string,
    externalPublicId?: string,
  ): Promise<ReservationModel | null> {
    return this.reservationRepository.findByHotelPmsAndExternalIdentifiers(
      hotelId,
      pmsProvider,
      externalId,
      externalPublicId,
    );
  }

  async updateReservationRecord(
    id: string,
    data: Partial<Omit<ReservationModel, 'id' | 'created_at' | 'updated_at'>>,
    transaction?: Knex.Transaction,
  ): Promise<ReservationModel | null> {
    return this.reservationRepository.update(id, data, transaction);
  }

  /**
   * Sets the GuestCheckinSummaryService instance to avoid circular dependency
   * @param service The GuestCheckinSummaryService instance
   */
  public setGuestCheckinSummaryService(service: {
    updateSummary(
      hotelId: string,
      action: CheckInMessageAction,
      bookingId?: string,
      originalAmount?: number,
    ): Promise<string | number | null>;
  }): void {
    this.guestCheckinSummaryService = service;
  }

  /**
   * Gets room availability and quote for the given dates and number of guests
   * @param availabilityParams the parameters for the availability request
   * @param phoneNumber the phone number the customer is calling from
   * @returns the availability and quote information for each group
   */
  async getRoomAvailabilityWithQuote(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionType: SessionType,
  ) {
    try {
      // Get hotel information
      const hotel =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          hotelPhoneNumber,
        );
      if (!hotel) {
        throw new NoDataError(
          `getRoomAvailabilityWithQuote: Hotel not found for assistant phone number ${hotelPhoneNumber}`,
        );
      }

      // Get PMS-specific service from factory
      const pmsService = await this.pmsServiceFactory.getReservationService(
        hotel.id,
      );

      // Call PMS-specific getSingleRoomAvailabilityInfo method
      const availabilityInfo = await pmsService.getRoomAvailabilityWithQuote(
        availabilityParams,
        phoneNumber,
        hotelPhoneNumber,
        sessionType,
      );

      return cleanStringFields(availabilityInfo);
    } catch (error) {
      if (error instanceof NoDataError) {
        throw error;
      }
      logAvailabilityError(
        'getRoomAvailabilityWithQuote: Error getting availability:',
        error,
      );
      if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        throw new BaseError(
          'getRoomAvailabilityWithQuote: Availability request timed out',
        );
      }
      throw error;
    }
  }

  /**
   * Same as {@link getRoomAvailabilityWithQuoteLite}, but asks the PMS
   * service to source room types from an alternate availability endpoint.
   * Currently only implemented by Cloudbeds — a workaround for a Cloudbeds
   * bug where `getRoomTypes` intermittently errors for same-day check-ins.
   * Other PMS services throw "not supported".
   */
  async getRoomAvailabilityWithQuoteLiteV2(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionType: SessionType,
  ) {
    try {
      // Get hotel information
      const hotel =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          hotelPhoneNumber,
        );
      if (!hotel) {
        throw new NoDataError(
          `getRoomAvailabilityWithQuoteLiteV2: Hotel not found for assistant phone number ${hotelPhoneNumber}`,
        );
      }

      // Get PMS-specific service from factory
      const pmsService = await this.pmsServiceFactory.getReservationService(
        hotel.id,
      );

      // Call PMS-specific getRoomAvailabilityWithQuoteLiteV2 method
      const availabilityInfo =
        await pmsService.getRoomAvailabilityWithQuoteLiteV2(
          availabilityParams,
          phoneNumber,
          hotelPhoneNumber,
          sessionType,
        );

      return cleanStringFields(availabilityInfo);
    } catch (error) {
      if (error instanceof NoDataError) {
        throw error;
      }
      logAvailabilityError(
        'getRoomAvailabilityWithQuoteLiteV2: Error getting availability:',
        error,
      );
      if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        throw new BaseError(
          'getRoomAvailabilityWithQuoteLiteV2: Availability request timed out',
        );
      }
      throw error;
    }
  }

  async getRoomAvailabilityWithQuoteLite(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionType: SessionType,
  ) {
    try {
      // Get hotel information
      const hotel =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          hotelPhoneNumber,
        );
      if (!hotel) {
        throw new NoDataError(
          `getRoomAvailabilityWithQuoteLite: Hotel not found for assistant phone number ${hotelPhoneNumber}`,
        );
      }

      logKpi({
        stat: KpiStat.PmsAvailabilityRequested,
        value: 1,
        contextName: 'getRoomAvailabilityWithQuoteLite',
        clientId: hotelPhoneNumber,
      });

      // Get PMS-specific service from factory
      const pmsService = await this.pmsServiceFactory.getReservationService(
        hotel.id,
      );

      // Call PMS-specific getRoomAvailabilityWithQuoteLite method
      const availabilityInfo =
        await pmsService.getRoomAvailabilityWithQuoteLite(
          availabilityParams,
          phoneNumber,
          hotelPhoneNumber,
          sessionType,
        );

      return cleanStringFields(availabilityInfo);
    } catch (error) {
      if (error instanceof NoDataError) {
        throw error;
      }
      logAvailabilityError(
        'getRoomAvailabilityWithQuoteLite: Error getting availability:',
        error,
      );
      if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        throw new BaseError(
          'getRoomAvailabilityWithQuoteLite: Availability request timed out',
        );
      }
      throw error;
    }
  }

  /**
   * Read-only availability + prices at the calling hotel's sister hotels
   * (`hotel_configurations.cross_sell_configuration`).
   *
   * With `check_all_sister_properties: true`, every sister hotel is checked in
   * parallel with a time limit per hotel; one hotel failing or timing out
   * becomes an error entry and the others are still returned, in configured
   * order. Without it, the original behaviour is kept unchanged (see
   * {@link checkSisterPropertiesInOrder}).
   */
  async checkSisterPropertyAvailability(
    params: CheckSisterPropertyAvailabilityRequest,
    callerPhoneNumber: string,
    assistantPhoneNumber: string,
  ): Promise<CrossSellAvailabilityResponse> {
    const methodName = 'RoomReservationService.checkSisterPropertyAvailability';

    const hotel =
      await this.hotelService.getHotelByAssistantPhoneNumber(
        assistantPhoneNumber,
      );
    if (!hotel) {
      throw new NoDataError(
        `${methodName}: Hotel not found for assistant phone number ${assistantPhoneNumber}`,
      );
    }

    const hotelConfig =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        hotel.id,
      );
    const crossSellConfig = hotelConfig?.cross_sell_configuration;
    if (!crossSellConfig?.check_all_sister_properties) {
      return this.checkSisterPropertiesInOrder(
        crossSellConfig,
        params,
        callerPhoneNumber,
        assistantPhoneNumber,
      );
    }
    const sisters = crossSellConfig.enabled
      ? (crossSellConfig.sister_properties ?? []).filter(
          (sister) => sister.hotel_id !== hotel.id,
        )
      : [];
    if (sisters.length === 0) {
      return {
        cross_sell_available: false,
        results: [],
        message: CROSS_SELL_NOT_CONFIGURED,
      };
    }

    logKpi({
      stat: KpiStat.CrossSellAvailabilityRequested,
      value: 1,
      contextName: methodName,
      clientId: assistantPhoneNumber,
    });

    const timeoutMs =
      crossSellConfig?.timeout_ms ?? DEFAULT_SISTER_PROPERTY_TIMEOUT_MS;
    const results = await Promise.all(
      sisters.map((sister) =>
        this.checkOneSisterPropertyAvailability(
          sister,
          params,
          callerPhoneNumber,
          assistantPhoneNumber,
          timeoutMs,
        ),
      ),
    );

    if (!results.some((result) => result.available)) {
      logKpi({
        stat: KpiStat.CrossSellAvailabilityNoneFound,
        value: 1,
        contextName: methodName,
        clientId: assistantPhoneNumber,
      });
    }

    return {
      cross_sell_available: results.some((result) => result.available),
      results: cleanStringFields(results) as SisterPropertyAvailabilityResult[],
      message: buildCrossSellMessage(results),
    };
  }

  /**
   * The original cross-sell check (#1754, built for Giri), kept unchanged for
   * every hotel without `check_all_sister_properties`: one sister hotel at a
   * time through `getRoomAvailabilityWithQuoteLite`, stopping at the first
   * with a bookable room, with no time limit.
   */
  private async checkSisterPropertiesInOrder(
    crossSellConfig: CrossSellConfiguration | null | undefined,
    params: CheckSisterPropertyAvailabilityRequest,
    callerPhoneNumber: string,
    assistantPhoneNumber: string,
  ): Promise<CrossSellAvailabilityResponse> {
    const methodName = 'RoomReservationService.checkSisterPropertyAvailability';

    if (
      !crossSellConfig?.enabled ||
      !crossSellConfig.sister_properties?.length
    ) {
      return {
        cross_sell_available: false,
        results: [],
        message: CROSS_SELL_NOT_CONFIGURED,
      };
    }

    logKpi({
      stat: KpiStat.CrossSellAvailabilityRequested,
      value: 1,
      contextName: methodName,
      clientId: assistantPhoneNumber,
    });

    const results: SisterPropertyAvailabilityResult[] = [];

    for (const sister of crossSellConfig.sister_properties) {
      try {
        const sisterHotel = await this.hotelService.getHotelById(
          sister.hotel_id,
        );

        const pmsService = await this.pmsServiceFactory.getReservationService(
          sisterHotel.id,
        );

        const availability = await pmsService.getRoomAvailabilityWithQuoteLite(
          {
            start_date: params.start_date,
            end_date: params.end_date,
            num_adults: params.num_adults,
            num_children: params.num_children ?? 0,
            num_pets: params.num_pets ?? 0,
            session_type: SessionType.CALL,
            booking_link: false,
          },
          callerPhoneNumber,
          sisterHotel.assistant_phone_number,
          SessionType.CALL,
        );

        const hasAvailability = hasBookableGroups(availability?.groups);

        results.push({
          hotel_name: sister.name,
          hotel_phone_number: sister.phone_number,
          distance_miles: sister.distance_miles,
          available: hasAvailability,
          groups: hasAvailability ? availability.groups : undefined,
        });

        if (hasAvailability) {
          logKpi({
            stat: KpiStat.CrossSellAvailabilityFound,
            value: 1,
            contextName: methodName,
            clientId: assistantPhoneNumber,
            contextId: sister.hotel_id,
          });
          break;
        }
      } catch (error) {
        logger.error(
          `${methodName}: Availability check failed for sister property ${sister.name}`,
          { error, sisterHotelId: sister.hotel_id },
        );
        results.push({
          hotel_name: sister.name,
          hotel_phone_number: sister.phone_number,
          distance_miles: sister.distance_miles,
          available: false,
          error: SISTER_PROPERTY_CHECK_FAILED,
        });
      }
    }

    const availableProperty = results.find((r) => r.available);

    if (!availableProperty) {
      logKpi({
        stat: KpiStat.CrossSellAvailabilityNoneFound,
        value: 1,
        contextName: methodName,
        clientId: assistantPhoneNumber,
      });
    }

    const distanceInfo =
      availableProperty?.distance_miles != null
        ? ` (${availableProperty.distance_miles} miles away)`
        : '';
    const message = availableProperty
      ? `${availableProperty.hotel_name}${distanceInfo} has availability for your dates.`
      : 'Unfortunately, none of the nearby sister properties have availability for your dates either.';

    return {
      cross_sell_available: !!availableProperty,
      results: cleanStringFields(results) as SisterPropertyAvailabilityResult[],
      message,
    };
  }

  private async checkOneSisterPropertyAvailability(
    sister: SisterProperty,
    params: CheckSisterPropertyAvailabilityRequest,
    callerPhoneNumber: string,
    assistantPhoneNumber: string,
    timeoutMs: number,
  ): Promise<SisterPropertyAvailabilityResult> {
    const methodName =
      'RoomReservationService.checkOneSisterPropertyAvailability';
    const result: SisterPropertyAvailabilityResult = {
      hotel_name: sister.name,
      hotel_phone_number: sister.phone_number,
      website: sister.website,
      distance_miles: sister.distance_miles,
      available: false,
    };
    const timedOut = Symbol('timedOut');
    let gaveUp = false;

    try {
      const availability = await withTimeoutWithFallback<
        SisterPmsAvailability | typeof timedOut
      >(
        async () => {
          const sisterHotel = await this.hotelService.getHotelById(
            sister.hotel_id,
          );
          // The time limit doesn't cancel this callback, so don't start PMS
          // work for a hotel already reported as timed out.
          if (gaveUp) return timedOut;
          result.website ??= sisterHotel.url || undefined;
          const pmsService = await this.pmsServiceFactory.getReservationService(
            sisterHotel.id,
          );
          const availabilityParams = {
            start_date: params.start_date,
            end_date: params.end_date,
            num_adults: params.num_adults,
            num_children: params.num_children ?? 0,
            num_pets: params.num_pets ?? 0,
            session_type: SessionType.CALL,
            booking_link: false,
          };
          // Same as the Cloudbeds agents' own availability tool
          // (/availability-lite-v2): getAvailableRoomTypes avoids the
          // getRoomTypes same-day check-in bug.
          return sisterHotel.pms_provider?.toLowerCase() ===
            PmsProvider.CLOUDBEDS
            ? pmsService.getRoomAvailabilityWithQuoteLiteV2(
                availabilityParams,
                callerPhoneNumber,
                sisterHotel.assistant_phone_number,
                SessionType.CALL,
              )
            : pmsService.getRoomAvailabilityWithQuoteLite(
                availabilityParams,
                callerPhoneNumber,
                sisterHotel.assistant_phone_number,
                SessionType.CALL,
              );
        },
        timeoutMs,
        timedOut,
      );

      if (availability === timedOut) {
        gaveUp = true;
        logger.warn(
          `${methodName}: Availability check timed out after ${timeoutMs} ms for sister property ${sister.name}`,
          { sisterHotelId: sister.hotel_id },
        );
        logKpi({
          stat: KpiStat.CrossSellAvailabilityCheckFailed,
          value: 1,
          contextName: methodName,
          clientId: assistantPhoneNumber,
          contextId: sister.hotel_id,
        });
        return { ...result, error: SISTER_PROPERTY_CHECK_TIMED_OUT };
      }

      result.available = hasBookableGroups(availability?.groups);
      if (result.available) {
        result.groups = availability.groups;
        logKpi({
          stat: KpiStat.CrossSellAvailabilityFound,
          value: 1,
          contextName: methodName,
          clientId: assistantPhoneNumber,
          contextId: sister.hotel_id,
        });
      }
      if (availability?.date_correction_details) {
        result.date_correction_details = availability.date_correction_details;
      }
      return result;
    } catch (error) {
      logger.error(
        `${methodName}: Availability check failed for sister property ${sister.name}`,
        {
          error,
          reason: error instanceof Error ? error.message : String(error),
          sisterHotelId: sister.hotel_id,
        },
      );
      logKpi({
        stat: KpiStat.CrossSellAvailabilityCheckFailed,
        value: 1,
        contextName: methodName,
        clientId: assistantPhoneNumber,
        contextId: sister.hotel_id,
      });
      return { ...result, error: SISTER_PROPERTY_CHECK_FAILED };
    }
  }

  async getAllRatesForRoomType(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    roomId: number | string,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionType: SessionType,
  ) {
    try {
      const hotel =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          hotelPhoneNumber,
        );
      if (!hotel) {
        throw new NoDataError(
          `getAllRatesForRoomType: Hotel not found for assistant phone number ${hotelPhoneNumber}`,
        );
      }

      const pmsService = await this.pmsServiceFactory.getReservationService(
        hotel.id,
      );

      const rateInfo = await pmsService.getAllRatesForRoomType(
        availabilityParams,
        roomId,
        phoneNumber,
        hotelPhoneNumber,
        sessionType,
      );

      return cleanStringFields(rateInfo);
    } catch (error) {
      if (error instanceof NoDataError) {
        throw error;
      }
      logger.error(
        'getAllRatesForRoomType: Error fetching rates for room type:',
        error,
      );
      if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        throw new BaseError(
          'getAllRatesForRoomType: Rate lookup request timed out',
        );
      }
      throw error;
    }
  }

  async getMultiRoomAvailabilityWithQuote(
    availabilityParams: GetAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionType: SessionType,
  ) {
    try {
      // Get hotel information
      const hotel =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          hotelPhoneNumber,
        );
      if (!hotel) {
        throw new NoDataError(
          `getMultiRoomAvailabilityWithQuote: Hotel not found for assistant phone number ${hotelPhoneNumber}`,
        );
      }

      // Get PMS-specific service from factory
      const pmsService = await this.pmsServiceFactory.getReservationService(
        hotel.id,
      );

      // Call PMS-specific getMultiRoomAvailabilityWithQuote method
      const availabilityInfo =
        await pmsService.getMultiRoomAvailabilityWithQuote(
          availabilityParams,
          phoneNumber,
          hotelPhoneNumber,
          sessionType,
        );

      return cleanStringFields(availabilityInfo);
    } catch (error) {
      if (error instanceof NoDataError) {
        throw error;
      }
      logAvailabilityError(
        'getMultiRoomAvailabilityWithQuote: Error getting availability:',
        error,
      );
      if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        throw new BaseError(
          'getMultiRoomAvailabilityWithQuote: Availability request timed out',
        );
      }
      throw error;
    }
  }

  async getWebRoomAvailabilityV2(
    availabilityParams: GetWebAvailabilityRequestParams,
  ) {
    try {
      // Get hotel information
      const hotel = await this.hotelService.getHotelByBusinessId(
        availabilityParams.business_id,
      );
      if (!hotel) {
        throw new NoDataError(
          `getWebRoomAvailability: Hotel not found for business id ${availabilityParams.business_id}`,
        );
      }

      // Get PMS-specific service from factory
      const pmsService = await this.pmsServiceFactory.getReservationService(
        hotel.id,
      );

      // Call PMS-specific getWebRoomAvailabilityV2 method
      const availabilityInfo =
        await pmsService.getWebRoomAvailabilityV2(availabilityParams);

      return availabilityInfo;
    } catch (error) {
      if (error instanceof NoDataError) {
        throw error;
      }
      logAvailabilityError(
        'getWebRoomAvailability: Error getting availability:',
        error,
      );
      if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        throw new BaseError(
          'getWebRoomAvailability: Availability request timed out',
        );
      }
      throw error;
    }
  }

  async getRateCalendar(
    params: GetRateCalendarRequestParams,
  ): Promise<RateCalendarResponse> {
    const hotel = await this.hotelService.getHotelByBusinessId(
      params.business_id,
    );
    if (!hotel) {
      throw new NoDataError(
        `getRateCalendar: Hotel not found for business id ${params.business_id}`,
      );
    }

    const { startDate, endDate } = resolveRateCalendarWindow(
      params.start_date,
      params.end_date,
      hotel.timezone,
    );
    const months = rateCalendarMonthWindow(startDate, endDate, hotel.timezone);
    const calendar = await this.cachedRateCalendar(
      hotel,
      months.startDate,
      months.endDate,
    );
    return {
      ...calendar,
      start_date: startDate,
      end_date: endDate,
      nights: calendar.nights.filter(
        (night) => night.date >= startDate && night.date <= endDate,
      ),
    };
  }

  private cachedRateCalendar(
    hotel: Hotel,
    startDate: string,
    endDate: string,
  ): Promise<RateCalendarResponse> {
    const cacheKey = `${hotel.id}:${startDate}:${endDate}`;
    const cached = this.rateCalendarCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const value = this.loadRateCalendar(hotel, startDate, endDate);
    this.rateCalendarCache.delete(cacheKey);
    this.rateCalendarCache.set(cacheKey, {
      expiresAt: Date.now() + RATE_CALENDAR_CACHE_TTL_MS,
      value,
    });
    value.catch(() => {
      if (this.rateCalendarCache.get(cacheKey)?.value === value) {
        this.rateCalendarCache.delete(cacheKey);
      }
    });
    if (this.rateCalendarCache.size > RATE_CALENDAR_CACHE_MAX_ENTRIES) {
      const oldestKey = this.rateCalendarCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.rateCalendarCache.delete(oldestKey);
      }
    }
    return value;
  }

  private async loadRateCalendar(
    hotel: Hotel,
    startDate: string,
    endDate: string,
  ): Promise<RateCalendarResponse> {
    const pmsService = await this.pmsServiceFactory.getReservationService(
      hotel.id,
    );
    if (!pmsService.getRateCalendar) {
      throw new BadRequestError(
        `getRateCalendar: Rate calendar is not supported for PMS provider ${hotel.pms_provider}`,
      );
    }

    const calendar = await pmsService.getRateCalendar(
      String(hotel.business_id),
      startDate,
      endDate,
    );
    return {
      hotel_name: hotel.name,
      hotel_phone: hotel.assistant_phone_number || null,
      hotel_website: hotel.url || null,
      start_date: startDate,
      end_date: endDate,
      ...calendar,
    };
  }

  async getMultiRoomAvailabilityWithQuoteLite(
    availabilityParams: GetAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionType: SessionType,
  ) {
    try {
      // Get hotel information
      const hotel =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          hotelPhoneNumber,
        );
      if (!hotel) {
        throw new NoDataError(
          `getMultiRoomAvailabilityWithQuoteLite: Hotel not found for assistant phone number ${hotelPhoneNumber}`,
        );
      }

      // Get PMS-specific service from factory
      const pmsService = await this.pmsServiceFactory.getReservationService(
        hotel.id,
      );

      // Call PMS-specific getMultiRoomAvailabilityWithQuoteLite method
      const availabilityInfo =
        await pmsService.getMultiRoomAvailabilityWithQuoteLite(
          availabilityParams,
          phoneNumber,
          hotelPhoneNumber,
          sessionType,
        );

      return cleanStringFields(availabilityInfo);
    } catch (error) {
      if (error instanceof NoDataError) {
        throw error;
      }
      logAvailabilityError(
        'getMultiRoomAvailabilityWithQuoteLite: Error getting availability:',
        error,
      );
      if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        throw new BaseError(
          'getMultiRoomAvailabilityWithQuoteLite: Availability request timed out',
        );
      }
      throw error;
    }
  }

  /**
   * Same as {@link getMultiRoomAvailabilityWithQuoteLite}, but asks the PMS
   * service to source room types from an alternate availability endpoint.
   * Currently only implemented by Cloudbeds — a workaround for a Cloudbeds
   * bug where `getRoomTypes` intermittently errors for same-day check-ins.
   * Other PMS services throw "not supported".
   */
  async getMultiRoomAvailabilityWithQuoteLiteV2(
    availabilityParams: GetAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionType: SessionType,
  ) {
    try {
      // Get hotel information
      const hotel =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          hotelPhoneNumber,
        );
      if (!hotel) {
        throw new NoDataError(
          `getMultiRoomAvailabilityWithQuoteLiteV2: Hotel not found for assistant phone number ${hotelPhoneNumber}`,
        );
      }

      // Get PMS-specific service from factory
      const pmsService = await this.pmsServiceFactory.getReservationService(
        hotel.id,
      );

      // Call PMS-specific getMultiRoomAvailabilityWithQuoteLiteV2 method
      const availabilityInfo =
        await pmsService.getMultiRoomAvailabilityWithQuoteLiteV2(
          availabilityParams,
          phoneNumber,
          hotelPhoneNumber,
          sessionType,
        );

      return cleanStringFields(availabilityInfo);
    } catch (error) {
      if (error instanceof NoDataError) {
        throw error;
      }
      logAvailabilityError(
        'getMultiRoomAvailabilityWithQuoteLiteV2: Error getting availability:',
        error,
      );
      if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        throw new BaseError(
          'getMultiRoomAvailabilityWithQuoteLiteV2: Availability request timed out',
        );
      }
      throw error;
    }
  }

  async createMultiRoomReservation(
    reservationParams: CreateMultiRoomReservationRequest,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionId: string,
    sessionType: SessionType,
  ) {
    let transaction: Knex.Transaction | null = null;
    try {
      transaction = await db.transaction();

      const hotelDetails =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          hotelPhoneNumber,
        );
      if (!hotelDetails) {
        throw new NoDataError('Hotel not found');
      }

      const pmsService = await this.pmsServiceFactory.getReservationService(
        hotelDetails.id,
      );

      const hotelConfiguration =
        await this.hotelConfigurationService.getHotelConfigurationByHotelId(
          hotelDetails.id,
        );

      // The number which the customer states is theirs. This should be stored in the customer table.
      const reservationPhoneNum = convertToPhoneNumber(
        reservationParams.customer_phone_number,
      );
      await validatePhoneWithTwilio(
        reservationParams.customer_phone_number,
        hotelConfiguration?.twilio_configuration,
        hotelDetails.country,
      );

      // If session type is not call, customer details are required. For calls, there is a provision to fill these in the confirmation page.
      const firstName = reservationParams.customer_first_name;
      const lastName = reservationParams.customer_last_name;
      if (
        sessionType !== SessionType.CALL &&
        (!firstName || !lastName || !reservationPhoneNum)
      ) {
        throw new BadRequestError(
          'First name, last name and phone number are required',
        );
      }

      logger.info(
        `Creating multi room reservation: ${JSON.stringify(reservationParams)}`,
      );

      let bookingReviewId: string = '';
      let { room_ids, check_in, check_out, people_per_room, ...rest } =
        reservationParams;

      const timezone = hotelDetails.timezone;
      const businessId = hotelDetails.business_id;

      // The number the customer is communicating from. This should be stored in the reservation table.
      let callerPhoneNum: string;
      if (sessionType !== SessionType.CHAT) {
        callerPhoneNum = convertToPhoneNumber(phoneNumber) || '';
      } else {
        callerPhoneNum = phoneNumber;
      }

      if (hotelDetails.payment_provider === PaymentProvider.RESNEXUS) {
        this.assertNotLimitedForFailedCardChecks(
          hotelDetails,
          callerPhoneNum,
          'assistant',
        );
      }

      if (!reservationPhoneNum || !callerPhoneNum) {
        const errorMessage =
          "Reservation phone number and customer's phone number are required";
        logger.error(errorMessage);
        throw new BadRequestError(errorMessage);
      }

      // Adjust check_out if it's the same as check_in
      const adjustedEndDateResult = adjustEndDateIfSameAsStartDate(
        check_in,
        check_out,
      );
      if (adjustedEndDateResult.shouldBeCorrected) {
        check_out = adjustedEndDateResult.date;
      }

      // Validate reservation dates
      validateReservationDates(check_in, check_out, timezone);

      // 1. Create customer
      const customerData = await this.createCustomerFromReservationParams(
        reservationParams,
        hotelDetails.id,
        reservationPhoneNum,
        transaction,
      );

      const roomsInfo = await pmsService.getRoomsInfo(businessId);

      await pmsService.validateMultiRoomOccupancy(
        people_per_room,
        roomsInfo,
        hotelDetails.id,
      );

      let roomTypeMap: Map<string, string> = new Map();
      try {
        roomTypeMap = await pmsService.getRoomTypeMap(
          businessId,
          room_ids,
          roomsInfo,
        );
      } catch (error) {
        logger.error(
          `Error getting room type. Proceeding without room type. Error:: ${JSON.stringify(error)}`,
        );
      }

      let parentBookingId = generateBookingId();
      parentBookingId = parentBookingId.toUpperCase();
      let bookingIds: string[] = [];
      const reservationsCreationData: Omit<
        ReservationModel,
        'id' | 'created_at' | 'updated_at' | 'payment_id'
      >[] = [];
      let subBookingIdIndex = 1;
      let totalAdults = 0;
      let totalChildren = 0;
      let totalPets = 0;

      // Calculate total adults, children, and pets from people_per_room
      if (people_per_room) {
        Object.values(people_per_room).forEach((occupantGroups) => {
          occupantGroups.forEach((group) => {
            totalAdults += group.num_adults || 0;
            totalChildren += group.num_children || 0;
            totalPets += group.num_pets || 0;
          });
        });
      }

      // Discounts are only fetched for PMS providers that support them and for payment-required hotels.
      // For other PMS systems, discount support should be implemented in their
      // respective shouldFetchDiscount() method when required.
      const discount =
        pmsService.shouldFetchDiscount() &&
        hotelDetails.payment_provider !== PaymentProvider.NOT_APPLICABLE
          ? await this.discountService.getUnusedDiscountByPhoneNumberAndHotelId(
              callerPhoneNum,
              hotelDetails.id,
            )
          : null;

      let reservations: ReservationModel[];
      const quotesCreationData: Quote[] = [];
      let paymentRecord: Payment;
      let paymentMetadata: PaymentMetadata;

      let quotes: Quote[];
      try {
        const roomIdSet = new Set(room_ids);
        for (const roomId of roomIdSet) {
          for (const occupancy of people_per_room[roomId]) {
            // Delegate partner-notes construction to each PMS service.
            // ResNexus encodes pet counts and discount notes as text; other PMS
            // systems return null here and handle these natively (e.g. addons).
            const notesFromPartner = pmsService.buildPartnerNotes({
              numPets: occupancy.num_pets ?? undefined,
              discountNote: discount?.note,
            });

            let subBookingId = `${parentBookingId}_${subBookingIdIndex}`;
            // Each OccupantGroup creates its own reservation, so each reservation gets the pets
            // from its corresponding OccupantGroup (defaults to 0 if not provided)
            const reservationDetails: Omit<
              ReservationModel,
              'id' | 'created_at' | 'updated_at' | 'payment_id'
            > = {
              room_id: roomId,
              business_id: businessId,
              hotel_id: hotelDetails.id,
              pms_provider: hotelDetails.pms_provider,
              check_in: new Date(check_in),
              check_out: new Date(check_out),
              num_adults: Number(occupancy.num_adults),
              num_children: Number(occupancy.num_children || 0),
              num_pets: Number(occupancy.num_pets || 0),
              phone_number: callerPhoneNum,
              customer_id: customerData.id || '',
              booking_id: subBookingId,
              status: ReservationStatus.INACTIVE,
              type: reservationParams.session_type,
              source: ReservationSource.DIRECT_HOTEL_RESERVATION,
              session_id: sessionId,
              customer_special_request: rest.customer_special_request,
              room_type: roomTypeMap.get(String(roomId)) || String(roomId),
              ...(rest.rate_code && { rate_code: rest.rate_code }),
              ...(notesFromPartner && { notes_from_partner: notesFromPartner }),
            };
            bookingIds.push(subBookingId);
            reservationsCreationData.push(reservationDetails);
            subBookingIdIndex++;
          }
        }

        if (hotelDetails.pms_provider === PmsProvider.STAYNTOUCH) {
          await pmsService.validateRoomAvailability(
            reservationsCreationData.map((reservation) => ({
              ...reservation,
              hotel: hotelDetails,
            })) as unknown as ReservationDTO[],
          );
        } else if (hotelDetails.pms_provider === PmsProvider.CLOUDBEDS) {
          await this.assertCloudbedsRoomsAvailable(
            pmsService,
            reservationsCreationData.map((reservation) => ({
              ...reservation,
              check_in,
              check_out,
              hotel: hotelDetails,
            })) as unknown as ReservationDTO[],
          );
        }

        reservations = await this.reservationRepository.createMany(
          reservationsCreationData,
          transaction,
        );

        const isForceZeroDeposit = shouldForceZeroDeposit(
          hotelDetails.id,
          room_ids,
          callerPhoneNum,
        );

        let currentRoomId: string = '';
        try {
          for (const reservation of reservations) {
            currentRoomId = reservation.room_id.toString();
            // All PMS services return PMSQuote with guaranteed common fields plus PMS-specific fields
            // The PMS service will apply pet fees, discounts, and payment configuration
            const getQuoteRequest: PMSQuoteRequest = {
              business_id: businessId,
              room_id: reservation.room_id,
              check_in,
              check_out,
              num_adults: reservation.num_adults,
              num_children: reservation.num_children || 0,
              hotel_id: hotelDetails.id,
              caller_phone_num: callerPhoneNum,
              num_pets: reservation.num_pets || 0,
              rate_code: rest.rate_code,
            };

            let quote: PMSQuote = await pmsService.getQuote(getQuoteRequest);

            if (quote.rate_code) {
              await this.reservationRepository.update(
                reservation.id,
                { rate_code: quote.rate_code },
                transaction,
              );
              reservation.rate_code = quote.rate_code;
            }

            quotesCreationData.push({
              reservation_id: reservation.id,
              base_rate: quote.base_rate,
              taxes: quote.taxes,
              fees: quote.fees,
              amount_charged: isForceZeroDeposit ? 0 : quote.amountCharged,
              quote_object: quote,
              platform_pricing: quote.platform_pricing ?? null,
            } as Quote);
          }
        } catch (error) {
          logger.error(
            `Failed to get quote for unit group ${currentRoomId} during multi room reservation. Error: ${JSON.stringify(error)}`,
          );
          throw error;
        }

        try {
          quotes = await this.quoteService.createQuotes(
            quotesCreationData,
            transaction,
          );
        } catch (error) {
          logger.error(
            `Failed to create quotes during multi room reservation. Error: ${JSON.stringify(error)}`,
          );
          throw error;
        }

        const totalAmountCharged = quotesCreationData.reduce(
          (total, quote) => total + quote.amount_charged,
          0,
        );

        if (discount) {
          for (const reservation of reservations) {
            await this.discountService.linkDiscountToReservation(
              discount.id,
              reservation.id,
              transaction,
            );
          }
        }

        // Insert booking_reviews row for all reservations (payment and no-payment)
        const bookingReview =
          await this.bookingReviewRepository.createWithUniqueReviewId(
            {
              booking_id: parentBookingId,
              hotel_id: hotelDetails.id,
            },
            transaction,
          );
        const reservationReviewId = bookingReview.reservation_review_id;

        const noPaymentStatus = noDextrPaymentStatusFor(
          hotelDetails.payment_provider,
          isForceZeroDeposit,
        );
        if (noPaymentStatus) {
          const reviewUrl = await this.finaliseNoPaymentCreation(
            reservations.map((r) => r.id),
            noPaymentStatus,
            reservationReviewId,
            hotelDetails.name!,
            transaction,
          );

          await transaction.commit();

          void this.sendReviewLinkSMS(
            reviewUrl,
            sessionType,
            reservationPhoneNum,
            hotelDetails,
            hotelConfiguration,
          );

          reservations.forEach((r) => {
            r.payment_status = noPaymentStatus;
          });

          return {
            reservations,
            payment: null,
            customer: customerData,
            payment_link: reviewUrl,
          };
        }

        // Payment flow: process payment as before
        const paymentCreationResult =
          await this.processPaymentForMultiRoomReservation(
            reservations,
            totalAmountCharged,
            callerPhoneNum,
            parentBookingId,
            check_in,
            check_out,
            sessionType,
            customerData,
            hotelDetails,
            hotelConfiguration,
            transaction,
          );
        paymentRecord = paymentCreationResult.paymentRecord;
        paymentMetadata = paymentCreationResult.paymentMetadata;

        bookingReviewId = bookingReview.reservation_review_id;
      } catch (error) {
        logger.error(
          `Error creating multi room reservation: ${JSON.stringify(error)}`,
        );
        throw error;
      }

      const secureReviewUrl = getSecureReviewUrl(
        bookingReviewId,
        hotelDetails.name!,
      );

      if (
        [SessionType.SMS, SessionType.CHAT].includes(
          reservationParams.session_type,
        )
      ) {
        paymentRecord.payment_link = secureReviewUrl;
      }

      await transaction.commit();

      await this.paymentService.sendPaymentNotifications(
        sessionId,
        paymentRecord,
        sessionType,
        paymentMetadata,
        reservationPhoneNum,
        hotelConfiguration?.sms_agent_enabled || false,
        bookingReviewId,
        hotelConfiguration?.twilio_configuration,
      );

      const result = {
        reservations,
        payment: paymentRecord,
        customer: customerData,
        secureUrl: secureReviewUrl,
      };

      return result;
    } catch (error) {
      if (transaction) {
        await transaction.rollback();
      }
      throw error;
    }
  }

  //TODO: no-payment web reservations should be supported
  async createWebReservation(
    reservationParams: CreateWebRoomReservationRequest,
  ) {
    let transaction: Knex.Transaction | null = null;

    try {
      transaction = await db.transaction();
      logger.info(
        `createWebReservation: Creating multi room reservation: ${JSON.stringify(reservationParams)}`,
      );

      let { room_ids, check_in, check_out, people_per_room, ...rest } =
        reservationParams;

      const isMultiRoom = isMultiRoomReservation(room_ids, people_per_room);
      const sessionType = SessionType.WEB;

      const hotelDetails = await this.hotelService.getHotelByBusinessId(
        reservationParams.business_id,
      );
      if (!hotelDetails) {
        throw new NoDataError('createWebReservation:Hotel not found');
      }

      const pmsService = await this.pmsServiceFactory.getReservationService(
        hotelDetails.id,
      );

      const hotelConfiguration =
        await this.hotelConfigurationService.getHotelConfigurationByHotelId(
          hotelDetails.id,
        );

      // Validate phone number using Twilio Lookup API
      await validatePhoneWithTwilio(
        reservationParams.customer_phone_number,
        hotelConfiguration?.twilio_configuration,
        hotelDetails.country,
      );

      const timezone = hotelDetails.timezone;
      const businessId = hotelDetails.business_id;
      const phoneNumber = convertToPhoneNumber(
        formatPhoneNumber(
          reservationParams.customer_phone_number,
          hotelDetails.country,
        ),
      );
      if (!phoneNumber) {
        throw new BadRequestError('createWebReservation: Invalid phone number');
      }

      if (hotelDetails.payment_provider === PaymentProvider.RESNEXUS) {
        this.assertNotLimitedForFailedCardChecks(
          hotelDetails,
          phoneNumber,
          'guest',
        );
      }

      // Adjust check_out if it's the same as check_in
      const adjustedEndDateResult = adjustEndDateIfSameAsStartDate(
        check_in,
        check_out,
      );
      if (adjustedEndDateResult.shouldBeCorrected) {
        check_out = adjustedEndDateResult.date;
      }

      // Validate reservation dates
      validateReservationDates(check_in, check_out, timezone);

      // 1. Create customer
      const customerData = await this.createCustomerFromReservationParams(
        reservationParams,
        hotelDetails.id,
        phoneNumber!,
        transaction,
      );

      const roomsInfo = await pmsService.getRoomsInfo(businessId);

      await pmsService.validateMultiRoomOccupancy(
        people_per_room,
        roomsInfo,
        hotelDetails.id,
      );

      let roomTypeMap: Map<string, string> = new Map();
      try {
        roomTypeMap = await pmsService.getRoomTypeMap(
          businessId,
          room_ids,
          roomsInfo,
        );
      } catch (error) {
        logger.error(
          `createWebReservation: Error getting room type. Proceeding without room type. Error:: ${JSON.stringify(error)}`,
        );
      }

      let parentBookingId = generateBookingId().toUpperCase();
      let bookingIds: string[] = [];
      const reservationsCreationData: Omit<
        ReservationModel,
        'id' | 'created_at' | 'updated_at' | 'payment_id'
      >[] = [];
      let subBookingIdIndex = 1;
      let totalAdults = 0;
      let totalChildren = 0;
      let totalPets = 0;

      // Calculate total adults, children, and pets from people_per_room
      if (people_per_room) {
        Object.values(people_per_room).forEach((occupantGroups) => {
          occupantGroups.forEach((group) => {
            totalAdults += group.num_adults || 0;
            totalChildren += group.num_children || 0;
            totalPets += group.num_pets || 0;
          });
        });
      }

      let reservations: ReservationModel[];
      const quotesCreationData: Quote[] = [];
      let paymentRecord: Payment;
      let paymentMetadata: PaymentMetadata;
      let quotes: Quote[];
      try {
        const roomIdSet = new Set(room_ids);
        for (const roomId of roomIdSet) {
          for (const occupancy of people_per_room[roomId]) {
            const notesFromPartner = pmsService.buildPartnerNotes({
              numPets: occupancy.num_pets,
            });

            let subBookingId = isMultiRoom
              ? `${parentBookingId}_${subBookingIdIndex}`
              : parentBookingId;
            // Each OccupantGroup creates its own reservation, so each reservation gets the pets
            // from its corresponding OccupantGroup (defaults to 0 if not provided)
            const reservationDetails: Omit<
              ReservationModel,
              'id' | 'created_at' | 'updated_at' | 'payment_id'
            > = {
              room_id: roomId,
              business_id: businessId,
              hotel_id: hotelDetails.id,
              pms_provider: hotelDetails.pms_provider,
              check_in: new Date(check_in),
              check_out: new Date(check_out),
              num_adults: Number(occupancy.num_adults),
              num_children: Number(occupancy.num_children),
              num_pets: Number(occupancy.num_pets || 0),
              phone_number: phoneNumber,
              customer_id: customerData.id || '',
              booking_id: subBookingId,
              status: ReservationStatus.INACTIVE,
              room_type: roomTypeMap.get(String(roomId)) || String(roomId),
              type: sessionType,
              source: ReservationSource.DIRECT_HOTEL_RESERVATION,
              ...(rest.rate_code && { rate_code: rest.rate_code }),
              ...(notesFromPartner && { notes_from_partner: notesFromPartner }),
            };
            bookingIds.push(subBookingId);
            reservationsCreationData.push(reservationDetails);
            subBookingIdIndex++;
          }
        }

        if (
          isMultiRoom &&
          hotelDetails.pms_provider === PmsProvider.STAYNTOUCH
        ) {
          await pmsService.validateRoomAvailability(
            reservationsCreationData.map((reservation) => ({
              ...reservation,
              hotel: hotelDetails,
            })) as unknown as ReservationDTO[],
          );
        } else if (hotelDetails.pms_provider === PmsProvider.CLOUDBEDS) {
          await this.assertCloudbedsRoomsAvailable(
            pmsService,
            reservationsCreationData.map((reservation) => ({
              ...reservation,
              check_in,
              check_out,
              hotel: hotelDetails,
            })) as unknown as ReservationDTO[],
          );
        }

        reservations = await this.reservationRepository.createMany(
          reservationsCreationData,
          transaction,
        );

        const isForceZeroDepositWeb =
          !!phoneNumber &&
          shouldForceZeroDeposit(hotelDetails.id, room_ids, phoneNumber);

        let currRoomId: string = '';
        try {
          for (const reservation of reservations) {
            currRoomId = reservation.room_id.toString();
            // All PMS services return PMSQuote with guaranteed common fields plus PMS-specific fields
            // The PMS service will apply pet fees, discounts, and payment configuration
            const getQuoteRequest: PMSQuoteRequest = {
              business_id: businessId,
              room_id: reservation.room_id,
              check_in,
              check_out,
              num_adults: reservation.num_adults,
              num_children: reservation.num_children || 0,
              hotel_id: hotelDetails.id,
              caller_phone_num: phoneNumber,
              num_pets: reservation.num_pets || 0,
              rate_code: rest.rate_code,
            };

            let quote: PMSQuote = await pmsService.getQuote(getQuoteRequest);

            if (quote.rate_code) {
              await this.reservationRepository.update(
                reservation.id,
                { rate_code: quote.rate_code },
                transaction,
              );
              reservation.rate_code = quote.rate_code;
            }

            quotesCreationData.push({
              reservation_id: reservation.id,
              base_rate: quote.base_rate,
              taxes: quote.taxes,
              fees: quote.fees,
              amount_charged: isForceZeroDepositWeb ? 0 : quote.amountCharged,
              quote_object: quote,
              platform_pricing: quote.platform_pricing ?? null,
            } as Quote);
          }
        } catch (error) {
          logger.error(
            `createWebReservation: Failed to get quote for room ${currRoomId} during multi room reservation. Error: ${JSON.stringify(error)}`,
          );
          throw error;
        }

        try {
          quotes = await this.quoteService.createQuotes(
            quotesCreationData,
            transaction,
          );
        } catch (error) {
          logger.error(
            `createWebReservation: Failed to create quotes during multi room reservation. Error: ${JSON.stringify(error)}`,
          );
          throw error;
        }

        const totalAmountCharged = quotesCreationData.reduce(
          (total, quote) => total + quote.amount_charged,
          0,
        );

        // Insert booking_reviews row for all reservations (payment and no-payment)
        const bookingReview =
          await this.bookingReviewRepository.createWithUniqueReviewId(
            {
              booking_id: parentBookingId,
              hotel_id: hotelDetails.id,
            },
            transaction,
          );

        const noPaymentStatus = noDextrPaymentStatusFor(
          hotelDetails.payment_provider,
          isForceZeroDepositWeb,
        );
        if (noPaymentStatus) {
          const reviewUrl = await this.finaliseNoPaymentCreation(
            reservations.map((r) => r.id),
            noPaymentStatus,
            bookingReview.reservation_review_id,
            hotelDetails.name!,
            transaction,
          );
          webReservationEvents.emitWebReservationCreated({
            reservationIds: reservations.map((reservation) => reservation.id),
            customerPhone: phoneNumber!,
            assistantPhone: hotelDetails.assistant_phone_number,
            businessId: businessId,
            sessionType: sessionType,
          });

          await transaction.commit();

          return {
            payment_link: reviewUrl,
            customer: customerData,
          };
        }

        const paymentCreationResult =
          await this.processPaymentForMultiRoomReservation(
            reservations,
            totalAmountCharged,
            phoneNumber,
            parentBookingId,
            check_in,
            check_out,
            sessionType,
            customerData,
            hotelDetails,
            hotelConfiguration,
            transaction,
          );

        paymentRecord = paymentCreationResult.paymentRecord;
        paymentMetadata = paymentCreationResult.paymentMetadata;
      } catch (error) {
        logger.error(
          `createWebReservation: Error creating multi room reservation: ${JSON.stringify(error)}`,
        );
        throw error;
      }

      await transaction.commit();

      // Emit event to create a session for web reservations
      webReservationEvents.emitWebReservationCreated({
        reservationIds: reservations.map((reservation) => reservation.id),
        customerPhone: phoneNumber!,
        assistantPhone: hotelDetails.assistant_phone_number,
        businessId: businessId,
        sessionType: sessionType,
      });

      if (!paymentRecord.payment_link) {
        throw new NoDataError(
          `createWebReservation: payment_link not found for payment ${paymentRecord.id}`,
        );
      }

      // amount_charged === 0 means paymentRecord.payment_link is a Stripe Checkout
      // Session URL (setup mode), not a Payment Link. Checkout Session URLs don't
      // support prefilling the email via query param, so skip appending it there.
      const result = {
        payment_link:
          paymentRecord.amount_charged === 0
            ? paymentRecord.payment_link
            : appendPrefilledEmailToPaymentLink(
                paymentRecord.payment_link,
                reservationParams.customer_email,
              ),
        customer: customerData,
      };

      return result;
    } catch (error) {
      if (transaction) {
        await transaction.rollback();
      }
      throw error;
    }
  }

  /**
   * Processes payment for a multi-room reservation
   * @param subReservations - the child reservations
   * @param totalAmountCharged - total amount to charge
   * @param callerPhoneNum - caller's phone number
   * @param bookingId - booking ID for logging
   * @param check_in - check-in date
   * @param check_out - check-out date
   * @param sessionType - session type
   * @param transaction - database transaction
   * @returns - the created payment record
   */
  private async processPaymentForMultiRoomReservation(
    reservations: ReservationModel[],
    totalAmountCharged: number,
    callerPhoneNum: string,
    bookingId: string,
    check_in: string,
    check_out: string,
    sessionType: SessionType,
    customerData: Customer,
    hotelDetails: Hotel,
    hotelConfiguration: HotelConfiguration | null,
    transaction: Knex.Transaction,
  ): Promise<{ paymentRecord: Payment; paymentMetadata: PaymentMetadata }> {
    try {
      const reservationIds = reservations.map((reservation) => reservation.id);

      // Create payment record and get payment link
      const paymentCreationMetadata: PaymentCreationMetadata = {
        ...(customerData.first_name && { first_name: customerData.first_name }),
        ...(customerData.last_name && { last_name: customerData.last_name }),
        ...(customerData.email && { email: customerData.email }),
        num_adults: Number(
          reservations.reduce(
            (total, reservation) => total + reservation.num_adults,
            0,
          ),
        ),
        num_children: Number(
          reservations.reduce(
            (total, reservation) => total + reservation.num_children,
            0,
          ),
        ),
        check_in,
        check_out,
        customer_id: customerData.id,
        customer_phone: callerPhoneNum,
        hotel_name: hotelDetails.name,
        hotel_url: hotelDetails.url,
        hotel_phone_number: hotelDetails.assistant_phone_number,
        hotel_sms_number: hotelDetails.sms_number,
        hotel_internal_phone_number: hotelDetails.internal_phone_number,
        hotel_country: hotelDetails.country,
        room_count: reservations.length,
        reservation_type: sessionType,
        hotel_id: hotelDetails.id,
        payment_provider: hotelDetails.payment_provider,
        platform_fee_active: isATrueValue(
          hotelConfiguration?.platform_fee_settings?.active,
        ),
        platform_fee_type: hotelConfiguration?.platform_fee_settings?.type,
        platform_fee_value: hotelConfiguration?.platform_fee_settings?.value,
      };

      // Validate currency is supported
      const currencyCode =
        Currency[hotelDetails.currency as keyof typeof Currency];
      if (!currencyCode) {
        throw new BadRequestError(
          `processPaymentForMultiRoomReservation: Unsupported currency symbol: ${hotelDetails.currency}`,
        );
      }

      const { paymentRecord, paymentMetadata } =
        await this.paymentService.createPayment(
          {
            amount: totalAmountCharged,
            currency: currencyCode,
            description: this.paymentService.generatePaymentDescription(
              check_in,
              check_out,
            ),
            sessionType,
            metadata: paymentCreationMetadata,
            payment_provider: hotelDetails.payment_provider,
            connectedAccountId:
              hotelConfiguration?.payment_account_id ?? undefined,
          },
          transaction,
        );

      if (!paymentRecord.payment_link) {
        throw new NoDataError('Failed to generate payment link');
      }

      logger.info(
        `Payment link generated for reservation ${bookingId}: ${paymentRecord.payment_link}`,
      );

      await this.paymentReservationRepository.linkPaymentToReservations(
        paymentRecord.id,
        reservationIds,
        transaction,
      );

      return { paymentRecord, paymentMetadata };
    } catch (paymentError) {
      const errorMessage =
        paymentError instanceof Error ? paymentError.message : 'Unknown error';
      logger.error(
        `Error processing payment for reservation ${bookingId}:`,
        errorMessage,
      );
      throw paymentError;
    }
  }

  /**
   * Processes payment for a reservation
   *
   * @param params - payment processing parameters
   * @returns - the created payment record
   */
  private async processPaymentForSingleRoomReservation(
    reservationDetails: ReservationModel,
    amountCharged: number,
    callerPhoneNum: string,
    check_in: string,
    check_out: string,
    num_adults: number,
    num_children: number,
    sessionType: SessionType,
    customerData: Customer,
    hotelDetails: Hotel,
    hotelConfiguration: HotelConfiguration | null,
    transaction: Knex.Transaction,
  ): Promise<{ paymentRecord: Payment; paymentMetadata: PaymentMetadata }> {
    try {
      // Validate currency is supported
      const currencyCode =
        Currency[hotelDetails.currency as keyof typeof Currency];
      if (!currencyCode) {
        throw new BadRequestError(
          `processPaymentForSingleRoomReservation: Unsupported currency symbol: ${hotelDetails.currency}.`,
        );
      }

      const paymentCreationMetadata: PaymentCreationMetadata = {
        ...(customerData.first_name && { first_name: customerData.first_name }),
        ...(customerData.last_name && { last_name: customerData.last_name }),
        ...(customerData.email && { email: customerData.email }),
        check_in,
        check_out,
        num_adults: Number(num_adults),
        num_children: Number(num_children),
        customer_id: customerData.id,
        customer_phone: callerPhoneNum,
        hotel_name: hotelDetails.name,
        hotel_url: hotelDetails.url,
        hotel_phone_number: hotelDetails.assistant_phone_number,
        hotel_sms_number: hotelDetails.sms_number,
        hotel_internal_phone_number: hotelDetails.internal_phone_number,
        hotel_country: hotelDetails.country,
        room_count: 1,
        reservation_type: sessionType,
        hotel_id: hotelDetails.id,
        payment_provider: hotelDetails.payment_provider,
        platform_fee_active: isATrueValue(
          hotelConfiguration?.platform_fee_settings?.active,
        ),
        platform_fee_type: hotelConfiguration?.platform_fee_settings?.type,
        platform_fee_value: hotelConfiguration?.platform_fee_settings?.value,
      };

      const { paymentRecord, paymentMetadata } =
        await this.paymentService.createPayment(
          {
            amount: amountCharged,
            currency: currencyCode,
            description: this.paymentService.generatePaymentDescription(
              check_in,
              check_out,
            ),
            sessionType,
            metadata: paymentCreationMetadata,
            payment_provider: hotelDetails.payment_provider,
            connectedAccountId:
              hotelConfiguration?.payment_account_id ?? undefined,
          },
          transaction,
        );

      if (!paymentRecord.payment_link) {
        throw new NoDataError('Failed to generate payment link');
      }

      logger.info(
        `Payment link generated for reservation ${reservationDetails.booking_id}: ${paymentRecord.payment_link}`,
      );

      await this.paymentReservationRepository.create(
        {
          payment_id: paymentRecord.id,
          reservation_id: reservationDetails.id,
        },
        transaction,
      );
      return { paymentRecord, paymentMetadata };
    } catch (e) {
      if (e instanceof BaseError) {
        throw e;
      }
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      logger.error(
        `Error processing payment for reservation ${reservationDetails.booking_id}:`,
        errorMessage,
      );
      throw new BadRequestError(
        `Failed to process payment for reservation ${reservationDetails.booking_id}`,
      );
    }
  }

  /**
   * Rejects a Cloudbeds booking before anything is written when the requested
   * room types lack live inventory for the stay — otherwise the agent can book
   * a room type availability never offered, and the guest only finds out on
   * the review page. CloudbedsRoomUnavailableError is not a BaseError, so it is
   * rethrown as a BadRequestError to reach the agent as a 400 with its message
   * instead of a generic 500.
   *
   * Fails open on Cloudbeds API/network errors: an outage shouldn't block
   * bookings, and the review page re-checks availability before payment.
   */
  private async assertCloudbedsRoomsAvailable(
    pmsService: IPMSReservationService,
    reservations: ReservationDTO[],
  ): Promise<void> {
    try {
      await pmsService.validateRoomAvailability(reservations);
    } catch (error) {
      if (error instanceof CloudbedsRoomUnavailableError) {
        throw new BadRequestError(
          `${error.message}. Check availability again and offer the guest one of the available room types.`,
        );
      }
      if (error instanceof CloudbedsAPIError) {
        logger.error(
          'assertCloudbedsRoomsAvailable: Cloudbeds availability check failed, continuing with reservation creation',
          {
            hotelId: reservations[0]?.hotel?.id,
            roomIds: reservations.map((r) => r.room_id),
            statusCode: error.statusCode,
            error: error.message,
          },
        );
        return;
      }
      throw error;
    }
  }

  /**
   * Creates a room reservation in ResNexus
   *
   * @param reservationParams - details of the reservation to be created
   * @param phoneNumber - phone number of the customer
   * @returns - the created reservation details
   */
  public async createSingleRoomReservation(
    reservationParams: CreateRoomReservationRequest,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionId: string,
    sessionType: SessionType,
    options?: { skipPaymentNotification?: boolean },
  ) {
    // Destructure & coerce numeric strings ➜ numbers, provide sensible defaults
    let trx: Knex.Transaction | undefined;
    try {
      let {
        room_id,
        check_in,
        check_out,
        num_adults = 0,
        num_children = 0,
        num_pets = 0,
        ...rest
      } = reservationParams;

      trx = await db.transaction();

      let bookingReviewId: string = '';

      const hotelDetails =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          hotelPhoneNumber,
        );
      if (!hotelDetails) {
        throw new NoDataError('Hotel not found');
      }

      const hotelConfiguration =
        await this.hotelConfigurationService.getHotelConfigurationByHotelId(
          hotelDetails.id,
        );

      // The number which is used for creating the reservation. This should be stored in the customer table.
      const reservationPhoneNum = convertToPhoneNumber(
        formatPhoneNumber(
          reservationParams.customer_phone_number,
          hotelDetails.country,
        ),
      );

      await validatePhoneWithTwilio(
        reservationParams.customer_phone_number,
        hotelConfiguration?.twilio_configuration,
        hotelDetails.country,
      );

      // If session type is not call, customer details are required. For calls, there is a provision to fill these in the confirmation page.
      const firstName = reservationParams.customer_first_name;
      const lastName = reservationParams.customer_last_name;
      if (
        sessionType !== SessionType.CALL &&
        (!firstName || !lastName || !reservationPhoneNum)
      ) {
        throw new BadRequestError(
          'First name, last name and phone number are required',
        );
      }

      // The number the customer is communicating from. This should be stored in the reservation table.
      let callerPhoneNum: string;
      if (sessionType !== SessionType.CHAT) {
        callerPhoneNum = convertToPhoneNumber(phoneNumber) || '';
      } else {
        callerPhoneNum = phoneNumber;
      }

      if (hotelDetails.payment_provider === PaymentProvider.RESNEXUS) {
        this.assertNotLimitedForFailedCardChecks(
          hotelDetails,
          callerPhoneNum,
          'assistant',
        );
      }

      const timezone = hotelDetails.timezone;
      const businessId = hotelDetails.business_id;

      if (!reservationPhoneNum || !callerPhoneNum) {
        const errorMessage =
          "createSingleRoomReservation: Reservation phone number and customer's phone number are required";
        logger.error(errorMessage);
        throw new BadRequestError(errorMessage);
      }
      // Adjust check_out if it's the same as check_in
      const adjustedEndDateResult = adjustEndDateIfSameAsStartDate(
        check_in,
        check_out,
      );
      if (adjustedEndDateResult.shouldBeCorrected) {
        check_out = adjustedEndDateResult.date;
      }

      // Validate reservation dates
      validateReservationDates(check_in, check_out, timezone);

      // Get PMS-specific service from factory
      const pmsService = await this.pmsServiceFactory.getReservationService(
        hotelDetails.id,
      );

      const roomsInfo = await pmsService.getRoomsInfo(businessId);
      await pmsService.validateMultiRoomOccupancy(
        {
          [String(room_id)]: [
            {
              num_adults: Number(num_adults),
              num_children: Number(num_children) || 0,
              num_pets: Number(num_pets) || 0,
            },
          ],
        },
        roomsInfo,
        hotelDetails.id,
      );

      if (hotelDetails.pms_provider === PmsProvider.CLOUDBEDS) {
        await this.assertCloudbedsRoomsAvailable(pmsService, [
          {
            room_id,
            check_in,
            check_out,
            num_adults: Number(num_adults),
            num_children: Number(num_children) || 0,
            hotel: hotelDetails,
          },
        ] as unknown as ReservationDTO[]);
      }

      // All PMS services return PMSQuote with guaranteed common fields plus PMS-specific fields
      // The PMS service will apply pet fees, discounts, and payment configuration
      let quote: PMSQuote;
      try {
        quote = await pmsService.getQuote({
          business_id: businessId,
          room_id: room_id,
          check_in,
          check_out,
          num_adults: Number(num_adults),
          num_children: Number(num_children) || 0,
          hotel_id: hotelDetails.id,
          caller_phone_num: callerPhoneNum,
          num_pets: Number(num_pets),
          rate_code: reservationParams.rate_code,
        });
      } catch (error) {
        logger.error(
          `createSingleRoomReservation: Failed to get quote. Error: ${error}`,
        );
        throw error;
      }

      // Get discount for linking to reservation (already applied in quote)
      const discount =
        pmsService.shouldFetchDiscount() &&
        hotelDetails.payment_provider !== PaymentProvider.NOT_APPLICABLE
          ? await this.discountService.getUnusedDiscountByPhoneNumberAndHotelId(
              callerPhoneNum,
              hotelDetails.id,
            )
          : null;

      // 1. Create customer
      const customerData = await this.createCustomerFromReservationParams(
        reservationParams,
        hotelDetails.id,
        reservationPhoneNum,
        trx,
      );

      // 2. Create reservation on our side
      let booking_id = generateBookingId();
      booking_id = booking_id.toUpperCase();

      let roomTypeMap: Map<string, string> = new Map();
      try {
        roomTypeMap = await pmsService.getRoomTypeMap(businessId, [room_id]);
      } catch (error) {
        logger.error(
          `Error getting room type. Proceeding without room type. Error:: ${JSON.stringify(error)}`,
        );
      }

      let notesFromPartner = null;

      if (discount) {
        notesFromPartner = discount.note;
      }

      if (num_pets && Number(num_pets) > 0) {
        const numPetsNote = `Number of Pets = ${num_pets};`;
        notesFromPartner = notesFromPartner
          ? `${notesFromPartner}; ${numPetsNote}`
          : numPetsNote;
      }

      const reservationDetailsForInsertion: Omit<
        ReservationModel,
        'id' | 'created_at' | 'updated_at' | 'payment_id'
      > = {
        room_id: room_id,
        business_id: businessId,
        hotel_id: hotelDetails.id,
        pms_provider: hotelDetails.pms_provider,
        check_in: new Date(check_in),
        check_out: new Date(check_out),
        num_adults: Number(num_adults),
        num_children: Number(num_children),
        num_pets: Number(num_pets),
        phone_number: callerPhoneNum,
        type: reservationParams.session_type,
        source: ReservationSource.DIRECT_HOTEL_RESERVATION,
        customer_id: customerData.id || '',
        booking_id: booking_id,
        status: ReservationStatus.INACTIVE,
        session_id: sessionId,
        customer_special_request: rest.customer_special_request,
        ...(notesFromPartner && { notes_from_partner: notesFromPartner }),
        room_type: roomTypeMap.get(String(room_id)) || String(room_id),
        ...(quote.rate_code && { rate_code: quote.rate_code }),
      };

      const reservationDetails = await this.reservationRepository.create(
        reservationDetailsForInsertion,
        trx,
      );

      const isForceZeroDeposit = shouldForceZeroDeposit(
        hotelDetails.id,
        [room_id],
        callerPhoneNum,
      );

      const quotesCreationData: Omit<
        Quote,
        'id' | 'created_at' | 'updated_at'
      > = {
        reservation_id: reservationDetails.id,
        base_rate: quote.base_rate,
        taxes: quote.taxes,
        fees: quote.fees,
        amount_charged: isForceZeroDeposit ? 0 : quote.amountCharged || 0,
        quote_object: quote,
        platform_pricing: quote.platform_pricing ?? null,
      };
      const quoteData = await this.quoteService.createQuote(
        quotesCreationData,
        trx,
      );

      if (discount) {
        await this.discountService.linkDiscountToReservation(
          discount.id,
          reservationDetails.id,
          trx,
        );
      }

      // Insert booking_reviews row for all reservations (payment and no-payment)
      const bookingReview =
        await this.bookingReviewRepository.createWithUniqueReviewId(
          {
            booking_id: booking_id,
            hotel_id: hotelDetails.id,
          },
          trx,
        );

      bookingReviewId = bookingReview.reservation_review_id;

      const noPaymentStatus = noDextrPaymentStatusFor(
        hotelDetails.payment_provider,
        isForceZeroDeposit,
      );
      if (noPaymentStatus) {
        const reviewUrl = await this.finaliseNoPaymentCreation(
          [reservationDetails.id],
          noPaymentStatus,
          bookingReview.reservation_review_id,
          hotelDetails.name!,
          trx,
        );

        await trx.commit();

        if (!options?.skipPaymentNotification) {
          void this.sendReviewLinkSMS(
            reviewUrl,
            sessionType,
            callerPhoneNum,
            hotelDetails,
            hotelConfiguration,
          );
        }

        return {
          ...reservationDetails,
          payment_status: noPaymentStatus,
          payments: [],
          customer: customerData,
          discount,
          payment_link: reviewUrl,
        };
      }

      // Payment flow: process payment as before
      const { paymentRecord, paymentMetadata } =
        await this.processPaymentForSingleRoomReservation(
          reservationDetails,
          quote.amountCharged || 0,
          callerPhoneNum,
          check_in,
          check_out,
          num_adults,
          num_children,
          sessionType,
          customerData,
          hotelDetails,
          hotelConfiguration,
          trx,
        );

      const secureReviewUrl = getSecureReviewUrl(
        bookingReviewId,
        hotelDetails.name!,
      );

      if (
        [SessionType.SMS, SessionType.CHAT].includes(
          reservationParams.session_type,
        )
      ) {
        paymentRecord.payment_link = secureReviewUrl;
      }

      await trx.commit();

      if (!options?.skipPaymentNotification) {
        await this.paymentService.sendPaymentNotifications(
          sessionId,
          paymentRecord,
          sessionType,
          paymentMetadata,
          reservationPhoneNum,
          hotelConfiguration?.sms_agent_enabled || false,
          bookingReviewId,
          hotelConfiguration?.twilio_configuration,
        );
      }

      const reservation = {
        ...reservationDetails,
        payments: [paymentRecord],
        customer: customerData,
        discount,
        secureUrl: secureReviewUrl,
      };

      return reservation;
    } catch (error) {
      if (trx) {
        await trx.rollback();
      }
      logger.error(`Error creating reservation: ${error}`);
      throw error;
    }
  }

  /**
   * Updates the Telegram summary for a reservation
   * @param reservationDetails The reservation details
   * @param bookingId The booking ID for error logging
   */
  private async updateTelegramSummaryForReservation(
    reservationDetails: ReservationDTO,
    bookingIdOrExternalIdOrReservationId: string,
    action: CheckInMessageAction,
    originalAmount?: number,
  ): Promise<void> {
    try {
      // Asynchronously update the Telegram summary if the service is available
      if (this.guestCheckinSummaryService) {
        // Fire and forget - don't block the main flow
        const hotel = reservationDetails.hotel;
        if (hotel) {
          const timezone = hotel.timezone;
          if (!hotel.timezone) {
            logger.error(
              `No timezone configured for hotel ${hotel.id}. Skipping Telegram check-in summary update`,
            );
            return;
          }

          logger.info(`check in is ${reservationDetails.check_in}`);
          const checkInDate = dayjs(reservationDetails.check_in).format(
            'YYYY-MM-DD',
          );
          logger.info(`Parsed check-in date: ${checkInDate}`);
          const now = dayjs().tz(timezone).format('YYYY-MM-DD');
          logger.info(`Current date in timezone ${timezone}: ${now}`);

          // Only update Telegram summary if the reservation is for today in the hotel's timezone
          if (checkInDate === now) {
            logger.info(
              `Updating Telegram check-in summary for hotel ${hotel.id}`,
            );

            // Fire and forget - don't block the main flow
            if (action === CheckInMessageAction.UPDATE) {
              this.guestCheckinSummaryService
                .updateSummary(
                  hotel.id,
                  action,
                  reservationDetails.booking_id,
                  originalAmount,
                )
                .then(() => {
                  logger.info(
                    `Telegram check-in summary updated for hotel ${hotel.id}`,
                  );
                })
                .catch((err: Error) => {
                  // Just log the error, don't fail the main process
                  logger.error(
                    `Failed to update Telegram check-in summary for hotel ${hotel.id}: ${err.message}`,
                  );
                });
            } else {
              if (action === CheckInMessageAction.CREATE) {
                this.guestCheckinSummaryService
                  .updateSummary(hotel.id, action)
                  .then(() => {
                    logger.info(
                      `Telegram check-in summary updated for hotel ${hotel.id}`,
                    );
                  })
                  .catch((err: Error) => {
                    // Just log the error, don't fail the main process
                    logger.error(
                      `Failed to update Telegram check-in summary for hotel ${hotel.id}: ${err.message}`,
                    );
                  });
              } else if (action === CheckInMessageAction.CANCEL) {
                this.guestCheckinSummaryService
                  .updateSummary(
                    hotel.id,
                    action,
                    reservationDetails.booking_id,
                  )
                  .then(() => {
                    logger.info(
                      `Telegram check-in summary updated for hotel ${hotel.id}`,
                    );
                  })
                  .catch((err: Error) => {
                    // Just log the error, don't fail the main process
                    logger.error(
                      `Failed to update Telegram check-in summary for hotel ${hotel.id}: ${err.message}`,
                    );
                  });
              }
            }
          } else {
            logger.info(
              `Skipping Telegram check-in summary update for hotel ${hotel.id}: check-in date ${checkInDate} is not today (${now}) in hotel timezone ${timezone}`,
            );
          }
        } else {
          logger.error(
            `Cannot update Telegram check-in summary: hotel not found for business id ${reservationDetails.business_id}`,
          );
        }
      } else {
        logger.error(
          `Cannot update Telegram check-in summary: guestCheckinSummaryService is not available`,
        );
      }
    } catch (telegramError) {
      // Log the error but don't fail the reservation status update
      logger.error(
        `Error updating Telegram check-in summary for reservation ${bookingIdOrExternalIdOrReservationId}: ${telegramError instanceof Error ? telegramError.message : 'Unknown error'}`,
      );
    }
  }

  private async cancelExternalDirectReservation(
    reservation: ReservationDTO,
    normalizedId: string,
    cancellationSource: CancellationSource,
    reason?: string,
  ): Promise<ReservationDTO> {
    try {
      const hotel = reservation.hotel;
      if (!hotel) {
        throw new NoDataError(
          `cancelExternalDirectReservation: Hotel not found for reservation ${normalizedId}`,
        );
      }

      const currentStatus = reservation.status;
      if (currentStatus !== ReservationStatus.ACTIVE) {
        throw new BadRequestError(
          `cancelExternalDirectReservation: Reservation ${normalizedId} is not active. Cannot cancel`,
        );
      }

      const isUserInitiated =
        cancellationSource === CancellationSource.CUSTOMER;
      this.checkCancellationEligibility(
        normalizedId,
        reservation,
        isUserInitiated,
      );

      const pmsService = await this.pmsServiceFactory.getReservationService(
        hotel.id,
      );
      await pmsService.cancelExternalDirectReservation(reservation, reason);
      logger.info(
        `cancelExternalDirectReservation: Cancelled website reservation ${reservation.booking_id} in PMS`,
      );

      if (
        currentStatus === ReservationStatus.ACTIVE &&
        cancellationSource === CancellationSource.CUSTOMER &&
        hotel.telegram_alerts_group_id
      ) {
        try {
          const notificationPayload: NotificationPayload = {
            recipient: hotel.telegram_alerts_group_id,
            content: {
              message:
                externalDirectBookingCancelledReviewRefundTelegramTemplate(
                  reservation,
                ),
              parseMode: 'MarkdownV2',
            },
          };
          await this.notificationFactory
            .getChatService(hotel.notification_type)
            .sendMessage(notificationPayload);
        } catch (err) {
          logger.warn(
            `cancelExternalDirectReservation: Failed to send booking cancelled notification for reservation ${normalizedId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        }
      }

      await this.sendCancellationSMS(reservation, cancellationSource);

      return reservation;
    } catch (error) {
      throw error;
    }
  }

  public async cancelReservation(
    bookingIdOrExternalIdOrReservationIdOrExternalPublicId: string,
    cancellationSource: CancellationSource = CancellationSource.SYSTEM,
    assistantPhoneNumber?: string,
    reason?: string,
    hotelId?: string,
  ) {
    const resolvedHotelId =
      hotelId ??
      (assistantPhoneNumber
        ? (
            await this.hotelService.getHotelByAssistantPhoneNumber(
              assistantPhoneNumber,
            )
          )?.id
        : undefined);
    if (!resolvedHotelId) {
      throw new BadRequestError(
        'cancelReservation: Unable to determine hotel. Provide assistantPhoneNumber or hotelId.',
      );
    }
    const reservation = await this.validateAndFetchReservationDetails(
      bookingIdOrExternalIdOrReservationIdOrExternalPublicId,
      resolvedHotelId,
      assistantPhoneNumber,
    );

    if (
      reservation.reservation_source ===
      ReservationSource.THIRD_PARTY_RESERVATION
    ) {
      throw new BadRequestError(
        'cancelReservation: Cancellation of third-party reservations is not supported',
      );
    }

    if (reservation.type === SessionType.EXTERNAL) {
      const reservationCancelResult =
        await this.cancelExternalDirectReservation(
          reservation,
          bookingIdOrExternalIdOrReservationIdOrExternalPublicId,
          cancellationSource,
          reason,
        );
      return {
        reservationCancelResult,
        errors: [] as { payment_id: string; message: string }[],
      };
    }

    let transaction: Knex.Transaction | undefined;
    try {
      transaction = await db.transaction();
      const reservationCancelResult = await this.updateReservationStatus(
        bookingIdOrExternalIdOrReservationIdOrExternalPublicId,
        ReservationStatus.CANCELLED,
        resolvedHotelId,
        transaction,
        cancellationSource,
        reason,
      );
      const payments = reservationCancelResult.payments;
      await transaction.commit();
      let errors: { payment_id: string; message: string }[] = [];
      if (payments && payments.length > 0) {
        const paymentIds = payments.map((payment) => payment.id);
        const disableResult = await this.paymentService.cancelPayments(
          paymentIds,
          true,
        );
        errors = disableResult.errors;
      }
      return { reservationCancelResult, errors };
    } catch (error) {
      if (transaction) {
        await transaction.rollback();
      }
      throw error;
    }
  }

  public async updateReservationStatus(
    bookingIdOrExternalIdOrReservationIdOrExternalPublicId: string,
    nextStatus: ReservationStatus,
    hotelId: string,
    parentTransaction?: Knex.Transaction,
    cancellationSource: CancellationSource = CancellationSource.SYSTEM,
    reason?: string,
  ) {
    const transaction =
      parentTransaction ||
      (await this.reservationRepository.startTransaction());
    let committed = false;
    try {
      logger.info(
        `updateReservationStatus: Updating status for reservation ${bookingIdOrExternalIdOrReservationIdOrExternalPublicId} to ${nextStatus}`,
      );
      if (
        !bookingIdOrExternalIdOrReservationIdOrExternalPublicId ||
        !nextStatus
      ) {
        throw new BadRequestError(
          'updateReservationStatus: Booking ID and status are required',
        );
      }
      if (
        bookingIdOrExternalIdOrReservationIdOrExternalPublicId
          .trim()
          .toUpperCase()
          .startsWith('BK')
      ) {
        bookingIdOrExternalIdOrReservationIdOrExternalPublicId =
          bookingIdOrExternalIdOrReservationIdOrExternalPublicId
            .trim()
            .toUpperCase();
      }

      logger.info(
        `updateReservationStatus: Updating status for reservation ${bookingIdOrExternalIdOrReservationIdOrExternalPublicId} to ${nextStatus}`,
      );

      let reservation: ReservationDTO | null = null;
      let currentStatus: ReservationStatus;
      reservation = await this.reservationRepository.findReservationWithDetails(
        bookingIdOrExternalIdOrReservationIdOrExternalPublicId,
        hotelId,
      );
      if (!reservation) {
        throw new NoDataError(
          `updateReservationStatus: Reservation with ID ${bookingIdOrExternalIdOrReservationIdOrExternalPublicId} not found`,
        );
      }
      const hotel = reservation.hotel;
      if (!hotel) {
        throw new NoDataError(
          `updateReservationStatus: Hotel not found for reservation ${bookingIdOrExternalIdOrReservationIdOrExternalPublicId}`,
        );
      }
      currentStatus = reservation.status;
      if (!validReservationPreStatus[nextStatus]?.includes(currentStatus)) {
        throw new BaseError(
          `updateReservationStatus: Cannot change reservation_status from ${currentStatus} to ${nextStatus}`,
        );
      }

      // Multi-room reservation
      if (reservation.booking_id.match(/_\d+$/)) {
        if (
          nextStatus === ReservationStatus.CANCELLED &&
          cancellationSource === CancellationSource.CUSTOMER
        ) {
          if (currentStatus === ReservationStatus.INACTIVE) {
            throw new BadRequestError(
              'updateReservationStatus: UpdateReservationStatus: Unpaid reservations which are a part of a multi-room reservation will be auto-cancelled by the system. The user cannot cancel the reservation',
            );
          } else {
            throw new BadRequestError(
              'updateReservationStatus: UpdateReservationStatus: For cancelling the reservation of multi-room reservations (i.e, multiple reservations having a single payment), contact the manager',
            );
          }
        }
      }

      // Reservation Cancellation
      if (
        nextStatus === ReservationStatus.CANCELLED &&
        currentStatus === ReservationStatus.ACTIVE
      ) {
        if (cancellationSource === CancellationSource.CUSTOMER) {
          this.checkCancellationEligibility(
            bookingIdOrExternalIdOrReservationIdOrExternalPublicId,
            reservation,
            true,
          );
        }

        // If cancelling an active reservation, cancel in PMS first — unless the
        // cancellation originated at the PMS itself (e.g. a Cloudbeds webhook),
        // in which case calling back would be redundant/wrong-direction.
        if (cancellationSource !== CancellationSource.PMS) {
          const pmsService = await this.pmsServiceFactory.getReservationService(
            hotel.id,
          );
          await pmsService.cancelReservation({
            business_id: reservation.business_id.toString(),
            internal_id: reservation.booking_id,
            external_id: reservation.external_id,
            reason,
          });
          logger.info(`Cancelled reservation ${reservation.booking_id} in PMS`);
        }
        logKpi({
          stat: KpiStat.PmsBookingCancelled,
          value: 1,
          contextName: 'updateReservationStatus',
          clientId: hotel.assistant_phone_number ?? hotel.id,
        });
        reservation.status = nextStatus;

        if (!hasNoDextrPayment(reservation.payment_status)) {
          if (
            cancellationSource === CancellationSource.CUSTOMER ||
            cancellationSource === CancellationSource.PMS
          ) {
            await this.updateReservationPaymentStatus(
              [reservation.id],
              ReservationPaymentStatus.REVIEW_PENDING,
              transaction,
            );
          }

          // Disable existing auto-charge for cancelled reservations
          if (reservation.auto_charge?.is_enabled) {
            await this.setupAutoCharge(
              reservation.booking_id,
              hotel.id,
              { is_enabled: false },
              transaction,
            );
          }
        }
      }

      if (
        nextStatus === ReservationStatus.NO_SHOW &&
        currentStatus === ReservationStatus.ACTIVE
      ) {
        if (
          cancellationSource === CancellationSource.CUSTOMER &&
          !hasNoDextrPayment(reservation.payment_status)
        ) {
          await this.updateReservationPaymentStatus(
            [reservation.id],
            ReservationPaymentStatus.REVIEW_PENDING,
            transaction,
          );
        }
      }

      await this.reservationRepository.updateStatus(
        reservation.id,
        nextStatus,
        currentStatus,
        transaction,
      );
      reservation.status = nextStatus;
      reservation.previous_status = currentStatus;

      if (!parentTransaction) {
        await transaction.commit();
        committed = true;
      }

      if (
        nextStatus === ReservationStatus.CANCELLED &&
        currentStatus === ReservationStatus.ACTIVE
      ) {
        if (
          (cancellationSource === CancellationSource.CUSTOMER ||
            cancellationSource === CancellationSource.PMS) &&
          !hasNoDextrPayment(reservation.payment_status) &&
          hotel.telegram_alerts_group_id
        ) {
          try {
            const notificationPayload: NotificationPayload = {
              recipient: hotel.telegram_alerts_group_id,
              content: {
                message:
                  bookingCancelledReviewRefundTelegramTemplate(reservation),
                parseMode: 'MarkdownV2',
              },
            };
            await this.notificationFactory
              .getChatService(hotel.notification_type)
              .sendMessage(notificationPayload);
          } catch (err) {
            logger.warn(
              `Failed to send booking cancelled notification for reservation ${bookingIdOrExternalIdOrReservationIdOrExternalPublicId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
            );
          }
        }
      }

      logger.info(
        `Successfully updated status for reservation ${bookingIdOrExternalIdOrReservationIdOrExternalPublicId} to ${nextStatus}`,
      );

      if (nextStatus === ReservationStatus.ACTIVE) {
        // Send a Telegram check-in message asynchronously without blocking the main flow
        this.updateTelegramSummaryForReservation(
          reservation,
          bookingIdOrExternalIdOrReservationIdOrExternalPublicId,
          CheckInMessageAction.CREATE,
        );

        // Check if this reservation needs immediate onboarding SMS (for late bookings)
        this.checkAndSendImmediateOnboardingSms(reservation).catch((error) => {
          logger.error(
            `updateReservationStatus: Failed to check/send immediate onboarding SMS for reservation ${reservation.id}: ${error}`,
          );
        });
      }
      if (
        currentStatus === ReservationStatus.ACTIVE &&
        nextStatus === ReservationStatus.CANCELLED
      ) {
        // Replace the existing Telegram check-in message asynchronously without blocking the main flow
        this.updateTelegramSummaryForReservation(
          reservation,
          bookingIdOrExternalIdOrReservationIdOrExternalPublicId,
          CheckInMessageAction.CANCEL,
        );
      }
      if (nextStatus === ReservationStatus.CANCELLED) {
        await this.sendCancellationSMS(reservation, cancellationSource);
      }

      return reservation;
    } catch (error) {
      if (!parentTransaction && !committed) {
        await transaction.rollback();
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `Error updating reservation status for booking ID ${bookingIdOrExternalIdOrReservationIdOrExternalPublicId}:`,
        errorMessage,
      );
      if (error instanceof BaseError) {
        throw error;
      }

      try {
        if (error instanceof Error) {
          const errorMessage = error.message || 'Unknown error';
          logger.error(
            `Error updating reservation status for booking ID ${bookingIdOrExternalIdOrReservationIdOrExternalPublicId}:`,
            errorMessage,
          );
        }
      } catch {}

      throw new BaseError(
        `Failed to update reservation status: ${errorMessage}`,
      );
    }
  }

  async updateMultipleReservationStatus(
    bookingId: string,
    hotelId: string,
    nextStatus: ReservationStatus,
    cancellationSource: CancellationSource = CancellationSource.DASHBOARD,
  ): Promise<ReservationDTO[]> {
    const transaction = await db.transaction();
    try {
      const reservations =
        await this.reservationRepository.findReservationsByBookingIdForHotel(
          bookingId,
          hotelId,
        );
      if (
        cancellationSource === CancellationSource.DASHBOARD &&
        reservations.some((r) => r.type === SessionType.EXTERNAL)
      ) {
        throw new NoDataError(
          `No reservation found for booking ID: ${bookingId}`,
        );
      }
      const updateResults = [];
      for (const reservation of reservations) {
        const result = await this.updateReservationStatus(
          reservation.id,
          nextStatus,
          hotelId,
          transaction,
          cancellationSource,
        );
        updateResults.push(result);
      }
      await transaction.commit();
      return updateResults;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Checks if a reservation is eligible for cancellation based on check-in date
   * @param bookingId The booking ID of the reservation
   * @param targetReservation The reservation to check
   * @throws BadRequestError if the reservation cannot be cancelled
   * @throws NoDataError if required data is missing
   */
  private checkCancellationEligibility(
    bookingId: string,
    targetReservation: ReservationDTO | null,
    isUserInitiated: boolean,
  ): void {
    if (!targetReservation) {
      throw new NoDataError(`No reservation found for booking ID ${bookingId}`);
    }

    const hotel = targetReservation.hotel;
    if (!hotel) {
      throw new NoDataError(`No hotel found for booking ID ${bookingId}`);
    }

    // Get hotel timezone
    const hotelTimezone = hotel.timezone;
    if (!hotelTimezone) {
      throw new NoDataError(
        `No hotel timezone found for booking ID ${bookingId}`,
      );
    }

    // Get check-in date from the reservation
    if (!targetReservation.check_in) {
      throw new NoDataError(
        `No check-in date found for booking ID ${bookingId}`,
      );
    }

    // Get current date in hotel's timezone
    const currentDateInHotelTZ = dayjs().tz(hotelTimezone).format('YYYY-MM-DD');
    const checkInDate = dayjs(targetReservation.check_in).format('YYYY-MM-DD');

    // If current date is on or after check-in date, don't allow cancellation
    if (currentDateInHotelTZ >= checkInDate && isUserInitiated) {
      throw new BadRequestError(
        `The user cannot cancel reservation ${bookingId} as the check-in date has already arrived or passed. ` +
          `Please contact the hotel directly for assistance.`,
      );
    }

    const hotelCancellationPolicy =
      targetReservation.hotel_configuration?.cancellation_policy;
    if (hotelCancellationPolicy) {
      const cancellationDeadlineDays =
        hotelCancellationPolicy.cancellation_deadline_days;
      if (cancellationDeadlineDays || cancellationDeadlineDays === 0) {
        const cancellationDeadlineDate = dayjs(targetReservation.check_in)
          .subtract(cancellationDeadlineDays, 'days')
          .format('YYYY-MM-DD');
        if (
          currentDateInHotelTZ > cancellationDeadlineDate &&
          isUserInitiated
        ) {
          throw new BadRequestError(
            `The user cannot cancel reservation ${getGuestFacingReservationId(targetReservation) ?? targetReservation.external_id} as the cancellation deadline of ${cancellationDeadlineDays} days before check-in has passed. ` +
              `Please contact the hotel manager for assistance.`,
          );
        }
      }
    }
  }

  /**
   * Sends cancellation SMS to the reservation/customer phone number.
   * Do not send the auto-cancellation SMS for web reservations.
   */
  private async sendCancellationSMS(
    existingReservation: ReservationDTO,
    cancellationSource: CancellationSource = CancellationSource.SYSTEM,
  ): Promise<void> {
    try {
      if (!existingReservation || !existingReservation.phone_number) {
        const reservationId = existingReservation?.id || '';
        throw new NoDataError(
          `sendCancellationSMS:: No reservation or phone number found for reservation ${reservationId}`,
        );
      }
      const hotel = existingReservation.hotel;
      const hotelConfig = existingReservation.hotel_configuration;
      if (!hotel) {
        const reservationId = existingReservation.id;
        throw new NoDataError(
          `sendCancellationSMS:: No hotel found for reservation ${reservationId}`,
        );
      }
      if (!existingReservation.customer) {
        const reservationId = existingReservation.id;
        throw new NoDataError(
          `sendCancellationSMS:: No customer found for reservation ${reservationId}`,
        );
      }

      // Do not send system auto-cancellation SMS
      if (cancellationSource === CancellationSource.SYSTEM) {
        return;
      }

      let smsBody: string | undefined;

      const country = hotel.country;
      const hotelPhoneNumber = hotel.assistant_phone_number;
      const hotelInternalPhoneNumber = hotel.internal_phone_number;
      const hotelName = hotel.name;
      const hotelSmsNumber = hotel.sms_number;
      const smsAgentEnabled = hotelConfig?.sms_agent_enabled || false;
      const customerFirstName = existingReservation.customer.first_name;
      const customerPhoneNumber = existingReservation.customer.phone_number;
      const reservationPhoneNumber = existingReservation.phone_number; // will be a UUID for CHAT reservations
      const reservationType = existingReservation.type;
      const toPhone = await resolveSmsTargetPhoneNumber(
        customerPhoneNumber,
        reservationPhoneNumber,
        hotelConfig?.twilio_configuration,
        country,
        false,
      );

      if (!country) {
        throw new NoDataError(
          `sendCancellationSMS:: No country found for hotel ${hotelName}`,
        );
      }
      if (!hotelPhoneNumber) {
        throw new NoDataError(
          `sendCancellationSMS:: No assistant phone number found for hotel ${hotelName}`,
        );
      }
      if (!hotelName) {
        throw new NoDataError(
          `sendCancellationSMS:: No hotel name found for hotel ${hotel.id}`,
        );
      }
      if (!hotelSmsNumber) {
        throw new NoDataError(
          `sendCancellationSMS:: No SMS number found for hotel ${hotelName}`,
        );
      }

      switch (cancellationSource) {
        case CancellationSource.CUSTOMER:
          smsBody = reservationCancelledByUserSMSTemplate(
            customerFirstName || 'Guest',
            hotelName,
            hotelInternalPhoneNumber || hotelPhoneNumber,
            country,
            smsAgentEnabled,
          );
          break;
        case CancellationSource.DASHBOARD:
        case CancellationSource.PMS:
          smsBody = reservationCancelledByDashboardSMSTemplate(
            customerFirstName || 'Guest',
            hotelName,
            hotelInternalPhoneNumber || hotelPhoneNumber,
            country,
            smsAgentEnabled,
          );
          break;
        default:
          break;
      }

      if (!smsBody) {
        logger.warn(
          `sendCancellationSMS:: No SMS body found for reservation ${existingReservation.id}`,
        );
        return;
      }

      if (!toPhone) {
        logger.warn(
          `sendCancellationSMS:: No phone number found for reservation ${existingReservation.id}`,
        );
        return;
      }

      const smsContent: NotificationSMSContent = {
        from: hotelSmsNumber,
        message: smsBody,
        twilioConfiguration: hotelConfig?.twilio_configuration,
      };
      const smsPayload: NotificationPayload = {
        recipient: toPhone,
        content: smsContent,
      };

      const smsResult = await this.smsService.sendMessage(smsPayload);
      logger.info(
        `Cancellation SMS sent to ${toPhone} for reservation ${existingReservation.id}`,
      );

      // Emit event for SMS tracking (decoupled from conversation service)
      if (smsResult) {
        smsEvents.emitSmsSent({
          sessionId: existingReservation.session_id,
          message: smsContent.message,
          from: smsContent.from,
          to: toPhone,
          callerPhoneNumber: existingReservation.phone_number,
          assistantPhoneNumber: hotelPhoneNumber,
          timestamp: new Date(),
          hotelSmsNumber,
          smsAgentEnabled,
          hotelId: hotel.id,
        });
      }
    } catch (error) {
      logger.error(
        `Failed to send cancellation SMS for reservation ${existingReservation.id}. Error: ${JSON.stringify(error)}`,
      );
    }
  }

  /**
   * Priority order of lookup:
   * 1. Booking ID
   * 2. lastDigitsPhoneNumber
   * 3. Guest Name
   * 4. CallerPhoneNumber
   * @param callerPhoneNumber
   * @param assistantPhoneNumber
   * @param bookingIdOrReservationIdOrExternalIdOrExternalPublicIdOrThirdPartyId
   * @param lastDigitsPhoneNumber
   * @param guestName
   * @param checkOutDate narrows a guestName lookup to a single checkout date
   * @param reservationIdLastFour last 4 chars of the reservation id; further
   *   narrows a guestName (+ checkOutDate) lookup
   * @returns
   */
  public async getReservationDetails(
    callerPhoneNumber: string,
    assistantPhoneNumber: string,
    bookingIdOrReservationIdOrExternalIdOrExternalPublicIdOrThirdPartyId?: string,
    lastDigitsPhoneNumber?: string,
    guestName?: string,
    checkOutDate?: string,
    reservationIdLastFour?: string,
    source?: ReservationLookupSource,
  ) {
    try {
      lastDigitsPhoneNumber = lastDigitsPhoneNumber?.trim();
      callerPhoneNumber = callerPhoneNumber?.trim();
      assistantPhoneNumber = assistantPhoneNumber?.trim();
      bookingIdOrReservationIdOrExternalIdOrExternalPublicIdOrThirdPartyId =
        bookingIdOrReservationIdOrExternalIdOrExternalPublicIdOrThirdPartyId?.trim();
      guestName = guestName?.trim();
      checkOutDate = checkOutDate?.trim();
      reservationIdLastFour = reservationIdLastFour?.trim();

      if (!callerPhoneNumber || !assistantPhoneNumber) {
        throw new BadRequestError(
          'getReservationDetails: Caller Phone Number and Assistant Phone Number are required',
        );
      }

      if (
        !(
          bookingIdOrReservationIdOrExternalIdOrExternalPublicIdOrThirdPartyId ||
          (callerPhoneNumber && assistantPhoneNumber)
        )
      ) {
        throw new BadRequestError(
          'getReservationDetails: Booking ID or Assistant Phone Number and Caller Phone Number is required',
        );
      }

      const bookingId =
        bookingIdOrReservationIdOrExternalIdOrExternalPublicIdOrThirdPartyId;
      const isTest = isTestPhone(callerPhoneNumber);

      const hotel =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          assistantPhoneNumber,
        );
      if (!hotel) {
        throw new BadRequestError(
          'getReservationDetails: Unable to determine hotel',
        );
      }

      logger.info(
        this.formatGetReservationDetailsLog(
          callerPhoneNumber,
          assistantPhoneNumber,
          `started params=${JSON.stringify({
            bookingId,
            lastDigits: lastDigitsPhoneNumber,
            guestName,
            checkOutDate,
            reservationIdLastFour,
            isTest,
          })}`,
        ),
      );

      let primaryResults: ReservationDTO[];
      let notFoundCriteria: {
        bookingId?: string;
        callerPhoneNumber?: string;
        lastDigitsPhoneNumber?: string;
        guestName?: string;
        checkOutDate?: string;
        reservationIdLastFour?: string;
      };

      if (bookingId) {
        primaryResults = await this.lookupReservationsByBookingId(
          callerPhoneNumber,
          hotel.id,
          bookingId,
          assistantPhoneNumber,
        );
        notFoundCriteria = { bookingId };
      } else if (lastDigitsPhoneNumber) {
        primaryResults = await this.lookupReservationsByLastDigits(
          callerPhoneNumber,
          assistantPhoneNumber,
          hotel.id,
          lastDigitsPhoneNumber,
          isTest,
        );
        notFoundCriteria = { lastDigitsPhoneNumber };
      } else if (guestName) {
        logger.info(
          this.formatGetReservationDetailsLog(
            callerPhoneNumber,
            assistantPhoneNumber,
            'starting guestName lookup',
          ),
        );
        primaryResults = await this.lookupReservationsByGuestName(
          hotel.id,
          guestName,
          source,
        );
        if (checkOutDate) {
          // check_out is stored as YYYY-MM-DD in the hotel's own timezone
          // already, so this is a plain date comparison — no .tz() needed.
          primaryResults = primaryResults.filter(
            (reservation) =>
              dayjs(reservation.check_out).format('YYYY-MM-DD') ===
              checkOutDate,
          );
        }
        if (reservationIdLastFour) {
          const lastFour = reservationIdLastFour.toLowerCase();
          primaryResults = primaryResults.filter((reservation) =>
            [
              reservation.external_public_id,
              reservation.external_id,
              reservation.id,
              reservation.booking_id,
            ].some((id) => id?.toLowerCase().endsWith(lastFour)),
          );
        }
        notFoundCriteria = { guestName, checkOutDate, reservationIdLastFour };
      } else {
        primaryResults = await this.lookupReservationsByCallerPhone(
          callerPhoneNumber,
          assistantPhoneNumber,
          hotel.id,
          isTest,
        );
        notFoundCriteria = { callerPhoneNumber };
      }

      return await this.finalizeGetReservationDetails(
        primaryResults,
        notFoundCriteria,
        callerPhoneNumber,
        assistantPhoneNumber,
      );
    } catch (error) {
      if (error instanceof BaseError) {
        throw error;
      }
      logger.error(
        this.formatGetReservationDetailsLog(
          callerPhoneNumber,
          assistantPhoneNumber,
          `unexpected error=${JSON.stringify(error)}`,
        ),
      );
      throw new BaseError(`Failed to fetch reservation details: ${error}`);
    }
  }

  /**
   * Merges DB-stored and live-PMS reservation results for the same lookup,
   * de-duplicating by external_id (keeping the DB copy when both exist,
   * same as before — it carries Daisy-specific fields like payments/quote/
   * channel that the PMS mapper always sets to null). The `reservations`
   * table has no room_name/room_number columns, so a kept DB-sourced result
   * never carries them even when the matching live PMS result does — this
   * fills them in from PMS without disturbing anything else the DB result
   * carries.
   */
  private mergeReservationResults(
    dbResults: ReservationDTO[],
    pmsResults: ReservationDTO[],
  ): ReservationDTO[] {
    const seen = new Set<string>();
    const merged = [...dbResults, ...pmsResults].filter((reservation) => {
      if (!reservation.external_id) return true;
      if (seen.has(reservation.external_id)) return false;
      seen.add(reservation.external_id);
      return true;
    });

    const pmsByExternalId = new Map(
      pmsResults
        .filter((reservation) => reservation.external_id)
        .map((reservation) => [reservation.external_id as string, reservation]),
    );

    return merged.map((reservation) => {
      const pmsMatch =
        reservation.external_id && pmsByExternalId.get(reservation.external_id);
      if (!pmsMatch || pmsMatch === reservation) return reservation;
      return {
        ...reservation,
        room_name: pmsMatch.room_name,
        room_number: pmsMatch.room_number,
      };
    });
  }

  /**
   * For DB-stored results that already carry a known PMS external_id, fetches
   * that exact reservation live from the PMS by ID and overlays its
   * room_name/room_number. This works even for PMS providers (Cloudbeds)
   * that have no phone-search capability at all — it looks the reservation
   * up directly by the ID already on file, rather than searching for it.
   */
  private async refreshDbResultsWithLiveRoomData(
    dbResults: ReservationDTO[],
    assistantPhoneNumber?: string,
    timeoutMs = 5_000,
  ): Promise<ReservationDTO[]> {
    if (!assistantPhoneNumber || dbResults.length === 0) return dbResults;

    // room_name/room_number only ever come from the Cloudbeds mapper — for
    // every other provider this refresh would be a wasted extra PMS call
    // (their own phone search already works, and none of them set these
    // fields regardless of how they're queried), so skip it entirely.
    const hotel =
      await this.hotelService.getHotelByAssistantPhoneNumber(
        assistantPhoneNumber,
      );
    if (hotel?.pms_provider !== PmsProvider.CLOUDBEDS) return dbResults;

    // Cloudbeds requests can take up to API_TIMEOUT (30s default) with no
    // stricter deadline of their own, and this refresh runs before the
    // existing phone lookup's own 12s budget even starts — bound it
    // explicitly so a slow Cloudbeds response can't blow the voice-agent's
    // overall response budget. On timeout (or any other failure), fall
    // back to the DB rows unchanged, same as when no live match is found.
    try {
      return await Promise.race([
        Promise.all(
          dbResults.map(async (dbResult) => {
            if (!dbResult.external_id) return dbResult;
            const [liveMatch] = await this.lookupPmsReservationsById(
              assistantPhoneNumber,
              dbResult.external_id,
            );
            if (!liveMatch) return dbResult;
            return {
              ...dbResult,
              room_name: liveMatch.room_name,
              room_number: liveMatch.room_number,
            };
          }),
        ),
        new Promise<ReservationDTO[]>((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                `refreshDbResultsWithLiveRoomData timed out after ${timeoutMs}ms`,
              ),
            );
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      logger.error(`refreshDbResultsWithLiveRoomData failed: ${error}`);
      return dbResults;
    }
  }

  private async lookupReservationsByBookingId(
    callerPhoneNumber: string,
    hotelId: string,
    bookingId: string,
    assistantPhoneNumber?: string,
  ): Promise<ReservationDTO[]> {
    logger.info(
      this.formatGetReservationDetailsLog(
        callerPhoneNumber,
        assistantPhoneNumber ?? '',
        'starting DB bookingId lookup',
      ),
    );
    const reservationDetails =
      await this.reservationRepository.findReservationWithDetails(
        bookingId,
        hotelId,
      );
    const dbResults = await this.refreshDbResultsWithLiveRoomData(
      reservationDetails ? [reservationDetails] : [],
      assistantPhoneNumber,
    );

    let pmsResults: ReservationDTO[] = [];
    if (!bookingId.toUpperCase().startsWith('BK') && assistantPhoneNumber) {
      logger.info(
        this.formatGetReservationDetailsLog(
          callerPhoneNumber,
          assistantPhoneNumber,
          'starting PMS bookingId lookup',
        ),
      );
      pmsResults = await this.lookupPmsReservationsById(
        assistantPhoneNumber,
        bookingId,
      );
    }

    return this.mergeReservationResults(dbResults, pmsResults);
  }

  private async lookupReservationsByLastDigits(
    callerPhoneNumber: string,
    assistantPhoneNumber: string,
    hotelId: string,
    lastDigitsPhoneNumber: string,
    isTest: boolean,
  ): Promise<ReservationDTO[]> {
    logger.info(
      this.formatGetReservationDetailsLog(
        callerPhoneNumber,
        assistantPhoneNumber,
        'starting DB lastDigits lookup',
      ),
    );
    const dbResults = await this.refreshDbResultsWithLiveRoomData(
      isTest
        ? await this.reservationRepository.getTestReservationsByLastDigitsPhoneNumber(
            lastDigitsPhoneNumber,
            hotelId,
          )
        : await this.reservationRepository.getReservationsByLastDigitsPhoneNumber(
            lastDigitsPhoneNumber,
            hotelId,
          ),
      assistantPhoneNumber,
    );

    logger.info(
      this.formatGetReservationDetailsLog(
        callerPhoneNumber,
        assistantPhoneNumber,
        'starting PMS lastDigits lookup',
      ),
    );
    const pmsResults = await this.lookupPmsReservationsByPhone(
      assistantPhoneNumber,
      lastDigitsPhoneNumber,
      isTest ? TEST_RESERVATION_LIMIT : undefined,
      12_000,
    );

    return this.mergeReservationResults(dbResults, pmsResults);
  }

  /** DB + PMS lookup by the caller's full phone number. */
  private async lookupReservationsByCallerPhone(
    callerPhoneNumber: string,
    assistantPhoneNumber: string,
    hotelId: string,
    isTest: boolean,
  ): Promise<ReservationDTO[]> {
    logger.info(
      this.formatGetReservationDetailsLog(
        callerPhoneNumber,
        assistantPhoneNumber,
        'starting DB callerPhone lookup',
      ),
    );
    const dbResults = await this.refreshDbResultsWithLiveRoomData(
      isTest
        ? await this.reservationRepository.getTestReservationsByPhoneNumber(
            callerPhoneNumber,
            hotelId,
          )
        : await this.reservationRepository.getReservationsByPhoneNumber(
            callerPhoneNumber,
            hotelId,
          ),
      assistantPhoneNumber,
    );

    logger.info(
      this.formatGetReservationDetailsLog(
        callerPhoneNumber,
        assistantPhoneNumber,
        'starting PMS callerPhone lookup',
      ),
    );
    const timeoutMs = 12_000;
    const pmsResults = await this.lookupPmsReservationsByPhone(
      assistantPhoneNumber,
      callerPhoneNumber,
      isTest ? TEST_RESERVATION_LIMIT : undefined,
      timeoutMs,
    );

    return this.mergeReservationResults(dbResults, pmsResults);
  }

  private finalizeGetReservationDetails(
    primaryResults: ReservationDTO[],
    notFoundCriteria: {
      bookingId?: string;
      callerPhoneNumber?: string;
      lastDigitsPhoneNumber?: string;
      guestName?: string;
      checkOutDate?: string;
      reservationIdLastFour?: string;
    },
    callerPhoneNumber: string,
    assistantPhoneNumber: string,
  ): ReservationDTO[] {
    const mergedResults = primaryResults.map(
      (res) => this.selectRequiredFields(res) as ReservationDTO,
    );

    if (mergedResults.length === 0) {
      logger.info(
        this.formatGetReservationDetailsLog(
          callerPhoneNumber,
          assistantPhoneNumber,
          'notFound',
        ),
      );
      throw new NoDataError(
        this.buildGetReservationDetailsNotFoundErrorMessage(notFoundCriteria),
      );
    }

    logger.info(
      this.formatGetReservationDetailsLog(
        callerPhoneNumber,
        assistantPhoneNumber,
        `completed count=${mergedResults.length}`,
      ),
    );
    return mergedResults;
  }

  private async lookupPmsReservationsById(
    assistantPhoneNumber: string,
    bookingId: string,
  ): Promise<ReservationDTO[]> {
    try {
      const hotel =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          assistantPhoneNumber,
        );
      if (!hotel) {
        return [];
      }

      const pmsService = await this.pmsServiceFactory.getReservationService(
        hotel.id,
      );
      if (
        [
          PmsProvider.STAYNTOUCH,
          PmsProvider.CLOUDBEDS,
          PmsProvider.MEWS,
          PmsProvider.CALRY,
        ].includes(hotel.pms_provider as PmsProvider)
      ) {
        return await pmsService.lookupReservationsById(hotel, bookingId);
      } else {
        logger.info(
          `lookupPmsReservationsById: Ignoring PMS lookup since it's not implemented for ${hotel.pms_provider} yet`,
        );
        return [];
      }
    } catch (error) {
      logger.error(`lookupPmsReservationsById exception: ${error}`);
      return [];
    }
  }

  private async lookupPmsReservationsByPhone(
    assistantPhoneNumber: string,
    phoneNumber: string,
    maxResults: number | undefined,
    timeoutMs: number,
  ): Promise<ReservationDTO[]> {
    try {
      return await Promise.race([
        (async (): Promise<ReservationDTO[]> => {
          const hotel =
            await this.hotelService.getHotelByAssistantPhoneNumber(
              assistantPhoneNumber,
            );
          if (!hotel) {
            return [];
          }

          const pmsService = await this.pmsServiceFactory.getReservationService(
            hotel.id,
          );
          return await pmsService.lookupReservationsByPhone(
            hotel,
            phoneNumber,
            maxResults,
          );
        })(),
        new Promise<ReservationDTO[]>((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                `lookupPmsReservationsByPhone timed out after ${timeoutMs}ms`,
              ),
            );
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('lookupPmsReservationsByPhone timed out')
      ) {
        logger.error(error.message);
        return [];
      }
      logger.error(`lookupPmsReservationsByPhone exception: ${error}`);
      return [];
    }
  }

  private async lookupReservationsByGuestName(
    hotelId: string,
    guestName: string,
    source?: ReservationLookupSource,
  ): Promise<ReservationDTO[]> {
    try {
      logger.info(
        `lookupReservationsByGuestName hotelId=${hotelId} ${guestName}`,
      );

      const hotel = await this.hotelService.getHotelById(hotelId);
      if (!hotel) {
        return [];
      }

      // Always fetch from both database and PMS, then merge results.
      // Exact (case-insensitive) match only — no fuzzy/similarity matching.
      // Cloudbeds hotels treat a single-token name (no first name given) as
      // a last name, matching the Cloudbeds API lookup below.
      // room_name/room_number also get refreshed from a live by-ID lookup
      // here, same as the other lookup paths — the guest-name PMS search
      // below isn't guaranteed to match, so it can't be relied on alone to
      // surface them.
      const dbResults = await this.refreshDbResultsWithLiveRoomData(
        await this.reservationRepository.getReservationsByExactGuestName(
          hotel.id,
          guestName,
          hotel.pms_provider === PmsProvider.CLOUDBEDS ? 'last' : undefined,
        ),
        hotel.assistant_phone_number,
      );

      let pmsResults: ReservationDTO[] = [];

      try {
        const pmsService = await this.pmsServiceFactory.getReservationService(
          hotel.id,
        );
        if (pmsService instanceof MewsReservationService) {
          pmsResults = await pmsService.lookupReservationsByGuestQueryFromPms(
            hotel,
            guestName,
            undefined,
            source,
          );
        } else if (
          pmsService instanceof StayntouchReservationService ||
          pmsService instanceof CloudbedsReservationService
        ) {
          pmsResults = await pmsService.lookupReservationsByGuestQueryFromPms(
            hotel,
            guestName,
          );
        }
      } catch (error) {
        logger.error(`lookupReservationsByGuestName PMS exception: ${error}`);
      }

      // Merge and deduplicate results from both sources
      const mergedResults = this.mergeReservationResults(dbResults, pmsResults);

      logger.info(
        `lookupReservationsByGuestName: Found ${dbResults.length} DB results, ${pmsResults.length} PMS results, ${mergedResults.length} total after deduplication`,
        {
          guestName,
          hotelId: hotel.id,
        },
      );

      return mergedResults;
    } catch (error) {
      logger.error(`lookupReservationsByGuestName exception: ${error}`);
      return [];
    }
  }

  /**
   * Selects only the required fields from reservation DTOs
   */
  private selectRequiredFields(
    reservation: ReservationDTO,
  ): Partial<ReservationDTO> {
    const selected: Record<string, unknown> = {
      id: reservation.id,
      booking_id: reservation.booking_id,
      external_id: reservation.external_id,
      external_public_id: reservation.external_public_id,
      phone_number: reservation.phone_number,
      type: reservation.type,
      reservation_source: reservation.reservation_source,
      status: reservation.status,
      room_type: reservation.room_type,
      room_id: reservation.room_id,
      room_name: reservation.room_name,
      room_number: reservation.room_number,
      business_id: reservation.business_id,
      check_in: reservation.check_in,
      check_out: reservation.check_out,
      num_adults: reservation.num_adults,
      num_children: reservation.num_children,
      num_pets: reservation.num_pets,
      rate_code: reservation.rate_code,
      ...(reservation.rate_id && { rate_id: reservation.rate_id }),
      customer: reservation.customer,
      payments: reservation.payments,
      ...(reservation.notes_from_partner && {
        notes_from_partner: reservation.notes_from_partner,
      }),
      discount: reservation.discount,
    };

    return this.stripEmptyFields(selected) as Partial<ReservationDTO>;
  }

  private stripEmptyFields<T extends Record<string, unknown>>(
    obj: T,
  ): Partial<T> {
    return _.transform(
      obj,
      (result: Record<string, unknown>, value, key) => {
        if (key === 'discount') {
          result[key] = value;
          return;
        }

        if (value === null || value === undefined || value === '') return;
        if (Array.isArray(value) && value.length === 0) return;
        if (_.isPlainObject(value) && _.isEmpty(value)) return;

        if (_.isPlainObject(value)) {
          const stripped = this.stripEmptyFields(
            value as Record<string, unknown>,
          );
          if (!_.isEmpty(stripped)) result[key] = stripped;
        } else if (Array.isArray(value)) {
          result[key] = value.map((item) =>
            _.isPlainObject(item)
              ? this.stripEmptyFields(item as Record<string, unknown>)
              : item,
          );
        } else {
          result[key] = value;
        }
      },
      {} as Record<string, unknown>,
    ) as Partial<T>;
  }

  /**
   * Merges reservation results and removes duplicates based on reservation ID
   */
  private formatGetReservationDetailsLog(
    callerPhoneNumber: string,
    assistantPhoneNumber: string,
    message: string,
  ): string {
    return `getReservationDetails [assistant=${assistantPhoneNumber || 'n/a'} caller=${callerPhoneNumber || 'n/a'}] ${message}`;
  }

  private buildGetReservationDetailsNotFoundErrorMessage(criteria: {
    bookingId?: string;
    callerPhoneNumber?: string;
    lastDigitsPhoneNumber?: string;
    guestName?: string;
    checkOutDate?: string;
    reservationIdLastFour?: string;
  }): string {
    const parts: string[] = [];

    if (criteria.bookingId) {
      parts.push(`booking ID ${criteria.bookingId}`);
    }

    if (criteria.lastDigitsPhoneNumber) {
      parts.push(`phone ending in ${criteria.lastDigitsPhoneNumber}`);
    } else if (criteria.callerPhoneNumber) {
      parts.push(`phone number ${criteria.callerPhoneNumber}`);
    }

    if (criteria.guestName) {
      parts.push(`guest name "${criteria.guestName}"`);
    }

    if (criteria.checkOutDate) {
      parts.push(`checkout date ${criteria.checkOutDate}`);
    }

    if (criteria.reservationIdLastFour) {
      parts.push(`reservation id ending in ${criteria.reservationIdLastFour}`);
    }

    if (parts.length === 0) {
      return 'getReservationDetails: No reservation found';
    }

    return `getReservationDetails: No reservation found for ${parts.join(' and ')}`;
  }

  public async getReservationsByPaymentId(paymentId: string) {
    try {
      if (!paymentId) {
        throw new BadRequestError(
          'getReservationsByPaymentId: paymentId is missing',
        );
      }

      const reservations =
        await this.reservationRepository.findManyReservationsWithDetailsByPaymentId(
          paymentId,
        );

      if (!reservations) {
        throw new NoDataError(
          `getReservationsByPaymentId: Reservations with payment ID ${paymentId} not found`,
        );
      }

      return reservations;
    } catch (error) {
      if (error instanceof BaseError) {
        throw error;
      }
      logger.error(
        `getReservationsByPaymentId: Error fetching reservation details: ${error}`,
      );
      throw new BaseError(
        `getReservationsByPaymentId: Failed to fetch reservation details: ${error}`,
      );
    }
  }

  protected async validateAndFetchReservationDetails(
    IdOrBookingIdOrExternalIdorExternalPublicId: string,
    hotelId: string,
    assistantPhoneNumber?: string,
  ): Promise<ReservationDTO> {
    if (!IdOrBookingIdOrExternalIdorExternalPublicId) {
      throw new BadRequestError(
        'validateAndFetchReservationDetails:: Booking ID is required',
      );
    }
    if (
      IdOrBookingIdOrExternalIdorExternalPublicId.trim()
        .toUpperCase()
        .startsWith('BK')
    ) {
      IdOrBookingIdOrExternalIdorExternalPublicId =
        IdOrBookingIdOrExternalIdorExternalPublicId.trim().toUpperCase();
    }

    const reservation =
      await this.reservationRepository.findReservationWithDetails(
        IdOrBookingIdOrExternalIdorExternalPublicId,
        hotelId,
      );
    if (reservation) {
      return reservation;
    }

    if (assistantPhoneNumber) {
      const pmsResults = await this.lookupPmsReservationsById(
        assistantPhoneNumber,
        IdOrBookingIdOrExternalIdorExternalPublicId,
      );
      if (pmsResults.length > 0) {
        return pmsResults[0];
      }
    }

    throw new NoDataError(
      'validateAndFetchReservationDetails:: Reservation not found',
    );
  }

  /**
   * Checks availability for modifying a reservation
   */
  public async checkAvailabilityForModification(
    modifyReservationRequest: ModifyRoomReservationRequest,
    assistantPhoneNumber?: string,
  ) {
    try {
      let bookingIdOrExternalIdorId = modifyReservationRequest.booking_id;
      if (bookingIdOrExternalIdorId.trim().toUpperCase().startsWith('BK')) {
        bookingIdOrExternalIdorId = bookingIdOrExternalIdorId
          .trim()
          .toUpperCase();
      }

      const resolvedHotel = assistantPhoneNumber
        ? await this.hotelService.getHotelByAssistantPhoneNumber(
            assistantPhoneNumber,
          )
        : null;
      if (!resolvedHotel) {
        throw new BadRequestError(
          'checkAvailabilityForModification: Unable to determine hotel',
        );
      }
      const reservationDetails = await this.validateAndFetchReservationDetails(
        bookingIdOrExternalIdorId,
        resolvedHotel.id,
        assistantPhoneNumber,
      );

      if (!reservationDetails) {
        throw new NoDataError(
          'validateAndFetchReservationDetails:: Reservation not found',
        );
      }

      const hotel = reservationDetails.hotel;
      if (!hotel) {
        throw new NoDataError(
          'validateAndFetchReservationDetails:: Hotel not found',
        );
      }

      if (
        reservationDetails.reservation_source ===
        ReservationSource.THIRD_PARTY_RESERVATION
      ) {
        throw new BadRequestError(
          'checkAvailabilityForModification: Modification of third-party reservations is not supported',
        );
      }

      if (
        reservationDetails.type === SessionType.EXTERNAL &&
        reservationDetails.pms_provider === PmsProvider.CLOUDBEDS
      ) {
        throw new BadRequestError(
          'checkAvailabilityForModification: Modification of externally-created Cloudbeds reservations is not supported. Please contact the hotel directly.',
        );
      }

      const note = modifyReservationRequest.room_changed
        ? 'The amounts indicate the cost for the new room type. Any existing amount paid by the customer is not considered. After modification, any delta amount (whether refund or additional payment) will be handled by the hotel.'
        : 'The amounts indicate the cost for the new dates. Any existing amount paid by the customer is not considered. After modification, any delta amount (whether refund or additional payment) will be handled by the hotel.';

      // Get PMS-specific service from factory
      const pmsService = await this.pmsServiceFactory.getReservationService(
        hotel.id!,
      );

      // External direct reservation: use Stayntouch-native availability check (no stored quote needed)
      if (reservationDetails.type === SessionType.EXTERNAL) {
        // When a room change is requested, return full availability (excluding the current room)
        // so the caller can present all available alternatives.
        if (modifyReservationRequest.room_changed) {
          const hotelPhoneNumber =
            assistantPhoneNumber ?? hotel.assistant_phone_number;
          if (!hotelPhoneNumber) {
            throw new NoDataError(
              'checkAvailabilityForModification: Hotel phone number not available',
            );
          }
          const availabilityResult = await this.getRoomAvailabilityWithQuote(
            {
              start_date: modifyReservationRequest.check_in,
              end_date: modifyReservationRequest.check_out,
              num_adults: reservationDetails.num_adults,
              num_children: reservationDetails.num_children ?? 0,
              num_pets: reservationDetails.num_pets ?? 0,
              session_type: reservationDetails.type,
              booking_link: false,
            },
            modifyReservationRequest.caller_phone_number,
            hotelPhoneNumber,
            reservationDetails.type,
          );
          return {
            ...availabilityResult,
            note,
            groups: (availabilityResult.groups ?? []).filter(
              (group: { room_id?: number }) =>
                Number(group.room_id) !== Number(reservationDetails.room_id),
            ),
          };
        }

        const info: ExternalModificationInfo =
          await pmsService.getExternalModificationInfo(
            reservationDetails,
            modifyReservationRequest.check_in,
            modifyReservationRequest.check_out,
          );

        if (info.scenario === 'same_dates') {
          return {
            note,
            groups: [],
            discount: null,
            message:
              'The requested dates are the same as the current reservation dates. No modification needed.',
          };
        }

        return {
          note,
          groups: [
            {
              unit_group_id: info.room_type_id,
              room_id: info.room_type_id,
              unit_group_name: reservationDetails.room_type || '',
              number_of_units_available: info.available ? 1 : 0,
              business_id: this.formatBusinessIdForResponse(hotel),
              check_in: modifyReservationRequest.check_in,
              check_out: modifyReservationRequest.check_out,
              base_rate: Math.max(0, info.pricingDelta),
              taxes: 0,
              fees: 0,
              total_amount: Math.abs(info.pricingDelta),
              amountCharged:
                hotel.payment_provider === PaymentProvider.NOT_APPLICABLE
                  ? 0
                  : Math.abs(info.pricingDelta),
              currency: info.currency,
              modification_scenario: info.scenario,
              pricing_delta: info.pricingDelta,
            },
          ],
          discount: null,
        };
      }

      // Multi-room reservation: detect via booking_id suffix
      if (reservationDetails.booking_id.match(/_\d+$/)) {
        const existingCheckInDate = dayjs(reservationDetails.check_in).format(
          'YYYY-MM-DD',
        );
        const existingCheckOutDate = dayjs(reservationDetails.check_out).format(
          'YYYY-MM-DD',
        );
        if (
          (modifyReservationRequest.check_in &&
            modifyReservationRequest.check_in !== existingCheckInDate) ||
          (modifyReservationRequest.check_out &&
            modifyReservationRequest.check_out !== existingCheckOutDate)
        ) {
          throw new BadRequestError(
            'CheckAvailabilityForModification: For modifying the check-in or check-out dates of multi-room reservations, contact the manager',
          );
        }
      }

      // If a discount was already applied during reservation creation, get it to calculate
      // the new rates during reservation modification
      const discount = await this.discountService.getDiscountByReservationId(
        reservationDetails.id,
      );
      const discountResponse: Omit<
        Discount,
        'reservation_id' | 'created_at' | 'updated_at'
      > | null = discount;

      // PMS service handles quote calculation, pet fees, discounts, and payment configuration
      const { raw_response: _rawQuote, ...updatedQuote } =
        await pmsService.getQuoteForModification(
          reservationDetails,
          modifyReservationRequest.check_in,
          modifyReservationRequest.check_out,
          discount,
        );

      return {
        groups: [
          {
            // map the quote to GroupWithQuote
            ...cloneDeep(updatedQuote),
            room_id: updatedQuote.unit_group_id,
            room_name: '',
            number_of_units_available: 1,
            business_id: this.formatBusinessIdForResponse(hotel),
          },
        ],
        discount: discountResponse,
      };
    } catch (error) {
      if (error instanceof BaseError) {
        throw error;
      }
      logger.error(`Error in checkAvailabilityForModification: ${error}`);
      throw new BaseError(
        `Failed to check availability for modification: ${error}`,
      );
    }
  }

  public async checkAvailabilityForModificationLite(
    modifyReservationRequest: ModifyRoomReservationRequest,
    assistantPhoneNumber?: string,
  ) {
    try {
      let bookingIdOrExternalIdorId =
        modifyReservationRequest.booking_id.toUpperCase();
      if (bookingIdOrExternalIdorId.trim().toUpperCase().startsWith('BK')) {
        bookingIdOrExternalIdorId = bookingIdOrExternalIdorId
          .trim()
          .toUpperCase();
      }
      const resolvedHotel = assistantPhoneNumber
        ? await this.hotelService.getHotelByAssistantPhoneNumber(
            assistantPhoneNumber,
          )
        : null;
      if (!resolvedHotel) {
        throw new BadRequestError(
          'checkAvailabilityForModificationLite: Unable to determine hotel',
        );
      }
      const reservationDetails = await this.validateAndFetchReservationDetails(
        bookingIdOrExternalIdorId,
        resolvedHotel.id,
        assistantPhoneNumber,
      );

      if (!reservationDetails) {
        throw new NoDataError(
          'validateAndFetchReservationDetails:: Reservation not found',
        );
      }

      const hotel = reservationDetails.hotel;
      if (!hotel) {
        throw new NoDataError(
          'validateAndFetchReservationDetails:: Hotel not found',
        );
      }

      if (
        reservationDetails.reservation_source ===
        ReservationSource.THIRD_PARTY_RESERVATION
      ) {
        throw new BadRequestError(
          'checkAvailabilityForModificationLite: Modification of third-party reservations is not supported',
        );
      }

      if (
        reservationDetails.type === SessionType.EXTERNAL &&
        reservationDetails.pms_provider === PmsProvider.CLOUDBEDS
      ) {
        throw new BadRequestError(
          'checkAvailabilityForModificationLite: Modification of externally-created Cloudbeds reservations is not supported. Please contact the hotel directly.',
        );
      }

      let note = '';
      if (modifyReservationRequest.room_changed) {
        note =
          'The amounts indicate the cost for the new room type. Any existing amount paid by the customer is not considered. Any pending amount will be automatically charged, and any refund will be processed by the hotel.';
      } else {
        note =
          'The amounts indicate the cost for the new dates. Any existing amount paid by the customer is not considered. Any pending amount will be automatically charged, and any refund will be processed by the hotel.';
      }

      // Get PMS-specific service from factory
      const pmsService = await this.pmsServiceFactory.getReservationService(
        hotel.id!,
      );

      // External direct reservation: build a natural language description from Stayntouch-native info
      if (reservationDetails.type === SessionType.EXTERNAL) {
        // For external reservations the delta is handled manually by the hotel, not auto-charged.
        note = modifyReservationRequest.room_changed
          ? 'The amounts indicate the cost for the new room type. Any existing amount paid by the customer is not considered. After modification, any delta amount (whether refund or additional payment) will be handled by the hotel.'
          : 'The amounts indicate the cost for the new dates. Any existing amount paid by the customer is not considered. After modification, any delta amount (whether refund or additional payment) will be handled by the hotel.';
        // When a room change is requested, return full availability so the agent can
        // present all available rooms — identical to the new-reservation flow.
        if (modifyReservationRequest.room_changed) {
          const hotelPhoneNumber =
            assistantPhoneNumber ?? hotel.assistant_phone_number;
          if (!hotelPhoneNumber) {
            throw new NoDataError(
              'checkAvailabilityForModificationLite: Hotel phone number not available',
            );
          }
          const availabilityResult =
            await this.getRoomAvailabilityWithQuoteLite(
              {
                start_date: modifyReservationRequest.check_in,
                end_date: modifyReservationRequest.check_out,
                num_adults: reservationDetails.num_adults,
                num_children: reservationDetails.num_children ?? 0,
                num_pets: reservationDetails.num_pets ?? 0,
                session_type: reservationDetails.type,
                booking_link: false,
              },
              modifyReservationRequest.caller_phone_number,
              hotelPhoneNumber,
              reservationDetails.type,
            );
          const currentRoomType = reservationDetails.room_type;
          return {
            ...availabilityResult,
            note,
            groups: (availabilityResult.groups ?? []).filter(
              (group: Record<string, string>) =>
                !currentRoomType ||
                !Object.keys(group).includes(currentRoomType),
            ),
          };
        }

        const info: ExternalModificationInfo =
          await pmsService.getExternalModificationInfo(
            reservationDetails,
            modifyReservationRequest.check_in,
            modifyReservationRequest.check_out,
          );

        let description: string;
        const checkIn = modifyReservationRequest.check_in;
        const checkOut = modifyReservationRequest.check_out;
        const currency = info.currency;

        if (info.scenario === 'same_dates') {
          description =
            'The requested dates are the same as the current reservation dates. No modification needed.';
        } else if (info.scenario === 'stay_reduction') {
          description = `The reservation will be shortened to check-in on ${checkIn} and check-out on ${checkOut}. The hotel may need to process a refund for the removed nights.`;
        } else if (!info.available) {
          description = `The room is not available for the requested dates (check-in ${checkIn}, check-out ${checkOut}).`;
        } else if (info.scenario === 'stay_extension') {
          const amountText = numberToWords(info.pricingDelta, currency);
          description = `The reservation will be extended to check-in on ${checkIn} and check-out on ${checkOut}. The additional amount for the new nights is ${amountText}.`;
        } else {
          const amountText = numberToWords(info.pricingDelta, currency);
          description = `The reservation will be moved to check-in on ${checkIn} and check-out on ${checkOut}. The total amount for the new dates is ${amountText}. Payment will need to be collected at the property.`;
        }

        return {
          note,
          groups: [{ [reservationDetails.room_type]: description }],
          discount: null,
        };
      }

      // When a room change is requested, return full availability so the agent can
      // present all available rooms — identical to the new-reservation flow.
      if (modifyReservationRequest.room_changed) {
        const hotelPhoneNumber =
          assistantPhoneNumber ?? hotel.assistant_phone_number;
        if (!hotelPhoneNumber) {
          throw new NoDataError(
            'checkAvailabilityForModificationLite: Hotel phone number not available',
          );
        }
        const availabilityResult = await this.getRoomAvailabilityWithQuoteLite(
          {
            start_date: modifyReservationRequest.check_in,
            end_date: modifyReservationRequest.check_out,
            num_adults: reservationDetails.num_adults,
            num_children: reservationDetails.num_children ?? 0,
            num_pets: reservationDetails.num_pets ?? 0,
            session_type: reservationDetails.type,
            booking_link: false,
          },
          modifyReservationRequest.caller_phone_number,
          hotelPhoneNumber,
          reservationDetails.type,
        );
        const currentRoomType = reservationDetails.room_type;
        return {
          ...availabilityResult,
          note,
          groups: (availabilityResult.groups ?? []).filter(
            (group: Record<string, string>) =>
              !currentRoomType || !Object.keys(group).includes(currentRoomType),
          ),
        };
      }

      // Multi-room reservation: detect via booking_id suffix
      if (reservationDetails.booking_id.match(/_\d+$/)) {
        const existingCheckInDate = dayjs(reservationDetails.check_in).format(
          'YYYY-MM-DD',
        );
        const existingCheckOutDate = dayjs(reservationDetails.check_out).format(
          'YYYY-MM-DD',
        );
        if (
          (modifyReservationRequest.check_in &&
            modifyReservationRequest.check_in !== existingCheckInDate) ||
          (modifyReservationRequest.check_out &&
            modifyReservationRequest.check_out !== existingCheckOutDate)
        ) {
          throw new BadRequestError(
            'CheckAvailabilityForModificationLite: For modifying the check-in or check-out dates of multi-room reservations, contact the manager',
          );
        }
      }

      // If a discount was already applied during reservation creation, get it to calculate
      // the new rates during reservation modification
      const discount = await this.discountService.getDiscountByReservationId(
        reservationDetails.id,
      );

      // PMS service handles quote calculation, pet fees, discounts, and payment configuration
      const { raw_response: _rawQuote, ...updatedQuote } =
        await pmsService.getQuoteForModification(
          reservationDetails,
          modifyReservationRequest.check_in,
          modifyReservationRequest.check_out,
          discount,
        );

      let sanitizedDiscount = sanitizeDiscount(discount);

      // Generate natural language description (dates from request; guests from reservation until occupancy modify is supported)
      const checkIn = modifyReservationRequest.check_in;
      const checkOut = modifyReservationRequest.check_out;
      const numAdults = reservationDetails.num_adults;
      const numChildren = reservationDetails.num_children ?? 0;
      const baseRateText = numberToWords(
        updatedQuote.base_rate,
        updatedQuote.currency,
      );
      const taxesText = numberToWords(
        updatedQuote.taxes,
        updatedQuote.currency,
      );
      const feesText = numberToWords(updatedQuote.fees, updatedQuote.currency);
      const totalAmountInWords = numberToWords(
        updatedQuote.total_amount,
        updatedQuote.currency,
      );
      const adultsText = numAdults === 1 ? '1 adult' : `${numAdults} adults`;
      const childrenText =
        numChildren === 0
          ? '0 children'
          : numChildren === 1
            ? '1 child'
            : `${numChildren} children`;

      const description = `For ${adultsText} and ${childrenText}, with check-in on ${checkIn} and check-out on ${checkOut}, the new base rate of the ${reservationDetails.room_type} (room id: ${reservationDetails.room_id}) is ${baseRateText}, taxes are ${taxesText}, fees are ${feesText}. The new total price is ${totalAmountInWords}.`;

      return {
        groups: [
          {
            [reservationDetails.room_type]: description,
          },
        ],
        discount: sanitizedDiscount,
      };
    } catch (error) {
      if (error instanceof BaseError) {
        throw error;
      }
      logger.error(`Error in checkAvailabilityForModificationLite: ${error}`);
      throw new BaseError(
        `Failed to check availability for modification: ${error}`,
      );
    }
  }

  private getRateLookupHotelId(hotel: Hotel): number | string {
    return hasNonNumericBusinessId(hotel)
      ? hotel.id!
      : parseInt(String(hotel.business_id), 10);
  }

  // business_id is a numeric PMS property id for most providers but a Mews
  // enterprise GUID and an opaque Calry property id for those two — only
  // coerce to number where it's actually numeric.
  private formatBusinessIdForResponse(hotel: Hotel): number | string {
    return hasNonNumericBusinessId(hotel)
      ? hotel.business_id
      : Number(hotel.business_id);
  }

  private async modifyExternalDirectReservation(
    reservationDetails: ReservationDTO,
    modifyReservationRequest: ModifyRoomReservationRequest,
  ): Promise<ReservationDTO> {
    if (
      modifyReservationRequest.new_rate_code &&
      !modifyReservationRequest.new_room_type_id
    ) {
      throw new BadRequestError(
        'modifyExternalDirectReservation: new_rate_code can only be specified when new_room_type_id is also provided',
      );
    }

    const roomChanged = !!modifyReservationRequest.new_room_type_id;

    const hotel = reservationDetails.hotel!;
    const pmsService = await this.pmsServiceFactory.getReservationService(
      hotel.id!,
    );

    const resolvedRoomTypeId =
      modifyReservationRequest.new_room_type_id ?? reservationDetails.room_id;
    let resolvedRateId: number | string | undefined;
    if (modifyReservationRequest.new_rate_code) {
      resolvedRateId = await pmsService.getRateIdByCode(
        this.getRateLookupHotelId(hotel),
        modifyReservationRequest.new_rate_code,
      );
      if (!resolvedRateId) {
        throw new BadRequestError(
          `modifyExternalDirectReservation: Rate code ${modifyReservationRequest.new_rate_code} not found when trying to resolve rate id`,
        );
      }
    } else {
      const rawRateId = reservationDetails.rate_id;
      const rateIdAsNum = Number(rawRateId);
      if (
        rawRateId != null &&
        String(rawRateId).trim() !== '' &&
        !Number.isNaN(rateIdAsNum) &&
        Number.isFinite(rateIdAsNum)
      ) {
        resolvedRateId = rateIdAsNum;
      } else {
        // rate_id is missing or a non-numeric string (e.g. "BAR") — treat it as a rate code
        const rateCodeFallback =
          (rawRateId != null && String(rawRateId).trim() !== ''
            ? String(rawRateId)
            : null) ??
          reservationDetails.rate_code ??
          null;
        if (rateCodeFallback) {
          resolvedRateId = await pmsService.getRateIdByCode(
            this.getRateLookupHotelId(hotel),
            rateCodeFallback,
          );
        }
      }
    }

    const info: ExternalModificationInfo =
      await pmsService.modifyExternalDirectReservation(
        reservationDetails,
        modifyReservationRequest.check_in,
        modifyReservationRequest.check_out,
        roomChanged ? resolvedRoomTypeId : undefined,
        roomChanged ? resolvedRateId : undefined,
      );

    if (info.scenario === 'same_dates' && !roomChanged) {
      return reservationDetails;
    }

    if (!info.available) {
      throw new BadRequestError(
        `modifyExternalDirectReservation: Room not available for dates ${modifyReservationRequest.check_in} to ${modifyReservationRequest.check_out}`,
      );
    }

    if (hotel.telegram_alerts_group_id) {
      try {
        let message: string;
        if (roomChanged) {
          message = reservationModifiedRoomChangeTelegramTemplate(
            reservationDetails,
            info.newDateBreakdown[0]?.room_type ?? 'Unknown Room',
            modifyReservationRequest.check_in,
            modifyReservationRequest.check_out,
            info.pricingDelta,
          );
        } else if (info.scenario === 'stay_reduction') {
          message = reservationModifiedRefundTelegramTemplate(
            reservationDetails,
            null,
            modifyReservationRequest.check_in,
            modifyReservationRequest.check_out,
          );
        } else {
          message = reservationModifiedPaymentTelegramTemplate(
            reservationDetails,
            info.pricingDelta,
            modifyReservationRequest.check_in,
            modifyReservationRequest.check_out,
            info.newDateBreakdown,
          );
        }
        await this.notificationFactory
          .getChatService(hotel.notification_type)
          .sendMessage({
            recipient: hotel.telegram_alerts_group_id,
            content: { message, parseMode: 'MarkdownV2' },
          });
      } catch (telegramError) {
        logger.error(
          `modifyExternalDirectReservation: Failed to send Telegram alert for booking ${reservationDetails.booking_id}`,
          { error: telegramError },
        );
      }
    }

    const updatedReservation: ReservationDTO = {
      ...reservationDetails,
      check_in: new Date(modifyReservationRequest.check_in),
      check_out: new Date(modifyReservationRequest.check_out),
      ...(roomChanged && {
        room_id: info.room_type_id,
        room_type:
          info.newDateBreakdown[0]?.room_type ?? reservationDetails.room_type,
        rate_id: info.rate_id ?? reservationDetails.rate_id,
        rate_code: info.rate_code || reservationDetails.rate_code,
      }),
    };

    return this.selectRequiredFields(updatedReservation) as ReservationDTO;
  }

  /**
   * Modifies an existing reservation with new details.
   */
  public async modifyReservation(
    modifyReservationRequest: ModifyRoomReservationRequest,
    phoneNumber: string,
    assistantPhoneNumber?: string,
  ): Promise<ReservationDTO> {
    try {
      let IdOrBookingIdOrExternalIdorExternalPublicId =
        modifyReservationRequest.booking_id;
      if (
        IdOrBookingIdOrExternalIdorExternalPublicId.trim()
          .toUpperCase()
          .startsWith('BK')
      ) {
        IdOrBookingIdOrExternalIdorExternalPublicId =
          IdOrBookingIdOrExternalIdorExternalPublicId.trim().toUpperCase();
      }
      const callerPhoneNumber = convertToPhoneNumber(phoneNumber);
      if (!callerPhoneNumber) {
        throw new BadRequestError(
          'modifyReservation: Phone number is required',
        );
      }

      const resolvedHotel = assistantPhoneNumber
        ? await this.hotelService.getHotelByAssistantPhoneNumber(
            assistantPhoneNumber,
          )
        : null;
      if (!resolvedHotel) {
        throw new BadRequestError(
          'modifyReservation: Unable to determine hotel',
        );
      }
      const reservationDetails = await this.validateAndFetchReservationDetails(
        IdOrBookingIdOrExternalIdorExternalPublicId,
        resolvedHotel.id,
        assistantPhoneNumber,
      );
      if (!reservationDetails) {
        throw new NoDataError('modifyReservation: Reservation not found');
      }

      const hotel = reservationDetails.hotel;
      if (!hotel) {
        throw new NoDataError('modifyReservation: Hotel not found');
      }

      if (
        reservationDetails.reservation_source ===
        ReservationSource.THIRD_PARTY_RESERVATION
      ) {
        throw new BadRequestError(
          'modifyReservation: Modification of third-party reservations is not supported',
        );
      }

      if (
        reservationDetails.type === SessionType.EXTERNAL &&
        reservationDetails.pms_provider === PmsProvider.CLOUDBEDS
      ) {
        throw new BadRequestError(
          'modifyReservation: Modification of externally-created Cloudbeds reservations is not supported. Please contact the hotel directly.',
        );
      }

      const newRoomTypeId = modifyReservationRequest.new_room_type_id;
      const roomChanged =
        !!newRoomTypeId && newRoomTypeId !== reservationDetails.room_id;

      if (modifyReservationRequest.new_rate_code && !roomChanged) {
        throw new BadRequestError(
          'modifyReservation: new_rate_code can only be specified when new_room_type_id is also provided',
        );
      }

      const numPetsToAdd = modifyReservationRequest.num_pets_to_add;
      if (numPetsToAdd) {
        if (reservationDetails.pms_provider !== PmsProvider.MEWS) {
          throw new BadRequestError(
            `modifyReservation: Adding pets to an existing reservation is only supported for MEWS PMS provider, not ${reservationDetails.pms_provider}`,
          );
        }
        if (reservationDetails.type === SessionType.EXTERNAL) {
          throw new BadRequestError(
            'modifyReservation: Adding pets to an externally-created reservation is not supported',
          );
        }
      }

      if (reservationDetails.type === SessionType.EXTERNAL) {
        return await this.modifyExternalDirectReservation(
          reservationDetails,
          modifyReservationRequest,
        );
      }

      if (
        roomChanged &&
        reservationDetails.pms_provider !== PmsProvider.STAYNTOUCH &&
        reservationDetails.pms_provider !== PmsProvider.CLOUDBEDS &&
        reservationDetails.pms_provider !== PmsProvider.MEWS
      ) {
        throw new BadRequestError(
          `modifyReservation: Room change is not supported for ${reservationDetails.pms_provider} PMS provider`,
        );
      }

      // Get PMS-specific service from factory
      const pmsService = await this.pmsServiceFactory.getReservationService(
        hotel.id!,
      );

      let newRateId: number | string | undefined;
      if (roomChanged && modifyReservationRequest.new_rate_code) {
        newRateId = await pmsService.getRateIdByCode(
          this.getRateLookupHotelId(hotel),
          modifyReservationRequest.new_rate_code,
        );
        if (!newRateId) {
          throw new BadRequestError(
            `modifyReservation: Rate code ${modifyReservationRequest.new_rate_code} not found`,
          );
        }
      }

      // Multi-room reservation: detect via payment siblings or booking_id suffix
      const isMultiRoom = reservationDetails.booking_id.match(/_\d+$/);
      if (isMultiRoom) {
        const existingCheckInDate = dayjs(reservationDetails.check_in).format(
          'YYYY-MM-DD',
        );
        const existingCheckOutDate = dayjs(reservationDetails.check_out).format(
          'YYYY-MM-DD',
        );
        if (
          (modifyReservationRequest.check_in &&
            modifyReservationRequest.check_in !== existingCheckInDate) ||
          (modifyReservationRequest.check_out &&
            modifyReservationRequest.check_out !== existingCheckOutDate)
        ) {
          throw new BadRequestError(
            'modifyReservation: For modifying the check-in or check-out dates of multi-room reservations, contact the manager',
          );
        }
      }

      // If a discount was already applied during reservation creation, get it to calculate
      // the new rates during reservation modification
      const discount = await this.discountService.getDiscountByReservationId(
        reservationDetails.id,
      );

      const mergedQuote = await pmsService.modifyReservation(
        reservationDetails,
        modifyReservationRequest.check_in,
        modifyReservationRequest.check_out,
        discount,
        newRoomTypeId,
        newRateId,
        ...(numPetsToAdd ? [numPetsToAdd] : []),
      );

      if (
        modifyReservationRequest.customer_special_request &&
        reservationDetails.external_id
      ) {
        await this.attachNotesToReservation(
          pmsService,
          [reservationDetails],
          modifyReservationRequest.customer_special_request,
        );
      }

      let newRoomTypeName: string | undefined;
      if (newRoomTypeId) {
        try {
          const roomTypeMap = await pmsService.getRoomTypeMap(
            hotel.business_id,
            [newRoomTypeId],
          );
          newRoomTypeName =
            roomTypeMap.get(String(newRoomTypeId)) || String(newRoomTypeId);
        } catch {
          newRoomTypeName = String(newRoomTypeId);
        }
      }

      const modifiedReservationDetails =
        await this.reservationRepository.update(reservationDetails.id, {
          check_in: new Date(modifyReservationRequest.check_in),
          check_out: new Date(modifyReservationRequest.check_out),
          ...(!hasNoDextrPayment(reservationDetails.payment_status) && {
            payment_status: ReservationPaymentStatus.REVIEW_PENDING,
          }),
          ...(modifyReservationRequest.new_room_type_id && {
            room_id: newRoomTypeId,
          }),
          ...(newRoomTypeName && {
            room_type: newRoomTypeName,
          }),
          ...(modifyReservationRequest.new_rate_code && {
            rate_code: modifyReservationRequest.new_rate_code,
          }),
          ...(numPetsToAdd && {
            num_pets: (reservationDetails.num_pets ?? 0) + numPetsToAdd,
          }),
        });
      const quote = await this.quoteService.getQuoteByReservationId(
        reservationDetails.id,
      );

      if (!quote) {
        throw new NoDataError(
          'modifyReservation: Quote not found for reservation id: ' +
            reservationDetails.id,
        );
      }
      const updatedQuote = await this.quoteService.updateQuote(quote.id, {
        ...quote,
        quote_object: mergedQuote,
        amount_charged: mergedQuote.amountCharged,
        base_rate: mergedQuote.base_rate,
        fees: mergedQuote.fees,
        taxes: mergedQuote.taxes,
        platform_pricing: mergedQuote.platform_pricing,
      });

      if (!updatedQuote) {
        throw new NoDataError('modifyReservation: Failed to update quote');
      }

      const modifiedReservation: ReservationDTO = {
        ...reservationDetails,
        ...modifiedReservationDetails,
        quote: {
          ...updatedQuote,
          total_amount: computeQuoteTotal(
            updatedQuote.base_rate ?? 0,
            updatedQuote.taxes ?? 0,
            updatedQuote.fees ?? 0,
          ),
        },
        hotel,
      };

      if (hotel.payment_provider === PaymentProvider.SHIFT4) {
        await this._handleReservationModificationPaymentShift4(
          reservationDetails,
          modifyReservationRequest,
          modifiedReservation,
          hotel,
        );
      } else if (hotel.payment_provider === PaymentProvider.MEWS) {
        await this._handleMewsModificationPayment(
          reservationDetails,
          modifiedReservation,
          hotel,
        );
      } else if (hotel.payment_provider === PaymentProvider.STRIPE) {
        await this._handleReservationModificationPaymentStripe(
          reservationDetails,
          modifyReservationRequest,
          modifiedReservation,
          hotel,
        );
      }

      // Asynchronously update the Telegram summary if the service is available
      // Only for ResNexus reservations. Untested for other providers.
      if (
        reservationDetails.pms_provider === PmsProvider.RESNEXUS &&
        modifiedReservation.status !== ReservationStatus.INACTIVE &&
        this.guestCheckinSummaryService &&
        hotel.id
      ) {
        const originalAmount = reservationDetails.quote?.amount_charged;
        // Fire and forget - don't block the main flow
        this.updateTelegramSummaryForReservation(
          modifiedReservation,
          reservationDetails.booking_id,
          CheckInMessageAction.UPDATE,
          originalAmount,
        );
      }

      logKpi({
        stat: KpiStat.PmsBookingModified,
        value: 1,
        contextName: 'modifyReservation',
        clientId: hotel.assistant_phone_number ?? hotel.id,
      });

      return modifiedReservation;
    } catch (error) {
      throw error;
    }
  }

  public async getReservationDetailsBySessionId(
    session_id: string,
  ): Promise<ReservationDTO[]> {
    const reservation =
      await this.reservationRepository.getReservationDetailsBySessionId(
        session_id,
      );
    if (!reservation) {
      logger.error(`Reservation not found for session id: ${session_id}`);
      throw new NoDataError('Reservation not found');
    }
    return enrichReservationsWithPolicySignaturePresignedUrl(reservation);
  }

  public async getReservationsForCheckInNotification(
    hotelId: string,
    checkInDate: string,
    statuses: ReservationStatus[],
  ): Promise<ReservationDTO[]> {
    try {
      if (!hotelId) {
        throw new BadRequestError(
          'getReservationsForCheckInNotification: Hotel ID is required',
        );
      }

      logger.info(
        `Fetching reservations for check-in notification, hotel_id: ${hotelId}, date: ${checkInDate}`,
      );
      const reservations =
        await this.reservationRepository.getReservationsForCheckInNotification(
          hotelId,
          checkInDate,
          statuses,
        );

      return reservations || [];
    } catch (error) {
      logger.error(
        `Error fetching reservations for check-in notification: ${error}`,
      );
      throw error;
    }
  }

  public async getBookingDashboardSummary(
    hotel_id: string,
    start_date?: Date,
    end_date?: Date,
    session_types?: SessionType[],
    version: string = 'v2',
    reservation_statuses: ReservationStatus[] = [
      ReservationStatus.ACTIVE,
      ReservationStatus.NO_SHOW,
    ],
  ): Promise<BookingSummaryV1 | BookingSummaryV2> {
    const effectiveSessionTypes = session_types
      ? session_types.filter((t) => t !== SessionType.EXTERNAL)
      : Object.values(SessionType).filter((t) => t !== SessionType.EXTERNAL);

    if (version === 'v1') {
      return this.getBookingDashboardSummaryV1(
        hotel_id,
        start_date,
        end_date,
        effectiveSessionTypes,
        reservation_statuses,
      );
    }
    return this.getBookingDashboardSummaryV2(
      hotel_id,
      start_date,
      end_date,
      effectiveSessionTypes,
      reservation_statuses,
    );
  }

  public async getBookingDashboardSummaryV2(
    hotel_id: string,
    start_date?: Date,
    end_date?: Date,
    session_types?: SessionType[],
    reservation_statuses: ReservationStatus[] = [
      ReservationStatus.ACTIVE,
      ReservationStatus.NO_SHOW,
    ],
  ): Promise<BookingSummaryV2> {
    const reservations =
      await this.reservationRepository.getReservationDashboardByHotelIdV2(
        hotel_id,
        start_date,
        end_date,
        session_types,
        reservation_statuses,
      );

    const summary: BookingSummaryV2 = {
      reservations: {
        total: reservations.total_reservations,
        total_revenue: reservations.total_amount
          ? reservations.total_amount
          : 0,
        total_amount_collected: reservations.total_amount_collected
          ? reservations.total_amount_collected
          : 0,
        total_review_pending_reservations:
          reservations.total_review_pending_reservations,
      },
    };
    logger.info(
      `Returned total_bookings: ${summary.reservations.total}, total_revenue: ${summary.reservations.total_revenue}, total_advance_collected: ${summary.reservations.total_amount_collected}`,
    );
    return summary;
  }

  public async getBookingDashboardSummaryV1(
    hotel_id: string,
    start_date?: Date,
    end_date?: Date,
    session_types?: SessionType[],
    reservation_statuses: ReservationStatus[] = [
      ReservationStatus.ACTIVE,
      ReservationStatus.NO_SHOW,
    ],
  ): Promise<BookingSummaryV1> {
    const reservations =
      await this.reservationRepository.getReservationDashboardByHotelIdV1(
        hotel_id,
        start_date,
        end_date,
        session_types,
        reservation_statuses,
      );

    const summary: BookingSummaryV1 = {
      reservations: {
        total: reservations.total_reservations,
        total_revenue: reservations.total_amount
          ? reservations.total_amount
          : 0,
      },
    };
    logger.info(
      `Returned total_bookings: ${summary.reservations.total}, total_revenue: ${summary.reservations.total_revenue}`,
    );
    return summary;
  }

  private _getMewsSavedCreditCardId(
    reservationDetails: ReservationDTO,
  ): string | undefined {
    return reservationDetails.customer?.card_metadata?.token ?? undefined;
  }

  private async _sendModificationTelegramAlert(
    reservationDetails: ReservationDTO,
    hotel: Hotel,
    bookingId: string,
    delta: number,
    newCheckIn: string,
    newCheckOut: string,
  ): Promise<void> {
    if (!hotel.telegram_check_in_group_id) return;
    if (delta === 0) return;
    try {
      const message =
        delta > 0
          ? reservationModifiedPaymentTelegramTemplate(
              reservationDetails,
              delta,
              newCheckIn,
              newCheckOut,
            )
          : reservationModifiedRefundTelegramTemplate(
              reservationDetails,
              roundCurrency(Math.abs(delta)),
              newCheckIn,
              newCheckOut,
            );

      await this.notificationFactory
        .getChatService(hotel.notification_type)
        .sendMessage({
          recipient: hotel.telegram_check_in_group_id,
          content: { message, parseMode: 'MarkdownV2' },
        });
    } catch (err) {
      logger.error(
        '_sendModificationTelegramAlert: Failed to send Telegram alert',
        { booking_id: bookingId, delta, error: err },
      );
    }
  }

  private async _handleMewsModificationPayment(
    reservationDetails: ReservationDTO,
    modifiedReservation: ReservationDTO,
    hotel: Hotel,
  ): Promise<void> {
    const bookingId = reservationDetails.booking_id.split('_')[0];
    const newCheckIn = dayjs(modifiedReservation.check_in).format('YYYY-MM-DD');
    const newCheckOut = dayjs(modifiedReservation.check_out).format(
      'YYYY-MM-DD',
    );

    const hotelConfig =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        hotel.id,
      );
    // Original reservation dates determine the deposit tier that applied at
    // booking time, not the new (modified) dates.
    const originalNights = dayjs(reservationDetails.check_out)
      .startOf('day')
      .diff(dayjs(reservationDetails.check_in).startOf('day'), 'day');
    const isPartialPaymentModel = !isFullPaymentPolicy(
      hotelConfig?.initial_deposit_policy,
      originalNights,
    );

    let allReservations: ReservationDTO[];
    let remainingBalance: number;
    try {
      allReservations = await this.getReservationsByBookingId(
        bookingId,
        hotel.id,
      );
      const { totalReservationAmount, totalPaidAmount, totalRefundedAmount } =
        await this._getReservationPaymentInfo(allReservations);
      const netPaidAmount = roundCurrency(
        totalPaidAmount - totalRefundedAmount,
      );
      remainingBalance = roundCurrency(totalReservationAmount - netPaidAmount);
    } catch (error) {
      logger.error(
        `_handleMewsModificationPayment: Failed to compute remaining balance for booking ${bookingId}`,
        { booking_id: bookingId, error },
      );
      return;
    }

    if (remainingBalance === 0) {
      // Exactly fully paid after modification — disable any pending
      // auto-charge left over from before the modification, otherwise it
      // would collect against a balance that's already settled.
      if (isPartialPaymentModel) {
        try {
          const hasActiveAutoCharge = allReservations.some(
            (r) => r.auto_charge?.is_enabled,
          );
          if (hasActiveAutoCharge) {
            await this.setupAutoCharge(bookingId, hotel.id, {
              is_enabled: false,
            });
          }
        } catch (error) {
          logger.error(
            `_handleMewsModificationPayment: Failed to disable auto-charge for booking ${bookingId}`,
            { booking_id: bookingId, error },
          );
        }
      }

      const freshReservation = await this.reservationRepository.findById(
        reservationDetails.id,
      );
      if (freshReservation) {
        modifiedReservation.auto_charge = freshReservation.auto_charge;
        modifiedReservation.payment_status = freshReservation.payment_status;
      }
      return;
    }

    if (remainingBalance < 0) {
      // Guest overpaid relative to the modified total — disable any pending
      // auto-charge so the cron doesn't collect against the stale (higher)
      // balance, mirroring the Shift4 modification-payment flow.
      if (isPartialPaymentModel) {
        try {
          const hasActiveAutoCharge = allReservations.some(
            (r) => r.auto_charge?.is_enabled,
          );
          if (hasActiveAutoCharge) {
            await this.setupAutoCharge(bookingId, hotel.id, {
              is_enabled: false,
            });
          }
        } catch (error) {
          logger.error(
            `_handleMewsModificationPayment: Failed to disable auto-charge for booking ${bookingId}`,
            { booking_id: bookingId, error },
          );
        }
      }

      await this._sendModificationTelegramAlert(
        reservationDetails,
        hotel,
        bookingId,
        remainingBalance,
        newCheckIn,
        newCheckOut,
      );

      const freshReservation = await this.reservationRepository.findById(
        reservationDetails.id,
      );
      if (freshReservation) {
        modifiedReservation.auto_charge = freshReservation.auto_charge;
        modifiedReservation.payment_status = freshReservation.payment_status;
      }
      return;
    }

    // remainingBalance > 0 — guest owes more.
    if (isPartialPaymentModel) {
      // Partial-payment hotel: defer collection via auto-charge instead of
      // charging now, mirroring the Shift4 modification-payment flow.
      try {
        const hasActiveAutoCharge = allReservations.some(
          (r) => r.auto_charge?.is_enabled,
        );
        const trx = await db.transaction();
        try {
          if (hasActiveAutoCharge) {
            await this.setupAutoCharge(
              bookingId,
              hotel.id,
              { is_enabled: false },
              trx,
            );
          }
          const autoChargeResult = await this.setupAutoCharge(
            bookingId,
            hotel.id,
            { is_enabled: true, amount: remainingBalance },
            trx,
          );
          if (!autoChargeResult.success) {
            throw new ExternalAPIError(
              `setupAutoCharge failed for booking ${bookingId}: ${autoChargeResult.message}`,
            );
          }
          await trx.commit();
        } catch (error) {
          await trx.rollback();
          throw error;
        }
        logger.info(
          `_handleMewsModificationPayment: Auto-charge updated for outstanding balance ${remainingBalance} on booking ${bookingId}`,
          { booking_id: bookingId, remaining_balance: remainingBalance },
        );
      } catch (error) {
        logger.error(
          `_handleMewsModificationPayment: Failed to set up auto-charge for booking ${bookingId}. Falling back to manual collection.`,
          { booking_id: bookingId, remainingBalance, error },
        );
        await this._sendModificationTelegramAlert(
          reservationDetails,
          hotel,
          bookingId,
          remainingBalance,
          newCheckIn,
          newCheckOut,
        );
      }
      // Re-fetch the persisted reservation row so the response reflects any
      // DB updates made inside this block (auto_charge replacement via
      // setupAutoCharge), mirroring the Shift4 modification-payment flow.
      const freshReservation = await this.reservationRepository.findById(
        reservationDetails.id,
      );
      if (freshReservation) {
        modifiedReservation.auto_charge = freshReservation.auto_charge;
        modifiedReservation.payment_status = freshReservation.payment_status;
      }
      return;
    }

    // Full-payment hotel: charge the outstanding balance immediately.
    const creditCardId = this._getMewsSavedCreditCardId(reservationDetails);
    if (!creditCardId) {
      await this._sendModificationTelegramAlert(
        reservationDetails,
        hotel,
        bookingId,
        remainingBalance,
        newCheckIn,
        newCheckOut,
      );
      return;
    }

    try {
      await this.chargeReservationImmediately(bookingId, hotel.id, {
        amount: remainingBalance,
        reason: 'reservation modification',
        send_guest_notification: true,
      });
      logger.info(
        `_handleMewsModificationPayment: Auto-charged ${remainingBalance} for booking ${bookingId} via saved Mews card`,
        { booking_id: bookingId },
      );
    } catch (error) {
      logger.error(
        `_handleMewsModificationPayment: Failed to auto-charge saved Mews card for booking ${bookingId}. Falling back to manual collection.`,
        { booking_id: bookingId, remainingBalance, error },
      );
      await this._sendModificationTelegramAlert(
        reservationDetails,
        hotel,
        bookingId,
        remainingBalance,
        newCheckIn,
        newCheckOut,
      );
    }
    // Re-fetch the persisted reservation row so the response reflects any
    // DB updates made inside this block (payment_status recalculated by
    // chargeReservationImmediately), mirroring the Shift4 modification-payment flow.
    const freshReservation = await this.reservationRepository.findById(
      reservationDetails.id,
    );
    if (freshReservation) {
      modifiedReservation.auto_charge = freshReservation.auto_charge;
      modifiedReservation.payment_status = freshReservation.payment_status;
    }
  }

  private async _handleReservationModificationPaymentShift4(
    reservationDetails: ReservationDTO,
    modifyReservationRequest: ModifyRoomReservationRequest,
    modifiedReservation: ReservationDTO,
    hotel: any,
  ): Promise<void> {
    // Re-evaluate payment balance after every modification. The behaviour
    // depends on the direction of the delta and the hotel's deposit model:
    //
    //   remainingBalance < 0  (guest overpaid — stay shortened after collection)
    //     → Both models: calculate the delta to refund and alert the hotel staff to manually refund the delta via Telegram.
    //
    //   remainingBalance > 0  (guest underpaid — stay extended or auto-charge pending)
    //     → partial/zero deposit: set up / update auto-charge for the delta.
    //     → full payment (PERCENTAGE 100): full payment was already collected upfront;
    //       the extension created a new outstanding balance → charge it immediately.
    //
    //   remainingBalance = 0  → disable any pending auto-charge; nothing to collect.

    // Fetch reservationDetails again (since we need the original dates), since the in-memory version may be different from the database version
    reservationDetails = await this.validateAndFetchReservationDetails(
      reservationDetails.booking_id,
      hotel.id,
      hotel.assistant_phone_number,
    );

    if (hotel.id) {
      const bookingId = reservationDetails.booking_id.split('_')[0];
      try {
        const hotelConfig =
          await this.hotelConfigurationService.getHotelConfigurationByHotelId(
            hotel.id,
          );
        // Use original reservation dates — the deposit policy tier that applied
        // at booking time determines the payment model, not the new dates.
        const originalNights = dayjs(reservationDetails.check_out).diff(
          dayjs(reservationDetails.check_in),
          'day',
        );
        const isPartialPaymentModel = !isFullPaymentPolicy(
          hotelConfig?.initial_deposit_policy,
          originalNights,
        );

        const allReservations = await this.getReservationsByBookingId(
          bookingId,
          hotel.id,
        );
        const { totalReservationAmount, totalPaidAmount, totalRefundedAmount } =
          await this._getReservationPaymentInfo(allReservations);
        const netPaidAmount = roundCurrency(
          totalPaidAmount - totalRefundedAmount,
        );
        const remainingBalance = roundCurrency(
          totalReservationAmount - netPaidAmount,
        );

        if (remainingBalance < 0) {
          // Guest was overcharged — modification reduced the total below what was
          // already collected. Disable any pending auto-charge and refund the delta.
          if (isPartialPaymentModel) {
            await this.setupAutoCharge(bookingId, hotel.id, {
              is_enabled: false,
            });
          }
          const refundAmount = roundCurrency(Math.abs(remainingBalance));
          logger.info(
            `modifyReservation: Guest overcharged by ${refundAmount} after modification for booking ${bookingId}. Refund required.`,
            {
              booking_id: bookingId,
              refund_amount: refundAmount,
              total_reservation_amount: totalReservationAmount,
              net_paid_amount: netPaidAmount,
            },
          );

          // Notify the hotel via Telegram so staff can process the refund manually.
          if (hotel.telegram_alerts_group_id) {
            try {
              await this.notificationFactory
                .getChatService(hotel.notification_type)
                .sendMessage({
                  recipient: hotel.telegram_alerts_group_id,
                  content: {
                    message: reservationModifiedRefundTelegramTemplate(
                      reservationDetails,
                      refundAmount,
                      modifyReservationRequest.check_in,
                      modifyReservationRequest.check_out,
                    ),
                    parseMode: 'MarkdownV2',
                  },
                });
            } catch (telegramError) {
              logger.error(
                `modifyReservation: Failed to send refund Telegram alert for booking ${bookingId}`,
                { error: telegramError },
              );
            }
          }
        } else if (remainingBalance === 0) {
          // Exactly fully paid — disable any pending auto-charge.
          if (isPartialPaymentModel) {
            await this.setupAutoCharge(bookingId, hotel.id, {
              is_enabled: false,
            });
          }
        } else {
          // remainingBalance > 0 — outstanding balance exists after modification.
          if (isPartialPaymentModel) {
            // Set up or re-enable auto-charge to collect the delta n days before
            // the (new) check-in date. Pass the already-computed remainingBalance
            // explicitly so the internal amount calculation (which does not account
            // for prior refunds) is bypassed entirely.
            //
            // For Shift4, we first disable any existing auto-charge to ensure pending invoices/payments
            // are cancelled before setting up the new one for the updated balance.
            const hasActiveAutoCharge = allReservations.some(
              (r) => r.auto_charge?.is_enabled,
            );
            const trx = await db.transaction();
            try {
              if (hasActiveAutoCharge) {
                await this.setupAutoCharge(
                  bookingId,
                  hotel.id,
                  { is_enabled: false },
                  trx,
                );
              }
              await this.setupAutoCharge(
                bookingId,
                hotel.id,
                { is_enabled: true, amount: remainingBalance },
                trx,
              );
              await trx.commit();
            } catch (error) {
              await trx.rollback();
              throw error;
            }
          } else {
            // Hotel requires full payment upfront. The stay modification created a new
            // outstanding balance — charge the card on file immediately for the delta.
            logger.info(
              `modifyReservation: Extended stay created outstanding balance of ${remainingBalance} for full-payment booking ${bookingId}. Charging immediately.`,
              {
                booking_id: bookingId,
                outstanding_amount: remainingBalance,
                total_reservation_amount: totalReservationAmount,
                net_paid_amount: netPaidAmount,
              },
            );
            await this.chargeReservationImmediately(bookingId, hotel.id, {
              amount: remainingBalance,
              reason: 'reservation modification',
              send_guest_notification: true,
            });
          }
        }

        // Re-fetch the persisted reservation row so the response reflects any
        // DB updates made inside this block (auto_charge replacement by Shift4/Stripe,
        // and payment_status recalculated by chargeReservationImmediately).
        const freshReservation = await this.reservationRepository.findById(
          reservationDetails.id,
        );
        if (freshReservation) {
          modifiedReservation.auto_charge = freshReservation.auto_charge;
          modifiedReservation.payment_status = freshReservation.payment_status;
        }
      } catch (autoChargeError) {
        logger.error(
          'modifyReservation: Failed to update payment config after modification',
          {
            booking_id: reservationDetails.booking_id.split('_')[0],
            error: autoChargeError,
          },
        );
      }
    }
  }

  private async _handleReservationModificationPaymentStripe(
    reservationDetails: ReservationDTO,
    modifyReservationRequest: ModifyRoomReservationRequest,
    modifiedReservation: ReservationDTO,
    hotel: Hotel,
  ): Promise<void> {
    const bookingId = reservationDetails.booking_id.split('_')[0];
    const newCheckIn = dayjs(modifiedReservation.check_in).format('YYYY-MM-DD');
    const newCheckOut = dayjs(modifiedReservation.check_out).format(
      'YYYY-MM-DD',
    );

    const hotelConfig =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        hotel.id,
      );
    const originalNights = dayjs(reservationDetails.check_out)
      .startOf('day')
      .diff(dayjs(reservationDetails.check_in).startOf('day'), 'day');
    const isPartialPaymentModel = !isFullPaymentPolicy(
      hotelConfig?.initial_deposit_policy,
      originalNights,
    );

    let allReservations: ReservationDTO[];
    let remainingBalance: number;
    try {
      allReservations = await this.getReservationsByBookingId(
        bookingId,
        hotel.id,
      );
      const { totalReservationAmount, totalPaidAmount, totalRefundedAmount } =
        await this._getReservationPaymentInfo(allReservations);
      const netPaidAmount = roundCurrency(
        totalPaidAmount - totalRefundedAmount,
      );
      remainingBalance = roundCurrency(totalReservationAmount - netPaidAmount);
    } catch (error) {
      logger.error(
        `_handleReservationModificationPaymentStripe: Failed to compute remaining balance for booking ${bookingId}`,
        { booking_id: bookingId, error },
      );
      return;
    }

    const hasActiveAutoCharge = allReservations.some(
      (r) => r.auto_charge?.is_enabled,
    );

    if (remainingBalance === 0) {
      if (isPartialPaymentModel) {
        try {
          if (hasActiveAutoCharge) {
            await this.setupAutoCharge(bookingId, hotel.id, {
              is_enabled: false,
            });
          }
        } catch (error) {
          logger.error(
            `_handleReservationModificationPaymentStripe: Failed to disable auto-charge for booking ${bookingId}`,
            { booking_id: bookingId, error },
          );
        }
      }

      const freshReservation = await this.reservationRepository.findById(
        reservationDetails.id,
      );
      if (freshReservation) {
        modifiedReservation.auto_charge = freshReservation.auto_charge;
        modifiedReservation.payment_status = freshReservation.payment_status;
      }
      return;
    }

    if (remainingBalance < 0) {
      if (isPartialPaymentModel) {
        try {
          if (hasActiveAutoCharge) {
            await this.setupAutoCharge(bookingId, hotel.id, {
              is_enabled: false,
            });
          }
        } catch (error) {
          logger.error(
            `_handleReservationModificationPaymentStripe: Failed to disable auto-charge for booking ${bookingId}`,
            { booking_id: bookingId, error },
          );
        }
      }

      const refundAmount = roundCurrency(Math.abs(remainingBalance));
      logger.info(
        `_handleReservationModificationPaymentStripe: Guest overcharged by ${refundAmount} after modification for booking ${bookingId}. Refund required.`,
        {
          booking_id: bookingId,
          refund_amount: refundAmount,
        },
      );

      await this._sendModificationTelegramAlert(
        reservationDetails,
        hotel,
        bookingId,
        remainingBalance,
        modifyReservationRequest.check_in,
        modifyReservationRequest.check_out,
      );

      const freshReservation = await this.reservationRepository.findById(
        reservationDetails.id,
      );
      if (freshReservation) {
        modifiedReservation.auto_charge = freshReservation.auto_charge;
        modifiedReservation.payment_status = freshReservation.payment_status;
      }
      return;
    }

    // remainingBalance > 0 — guest owes more.
    if (isPartialPaymentModel) {
      try {
        const trx = await db.transaction();
        try {
          if (hasActiveAutoCharge) {
            await this.setupAutoCharge(
              bookingId,
              hotel.id,
              { is_enabled: false },
              trx,
            );
          }
          const autoChargeResult = await this.setupAutoCharge(
            bookingId,
            hotel.id,
            { is_enabled: true, amount: remainingBalance },
            trx,
          );
          if (!autoChargeResult.success) {
            throw new ExternalAPIError(
              `setupAutoCharge failed for booking ${bookingId}: ${autoChargeResult.message}`,
            );
          }
          await trx.commit();
        } catch (error) {
          await trx.rollback();
          throw error;
        }
        logger.info(
          `_handleReservationModificationPaymentStripe: Auto-charge updated for outstanding balance ${remainingBalance} on booking ${bookingId}`,
          { booking_id: bookingId, remaining_balance: remainingBalance },
        );
      } catch (error) {
        logger.error(
          `_handleReservationModificationPaymentStripe: Failed to set up auto-charge for booking ${bookingId}. Sending Telegram alert for manual collection.`,
          { booking_id: bookingId, remainingBalance, error },
        );
        await this._sendModificationTelegramAlert(
          reservationDetails,
          hotel,
          bookingId,
          remainingBalance,
          newCheckIn,
          newCheckOut,
        );
      }
      const freshReservation = await this.reservationRepository.findById(
        reservationDetails.id,
      );
      if (freshReservation) {
        modifiedReservation.auto_charge = freshReservation.auto_charge;
        modifiedReservation.payment_status = freshReservation.payment_status;
      }
      return;
    }

    // Full-payment hotel: charge the outstanding balance immediately.
    try {
      logger.info(
        `_handleReservationModificationPaymentStripe: Extended stay created outstanding balance of ${remainingBalance} for full-payment booking ${bookingId}. Charging immediately.`,
        {
          booking_id: bookingId,
          outstanding_amount: remainingBalance,
        },
      );
      await this.chargeReservationImmediately(bookingId, hotel.id, {
        amount: remainingBalance,
        reason: 'reservation modification',
        send_guest_notification: true,
      });
    } catch (error) {
      logger.error(
        `_handleReservationModificationPaymentStripe: Failed to charge outstanding balance for booking ${bookingId}. Sending Telegram alert for manual collection.`,
        { booking_id: bookingId, remainingBalance, error },
      );
      await this._sendModificationTelegramAlert(
        reservationDetails,
        hotel,
        bookingId,
        remainingBalance,
        newCheckIn,
        newCheckOut,
      );
    }
    const freshReservation = await this.reservationRepository.findById(
      reservationDetails.id,
    );
    if (freshReservation) {
      modifiedReservation.auto_charge = freshReservation.auto_charge;
      modifiedReservation.payment_status = freshReservation.payment_status;
    }
  }

  /**
   * Creates PMS reservations for a booking (handles both single and multi-room bookings)
   * @param reservations The reservations to create in the PMS
   * @param card A raw card, for a PMS that takes payment in its create call
   */
  /**
   * Attach a guest note to one or more PMS reservations. Non-fatal — failures
   * are logged and swallowed so they never block reservation creation/modification.
   */
  private async attachNotesToReservation(
    pmsService: IPMSReservationService,
    reservations: ReservationDTO[],
    note: string,
  ): Promise<void> {
    if (typeof pmsService.addReservationNotes !== 'function') {
      return;
    }
    const noteData = { notes: [{ description: note }] };
    for (const reservation of reservations) {
      if (!reservation.external_id) continue;
      try {
        await pmsService.addReservationNotes(reservation.external_id, noteData);
        logger.info(
          `attachNotesToReservation: Attached note to ${reservation.booking_id}`,
        );
      } catch (error) {
        logger.warn(
          `attachNotesToReservation: Failed to attach note to ${reservation.booking_id} — non-fatal`,
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    }
  }

  public async finalizePmsReservations(
    reservations: ReservationDTO[],
    card?: PmsCardDetails,
  ) {
    if (!reservations || reservations.length === 0) {
      throw new BadRequestError(
        'finalizePmsReservations:: No reservations provided',
      );
    }

    const hotel = reservations[0].hotel;
    if (!hotel) {
      throw new NoDataError(
        'finalizePmsReservations:: No hotel found for reservations',
      );
    }

    logger.info(
      `finalizePmsReservations:: Creating PMS reservations for ${reservations.length} reservations`,
    );

    // Get PMS service for this hotel
    const pmsService = await this.pmsServiceFactory.getReservationService(
      hotel.id,
    );

    if (
      hotel.pms_provider === PmsProvider.STAYNTOUCH ||
      hotel.pms_provider === PmsProvider.MEWS
    ) {
      await pmsService.validateRoomAvailability(reservations);
    }

    try {
      if (
        hotel.pms_provider === PmsProvider.MEWS &&
        pmsService instanceof MewsReservationService &&
        reservations.length > 1
      ) {
        const batchResults =
          await pmsService.createReservationsForBooking(reservations);

        for (const {
          booking_id,
          reservation_id,
          external_public_id,
        } of batchResults) {
          const reservation = reservations.find(
            (r) => r.booking_id === booking_id,
          );
          if (!reservation?.id) {
            throw new NoDataError(
              `No reservation found for booking ID: ${booking_id.toUpperCase()}`,
            );
          }
          await this.reservationRepository.update(reservation.id, {
            external_id: reservation_id,
            ...(external_public_id && { external_public_id }),
          });
          reservation.external_id = reservation_id;
          if (external_public_id) {
            reservation.external_public_id = external_public_id;
          }
          logger.info(
            `Successfully created PMS reservation for booking ID: ${booking_id.toUpperCase()}`,
          );
        }

        const specialRequest = reservations[0]?.customer_special_request;
        if (specialRequest) {
          await this.attachNotesToReservation(
            pmsService,
            reservations,
            specialRequest,
          );
        }

        // Count only the reservations that were successfully created
        if (batchResults.length > 0) {
          logKpi({
            stat: KpiStat.PmsBookingCreated,
            value: batchResults.length,
            contextName: 'finalizePmsReservations',
            clientId: hotel.assistant_phone_number ?? hotel.id,
          });
        }
      } else if (
        hotel.pms_provider === PmsProvider.CLOUDBEDS &&
        reservations.length > 1
      ) {
        // Cloudbeds rejects concurrent requests with similar payloads due to
        // internal idempotency checks — create multi-room reservations sequentially.
        const failureReasons: string[] = [];
        let successCount = 0;

        for (const reservation of reservations) {
          const bookingId = reservation.booking_id.toUpperCase();

          try {
            validateReservationForCreation(reservation);

            logger.info(
              `Creating PMS reservation for booking ID: ${bookingId}`,
            );
            const pmsResponse = await pmsService.createReservation({
              reservation,
              customer: reservation.customer,
              quote: reservation.quote!,
              discount: reservation.discount,
              notes_from_partner: reservation.notes_from_partner,
            });

            if (pmsResponse.reservation_id && reservation.id) {
              logger.info(
                `finalizePmsReservations: Updating reservation with external ID ${pmsResponse.reservation_id}`,
              );
              await this.reservationRepository.update(reservation.id, {
                external_id: pmsResponse.reservation_id,
                ...(pmsResponse.notes_from_partner && {
                  notes_from_partner: pmsResponse.notes_from_partner,
                }),
                ...(pmsResponse.external_public_id && {
                  external_public_id: pmsResponse.external_public_id,
                }),
              });
              logger.info(
                `finalizePmsReservations: Updated reservation with external ID ${pmsResponse.reservation_id}`,
              );
              reservation.external_id = pmsResponse.reservation_id;
              if (pmsResponse.external_public_id) {
                reservation.external_public_id = pmsResponse.external_public_id;
              }
              if (pmsResponse.notes_from_partner) {
                reservation.notes_from_partner = pmsResponse.notes_from_partner;
              }
            }

            if (
              reservation.customer_special_request &&
              reservation.external_id
            ) {
              await this.attachNotesToReservation(
                pmsService,
                [reservation],
                reservation.customer_special_request,
              );
            }

            successCount++;
            logger.info(
              `Successfully created PMS reservation for booking ID: ${bookingId}`,
            );
          } catch (error) {
            const reason =
              error instanceof Error ? error.message : JSON.stringify(error);
            logger.error(
              `Failed to create PMS reservation for booking ID: ${bookingId}. Error: ${reason}`,
            );
            failureReasons.push(reason);
          }
        }

        if (failureReasons.length > 0) {
          throw new BaseError(
            `Failed to create one or more PMS reservations: ${JSON.stringify(failureReasons)}`,
          );
        }

        if (successCount > 0) {
          logKpi({
            stat: KpiStat.PmsBookingCreated,
            value: successCount,
            contextName: 'finalizePmsReservations',
            clientId: hotel.assistant_phone_number ?? hotel.id,
          });
        }
      } else {
        const results = await Promise.allSettled(
          reservations.map(async (reservation: ReservationDTO) => {
            const bookingId = reservation.booking_id.toUpperCase();

            validateReservationForCreation(reservation);

            logger.info(
              `Creating PMS reservation for booking ID: ${bookingId}`,
            );
            const pmsResponse = await pmsService.createReservation({
              reservation,
              customer: reservation.customer,
              quote: reservation.quote!,
              discount: reservation.discount,
              notes_from_partner: reservation.notes_from_partner,
              card,
            });

            if (pmsResponse.reservation_id && reservation.id) {
              logger.info(
                `finalizePmsReservations: Updating reservation with external ID ${pmsResponse.reservation_id}`,
              );
              await this.reservationRepository.update(reservation.id, {
                external_id: pmsResponse.reservation_id,
                ...(pmsResponse.notes_from_partner && {
                  notes_from_partner: pmsResponse.notes_from_partner,
                }),
                ...(pmsResponse.external_public_id && {
                  external_public_id: pmsResponse.external_public_id,
                }),
              });
              logger.info(
                `finalizePmsReservations: Updated reservation with external ID ${pmsResponse.reservation_id}`,
              );
              reservation.external_id = pmsResponse.reservation_id;
              if (pmsResponse.external_public_id) {
                reservation.external_public_id = pmsResponse.external_public_id;
              }
              if (pmsResponse.notes_from_partner) {
                reservation.notes_from_partner = pmsResponse.notes_from_partner;
              }
            }

            if (
              reservation.customer_special_request &&
              reservation.external_id
            ) {
              await this.attachNotesToReservation(
                pmsService,
                [reservation],
                reservation.customer_special_request,
              );
            }
          }),
        );

        results.forEach((result, index) => {
          const child = reservations[index];
          const bookingId = child.booking_id?.toUpperCase();

          if (result.status === PromiseSettledStatus.REJECTED) {
            logger.error(
              `Failed to create PMS reservation for booking ID: ${bookingId}. Error: ${result.reason instanceof Error ? result.reason.message : JSON.stringify(result.reason)}`,
            );
          } else {
            logger.info(
              `Successfully created PMS reservation for booking ID: ${bookingId}`,
            );
          }
        });

        const unknownOutcome = results.find(
          (result): result is PromiseRejectedResult =>
            result.status === PromiseSettledStatus.REJECTED &&
            result.reason instanceof PmsBookingOutcomeUnknownError,
        );
        if (unknownOutcome) throw unknownOutcome.reason;

        const failureReasons = results
          .filter((result) => result.status === PromiseSettledStatus.REJECTED)
          .map((result) =>
            result.reason instanceof Error
              ? result.reason.message
              : JSON.stringify(result.reason),
          );
        if (failureReasons.length > 0) {
          throw new BaseError(
            `Failed to create one or more PMS reservations: ${JSON.stringify(failureReasons)}`,
          );
        }

        const successCount = results.filter(
          (r) => r.status === 'fulfilled',
        ).length;
        if (successCount > 0) {
          logKpi({
            stat: KpiStat.PmsBookingCreated,
            value: successCount,
            contextName: 'finalizePmsReservations',
            clientId: hotel.assistant_phone_number ?? hotel.id,
          });
        }
      }
    } catch (error) {
      if (error instanceof PmsBookingOutcomeUnknownError) throw error;
      logger.error(
        `Failed to create one or more PMS reservations for multi-room booking: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
      );
      throw new BaseError(
        `Failed to create one or more PMS reservations: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
      );
    }

    // Update status of all reservations to ACTIVE
    await Promise.allSettled(
      reservations.map(async (reservation) => {
        logger.info(
          `finalizePmsReservations: Updating reservation ${reservation.booking_id} to ${ReservationStatus.ACTIVE}`,
        );
        await this.updateReservationStatus(
          reservation.booking_id,
          ReservationStatus.ACTIVE,
          hotel.id,
        );
        reservation.previous_status = reservation.status;
        reservation.status = ReservationStatus.ACTIVE;
      }),
    );

    // Setup autopay for remaining amount if applicable

    const hotelConfiguration =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        hotel.id,
      );

    // Auto-charge: enabled when a payment provider is active and the initial
    // deposit did not cover the full reservation amount. This covers both
    // partial-deposit and zero-deposit (card-only capture) scenarios.
    // Skipped for Vineyard forced-zero-deposit guests (no auto-charge).
    const callerPhone = reservations[0].phone_number;
    const reservationRoomIds = reservations.map((r) => r.room_id);
    // ResNexus-native hotels are excluded: ResNexus auto-charges the balance
    // itself off the card it collected, so a Dextr auto-charge would double up.
    if (
      hotel.payment_provider !== PaymentProvider.NOT_APPLICABLE &&
      hotel.payment_provider !== PaymentProvider.RESNEXUS &&
      !shouldForceZeroDeposit(hotel.id, reservationRoomIds, callerPhone)
    ) {
      const totalReservationAmount = reservations.reduce((sum, reservation) => {
        return roundCurrency(sum + getReservationTotalAmount(reservation));
      }, 0);
      const totalAdvancePaid = reservations.reduce((sum, r) => {
        const amount = roundCurrency(r.quote?.amount_charged || 0);
        return roundCurrency(sum + amount);
      }, 0);

      if (totalAdvancePaid < totalReservationAmount) {
        const bookingId = reservations[0].booking_id.split('_')[0];
        await this.setupAutoCharge(bookingId, hotel.id, {
          is_enabled: true,
        });
      }
    }

    return reservations;
  }

  /**
   * Cancels stale reservations and their associated payments.
   * Finds reservations in INACTIVE status that have been stale since <= cutoff.
   * Orchestrates using updateReservationStatus.
   */
  public async cancelStaleReservationsAndPayments(
    cutoffMinutes: number,
  ): Promise<{
    processed: number;
    cancelled: number;
    reservations_updated: number;
    errors: { payment_id?: string; reservation_id?: string; message: string }[];
  }> {
    const errors: {
      payment_id?: string;
      reservation_id?: string;
      message: string;
    }[] = [];
    const cutoff = new Date(Date.now() - cutoffMinutes * 60 * 1000);

    // 1) Fetch stale inactive reservations (excludes NOT_APPLICABLE)
    const candidates = await this.reservationRepository.findStaleReservations(
      cutoff,
      pmsBookingClaimStaleBefore(),
    );
    if (!candidates.length) {
      return { processed: 0, cancelled: 0, reservations_updated: 0, errors };
    }

    // 2) Exclude reservations that have a completed payment (already paid, awaiting PMS creation)
    const candidateIds = candidates.map((r: ReservationModel) => r.id);
    const paidIds = new Set(
      await this.paymentReservationRepository.findReservationIdsWithCompletedPayments(
        candidateIds,
      ),
    );
    const claims = await this.claimStaleForCancellation(
      candidates.filter((r: ReservationModel) => !paidIds.has(r.id)),
    );
    if (!claims.length) {
      return { processed: 0, cancelled: 0, reservations_updated: 0, errors };
    }
    const staleReservations = claims.map((c) => c.reservation);

    const reservationIds = staleReservations.map((r: ReservationModel) => r.id);
    try {
      // 3) Get payment IDs associated with these stale reservations
      const paymentIds =
        await this.paymentService.getPaymentIdsByReservationIds(reservationIds);
      const uniquePaymentIds = _.uniq(paymentIds);

      // 4) Cancel payments (Stripe + DB payment_status)
      let cancelResult = {
        processed: 0,
        cancelled: 0,
        errors: [] as { payment_id?: string; message: string }[],
      };
      if (uniquePaymentIds.length > 0) {
        cancelResult = await this.paymentService.cancelPayments(
          uniquePaymentIds,
          true,
        );
        errors.push(...cancelResult.errors);
      }

      // 5) Update reservation statuses using existing business logic
      let reservationsUpdated = 0;
      for (const staleReservation of staleReservations) {
        try {
          await runWithContext(
            { ...createRequestContext(), hotelId: staleReservation.hotel_id },
            () =>
              this.updateReservationStatus(
                staleReservation.id,
                ReservationStatus.CANCELLED,
                staleReservation.hotel_id,
              ),
          );
          reservationsUpdated += 1;
          logKpi({
            stat: KpiStat.ReservationStaleCancelled,
            value: 1,
            contextName: 'cancelStaleReservationsAndPayments',
            clientId: staleReservation.hotel_id,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          errors.push({ reservation_id: staleReservation.id, message });
        }
      }

      return {
        processed: cancelResult.processed,
        cancelled: cancelResult.cancelled,
        reservations_updated: reservationsUpdated,
        errors,
      };
    } finally {
      await this.releaseStaleClaims(claims);
    }
  }

  /**
   * Claims each stale reservation before it is cancelled, so a card submission
   * that claimed it after the stale query ran keeps it, and one arriving now is
   * refused. Returns the reservations this sweep now holds, with their claims.
   */
  private async claimStaleForCancellation<T extends { id: string }>(
    reservations: T[],
  ): Promise<{ reservation: T; claimedAt: Date }[]> {
    const claims: { reservation: T; claimedAt: Date }[] = [];
    for (const reservation of reservations) {
      const claimedAt = await this.reservationRepository.claimForPmsBooking(
        [reservation.id],
        pmsBookingClaimStaleBefore(),
      );
      if (claimedAt) claims.push({ reservation, claimedAt });
    }
    return claims;
  }

  private async releaseStaleClaims(
    claims: { reservation: { id: string }; claimedAt: Date }[],
  ): Promise<void> {
    for (const { reservation, claimedAt } of claims) {
      await this.reservationRepository.releasePmsBookingClaim(
        [reservation.id],
        claimedAt,
      );
    }
  }

  /**
   * Cancels stale no-payment reservations (payment_status = NOT_APPLICABLE) that have
   * been INACTIVE beyond the review timeout. These have no payments to cancel —
   * only the reservation status is updated.
   */
  public async cancelStaleNoPaymentReservations(
    cutoffMinutes: number,
  ): Promise<{
    reservations_cancelled: number;
    errors: { reservation_id: string; message: string }[];
  }> {
    const errors: { reservation_id: string; message: string }[] = [];
    const cutoff = new Date(Date.now() - cutoffMinutes * 60 * 1000);

    const claims = await this.claimStaleForCancellation(
      await this.reservationRepository.findStaleNoPaymentReservations(
        cutoff,
        pmsBookingClaimStaleBefore(),
      ),
    );
    if (!claims.length) {
      return { reservations_cancelled: 0, errors };
    }
    const staleReservations = claims.map((c) => c.reservation);

    let cancelled = 0;
    try {
      for (const reservation of staleReservations) {
        try {
          await this.updateReservationStatus(
            reservation.id,
            ReservationStatus.CANCELLED,
            reservation.hotel_id,
          );
          cancelled++;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          errors.push({ reservation_id: reservation.id, message });
        }
      }
    } finally {
      await this.releaseStaleClaims(claims);
    }

    return { reservations_cancelled: cancelled, errors };
  }

  /**
   * Finds all pending payments with payment_link_id starting with 'pl_' whose reservations
   * are INACTIVE, validates room availability via PMS, and disables payment links
   * for rooms that are no longer available.
   */
  public async cancelReservationsForUnavailableRooms(
    cancellationSource: CancellationSource = CancellationSource.SYSTEM,
  ): Promise<{
    total_pending: number;
    disabled: number;
    still_available: number;
    errors: { payment_id: string; message: string }[];
  }> {
    const errors: { payment_id: string; message: string }[] = [];

    const pendingPayments =
      await this.paymentService.getPendingPaymentsWithInactiveReservations();
    if (!pendingPayments.length) {
      return { total_pending: 0, disabled: 0, still_available: 0, errors };
    }

    let disabled = 0;
    let stillAvailable = 0;

    for (const payment of pendingPayments) {
      try {
        const reservations =
          await this.reservationRepository.findManyReservationWithDetailsByIds(
            payment.reservation_ids,
          );
        if (!reservations?.length) {
          errors.push({
            payment_id: payment.id,
            message: 'No reservation details found',
          });
          continue;
        }

        const pmsService = await this.pmsServiceFactory.getReservationService(
          payment.hotel_id,
        );

        // Same reasoning as cancelStaleReservationsAndPayments: this admin
        // endpoint has no ambient per-hotel request context, so establish
        // one here for the PMS/logKpi calls below.
        await runWithContext(
          { ...createRequestContext(), hotelId: payment.hotel_id },
          async () => {
            try {
              await pmsService.validateRoomAvailability(reservations);
              stillAvailable++;
            } catch (availabilityError) {
              if (availabilityError instanceof NoDataError) {
                logger.info(
                  `cancelReservationsForUnavailableRooms: Room unavailable for payment ${payment.id} — disabling payment link`,
                );
                const disableResult = await this.cancelReservation(
                  reservations[0].id,
                  cancellationSource,
                  undefined,
                  undefined,
                  reservations[0].hotel_id,
                );
                if (disableResult.errors.length) {
                  errors.push(...disableResult.errors);
                } else {
                  disabled++;
                }
              } else {
                throw availabilityError;
              }
            }
          },
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        logger.error(
          `cancelReservationsForUnavailableRooms: Error processing payment ${payment.id}: ${message}`,
        );
        errors.push({ payment_id: payment.id, message });
      }
    }

    return {
      total_pending: pendingPayments.length,
      disabled,
      still_available: stillAvailable,
      errors,
    };
  }

  /** Sends SMS payment reminders for reservations with payments older than `minAgeMinutes`.
   * Only send reminders for reservations made via call, SMS, and CHAT.
   */
  async sendPaymentReminders(minAgeMinutes: number) {
    const errors: { payment_id: string; message: string }[] = [];
    const reminderNotificationLimit =
      config.PAYMENT_REMINDER_NOTIFICATION_LIMIT;
    const cutoff = new Date(Date.now() - minAgeMinutes * 60 * 1000);

    // 1) Get stale inactive reservations
    const staleReservations =
      await this.reservationRepository.findStaleReservations(
        cutoff,
        pmsBookingClaimStaleBefore(),
      );
    if (!staleReservations.length) {
      return { processed: 0, reminded: 0, errors };
    }

    const reservationIds = staleReservations.map((r: ReservationModel) => r.id);

    // 2) Get unique payment IDs for these reservations. Each inactive reservation will only have one payment ID.
    const paymentIds = _.uniq(
      await this.paymentService.getPaymentIdsByReservationIds(reservationIds),
    );
    if (!paymentIds.length) {
      return { processed: 0, reminded: 0, errors };
    }

    // 3) Get full payment objects with reservation IDs
    let payments =
      await this.paymentService.getPaymentsWithReservationsAndHotelId(
        paymentIds,
      );

    // 4) Filter by notification count limit if specified
    if (reminderNotificationLimit) {
      payments = payments.filter(
        (p) => (p.notification_count ?? 0) < reminderNotificationLimit,
      );
    }

    logger.info(`Found ${payments.length} payments for reminders`);
    if (!payments?.length) {
      return { processed: 0, reminded: 0, errors };
    }

    // 5) If multiple reservations have the same payment, then only one reservation will be sent a reminder
    const firstReservationIdPerPayment: string[] = [];
    for (const payment of payments) {
      if (payment.reservation_ids?.length >= 1) {
        firstReservationIdPerPayment.push(payment.reservation_ids[0]);
      }
    }

    // 6) Only send reminders for reservations made via call, SMS, and CHAT.
    const types = [SessionType.CALL, SessionType.SMS, SessionType.CHAT];
    const reservations =
      await this.reservationRepository.findManyReservationWithDetailsByIds(
        firstReservationIdPerPayment,
        types,
      );

    if (!reservations?.length) {
      return { processed: 0, reminded: 0, errors };
    }

    const paymentIdReservationMap = new Map<string, ReservationDTO>();
    reservations.forEach((reservation) => {
      if (reservation.payments && reservation.payments.length > 0) {
        for (const payment of reservation.payments) {
          paymentIdReservationMap.set(payment.id, reservation);
        }
      }
    });
    const paymentIdPaymentMap = new Map<
      string,
      Payment & { reservation_ids: string[]; hotel_id: string }
    >(payments.map((p) => [p.id, p]));

    const results = await Promise.all(
      Array.from(paymentIdReservationMap.entries()).map(
        async ([paymentId, reservation]) => {
          const payment = paymentIdPaymentMap.get(paymentId);
          try {
            if (!payment?.payment_link) {
              // Nothing to remind if we don't have a link
              return { paymentId, success: false };
            }

            const hotel = reservation.hotel;
            if (!hotel) {
              throw new NoDataError(
                `sendPaymentReminders: No hotel found for reservation ${reservation.id}`,
              );
            }

            const parentBookingId = reservation.booking_id.replace(/_\d+$/, '');
            const bookingReview =
              await this.bookingReviewRepository.findByBookingId(
                parentBookingId,
              );
            if (!bookingReview) {
              logger.warn(
                `sendPaymentReminders: No booking review found for booking ${parentBookingId}, skipping`,
              );
              return { paymentId, success: false };
            }
            const reviewUrl = getSecureReviewUrl(
              bookingReview.reservation_review_id,
              hotel.name || 'hotels',
            );

            const toPhone = await resolveSmsTargetPhoneNumber(
              reservation.customer.phone_number,
              reservation.phone_number,
              reservation.hotel_configuration?.twilio_configuration,
              hotel.country,
              false,
            );
            const firstName = reservation.customer?.first_name || 'Guest';
            const hotelName = hotel.name || 'our hotel';
            const hotelPhoneNumber = hotel.assistant_phone_number;
            const hotelSmsNumber = hotel.sms_number;
            const hotelCountry = hotel.country;
            const smsAgentEnabled =
              reservation.hotel_configuration?.sms_agent_enabled || false;
            const createdAt = new Date(payment.created_at);
            const ageMins = Math.floor(
              (Date.now() - createdAt.getTime()) / 60000,
            );
            const minutesLeft = Math.max(0, config.REVIEW_TIMEOUT - ageMins);

            // If n reminder notifications have been sent, the current notification is the (n+1)th reminder
            const reminderNumber = (payment.notification_count ?? 1) + 1;

            await this.paymentService.sendPaymentReminderSMS(
              payment.id,
              toPhone,
              firstName,
              hotelName,
              reviewUrl,
              minutesLeft,
              hotelPhoneNumber,
              reminderNumber,
              hotelSmsNumber,
              hotelCountry,
              reservation.session_id!,
              reservation.type,
              smsAgentEnabled,
              hotel.id,
              hotel.internal_phone_number,
              reservation.hotel_configuration?.twilio_configuration,
            );

            return { paymentId: payment.id, success: true };
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'Unknown error';
            logger.error('Failed to send payment reminder:', err);
            return {
              paymentId: (payment as any).id,
              success: false,
              error: message,
            };
          }
        },
      ),
    );

    const reminded = results.reduce((acc, r) => acc + (r.success ? 1 : 0), 0);
    errors.push(
      ...results
        .filter((r) => !r.success && (r as any).error)
        .map((r) => ({
          payment_id: (r as any).paymentId,
          message: (r as any).error,
        })),
    );

    return { processed: payments.length, reminded, errors };
  }

  /**
   * Fetches reservation details by reservation review ID. This data is used by the customer to review the reservation before payment (or before confirmation for no-payment hotels).
   * @param reservationReviewId The unique review identifier from booking_reviews.
   * @returns The reservation details.
   */
  public async getReservationDetailsByReviewId(reservationReviewId: string) {
    // 1) Look up booking_reviews by reservation_review_id
    const bookingReview =
      await this.bookingReviewRepository.findByReservationReviewId(
        reservationReviewId,
      );
    if (!bookingReview) {
      throw new NoDataError(
        `Booking review not found for reservation_review_id ${reservationReviewId}`,
      );
    }

    // 2) Load all reservations for this booking
    const reservationsWithBookingIdPrefix =
      await this.reservationRepository.findReservationsByBookingIdForHotel(
        bookingReview.booking_id,
        bookingReview.hotel_id,
      );
    if (
      !reservationsWithBookingIdPrefix ||
      reservationsWithBookingIdPrefix.length === 0
    ) {
      throw new NoDataError(
        `No reservations found for booking ${bookingReview.booking_id}`,
      );
    }

    // 3) Optionally load linked payment (may not exist for no-payment reservations)
    const reservationIds = reservationsWithBookingIdPrefix.map((r) => r.id);
    const payment =
      await this.paymentReservationRepository.findPaymentByReservationIds(
        reservationIds,
      );

    // 4) Validate payment link state if a payment exists
    if (payment) {
      if (payment.payment_link_disabled) {
        throw new BadRequestError('This payment link has expired');
      }
      if (
        ![PaymentStatus.PENDING, PaymentStatus.FAILED].includes(
          payment.payment_status,
        )
      ) {
        throw new BadRequestError('Invalid payment link');
      }
    }

    // 5) Validate availability of the rooms still waiting to be booked. A room
    // already booked in the PMS holds its own unit, so checking it again would
    // count the guest's booking against itself.
    const awaitingBooking = reservationsWithBookingIdPrefix.filter(
      (r) => r.status === ReservationStatus.INACTIVE,
    );
    if (awaitingBooking.length > 0) {
      const pmsService = await this.pmsServiceFactory.getReservationService(
        bookingReview.hotel_id,
      );
      await pmsService.validateRoomAvailability(awaitingBooking);
    }

    // 6) Aggregate quote totals
    let aggBaseRate = 0;
    let aggTaxes = 0;
    let aggFees = 0;
    let aggAmountCharged = 0;
    let aggTotal = 0;
    let aggProcessingFeePercentage: number | null = null;
    let aggProcessingFeeAmount: number | null = null;

    const processingFeePct: number | null =
      reservationsWithBookingIdPrefix[0]?.hotel_configuration
        ?.processing_fee_percentage ?? null;

    reservationsWithBookingIdPrefix?.forEach((reservation) => {
      const quote = reservation.quote;
      if (quote) {
        aggBaseRate += Number(quote.base_rate || 0);
        aggTaxes += Number(quote.taxes || 0);
        aggFees += Number(quote.fees || 0);
        aggAmountCharged += Number(quote.amount_charged || 0);
        aggTotal += getReservationTotalAmount(reservation);

        if (processingFeePct != null) {
          const rawBaseRate = Number(
            quote.quote_object?.raw_response?.base_rate ?? quote.base_rate,
          );
          aggProcessingFeePercentage = processingFeePct;
          aggProcessingFeeAmount = roundCurrency(
            (aggProcessingFeeAmount ?? 0) +
              rawBaseRate * (processingFeePct / 100),
          );
        }
      }
    });

    // 7) Build reservations list with required fields
    const reservations = reservationsWithBookingIdPrefix.map((r) => ({
      id: r.id,
      booking_id: r.booking_id,
      external_id: r.external_id,
      check_in: r.check_in,
      check_out: r.check_out,
      num_adults: r.num_adults,
      num_children: r.num_children,
      num_pets: r.num_pets ?? 0,
      customer_id: r.customer?.id,
      phone_number: r.phone_number,
      status: r.status,
      roomType: r.room_type,
    }));

    // 8) Generate presigned URLs
    const hotelImagePresignedUrl = reservationsWithBookingIdPrefix[0]?.hotel
      ?.image_url
      ? await generatePresignedUrl(
          reservationsWithBookingIdPrefix[0].hotel.image_url,
          3600,
        )
      : null;

    const customerFromRes = reservationsWithBookingIdPrefix[0]?.customer;
    let customerSignaturePresignedUrl: string | null = null;
    if (customerFromRes?.signature) {
      try {
        customerSignaturePresignedUrl = await generatePresignedUrl(
          customerFromRes.signature,
          3600,
        );
      } catch (err) {
        logger.warn(
          `getReservationDetailsByReviewId: Could not generate presigned URL for customer signature: ${err}`,
        );
      }
    }

    // 9) Compose structured response
    const terms_and_policy_config =
      reservationsWithBookingIdPrefix[0]?.hotel_configuration
        ?.terms_and_policy_config ?? null;
    const hotel = reservationsWithBookingIdPrefix[0]?.hotel;

    // Tells the frontend the 3DS status. Reflects the Shift4 hotel's toggle
    // (true/false) when set; null when there is no 3DS setting — i.e. the
    // config is absent or the hotel is not on Shift4.
    const enable_3ds =
      hotel?.payment_provider === PaymentProvider.SHIFT4
        ? (reservationsWithBookingIdPrefix[0]?.hotel_configuration
            ?.threeDS_config?.enabled ?? null)
        : null;
    const address = reservationsWithBookingIdPrefix[0]?.customer?.address;
    const billingAddress =
      reservationsWithBookingIdPrefix[0]?.customer?.billing_address;

    const result: {
      hotel: Record<string, unknown> | null;
      customer: Record<string, unknown> | null;
      address: Record<string, unknown> | null;
      billing_address: Record<string, unknown> | null;
      quote: Record<string, unknown>;
      reservations: typeof reservations;
      payment: Record<string, unknown> | null;
      mews_public_key?: string;
      authnet_config?: { apiLoginId: string; publicClientKey: string };
    } = {
      hotel: hotel
        ? {
            id: hotel.id,
            name: hotel.name,
            phone_number: hotel.assistant_phone_number,
            internal_phone_number: hotel.internal_phone_number,
            country: hotel.country,
            address: hotel.address,
            image_url: hotelImagePresignedUrl,
            currency: hotel.currency,
            terms_and_policy_config,
            payment_provider: hotel.payment_provider,
            pms_provider: hotel.pms_provider,
            enable_3ds,
          }
        : null,
      customer: customerFromRes
        ? {
            id: customerFromRes.id,
            first_name: customerFromRes.first_name,
            last_name: customerFromRes.last_name,
            email: customerFromRes.email,
            phone_number: customerFromRes.phone_number,
            signature: customerFromRes.signature ?? null,
            device_details: customerFromRes.device_details ?? null,
            signature_presigned_url: customerSignaturePresignedUrl,
          }
        : null,
      address: address
        ? {
            state_or_province: address.state_or_province,
            postal_code: address.postal_code,
            country: address.country,
            address_first_line: address.address_first_line,
            city: address.city,
          }
        : null,
      billing_address: billingAddress
        ? {
            state_or_province: billingAddress.state_or_province,
            postal_code: billingAddress.postal_code,
            country: billingAddress.country,
            address_first_line: billingAddress.address_first_line,
            city: billingAddress.city,
          }
        : null,
      quote: {
        base_rate: aggBaseRate,
        taxes: aggTaxes,
        fees: aggFees,
        amount_charged: aggAmountCharged,
        total: aggTotal,
        ...(aggProcessingFeePercentage != null && {
          processing_fee_percentage: aggProcessingFeePercentage,
          processing_fee_amount: aggProcessingFeeAmount,
        }),
      },
      reservations,
      payment: payment
        ? {
            status: payment.payment_status,
            currency: payment.currency,
            payment_provider: payment.payment_provider,
          }
        : null,
    };

    if (hotel?.payment_provider === PaymentProvider.MEWS) {
      await this.findAndValidateReviewPayment(
        reservationIds,
        bookingReview.booking_id,
      );

      try {
        // PublicKey doubles as the PCI Proxy `merchantId` for Mews's Secure Fields
        // payment form (see Mews docs: use-cases/payment-automation.md#1-retrieve-publickey).
        // Sent to the client so the card form can tokenize card details directly with
        // PCI Proxy — raw card data never reaches this backend, only the resulting
        // transactionId, which we later use to add a tokenized credit card in Mews.
        const mewsPublicKey = await mewsPaymentProviderService.getPublicKey(
          hotel.assistant_phone_number,
        );
        result.mews_public_key = mewsPublicKey;
      } catch (err) {
        logger.warn(
          'getReservationDetailsByReviewId: Could not fetch Mews public key',
          {
            error: err instanceof Error ? err.message : String(err),
            mewsRequestId: getMewsRequestId(err),
          },
        );
      }
    }

    if (hotel?.payment_provider === PaymentProvider.AUTHORIZE_NET) {
      try {
        const authnetConfig =
          await this.hotelConfigurationService.getAuthorizenetConfigByHotelId(
            hotel.id,
          );
        if (authnetConfig) {
          result.authnet_config = {
            apiLoginId: authnetConfig.apiLoginId,
            publicClientKey: authnetConfig.publicClientKey,
          };
        }
      } catch (err) {
        logger.warn(
          'getReservationDetailsByReviewId: Could not fetch Authorize.net config',
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
    }

    return result;
  }

  /**
   * Builds the review payload for customer update: uploads policy signature image to S3 when provided,
   * and merges device info (IP, browser, device_type) into the shape expected by customerService.updateCustomer.
   */
  public async prepareReviewPayloadForCustomerUpdate(
    reviewContext: {
      deviceIpAndLocation: DeviceIpAndLocation;
      policy_signature?: { image: string; contentType: string };
    },
    customerName: string,
  ): Promise<{
    signature?: string;
    device_details?: DeviceDetails;
  }> {
    const { deviceIpAndLocation, policy_signature: policySignatureRaw } =
      reviewContext;
    let signature: string | undefined;

    if (policySignatureRaw) {
      const buffer = Buffer.from(policySignatureRaw.image, 'base64');
      if (buffer.length === 0) {
        throw new BadRequestError(
          'policy_signature.image must be valid base64',
        );
      }
      const { filePath } = await this.uploadPolicySignatureImage(
        buffer,
        policySignatureRaw.contentType,
        customerName,
      );
      signature = filePath;
    }

    const hasDeviceDetails =
      deviceIpAndLocation.customer_device_ip != null ||
      deviceIpAndLocation.customer_device_location != null ||
      deviceIpAndLocation.browser != null ||
      deviceIpAndLocation.device_type != null;
    const device_details = hasDeviceDetails
      ? {
          ...(deviceIpAndLocation.customer_device_ip != null && {
            customer_ip: deviceIpAndLocation.customer_device_ip,
          }),
          ...(deviceIpAndLocation.customer_device_location != null && {
            customer_location: deviceIpAndLocation.customer_device_location,
          }),
          ...(deviceIpAndLocation.browser != null && {
            browser: deviceIpAndLocation.browser,
          }),
          ...(deviceIpAndLocation.device_type != null && {
            device_type: deviceIpAndLocation.device_type,
          }),
        }
      : undefined;

    return {
      ...(signature != null && { signature }),
      ...(device_details != null && { device_details }),
    };
  }

  /**
   * Uploads a policy signature image to S3 and returns the S3 path.
   */
  public async uploadPolicySignatureImage(
    buffer: Buffer,
    contentType: string,
    customerName?: string,
  ): Promise<{ filePath: string }> {
    const ext = contentType.split('/')[1] || 'png';
    const namePart = customerName
      ? customerName
          .replace(/[^a-zA-Z0-9-_]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 80)
      : '';
    const key = namePart
      ? `policy-signatures/${namePart}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}.${ext}`
      : `policy-signatures/${Date.now()}-${Math.random().toString(36).slice(2, 11)}.${ext}`;
    const filePath = await uploadBufferToS3ReturnPath(buffer, key, contentType);
    return { filePath };
  }

  /**
   * Handles review page submission: updates customer details, then either returns a payment URL
   * (for payment-required hotels) or creates the PMS reservation directly (for no-payment hotels).
   */
  /**
   * Re-checks the hotel's same-day cutoff at payment time.
   *
   * The cutoff is validated when availability is quoted, but the guest can take
   * up to REVIEW_TIMEOUT to pay — long enough to cross it. Must run before the
   * card is captured: past the cutoff the PMS start time has passed too, so the
   * booking would be charged and then rejected by the PMS.
   */
  private async assertSameDayStillBookable(
    reservations: ReservationDTO[],
    hotel: Hotel,
    hotelConfig?: HotelConfiguration | null,
  ): Promise<void> {
    const config =
      hotelConfig !== undefined
        ? hotelConfig
        : await this.hotelConfigurationService.getHotelConfigurationByHotelId(
            hotel.id,
          );
    const sameDayConfig = config?.same_day_booking_configuration;
    if (!sameDayConfig || !hotel.timezone) return;

    const todayInHotelTz = dayjs().tz(hotel.timezone).format('YYYY-MM-DD');
    for (const reservation of reservations) {
      try {
        validateSameDayBooking(
          dayjs(reservation.check_in).format('YYYY-MM-DD'),
          todayInHotelTz,
          hotel.timezone,
          sameDayConfig,
        );
      } catch (err) {
        logKpi({
          stat: KpiStat.PmsBookingSameDayCutoffRejected,
          value: 1,
          contextName: 'RoomReservationService.assertSameDayStillBookable',
          clientId: hotel.assistant_phone_number ?? hotel.id,
          contextId: reservation.booking_id,
        });
        throw err;
      }
    }
  }

  public async submitReviewAndProcessReservation(
    customerData: UpdateCustomerDataBeforePayment,
    reservationReviewId: string,
    reviewContext?: {
      request: RequestLikeForIp;
      policy_signature?: { image: string; contentType: string };
    },
  ) {
    if (!reservationReviewId) {
      throw new BadRequestError(
        'submitReviewAndProcessReservation: reservation_review_id is required',
      );
    }

    const reviewPayload = reviewContext
      ? await this.prepareReviewPayloadForCustomerUpdate(
          {
            deviceIpAndLocation: getDeviceIpAndLocation(reviewContext.request),
            ...(reviewContext.policy_signature != null && {
              policy_signature: reviewContext.policy_signature,
            }),
          },
          `${customerData.first_name}-${customerData.last_name}`.trim(),
        )
      : undefined;

    const customerDeviceIP = reviewPayload?.device_details?.customer_ip ?? null;

    if (reviewPayload?.device_details) {
      logger.info('submitReviewAndProcessReservation: device details', {
        customer_device_ip: customerDeviceIP,
        customer_device_location:
          reviewPayload.device_details.customer_location ?? null,
        browser: reviewPayload.device_details.browser ?? null,
        device_type: reviewPayload.device_details.device_type ?? null,
      });
    }

    // 1) Look up booking_reviews
    const bookingReview =
      await this.bookingReviewRepository.findByReservationReviewId(
        reservationReviewId,
      );
    if (!bookingReview) {
      throw new NoDataError(
        `submitReviewAndProcessReservation: Booking review not found for reservation_review_id ${reservationReviewId}`,
      );
    }

    // 2) Load reservations for this booking
    const allReservations =
      await this.reservationRepository.findReservationsByBookingIdForHotel(
        bookingReview.booking_id,
        bookingReview.hotel_id,
      );
    if (!allReservations || allReservations.length === 0) {
      throw new NoDataError(
        `submitReviewAndProcessReservation: No reservations found for booking ${bookingReview.booking_id}`,
      );
    }

    const reservation = allReservations[0];

    if (reservation.status !== ReservationStatus.INACTIVE) {
      throw new BadRequestError(
        `submitReviewAndProcessReservation: Reservation ${reservation.id} review already submitted`,
      );
    }

    if (!reservation.customer?.id) {
      throw new NoDataError(
        `submitReviewAndProcessReservation: Customer not found for reservation ${reservation.id}`,
      );
    }

    const hotel = await this.hotelService.getHotelById(bookingReview.hotel_id);
    if (!hotel) {
      throw new NoDataError(
        `submitReviewAndProcessReservation: Hotel ${bookingReview.hotel_id} not found`,
      );
    }

    // 3) Validate room availability. The same-day cutoff is re-checked here
    // because the quote may have been issued before it and paid after.
    await this.assertSameDayStillBookable(allReservations, hotel);

    const pmsService = await this.pmsServiceFactory.getReservationService(
      bookingReview.hotel_id,
    );
    await pmsService.validateRoomAvailability(allReservations);

    // 4) Update customer details
    await this.customerService.updateCustomer(reservation.customer.id, {
      ...customerData,
      address: {
        ...customerData.address,
        ip_address: customerDeviceIP ?? undefined,
      },
      ...reviewPayload,
    });

    // 5) Build signature presigned URL if provided
    let policySignaturePresignedUrl: string | undefined;
    if (reviewPayload?.signature) {
      try {
        policySignaturePresignedUrl = await generatePresignedUrl(
          reviewPayload.signature,
          3600,
        );
      } catch (err) {
        logger.warn(
          `submitReviewAndProcessReservation: Could not generate presigned URL for signature: ${err}`,
        );
      }
    }

    // 6) Branch on payment provider
    const reservationIds = allReservations.map((r) => r.id);
    const email = customerData.email;

    const isNoPayment =
      hotel.payment_provider === PaymentProvider.NOT_APPLICABLE ||
      shouldForceZeroDeposit(
        hotel.id,
        allReservations.map((r) => r.room_id),
        reservation.phone_number,
      );

    if (isNoPayment) {
      const refreshedReservations =
        await this.reservationRepository.findReservationsByBookingIdForHotel(
          bookingReview.booking_id,
          bookingReview.hotel_id,
        );
      const createdReservations = await this.finalizePmsReservations(
        refreshedReservations,
      );
      const twilioConfiguration =
        await this.hotelConfigurationService.getTwilioConfigurationByHotelId(
          hotel.id,
        );
      void this.sendNoPaymentConfirmationSMS(
        createdReservations,
        refreshedReservations,
        hotel,
        twilioConfiguration,
      );
      void this.sendNoPaymentBookingTelegramNotification(
        createdReservations,
        refreshedReservations,
        hotel,
      );
      return {
        confirmed: true,
        ...(policySignaturePresignedUrl && {
          policy_signature_presigned_url: policySignaturePresignedUrl,
        }),
      };
    }

    switch (hotel.payment_provider) {
      case PaymentProvider.SHIFT4: {
        const payment = await this.findAndValidateReviewPayment(
          reservationIds,
          bookingReview.booking_id,
        );
        if (!payment.payment_link) {
          throw new NoDataError(
            `submitReviewAndProcessReservation: payment_link not found for Shift4 payment ${payment.id}`,
          );
        }
        const shift4Response = await this.handleShift4PreAuthorization(
          payment,
          reservation,
          customerData,
          hotel,
          customerDeviceIP,
        );
        return {
          paymentLink: payment.payment_link,
          shift4PreAuthResponse: shift4Response,
          ...(policySignaturePresignedUrl && {
            policy_signature_presigned_url: policySignaturePresignedUrl,
          }),
        };
      }

      case PaymentProvider.STRIPE: {
        const payment = await this.findAndValidateReviewPayment(
          reservationIds,
          bookingReview.booking_id,
        );
        if (!payment.payment_link) {
          throw new NoDataError(
            `submitReviewAndProcessReservation: payment_link not found for Stripe payment ${payment.id}`,
          );
        }
        // amount_charged === 0 means payment.payment_link is a Stripe Checkout
        // Session URL (setup mode), not a Payment Link. Checkout Session URLs don't
        // support prefilling the email via query param, so skip appending it there.
        return {
          paymentLink:
            payment.amount_charged === 0
              ? payment.payment_link
              : appendPrefilledEmailToPaymentLink(payment.payment_link, email),
          ...(policySignaturePresignedUrl && {
            policy_signature_presigned_url: policySignaturePresignedUrl,
          }),
        };
      }

      // None of these issue a payment link: the frontend collects the card
      // and posts it to the provider's /card-token endpoint.
      case PaymentProvider.MEWS:
      case PaymentProvider.OPERA:
      case PaymentProvider.AUTHORIZE_NET:
      case PaymentProvider.RESNEXUS: {
        return {
          ...(policySignaturePresignedUrl && {
            policy_signature_presigned_url: policySignaturePresignedUrl,
          }),
        };
      }

      case PaymentProvider.CLOUDBEDS_SDK: {
        return {
          cloudbedsSdkApiKey:
            await cloudbedsSdkPaymentProviderService.getSdkApiKey(hotel.id),
          cloudbedsSdkPropertyId:
            await cloudbedsSdkPaymentProviderService.getSdkPropertyId(hotel.id),
          cloudbedsSdkEnv: config.CLOUDBEDS_SDK_ENV,
          ...(policySignaturePresignedUrl && {
            policy_signature_presigned_url: policySignaturePresignedUrl,
          }),
        };
      }

      default:
        throw new BadRequestError(
          `submitReviewAndProcessReservation: Unsupported payment provider ${hotel.payment_provider} for booking ${bookingReview.booking_id}`,
        );
    }
  }

  /**
   * Handles Shift4 pre-authorization for a payment
   * @param payment Payment record
   * @param reservation Reservation details
   * @param customerData Customer data from the request
   * @param hotel Hotel information
   * @returns Shift4 pre-authorization response or undefined if failed
   */
  private async handleShift4PreAuthorization(
    payment: Payment & { reservation_ids: string[] },
    reservation: ReservationDTO,
    customerData: UpdateCustomerDataBeforePayment,
    hotel: Hotel,
    customerDeviceIP: string | null,
  ): Promise<Shift4PreAuthResponse> {
    try {
      logger.info(
        'handleShift4PreAuthorization: Initiating Shift4 pre-authorization',
        {
          hotel_id: payment.hotel_id,
          payment_id: payment.id,
        },
      );

      // Validate customer device IP
      if (!customerDeviceIP) {
        logger.error(`handleShift4PreAuthorization: Customer IP not found`);
        throw new BadRequestError(`Customer IP not found`);
      }

      // Validate all mandatory customer and address fields using Joi
      validateShift4CustomerData(customerData);

      // Retrieve hotel-specific Shift4 credentials from config
      const hotelShift4Config = config.HOTEL_SHIFT4_CONFIG[hotel.id];
      if (!hotelShift4Config) {
        logger.error(
          `handleShift4PreAuthorization: Shift4 config not found for hotel ${hotel.id}`,
        );
        throw new BadRequestError(
          `Shift4 payment configuration not found for this hotel`,
        );
      }

      let invoiceId = payment.payment_link_id;
      if (!invoiceId) {
        throw new NoDataError(
          `handleShift4PreAuthorization: invoice ID not found for payment ${payment.id}`,
        );
      }

      // After Joi validation, we can safely assert these fields are defined
      const billingAddress =
        customerData.billing_address ?? customerData.address;
      const billingAddressData = {
        firstName: customerData.first_name,
        lastName: customerData.last_name,
        address1: billingAddress.address_first_line!,
        city: billingAddress.city!,
        state: billingAddress.state_or_province,
        postalCode: billingAddress.postal_code,
        countryCode: billingAddress.country!,
        phone1: customerData.phone_number,
      };

      const customerAddress = customerData.address;
      const shippingAddressData = {
        firstName: customerData.first_name,
        lastName: customerData.last_name,
        address1: customerAddress.address_first_line!,
        city: customerAddress.city!,
        state: customerAddress.state_or_province,
        postalCode: customerAddress.postal_code,
        countryCode: customerAddress.country!,
        phone1: customerData.phone_number,
      };

      const consumer = {
        mobilePhone: customerData.phone_number,
        lastName: customerData.last_name,
        email: customerData.email,
        billingAddress: billingAddressData,
        shippingAddress: shippingAddressData,
      };

      const hotelConfiguration =
        await this.hotelConfigurationService.getHotelConfigurationByHotelId(
          hotel.id,
        );
      const enable3DS = hotelConfiguration?.threeDS_config?.enabled === true;

      if (enable3DS) {
        logKpi({
          stat: KpiStat.PaymentShift4ThreeDSApplied,
          value: 1,
          contextName: 'RoomReservationService.handleShift4PreAuthorization',
          clientId: hotel.assistant_phone_number ?? hotel.id,
          contextId: payment.id,
        });
      }

      const shift4Response = await shift4Service.preauthorizeClient({
        orderNumber: reservation.booking_id,
        amount: payment.amount_charged,
        currencyCode: payment.currency.toUpperCase(),
        consumer,
        invoice: invoiceId,
        customerDeviceIP,
        hotelShift4Config,
        enable3DS,
      });

      logger.info(
        'handleShift4PreAuthorization: Shift4 pre-authorization successful',
        {
          invoiceId,
          responseCode: shift4Response.i4go_responsecode,
        },
      );

      return shift4Response;
    } catch (error) {
      logger.error(
        'handleShift4PreAuthorization: Shift4 pre-authorization failed',
        error,
      );
      throw error;
    }
  }

  /**
   * Processes Shift4 card token submission and initiates initial deposit payment.
   * Stores encrypted card token in customer record for future charges.
   * Shift4 Sale/Purchase API doc (type should be GTV Token): https://docs.shift4.com/apis/payments-platform-rest/openapi/transactions/transactionssale
   * @param cardTokenData Card token data from Shift4 i4Go response
   * @returns Shift4 sale transaction response
   */
  public async processShift4InitialDepositAndCreateReservations(
    cardTokenData: Shift4CardTokenRequest,
  ) {
    try {
      logger.info(
        'processShift4InitialDepositAndCreateReservations: Processing card token and payment',
        {
          payment_id: cardTokenData.payment_id,
        },
      );

      // Present only when 3DS ran during pre-authorization (per-hotel toggle).
      const threeDSecureData = cardTokenData.threeDSecure;

      // Look up booking review, then find payment through reservations
      const bookingReview =
        await this.bookingReviewRepository.findByReservationReviewId(
          cardTokenData.payment_id,
        );
      if (!bookingReview) {
        throw new NoDataError(
          `Booking review not found for reservation_review_id ${cardTokenData.payment_id}`,
        );
      }
      const reservations =
        await this.reservationRepository.findReservationsByBookingIdForHotel(
          bookingReview.booking_id,
          bookingReview.hotel_id,
        );
      if (!reservations?.length) {
        throw new NoDataError(
          `No reservations found for booking ${bookingReview.booking_id}`,
        );
      }
      const payment =
        await this.paymentReservationRepository.findPaymentByReservationIds(
          reservations.map((r) => r.id),
        );
      if (!payment) {
        throw new NoDataError(
          `Payment not found for booking review ID ${cardTokenData.payment_id}`,
        );
      }
      if (!payment.reservation_ids || payment.reservation_ids.length === 0) {
        throw new NoDataError(
          `No reservations found for payment linked to booking review ID ${payment.id}`,
        );
      }

      if (
        !validPaymentPreStatus[PaymentStatus.COMPLETED]?.includes(
          payment.payment_status,
        )
      ) {
        throw new BadRequestError(
          `Payment ${payment.id} is not in a valid status to process initial deposit`,
        );
      }

      // Get hotel and Shift4 configuration
      const hotelData =
        await this.hotelService.getHotelWithConfigurationsAndChannels(
          payment.hotel_id,
        );
      if (!hotelData) {
        throw new NoDataError(
          `Hotel ${payment.hotel_id} not found for payment ${payment.id}`,
        );
      }
      const hotel = hotelData.hotel;
      const hotelConfig = hotelData.configuration;

      // 3DS is applied only when the hotel toggle is on. When off, we don't
      // touch or send 3DS (as the flow behaved while 3DS was disabled). The
      // normalized block is only transmitted to Shift4 on the sale request — it
      // is never persisted (the 3DS cryptogram is sensitive authentication data
      // that must not be stored post-authorization, PCI-DSS 3.3.1).
      const threeDSEnabled = hotelConfig?.threeDS_config?.enabled === true;
      if (threeDSEnabled) {
        if (threeDSecureData && !threeDSecureData.authenticationSource) {
          threeDSecureData.authenticationSource =
            ThreeDSecureAuthenticationSource.ACS;
        }

        // Adjust 3D Secure data based on hotel country
        // For US merchants: use programProtocol, remove version
        // For non-US merchants: use version, remove programProtocol
        if (threeDSecureData) {
          if (hotel.country.toLocaleLowerCase() === Country.US.toLowerCase()) {
            delete threeDSecureData.version;
          } else {
            delete threeDSecureData.programProtocol;
          }
        }
      }

      const hotelShift4Config = config.HOTEL_SHIFT4_CONFIG[hotel.id];
      if (!hotelShift4Config) {
        throw new BadRequestError(
          `Shift4 payment configuration not found for hotel ${hotel.id}`,
        );
      }

      // Use the first reservation for customer and basic details
      const primaryReservation = reservations[0];
      const customer = primaryReservation.customer;
      if (!customer || !customer.id) {
        throw new NoDataError(
          `Customer not found for reservation ${primaryReservation.id}`,
        );
      }

      const customerDataToUpdate: Partial<
        Omit<Customer, 'id' | 'created_at' | 'updated_at'>
      > = {
        card_metadata: {
          token: cardTokenData.i4go_uniqueid,
          expiration_month: cardTokenData.i4go_expirationmonth,
          expiration_year: cardTokenData.i4go_expirationyear,
        },
      };

      logger.info(
        'processShift4InitialDepositAndCreateReservations: Card token stored',
        {
          customer_id: customer.id,
          payment_id: payment.id,
          reservation_count: reservations.length,
        },
      );

      // Build Shift4 sale transaction request
      const invoiceId = payment.payment_link_id;
      if (!invoiceId) {
        throw new NoDataError(`Invoice ID not found for payment ${payment.id}`);
      }

      // Zero-deposit: capture and store the card, skip the charge entirely.
      // The first real charge is deferred to the autocharge scheduler, which
      // falls back to CardOnFileType.U01 when no transaction_id exists yet.
      if (Number(payment.amount_charged) === 0) {
        return this.processShift4ZeroDepositCardCapture(
          payment,
          reservations,
          customer,
          customerDataToUpdate,
          hotel,
          invoiceId,
          hotelConfig,
        );
      }

      const saleTransactionRequest = this.buildShift4AdvanceDepositRequest(
        payment,
        reservations,
        customer,
        cardTokenData,
        hotel,
        hotelConfig,
        invoiceId,
      );

      logPaymentContext({
        invoiceId,
        hotel,
        bookingId: bookingReview.booking_id,
        customer,
      });

      // Execute sale transaction
      const saleResponse = await shift4Service.saleTransaction(
        saleTransactionRequest,
        hotelShift4Config.accessToken,
      );

      const saleResponseData = saleResponse.result?.[0];

      logger.info(
        'processShift4InitialDepositAndCreateReservations: Sale transaction completed',
        {
          payment_id: payment.id,
          invoice: invoiceId,
          response_code: saleResponseData?.transaction?.responseCode,
        },
      );

      // Check if payment was approved
      if (
        ![
          Shift4ResponseCode.APPROVED,
          Shift4ResponseCode.APPROVED_CEILING,
        ].includes(saleResponseData?.transaction?.responseCode)
      ) {
        // Handle payment failure
        await this.handleShift4PaymentFailure(
          payment,
          reservations,
          hotel,
          saleResponseData,
        );
        throw new Shift4Error(
          `Advance payment collection failed for payment ${payment.id}. Shift4 response code ${saleResponseData?.transaction?.responseCode}`,
        );
      }

      // If payment was approved, but downstream processing failed, throw a custom error to be caught and identified by the caller
      try {
        // Update payment status to COMPLETED
        await this.paymentService.updatePaymentStatusById(
          payment.id,
          PaymentStatus.COMPLETED,
        );

        // Persist the Shift4 invoice ID as booking_confirmation_id
        await this.paymentService.updatePaymentById(payment.id, {
          booking_confirmation_id: invoiceId,
          payment_link_disabled: true,
        });

        const transactionId =
          saleResponseData?.transaction?.cardOnFile?.transactionId;

        logger.info(
          `processShift4InitialDepositAndCreateReservations: Payment ${payment.id} marked as COMPLETED. Transaction ID: ${transactionId}, booking_confirmation_id: ${invoiceId}`,
        );

        // Store the transactionId from card-on-file response for future charges
        if (transactionId) {
          customerDataToUpdate.card_metadata!.transaction_id = transactionId;
        }
        // Store the card token and metadata
        await customerService.updateCustomer(customer.id, customerDataToUpdate);
        logger.info(`Customer ${customer.id} updated with card metadata`);

        // Handle post-payment success flow in a separate transaction
        const createdReservations =
          await this.createReservationsPostShift4InitalDepositPaymentSuccess(
            payment,
            reservations,
            hotel,
            saleResponseData,
          );

        // Record payment in Stayntouch PMS if hotel uses Stayntouch PMS
        if (hotel.pms_provider === PmsProvider.STAYNTOUCH && saleResponseData) {
          try {
            await this.recordPaymentInStayntouch(
              createdReservations,
              saleResponseData,
              payment,
            );
          } catch (stayntouchError) {
            logger.error(
              `processShift4InitialDepositAndCreateReservations: Failed to record payment in Stayntouch for payment ${payment.id}: ${stayntouchError}`,
            );
          }
        }

        // Record the deposit on the Opera folio if the hotel is Opera-backed
        // through Calry (no-op for other PMS)
        await recordCollectedPaymentInOpera({
          reservations: createdReservations,
          currency: hotel.currency,
          payment,
        });

        // Send notifications
        this.sendPaymentSuccessNotifications(
          payment,
          reservations,
          hotel,
          createdReservations,
          hotelConfig,
        )
          .then(() => {
            logger.info(
              `Sent Shift4 initial deposit collection notification for payment ${payment.id}`,
            );
          })
          .catch((err: Error) => {
            logger.error(
              `Failed to send Shift4 initial deposit collection notification for payment ${payment.id}: ${err.message}`,
            );
          });
      } catch (postChargeError) {
        logger.error(
          `processShift4InitialDepositAndCreateReservations: CRITICAL - Shift4 charge succeeded but post-charge processing failed. ` +
            `PaymentId: ${payment.id}, InvoiceId: ${invoiceId}. Manual reconciliation required.`,
          postChargeError,
        );
        throw new PaymentSucceededProcessingFailedError(
          `Payment was collected but booking finalisation failed. Contact support with reference: ${invoiceId}.`,
          payment.id,
          invoiceId,
        );
      }

      return { saleResponse: saleResponseData };
    } catch (error) {
      logger.error(
        'processShift4InitialDepositAndCreateReservations: Error processing card token and payment',
        error,
      );
      throw error;
    }
  }

  public async processAuthorizeNetInitialDepositAndCreateReservations(
    cardTokenData: AuthorizeNetCardTokenRequest,
  ) {
    try {
      logger.info(
        'processAuthorizeNetInitialDepositAndCreateReservations: Processing nonce and payment',
        { payment_id: cardTokenData.reservation_review_id },
      );

      const bookingReview =
        await this.bookingReviewRepository.findByReservationReviewId(
          cardTokenData.reservation_review_id,
        );
      if (!bookingReview) {
        throw new NoDataError(
          `Booking review not found for reservation_review_id ${cardTokenData.reservation_review_id}`,
        );
      }

      const reservations =
        await this.reservationRepository.findReservationsByBookingIdForHotel(
          bookingReview.booking_id,
          bookingReview.hotel_id,
        );
      if (!reservations?.length) {
        throw new NoDataError(
          `No reservations found for booking ${bookingReview.booking_id}`,
        );
      }

      const payment =
        await this.paymentReservationRepository.findPaymentByReservationIds(
          reservations.map((r) => r.id),
        );
      if (!payment) {
        throw new NoDataError(
          `Payment not found for booking review ID ${cardTokenData.reservation_review_id}`,
        );
      }
      if (!payment.reservation_ids || payment.reservation_ids.length === 0) {
        throw new NoDataError(
          `No reservations found for payment linked to booking review ID ${payment.id}`,
        );
      }

      if (
        !validPaymentPreStatus[PaymentStatus.COMPLETED]?.includes(
          payment.payment_status,
        )
      ) {
        throw new BadRequestError(
          `Payment ${payment.id} is not in a valid status to process initial deposit`,
        );
      }

      const hotelData =
        await this.hotelService.getHotelWithConfigurationsAndChannels(
          payment.hotel_id,
        );
      if (!hotelData) {
        throw new NoDataError(
          `Hotel ${payment.hotel_id} not found for payment ${payment.id}`,
        );
      }
      const hotel = hotelData.hotel;
      const hotelConfig = hotelData.configuration;

      const accessToken = await authorizeNetTokenService.getAccessTokenForHotel(
        hotel.id,
      );

      const primaryReservation = reservations[0];
      const customer = primaryReservation.customer;
      if (!customer || !customer.id) {
        throw new NoDataError(
          `Customer not found for reservation ${primaryReservation.id}`,
        );
      }

      const chargeAmount = Number(payment.amount_charged);

      if (chargeAmount === 0) {
        return this.processAuthorizeNetZeroDepositCardCapture(
          payment,
          reservations,
          customer,
          hotel,
          hotelConfig,
          cardTokenData,
          accessToken,
        );
      }

      const chargeResult = await authorizeNetService.chargeWithNonce(
        accessToken,
        chargeAmount,
        {
          dataDescriptor: cardTokenData.dataDescriptor,
          dataValue: cardTokenData.dataValue,
        },
        { isFirstSubsequentAuth: true },
      );

      logger.info(
        'processAuthorizeNetInitialDepositAndCreateReservations: Charge succeeded',
        {
          payment_id: payment.id,
          transactionId: chargeResult.transactionId,
          networkTransId: chargeResult.networkTransId,
        },
      );

      let profileResult: {
        customerProfileId: string;
        paymentProfileId: string;
      } | null = null;
      try {
        profileResult =
          await authorizeNetService.createCustomerProfileFromTransaction(
            accessToken,
            chargeResult.transactionId,
          );
        logger.info(
          'processAuthorizeNetInitialDepositAndCreateReservations: CIM profile created',
          { customerProfileId: profileResult.customerProfileId },
        );
      } catch (profileError) {
        logger.error(
          'processAuthorizeNetInitialDepositAndCreateReservations: CIM profile creation failed (non-fatal)',
          profileError,
        );
      }

      try {
        await this.paymentService.updatePaymentStatusById(
          payment.id,
          PaymentStatus.COMPLETED,
        );

        await this.paymentService.updatePaymentById(payment.id, {
          booking_confirmation_id: chargeResult.transactionId,
          payment_link_disabled: true,
        });

        const lastFour = cardTokenData.cardNumber
          ? cardTokenData.cardNumber.slice(-4)
          : chargeResult.accountNumber?.replace(/X/gi, '');

        const customerDataToUpdate: Partial<
          Omit<Customer, 'id' | 'created_at' | 'updated_at'>
        > = {
          card_metadata: {
            token: chargeResult.transactionId,
            authnet_customer_profile_id: profileResult?.customerProfileId,
            authnet_payment_profile_id: profileResult?.paymentProfileId,
            authnet_network_trans_id: chargeResult.networkTransId,
            authnet_original_auth_amount: chargeAmount,
            authnet_last_four: lastFour,
            authnet_card_type: chargeResult.accountType,
            authnet_exp_date: cardTokenData.expDate,
          },
        };

        await customerService.updateCustomer(customer.id, customerDataToUpdate);

        await this.updateReservationPaymentStatusFromPaymentInfo(
          reservations,
          'CREDIT',
        );

        const createdReservations =
          await this.finalizePmsReservations(reservations);

        logKpi({
          stat: KpiStat.PaymentSuccess,
          value: 1,
          contextName:
            'RoomReservationService.processAuthorizeNetInitialDepositAndCreateReservations',
          clientId: hotel.assistant_phone_number,
          contextId: payment.id,
        });

        this.sendPaymentSuccessNotifications(
          payment,
          reservations,
          hotel,
          createdReservations,
          hotelConfig,
        )
          .then(() => {
            logger.info(
              `Sent AuthorizeNet deposit collection notification for payment ${payment.id}`,
            );
          })
          .catch((err: Error) => {
            logger.error(
              `Failed to send AuthorizeNet deposit collection notification for payment ${payment.id}: ${err.message}`,
            );
          });

        return { paymentId: payment.id, chargeResult, profileResult };
      } catch (postChargeError) {
        logger.error(
          `processAuthorizeNetInitialDepositAndCreateReservations: CRITICAL - charge succeeded but post-charge processing failed. ` +
            `PaymentId: ${payment.id}, TransId: ${chargeResult.transactionId}. Manual reconciliation required.`,
          postChargeError,
        );
        throw new PaymentSucceededProcessingFailedError(
          `Payment was collected but booking finalisation failed. Contact support with reference: ${chargeResult.transactionId}.`,
          payment.id,
          chargeResult.transactionId,
        );
      }
    } catch (error) {
      logger.error(
        'processAuthorizeNetInitialDepositAndCreateReservations: Error processing nonce and payment',
        error,
      );
      throw error;
    }
  }

  private async processAuthorizeNetZeroDepositCardCapture(
    payment: Payment,
    reservations: ReservationDTO[],
    customer: Customer,
    hotel: Hotel,
    hotelConfig: HotelConfiguration | null,
    cardTokenData: AuthorizeNetCardTokenRequest,
    accessToken: string,
  ): Promise<{ paymentId: string; success: true }> {
    const profileResult = await authorizeNetService.createProfileFromNonce(
      accessToken,
      {
        dataDescriptor: cardTokenData.dataDescriptor,
        dataValue: cardTokenData.dataValue,
      },
      customer.id!,
      customer.email ?? undefined,
    );

    try {
      logger.info(
        'processAuthorizeNetZeroDepositCardCapture: Profile created without charge',
        {
          payment_id: payment.id,
          customerProfileId: profileResult.customerProfileId,
        },
      );

      await this.paymentService.updatePaymentStatusById(
        payment.id,
        PaymentStatus.COMPLETED,
      );

      await this.paymentService.updatePaymentById(payment.id, {
        payment_link_disabled: true,
      });

      const lastFour = cardTokenData.cardNumber
        ? cardTokenData.cardNumber.slice(-4)
        : undefined;

      await customerService.updateCustomer(customer.id!, {
        card_metadata: {
          token: '',
          authnet_customer_profile_id: profileResult.customerProfileId,
          authnet_payment_profile_id: profileResult.paymentProfileId,
          authnet_network_trans_id: undefined,
          authnet_original_auth_amount: undefined,
          authnet_last_four: lastFour,
          authnet_card_type: undefined,
          authnet_exp_date: cardTokenData.expDate ?? undefined,
        },
      });

      logger.info(
        `processAuthorizeNetZeroDepositCardCapture: Customer ${customer.id} card stored, no charge collected. Payment ${payment.id} marked COMPLETED.`,
      );

      await this.updateReservationPaymentStatusFromPaymentInfo(
        reservations,
        'CREDIT',
      );

      const createdReservations =
        await this.finalizePmsReservations(reservations);

      logKpi({
        stat: KpiStat.PaymentSetupSessionCompleted,
        value: 1,
        contextName:
          'RoomReservationService.processAuthorizeNetZeroDepositCardCapture',
        clientId: hotel.assistant_phone_number,
        contextId: payment.id,
      });

      this.sendZeroDepositCardCaptureConfirmationNotifications(
        reservations,
        hotel,
        createdReservations,
        hotelConfig,
      )
        .then(() => {
          logger.info(
            `Sent AuthorizeNet zero-deposit card-capture confirmation for payment ${payment.id}`,
          );
        })
        .catch((err: Error) => {
          logger.error(
            `Failed to send AuthorizeNet zero-deposit card-capture confirmation for payment ${payment.id}: ${err.message}`,
          );
        });
    } catch (postCaptureError) {
      logger.error(
        `processAuthorizeNetZeroDepositCardCapture: CRITICAL - Profile created but post-capture processing failed. ` +
          `PaymentId: ${payment.id}. Manual reconciliation required.`,
        postCaptureError,
      );
      throw new PaymentSucceededProcessingFailedError(
        `Card was captured but booking finalisation failed. Contact support with payment reference: ${payment.id}.`,
        payment.id,
        payment.id,
      );
    }

    return { paymentId: payment.id, success: true };
  }

  /**
   * Zero-deposit Shift4 flow: no sale transaction is executed here. The card
   * token is stored on the customer record and the booking is finalised
   * immediately; the first real charge happens later via the autocharge
   * scheduler (Shift4AutoChargeExecutor), which uses CardOnFileType.U01 when
   * no transaction_id exists yet.
   */
  private async processShift4ZeroDepositCardCapture(
    payment: Payment,
    reservations: ReservationDTO[],
    customer: Customer,
    customerDataToUpdate: Partial<
      Omit<Customer, 'id' | 'created_at' | 'updated_at'>
    >,
    hotel: Hotel,
    invoiceId: string,
    hotelConfig: HotelConfiguration | null,
  ): Promise<{ success: true }> {
    try {
      await this.paymentService.updatePaymentStatusById(
        payment.id,
        PaymentStatus.COMPLETED,
      );

      await this.paymentService.updatePaymentById(payment.id, {
        booking_confirmation_id: invoiceId,
        payment_link_disabled: true,
      });

      await customerService.updateCustomer(customer.id!, customerDataToUpdate);
      logger.info(
        `processShift4ZeroDepositCardCapture: Customer ${customer.id} card stored, no charge collected. Payment ${payment.id} marked COMPLETED.`,
      );

      const createdReservations =
        await this.createReservationsPostShift4InitalDepositPaymentSuccess(
          payment,
          reservations,
          hotel,
          undefined,
          true,
        );

      logKpi({
        stat: KpiStat.PaymentSetupSessionCompleted,
        value: 1,
        contextName:
          'RoomReservationService.processShift4ZeroDepositCardCapture',
        clientId: hotel.assistant_phone_number,
        contextId: payment.id,
      });

      this.sendZeroDepositCardCaptureConfirmationNotifications(
        reservations,
        hotel,
        createdReservations,
        hotelConfig,
      )
        .then(() => {
          logger.info(
            `Sent Shift4 zero-deposit card-capture confirmation for payment ${payment.id}`,
          );
        })
        .catch((err: Error) => {
          logger.error(
            `Failed to send Shift4 zero-deposit card-capture confirmation for payment ${payment.id}: ${err.message}`,
          );
        });
    } catch (postCaptureError) {
      logger.error(
        `processShift4ZeroDepositCardCapture: CRITICAL - Card captured but post-capture processing failed. ` +
          `PaymentId: ${payment.id}, InvoiceId: ${invoiceId}. Manual reconciliation required.`,
        postCaptureError,
      );
      throw new PaymentSucceededProcessingFailedError(
        `Card was captured but booking finalisation failed. Contact support with reference: ${invoiceId}.`,
        payment.id,
        invoiceId,
      );
    }

    return { success: true };
  }

  /**
   * Guest confirmation for zero-deposit card-capture flows (Shift4, Mews):
   * no amount was charged, so this uses the same AUTO_CHARGE_LATER template
   * Stripe's setup-session webhook uses, not the payment-success templates.
   */
  private async sendZeroDepositCardCaptureConfirmationNotifications(
    reservations: ReservationDTO[],
    hotel: Hotel,
    createdReservations: ReservationDTO[],
    hotelConfig: HotelConfiguration | null,
    paymentNote?: BookingPaymentNote,
  ): Promise<void> {
    const guestFacingBookingIds =
      getGuestFacingReservationIds(createdReservations);
    const totalAmount = reservations?.reduce(
      (acc: number, reservation: any) =>
        acc +
        (Number(reservation.quote?.base_rate ?? 0) +
          Number(reservation.quote?.taxes ?? 0) +
          Number(reservation.quote?.fees ?? 0)),
      0,
    );

    try {
      const message: BookingConfirmedMessage = {
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
        paymentNote:
          paymentNote ??
          (hotel.payment_provider === PaymentProvider.CLOUDBEDS_SDK
            ? BookingPaymentNote.CLOUDBEDS_CARD_CAPTURE
            : BookingPaymentNote.AUTO_CHARGE_LATER),
        currency: hotel.currency,
      };

      const htmlMessage = noPaymentBookingConfirmedTemplate(message);

      await this.notificationFactory
        .getChatService(hotel.notification_type)
        .sendMessage({
          recipient: hotel.telegram_alerts_group_id,
          content: {
            message: htmlMessage,
            parseMode: 'HTML',
          },
        });
      logger.info(
        `sendZeroDepositCardCaptureConfirmationNotifications: Telegram sent for booking ${reservations[0].booking_id}`,
      );
    } catch (error) {
      logger.error(
        `sendZeroDepositCardCaptureConfirmationNotifications: Error sending Telegram: ${JSON.stringify(error)}`,
      );
    }

    try {
      if (!hotel.sms_number) {
        logger.warn(
          `sendZeroDepositCardCaptureConfirmationNotifications: No SMS number configured for hotel ${hotel.id}`,
        );
        return;
      }

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

      if (!smsRecipientPhoneNumber) {
        logger.warn(
          `sendZeroDepositCardCaptureConfirmationNotifications: No valid phone number for booking ${reservations[0].booking_id}`,
        );
        return;
      }

      const smsPayload: NotificationPayload = {
        recipient: convertToPhoneNumber(smsRecipientPhoneNumber)!,
        content: {
          message: smsBody,
          from: convertToPhoneNumber(hotel.sms_number)!,
          twilioConfiguration: hotelConfig?.twilio_configuration,
        },
      };

      await this.smsService.sendMessage(smsPayload);
      logger.info(
        `sendZeroDepositCardCaptureConfirmationNotifications: SMS sent for booking ${reservations[0].booking_id}`,
      );
    } catch (error) {
      logger.error(
        `sendZeroDepositCardCaptureConfirmationNotifications: Error sending SMS: ${JSON.stringify(error)}`,
      );
    }
  }

  /**
   * Tokenizes the guest's card with OPI, creates the Calry reservation, puts
   * the token on it, then posts the deposit to the reservation's folio.
   *
   * Order matters and differs from every other provider: Opera settles against
   * a card held on a reservation, so the reservation must exist before the
   * money can move. That is also why a failure after create has to cancel —
   * an uncancelled reservation would be held without payment.
   *
   * The card details and the resulting token live in memory for this call only.
   * Opera keeps the card after attach, so nothing card-related is written to
   * our database. Never log `cardData.pan` or the token.
   */
  public async processOperaCardTokenAndCreateReservations(
    cardData: OperaCardTokenRequest,
  ) {
    logger.info(
      'processOperaCardTokenAndCreateReservations: Processing Opera card',
      { reservation_review_id: cardData.reservation_review_id },
    );

    const bookingReview =
      await this.bookingReviewRepository.findByReservationReviewId(
        cardData.reservation_review_id,
      );
    if (!bookingReview) {
      throw new NoDataError(
        `Booking review not found for reservation_review_id ${cardData.reservation_review_id}`,
      );
    }

    const reservations =
      await this.reservationRepository.findReservationsByBookingIdForHotel(
        bookingReview.booking_id,
        bookingReview.hotel_id,
      );
    if (!reservations?.length) {
      throw new NoDataError(
        `No reservations found for booking ${bookingReview.booking_id}`,
      );
    }

    const payment =
      await this.paymentReservationRepository.findPaymentByReservationIds(
        reservations.map((r) => r.id),
      );
    if (!payment) {
      throw new NoDataError(
        `Payment not found for booking review ID ${cardData.reservation_review_id}`,
      );
    }

    if (
      !validPaymentPreStatus[PaymentStatus.COMPLETED]?.includes(
        payment.payment_status,
      )
    ) {
      throw new BadRequestError(
        `Payment ${payment.id} is not in a valid state for processing: ${payment.payment_status}`,
      );
    }

    const hotel = await this.hotelService.getHotelById(bookingReview.hotel_id);
    if (!hotel) {
      throw new NoDataError(`Hotel ${bookingReview.hotel_id} not found`);
    }

    const hotelConfig =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        hotel.id,
      );

    // Must precede tokenization: once the card is exchanged and the booking
    // created, a PMS rejection leaves an orphaned reservation to unwind.
    await this.assertSameDayStillBookable(reservations, hotel, hotelConfig);

    const clientId = hotel.assistant_phone_number ?? hotel.id;
    const { operaCardPaymentMethodCode } =
      (await this.hotelConfigurationService.getExternalAuthConfigByHotelId(
        hotel.id,
      )) ?? {};
    const paymentCard = await operaCardTokenService.exchangeCard(
      hotel.id,
      {
        pan: cardData.pan,
        expiryDate: cardData.expiryDate,
        cardHolderName: cardData.card_holder_name,
      },
      clientId,
    );

    const createdReservations =
      await this.finalizePmsReservations(reservations);

    const amount = Number(payment.amount_charged);
    const currency = payment.currency || hotel.currency || 'USD';
    let postingId: string | undefined;

    try {
      for (const reservation of createdReservations) {
        if (!reservation.external_id) continue;
        await operaCardAttachService.attachCard({
          hotelId: hotel.id,
          reservationId: reservation.external_id,
          card: paymentCard,
          clientId,
        });
      }

      if (amount > 0) {
        // Each room is its own Opera reservation with its own folio, so the
        // deposit is split across them by what each room was quoted. Posting
        // the whole amount to one folio would leave every other room reading
        // as unpaid in Opera while Daisy considered the booking settled.
        const payable = createdReservations.filter((r) => r.external_id);
        if (!payable.length) {
          throw new NoDataError(
            `No Opera reservation id available to post the deposit for booking ${bookingReview.booking_id}`,
          );
        }

        const shares = this.splitDepositAcrossRooms(payable, amount);

        for (const [index, reservation] of payable.entries()) {
          const share = shares[index];
          if (share <= 0) continue;

          const id = await operaFolioService.postPayment({
            hotelId: hotel.id,
            reservationId: reservation.external_id!,
            amount: share,
            currency,
            paymentMethodCode:
              operaCardPaymentMethodCode ?? paymentCard.cardType,
            postingReference: `Dextr deposit ${payment.id.slice(0, 8)}`,
            clientId,
          });
          // The first posting id stands in for the booking on the payment.
          postingId ??= id;
        }
      }
    } catch (error) {
      // The reservation exists in Opera but is unpaid. Cancel it so a retry
      // with another card does not leave a duplicate behind.
      await this.cancelUnpaidPmsReservations(createdReservations, hotel);
      await this.paymentService.updatePaymentStatusById(
        payment.id,
        PaymentStatus.FAILED,
      );
      throw error;
    }

    try {
      await this.paymentService.updatePaymentStatusById(
        payment.id,
        PaymentStatus.COMPLETED,
      );

      await this.paymentService.updatePaymentById(payment.id, {
        ...(postingId && { booking_confirmation_id: postingId }),
        payment_link_disabled: true,
      });

      logKpi({
        stat: KpiStat.PaymentSuccess,
        value: 1,
        contextName: 'processOperaCardTokenAndCreateReservations',
        clientId,
        contextId: payment.id,
      });

      await this.updateReservationPaymentStatusFromPaymentInfo(
        reservations,
        'CREDIT',
      );

      this.sendPaymentSuccessNotifications(
        payment,
        reservations,
        hotel,
        createdReservations,
        hotelConfig,
      ).catch((err: Error) => {
        logger.error(
          `processOperaCardTokenAndCreateReservations: Failed to send notifications for payment ${payment.id}: ${err.message}`,
        );
      });

      return { success: true, ...(postingId && { postingId }) };
    } catch (postChargeError) {
      logger.error(
        `processOperaCardTokenAndCreateReservations: CRITICAL - Opera deposit posted but post-charge processing failed. ` +
          `PaymentId: ${payment.id}, OperaPostingId: ${postingId}. Manual reconciliation required.`,
        postChargeError,
      );
      throw new PaymentSucceededProcessingFailedError(
        `Payment was collected but booking finalisation failed. Contact support with reference: ${postingId ?? payment.id}.`,
        payment.id,
        postingId ?? payment.id,
      );
    }
  }

  private assertNotLimitedForFailedCardChecks(
    hotel: Hotel,
    phoneNumber: string,
    audience: 'assistant' | 'guest',
  ): void {
    if (!failedCardCheckLimiter.isPhoneBlocked(hotel.id, phoneNumber)) {
      return;
    }
    logKpi({
      stat: KpiStat.PmsCardVerificationRateLimited,
      value: 1,
      contextName: 'RoomReservationService.assertNotLimitedForFailedCardChecks',
      clientId: hotel.assistant_phone_number ?? hotel.id,
    });
    throw new BookingNotCompletedError(audience);
  }

  private async verifyCardBeforeBooking(
    card: PmsCardDetails,
    reservation: ReservationDTO,
    clientId: string,
    bookingId: string,
    reviewId: string,
  ): Promise<void> {
    const limiterKey = {
      hotelId: reservation.hotel_id,
      phoneNumber: reservation.phone_number,
      reviewId,
    };
    if (failedCardCheckLimiter.isCardSubmissionBlocked(limiterKey)) {
      logKpi({
        stat: KpiStat.PmsCardVerificationRateLimited,
        value: 1,
        contextName:
          'RoomReservationService.processResNexusCardAndCreateReservations',
        clientId,
        contextId: bookingId,
      });
      throw new BookingNotCompletedError('guest');
    }

    const outcome = await this.cardVerifier.verifyCard(
      card,
      reservation.customer,
    );
    if (outcome === 'declined') {
      failedCardCheckLimiter.recordDecline(limiterKey);
    }
    const stat = {
      approved: KpiStat.PmsCardVerificationApproved,
      declined: KpiStat.PmsCardVerificationDeclined,
      unavailable: KpiStat.PmsCardVerificationUnavailable,
    }[outcome];
    logKpi({
      stat,
      value: 1,
      contextName:
        'RoomReservationService.processResNexusCardAndCreateReservations',
      clientId,
      contextId: bookingId,
    });
    if (outcome === 'declined') {
      throw new CardVerificationError();
    }
    // The check guards against invalid cards, so our own gateway failing (e.g. revoked keys) must not block the booking.
    if (outcome === 'unavailable') {
      logger.warn(
        `verifyCardBeforeBooking: card check unavailable, booking ${bookingId} without a card check`,
      );
    }
  }

  // Dextr's Authorize.net account is optional, so without its credentials ResNexus bookings go through unchecked.
  private async maybeVerifyCard(check: {
    card: PmsCardDetails;
    reservation: ReservationDTO;
    clientId: string;
    bookingId: string;
    reviewId: string;
  }): Promise<void> {
    if (
      !config.AUTHORIZE_NET_VERIFY_API_LOGIN_ID ||
      !config.AUTHORIZE_NET_VERIFY_TRANSACTION_KEY
    ) {
      logger.warn(
        `maybeVerifyCard: Authorize.net verify credentials are not set, booking ${check.bookingId} without a card check`,
      );
      return;
    }
    await this.verifyCardBeforeBooking(
      check.card,
      check.reservation,
      check.clientId,
      check.bookingId,
      check.reviewId,
    );
  }

  /**
   * Books each pending room in ResNexus, one at a time with the same card. If
   * the first room fails nothing is booked and the guest can retry. If a later
   * room fails, the booked rooms are kept, since their deposits cannot be
   * refunded from here, and the failure is reported to the guest and staff. A
   * retry only books the rooms still pending.
   */
  public async processResNexusCardAndCreateReservations(
    submission: ResNexusCardRequest,
  ) {
    logger.info(
      'processResNexusCardAndCreateReservations: Processing ResNexus card',
      { reservation_review_id: submission.reservation_review_id },
    );

    const bookingReview =
      await this.bookingReviewRepository.findByReservationReviewId(
        submission.reservation_review_id,
      );
    if (!bookingReview) {
      throw new NoDataError(
        `Booking review not found for reservation_review_id ${submission.reservation_review_id}`,
      );
    }

    const reservations =
      await this.reservationRepository.findReservationsByBookingIdForHotel(
        bookingReview.booking_id,
        bookingReview.hotel_id,
      );
    if (!reservations?.length) {
      throw new NoDataError(
        `No reservations found for booking ${bookingReview.booking_id}`,
      );
    }

    const hotel = await this.hotelService.getHotelById(bookingReview.hotel_id);
    if (!hotel) {
      throw new NoDataError(`Hotel ${bookingReview.hotel_id} not found`);
    }

    if (hotel.payment_provider !== PaymentProvider.RESNEXUS) {
      throw new BadRequestError(
        `Hotel ${hotel.id} does not collect payment through ResNexus`,
      );
    }

    // A booking made before the hotel moved to ResNexus already has a Dextr
    // payment, so booking it here would take the deposit twice.
    if (
      reservations.some(
        (r) => r.payment_status !== ReservationPaymentStatus.EXTERNALLY_MANAGED,
      )
    ) {
      throw new BadRequestError(
        `Booking ${bookingReview.booking_id} was not created for ResNexus card payment`,
      );
    }

    // The stale sweeper cancels bookings whose card page was never
    // submitted, so a cancelled room means the link has expired.
    if (reservations.some((r) => r.status === ReservationStatus.CANCELLED)) {
      throw new BadRequestError('This booking link has expired');
    }

    // A room whose ResNexus outcome is unknown may already be booked and charged, so staff confirm it first.
    if (reservations.some((r) => r.status === ReservationStatus.FAILED)) {
      throw new PmsBookingOutcomeUnknownError();
    }

    const pending = reservations.filter(
      (r) => r.status === ReservationStatus.INACTIVE,
    );
    if (pending.length === 0) {
      throw new BadRequestError(
        `Booking ${bookingReview.booking_id} is already confirmed`,
      );
    }

    const clientId = hotel.assistant_phone_number ?? hotel.id;

    // A second submission (another tab, a network retry) must not create and
    // charge the same rooms again while this one is still booking them.
    const pendingIds = pending.map((r) => r.id);
    const claimedAt = await this.reservationRepository.claimForPmsBooking(
      pendingIds,
      pmsBookingClaimStaleBefore(),
    );
    if (!claimedAt) {
      throw new BadRequestError(
        `Booking ${bookingReview.booking_id} is already being confirmed`,
      );
    }

    const booked: ReservationDTO[] = [];
    const failedBookingIds: string[] = [];
    try {
      const hotelConfig =
        await this.hotelConfigurationService.getHotelConfigurationByHotelId(
          hotel.id,
        );

      // Checked for every room before the first create call, which cannot be
      // undone, so a sold-out second room cannot leave a half-booked stay.
      await this.assertSameDayStillBookable(pending, hotel, hotelConfig);
      const pmsService = await this.pmsServiceFactory.getReservationService(
        hotel.id,
      );
      await pmsService.validateRoomAvailability(pending);

      const expiry = parseYyMm(submission.expiryDate);
      const card: PmsCardDetails = {
        pan: submission.pan,
        cvv: submission.cvv,
        expiryMonth: expiry.month,
        expiryYear: expiry.year,
        cardHolderName: submission.card_holder_name,
      };

      await this.maybeVerifyCard({
        card,
        reservation: pending[0],
        clientId,
        bookingId: bookingReview.booking_id,
        reviewId: submission.reservation_review_id,
      });

      for (const reservation of pending) {
        logKpi({
          stat: KpiStat.PmsBookingCardSent,
          value: 1,
          contextName: 'processResNexusCardAndCreateReservations',
          clientId,
          contextId: bookingReview.booking_id,
        });
        try {
          const [created] = await this.finalizePmsReservations(
            [reservation],
            card,
          );
          booked.push(created);
        } catch (error) {
          if (error instanceof PmsBookingOutcomeUnknownError) {
            await this.holdUnconfirmedPmsBooking({
              reservation,
              hotel,
              clientId,
              bookedIds: booked.map((r) => r.booking_id.toUpperCase()),
            });
            throw error;
          }
          if (booked.length === 0) {
            // Nothing is booked yet, so the guest can retry with another card.
            await this.cancelUnpaidPmsReservations([reservation], hotel);
            logKpi({
              stat: KpiStat.PmsBookingCardRejected,
              value: 1,
              contextName: 'processResNexusCardAndCreateReservations',
              clientId,
              contextId: bookingReview.booking_id,
            });
            throw error;
          }
          logger.error(
            `processResNexusCardAndCreateReservations: Failed to book ${reservation.booking_id} after other rooms of the same booking were booked`,
            error,
          );
          failedBookingIds.push(reservation.booking_id.toUpperCase());
        }
      }
    } finally {
      await this.reservationRepository.releasePmsBookingClaim(
        pendingIds,
        claimedAt,
      );
    }

    const resNexusReservationIds = booked
      .map((r) => r.external_id)
      .filter((id): id is string => Boolean(id));

    if (failedBookingIds.length > 0) {
      logger.error(
        `processResNexusCardAndCreateReservations: CRITICAL - booking ${bookingReview.booking_id} is only partly booked in ResNexus. ` +
          `Booked: ${JSON.stringify(resNexusReservationIds)}. Failed: ${JSON.stringify(failedBookingIds)}. ` +
          'ResNexus has taken deposits for the booked rooms; follow up with the guest and the property.',
      );
      logKpi({
        stat: KpiStat.PmsBookingPartiallyCreated,
        value: failedBookingIds.length,
        contextName: 'processResNexusCardAndCreateReservations',
        clientId,
        contextId: bookingReview.booking_id,
      });
    }

    const twilioConfiguration =
      await this.hotelConfigurationService.getTwilioConfigurationByHotelId(
        hotel.id,
      );
    const bookedOriginals = pending.filter((r) =>
      booked.some((b) => b.id === r.id),
    );
    void this.sendNoPaymentConfirmationSMS(
      booked,
      bookedOriginals,
      hotel,
      twilioConfiguration,
      failedBookingIds.length,
    );
    void this.sendNoPaymentBookingTelegramNotification(
      booked,
      bookedOriginals,
      hotel,
      failedBookingIds,
    );

    return {
      success: true,
      resnexus_reservation_ids: resNexusReservationIds,
      ...(failedBookingIds.length > 0 && {
        failed_booking_ids: failedBookingIds,
      }),
    };
  }

  /**
   * Splits a single collected amount across the rooms of a booking, in
   * proportion to what each room was quoted.
   *
   * Rounding is absorbed by the last room so the shares always sum to exactly
   * the amount charged — a folio total that disagrees with the payment by a
   * cent is a reconciliation problem. Rooms with no quote fall back to an even
   * split.
   */
  private splitDepositAcrossRooms(
    reservations: ReservationDTO[],
    amount: number,
  ): number[] {
    const quoted = reservations.map((r) =>
      Number(r.quote?.amount_charged ?? 0),
    );
    const total = quoted.reduce((sum, value) => sum + value, 0);

    const shares =
      total > 0
        ? quoted.map((value) => roundCurrency((amount * value) / total))
        : reservations.map(() => roundCurrency(amount / reservations.length));

    const distributed = shares
      .slice(0, -1)
      .reduce((sum, value) => sum + value, 0);
    shares[shares.length - 1] = roundCurrency(amount - distributed);

    return shares;
  }

  /**
   * Cancels reservations that were created in the PMS but whose card could not
   * be attached or charged. Best-effort: a cancellation failure must not mask
   * the payment error that triggered it.
   */
  private async cancelUnpaidPmsReservations(
    reservations: ReservationDTO[],
    hotel: Hotel,
  ): Promise<void> {
    const pmsService = await this.pmsServiceFactory.getReservationService(
      hotel.id,
    );

    for (const reservation of reservations) {
      if (!reservation.external_id) continue;
      try {
        await pmsService.cancelReservation({
          business_id: hotel.business_id,
          external_id: reservation.external_id,
          internal_id: reservation.id,
          reason: 'Payment failed',
        });
      } catch (error) {
        logger.error(
          `cancelUnpaidPmsReservations: Failed to cancel unpaid reservation ${reservation.external_id}. Manual cleanup required.`,
          error,
        );
      }
    }
  }

  // FAILED keeps the room out of booking claims, retries and the stale sweep until staff check ResNexus.
  private async holdUnconfirmedPmsBooking(hold: {
    reservation: ReservationDTO;
    hotel: Hotel;
    clientId: string;
    bookedIds: string[];
  }): Promise<void> {
    const { reservation, hotel, clientId, bookedIds } = hold;
    const bookingId = reservation.booking_id.toUpperCase();
    await this.reservationRepository.updateStatus(
      reservation.id,
      ReservationStatus.FAILED,
      reservation.status,
    );
    logger.error(
      `holdUnconfirmedPmsBooking: CRITICAL - ResNexus did not answer when booking ${bookingId}, so it may be booked and charged. ` +
        `Rooms already booked: ${JSON.stringify(bookedIds)}. Check ResNexus and confirm with the guest.`,
    );
    logKpi({
      stat: KpiStat.PmsBookingOutcomeUnknown,
      value: 1,
      contextName: 'processResNexusCardAndCreateReservations',
      clientId,
      contextId: reservation.booking_id,
    });
    if (!hotel.telegram_alerts_group_id) return;

    const guest =
      `${reservation.customer?.first_name ?? ''} ${reservation.customer?.last_name ?? ''}`.trim();
    await this.notificationFactory
      .getChatService(hotel.notification_type)
      .sendMessage({
        recipient: hotel.telegram_alerts_group_id,
        content: {
          message:
            `⚠️ Booking ${bookingId} for ${guest || 'a guest'} (${reservation.phone_number}), ` +
            `${dayjs(reservation.check_in).format('YYYY-MM-DD')} to ${dayjs(reservation.check_out).format('YYYY-MM-DD')}: ` +
            'ResNexus did not answer when we booked this room, so it may be booked and the deposit taken. ' +
            'Please check ResNexus and confirm with the guest, who has been asked not to submit their card again.' +
            (bookedIds.length
              ? ` Rooms already booked: ${bookedIds.join(', ')}.`
              : ''),
        },
      })
      .catch((error: unknown) =>
        logger.error(
          `holdUnconfirmedPmsBooking: Error sending Telegram for ${bookingId}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  }

  public async processMewsPaymentAndCreateReservations(
    cardTokenData: MewsCardTokenRequest,
  ) {
    try {
      logger.info(
        'processMewsPaymentAndCreateReservations: Processing Mews card token and payment',
        { reservation_review_id: cardTokenData.reservation_review_id },
      );

      const bookingReview =
        await this.bookingReviewRepository.findByReservationReviewId(
          cardTokenData.reservation_review_id,
        );
      if (!bookingReview) {
        throw new NoDataError(
          `Booking review not found for reservation_review_id ${cardTokenData.reservation_review_id}`,
        );
      }

      const reservations =
        await this.reservationRepository.findReservationsByBookingIdForHotel(
          bookingReview.booking_id,
          bookingReview.hotel_id,
        );
      if (!reservations?.length) {
        throw new NoDataError(
          `No reservations found for booking ${bookingReview.booking_id}`,
        );
      }

      const payment =
        await this.paymentReservationRepository.findPaymentByReservationIds(
          reservations.map((r) => r.id),
        );
      if (!payment) {
        throw new NoDataError(
          `Payment not found for booking review ID ${cardTokenData.reservation_review_id}`,
        );
      }

      if (
        !validPaymentPreStatus[PaymentStatus.COMPLETED]?.includes(
          payment.payment_status,
        )
      ) {
        throw new BadRequestError(
          `Payment ${payment.id} is not in a valid state for processing: ${payment.payment_status}`,
        );
      }

      const customer = reservations[0]?.customer;
      if (!customer || !customer.id) {
        throw new NoDataError(
          `Customer not found for reservations in booking ${bookingReview.booking_id}`,
        );
      }

      const hotel = await this.hotelService.getHotelById(
        bookingReview.hotel_id,
      );
      if (!hotel) {
        throw new NoDataError(`Hotel ${bookingReview.hotel_id} not found`);
      }

      const hotelConfig =
        await this.hotelConfigurationService.getHotelConfigurationByHotelId(
          hotel.id,
        );

      // Both guards must precede every capture path below. Once the card is
      // captured a PMS rejection leaves an orphaned payment needing manual
      // reconciliation.
      await this.assertSameDayStillBookable(reservations, hotel, hotelConfig);
      const mewsPmsService = await this.pmsServiceFactory.getReservationService(
        bookingReview.hotel_id,
      );
      if (mewsPmsService instanceof MewsReservationService) {
        // Covers hotels with no same_day_booking_configuration, for which the
        // cutoff guard above is a no-op.
        await mewsPmsService.assertReservationStartsInFuture(reservations);
      }

      const currency = payment.currency || hotel.currency || 'USD';
      const amount = Number(payment.amount_charged);

      // Zero-deposit: tokenize and store the card, skip the charge entirely.
      if (amount === 0) {
        return this.processMewsZeroDepositCardCapture(
          payment,
          reservations,
          customer,
          hotel,
          hotelConfig,
          cardTokenData,
        );
      }

      // Charge card via Mews
      const { paymentId, mewsAccountId, creditCardId } =
        await mewsPaymentProviderService.processCardPayment({
          hotelPhoneNumber: hotel.assistant_phone_number,
          customer: {
            firstName: customer.first_name ?? '',
            lastName: customer.last_name ?? '',
            email: customer.email ?? undefined,
            phone: customer.phone_number ?? undefined,
            country: hotel.country,
          },
          transactionId: cardTokenData.transactionId,
          expiration: cardTokenData.expiration,
          amount,
          currency,
        });

      logger.info(
        `processMewsPaymentAndCreateReservations: Payment succeeded for payment ${payment.id}`,
        { paymentId, mewsAccountId },
      );

      try {
        await this.paymentService.updatePaymentStatusById(
          payment.id,
          PaymentStatus.COMPLETED,
        );

        await this.paymentService.updatePaymentById(payment.id, {
          booking_confirmation_id: paymentId,
          payment_link_disabled: true,
          metadata: {
            ...(payment.metadata as PaymentCreationMetadata),
            mews_account_id: mewsAccountId,
            mews_credit_card_id: creditCardId,
          },
        });

        // Store the card token on the customer, consistent with how Shift4 stores its card_metadata.
        // Persist the Mews account id too so auto-charge refunds can resolve it without an API lookup.
        await customerService.updateCustomer(customer.id, {
          card_metadata: {
            token: creditCardId,
            mews_account_id: mewsAccountId,
          },
        });

        logger.info(
          `processMewsPaymentAndCreateReservations: Payment ${payment.id} marked COMPLETED. Mews PaymentId: ${paymentId}`,
        );

        logKpi({
          stat: KpiStat.PaymentSuccess,
          value: 1,
          contextName: 'processMewsPaymentAndCreateReservations',
          clientId: hotel.assistant_phone_number ?? hotel.id,
          contextId: payment.id,
        });

        await this.updateReservationPaymentStatusFromPaymentInfo(
          reservations,
          'CREDIT',
        );

        // Propagate mews_account_id and mews_credit_card_id to in-memory reservations so createReservation can read them
        for (const reservation of reservations) {
          if (reservation.payments) {
            const p = reservation.payments.find((pm) => pm.id === payment.id);
            if (p) {
              p.metadata = {
                ...(p.metadata ?? {}),
                mews_account_id: mewsAccountId,
                mews_credit_card_id: creditCardId,
              };
              p.booking_confirmation_id = paymentId;
            }
          }
        }

        const createdReservations =
          await this.finalizePmsReservations(reservations);

        this.sendPaymentSuccessNotifications(
          payment,
          reservations,
          hotel,
          createdReservations,
          hotelConfig,
        )
          .then(() => {
            logger.info(
              `processMewsPaymentAndCreateReservations: Notifications sent for payment ${payment.id}`,
            );
          })
          .catch((err: Error) => {
            logger.error(
              `processMewsPaymentAndCreateReservations: Failed to send notifications for payment ${payment.id}: ${err.message}`,
            );
          });

        return { paymentId };
      } catch (postChargeError) {
        logger.error(
          `processMewsPaymentAndCreateReservations: CRITICAL - Mews charge succeeded but post-charge processing failed. ` +
            `PaymentId: ${payment.id}, MewsPaymentId: ${paymentId}. Manual reconciliation required.`,
          postChargeError,
        );
        throw new PaymentSucceededProcessingFailedError(
          `Payment was collected but booking finalisation failed. Contact support with reference: ${paymentId}.`,
          payment.id,
          paymentId,
        );
      }
    } catch (error) {
      logger.error(
        'processMewsPaymentAndCreateReservations: Error processing Mews card token and payment',
        { error, mewsRequestId: getMewsRequestId(error) },
      );
      throw error;
    }
  }

  /**
   * Books each pending room in Cloudbeds and attaches the guest's card to it.
   * Dextr charges nothing: the hotel takes the deposit and balance in
   * Cloudbeds. Room 1 uses the Payment Element token; later rooms reuse the
   * stored card Cloudbeds returns for room 1. If room 1 fails it is cancelled
   * so the guest can retry. If a later room fails, the booked rooms are kept
   * and the failure is reported. A retry only books the rooms still pending.
   */
  public async processCloudbedsPaymentAndCreateReservations(
    cardTokenData: CloudbedsCardTokenRequest,
  ) {
    const logPrefix = 'processCloudbedsPaymentAndCreateReservations';
    logger.info(`${logPrefix}: Processing Cloudbeds SDK card token`, {
      reservation_review_id: cardTokenData.reservation_review_id,
    });

    const bookingReview =
      await this.bookingReviewRepository.findByReservationReviewId(
        cardTokenData.reservation_review_id,
      );
    if (!bookingReview) {
      throw new NoDataError(
        `Booking review not found for reservation_review_id ${cardTokenData.reservation_review_id}`,
      );
    }

    const reservations =
      await this.reservationRepository.findReservationsByBookingIdForHotel(
        bookingReview.booking_id,
        bookingReview.hotel_id,
      );
    if (!reservations?.length) {
      throw new NoDataError(
        `No reservations found for booking ${bookingReview.booking_id}`,
      );
    }

    const hotel = await this.hotelService.getHotelById(bookingReview.hotel_id);
    if (!hotel) {
      throw new NoDataError(`Hotel ${bookingReview.hotel_id} not found`);
    }
    if (hotel.payment_provider !== PaymentProvider.CLOUDBEDS_SDK) {
      throw new BadRequestError(
        `Hotel ${hotel.id} does not collect cards through the Cloudbeds SDK`,
      );
    }

    // A booking created before this flow has a Dextr payment and still
    // expects it to be completed, which this flow never does.
    if (
      reservations.some(
        (r) => r.payment_status !== ReservationPaymentStatus.NOT_APPLICABLE,
      )
    ) {
      throw new BadRequestError('This booking link has expired');
    }
    if (reservations.some((r) => r.status === ReservationStatus.CANCELLED)) {
      throw new BadRequestError('This booking link has expired');
    }

    const pending = reservations.filter(
      (r) => r.status === ReservationStatus.INACTIVE,
    );
    if (pending.length === 0) {
      throw new BadRequestError(
        `Booking ${bookingReview.booking_id} is already confirmed`,
      );
    }

    const hotelConfig =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        hotel.id,
      );
    await this.assertSameDayStillBookable(pending, hotel, hotelConfig);

    // A second submission (another tab, a network retry) must not book the
    // same rooms in Cloudbeds again while this one is still booking them. A
    // claim older than 5 minutes belongs to a request that crashed.
    const pendingIds = pending.map((r) => r.id!);
    let claimedAt = await this.reservationRepository.claimForPmsBooking(
      pendingIds,
      dayjs().subtract(5, 'minute').toDate(),
    );
    if (!claimedAt) {
      throw new BadRequestError(
        `Booking ${bookingReview.booking_id} is already being confirmed`,
      );
    }

    const clientId = hotel.assistant_phone_number ?? hotel.id;
    const booked: ReservationDTO[] = [];
    const failedBookingIds: string[] = [];
    let paymentMethodId: string | null = cardTokenData.paymentMethodId;
    let redirectUrl: string | null = null;

    try {
      for (const reservation of pending) {
        // Slow Cloudbeds calls can outlast the claim, so renew it before each
        // later room and stop if another submission has taken it over.
        if (booked.length > 0) {
          const renewedAt =
            await this.reservationRepository.renewPmsBookingClaim(
              pendingIds,
              claimedAt,
            );
          if (!renewedAt) {
            logger.error(
              `${logPrefix}: Lost the claim on booking ${bookingReview.booking_id} to another submission; leaving the remaining rooms to it`,
            );
            break;
          }
          claimedAt = renewedAt;
        }
        let created: ReservationDTO;
        try {
          [created] = await this.finalizePmsReservations([reservation]);
        } catch (error) {
          if (booked.length === 0) throw error;
          logger.error(
            `${logPrefix}: Failed to book ${reservation.booking_id} after other rooms of the same booking were booked`,
            error,
          );
          failedBookingIds.push(reservation.booking_id.toUpperCase());
          continue;
        }
        booked.push(created);

        if (!created.external_id) {
          logger.error(
            `${logPrefix}: CRITICAL - Cloudbeds returned no reservation id for ${created.booking_id}; the card was not attached`,
          );
          continue;
        }
        if (!paymentMethodId) {
          logger.warn(
            `${logPrefix}: No stored card to attach to ${created.booking_id}; the card is on the first room`,
          );
          continue;
        }
        try {
          const result = await this.attachCloudbedsCard(
            hotel.id,
            created.external_id,
            paymentMethodId,
            booked.length > 1,
          );
          if (booked.length === 1) {
            paymentMethodId = result.storedPaymentMethodId;
            redirectUrl = result.redirectUrl;
          }
        } catch (error) {
          if (booked.length === 1) {
            await this.undoCloudbedsBooking(created, hotel);
            logKpi({
              stat: KpiStat.PaymentFailed,
              value: 1,
              contextName: logPrefix,
              clientId,
              contextId: bookingReview.booking_id,
            });
            throw error;
          }
          logger.error(
            `${logPrefix}: Booked ${created.booking_id} but could not attach the card to it; the card is on the first room`,
            error,
          );
        }
      }
    } finally {
      await this.reservationRepository.releasePmsBookingClaim(
        pendingIds,
        claimedAt,
      );
    }

    if (failedBookingIds.length > 0) {
      logger.error(
        `${logPrefix}: CRITICAL - booking ${bookingReview.booking_id} is only partly booked in Cloudbeds. ` +
          `Failed: ${JSON.stringify(failedBookingIds)}. Follow up with the guest and the property.`,
      );
      logKpi({
        stat: KpiStat.PmsBookingPartiallyCreated,
        value: failedBookingIds.length,
        contextName: logPrefix,
        clientId,
        contextId: bookingReview.booking_id,
      });
    }

    // Hotels that take full payment at booking are charged now; otherwise the
    // card stays on the reservation for the hotel to charge.
    let chargedAtBooking = false;
    let chargeNeedsCheck = false;
    if (
      hotelConfig?.payment_configuration?.charge_at_booking === true &&
      booked.length > 0 &&
      !redirectUrl
    ) {
      const charge = await this.chargeCloudbedsRoomsAtBooking(
        booked,
        pending,
        hotel,
        [
          ...new Set(
            [cardTokenData.paymentMethodId, paymentMethodId].filter(
              (id): id is string => Boolean(id),
            ),
          ),
        ],
        bookingReview.booking_id,
        clientId,
      );
      redirectUrl = charge.redirectUrl;
      chargedAtBooking = charge.charged;
      chargeNeedsCheck = charge.needsCheck;
    }

    const bookedOriginals = pending.filter((r) =>
      booked.some((b) => b.id === r.id),
    );
    this.sendZeroDepositCardCaptureConfirmationNotifications(
      bookedOriginals,
      hotel,
      booked,
      hotelConfig,
      chargeNeedsCheck
        ? BookingPaymentNote.CLOUDBEDS_CHARGE_NEEDS_CHECK
        : chargedAtBooking && !redirectUrl
          ? BookingPaymentNote.CLOUDBEDS_CHARGED_AT_BOOKING
          : undefined,
    ).catch((err: Error) => {
      logger.error(
        `${logPrefix}: Failed to send card-capture notifications for booking ${bookingReview.booking_id}: ${err.message}`,
      );
    });

    return {
      success: true,
      cloudbeds_reservation_ids: booked
        .map((r) => r.external_id)
        .filter((id): id is string => Boolean(id)),
      ...(failedBookingIds.length > 0 && {
        failed_booking_ids: failedBookingIds,
      }),
      ...(redirectUrl && { redirect_url: redirectUrl }),
    };
  }

  /**
   * Attaches a card to a Cloudbeds reservation. A stored card id only
   * resolves a few seconds after Cloudbeds stores it, so reuse of the first
   * room's card is retried briefly.
   */
  private async attachCloudbedsCard(
    hotelId: string,
    cloudbedsReservationId: string,
    paymentMethodId: string,
    isStoredCard: boolean,
  ) {
    const attempts = isStoredCard ? 3 : 1;
    for (let attempt = 1; ; attempt++) {
      try {
        return await cloudbedsSdkPaymentProviderService.processCardPayment({
          hotelId,
          cloudbedsReservationId,
          paymentMethodId,
          returnUrl: `${config.SECURE_URL}/booking/success`,
        });
      } catch (error) {
        if (attempt >= attempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  /** How long a card Cloudbeds just stored needs before it can be charged. Tests set 0. */
  static cloudbedsStoredCardSettleMs = 3000;

  /**
   * Charges each room what the review page showed as due now (the deposit
   * policy's `amount_charged`, capped by the Cloudbeds balance) to the card
   * just attached (`payment_configuration.charge_at_booking`). A room with
   * nothing due now keeps the card on file only.
   * - Cloudbeds refuses room 1's charge (`failed`/`canceled`, or a 4xx /
   *   `success: false` answer, so no money moved): every room booked here is
   *   cancelled and made pending again so the guest can retry another card.
   * - The outcome is unknown (timeout, 5xx, no usable balance): the booking is
   *   kept, since Cloudbeds may have taken the money, and the team is told to
   *   check the payment.
   * - A room refused after an earlier room was charged or had an unknown
   *   outcome, or rooms left uncharged behind a 3DS page: the booking is kept
   *   and the team is told to check the payment.
   */
  private async chargeCloudbedsRoomsAtBooking(
    booked: ReservationDTO[],
    originals: ReservationDTO[],
    hotel: Hotel,
    paymentMethodIds: string[],
    bookingId: string,
    clientId: string,
  ): Promise<{
    redirectUrl: string | null;
    charged: boolean;
    needsCheck: boolean;
  }> {
    const logPrefix = 'chargeCloudbedsRoomsAtBooking';
    const rooms = booked.filter((room) => room.external_id);
    // What the review page showed as due now: the hotel's deposit policy.
    const dueNow = new Map(
      originals.map((room) => [
        room.id,
        {
          advance: Number(room.quote?.amount_charged ?? 0),
          total: getReservationTotalAmount(room),
        },
      ]),
    );
    let charged = 0;
    let needsCheck = false;
    // The card Cloudbeds stored a moment ago only resolves after a few seconds.
    await new Promise((resolve) =>
      setTimeout(resolve, RoomReservationService.cloudbedsStoredCardSettleMs),
    );
    for (const [index, room] of rooms.entries()) {
      const due = dueNow.get(room.id);
      if (!due || !(due.advance > 0)) {
        logger.info(
          `${logPrefix}: Nothing is due now for ${room.booking_id} under the deposit policy; the card stays on file`,
        );
        continue;
      }
      // A full payment may differ from Cloudbeds' total by rounding; let it
      // settle the folio, but never charge more than a few cents above it.
      const isFullPayment = due.advance >= due.total - 0.005;
      const maxAmount = isFullPayment
        ? due.advance + CLOUDBEDS_FULL_PAYMENT_ROUNDING
        : due.advance;
      const outcome = await this.chargeCloudbedsRoomBalance(
        hotel.id,
        room,
        paymentMethodIds,
        maxAmount,
      );
      if (outcome.kind === 'refused') {
        logKpi({
          stat: KpiStat.PaymentFailed,
          value: 1,
          contextName: logPrefix,
          clientId,
          contextId: bookingId,
        });
        if (charged === 0 && !needsCheck) {
          logger.warn(
            `${logPrefix}: Cloudbeds refused the charge for ${room.booking_id}; cancelling booking ${bookingId} so the guest can retry`,
            outcome.error,
          );
          for (const bookedRoom of booked) {
            await this.undoCloudbedsBooking(bookedRoom, hotel);
          }
          throw new BadRequestError(
            'Your card could not be charged. Please try another card.',
          );
        }
        logger.error(
          `${logPrefix}: CRITICAL - ${room.booking_id} (Cloudbeds ${room.external_id}) is booked but Cloudbeds refused its charge; other rooms of booking ${bookingId} may have been charged. Check the folio and charge it in Cloudbeds.`,
          outcome.error,
        );
        needsCheck = true;
        continue;
      }
      if (outcome.kind === 'unknown') {
        logger.error(
          `${logPrefix}: CRITICAL - charge for ${room.booking_id} (Cloudbeds ${room.external_id}) has an unknown outcome; keeping booking ${bookingId}. Check the folio in Cloudbeds before charging again.`,
          outcome.error,
        );
        needsCheck = true;
        continue;
      }
      const { result } = outcome;
      if (result.redirectUrl) {
        const uncharged = rooms.slice(index + 1);
        if (uncharged.length > 0) {
          logger.error(
            `${logPrefix}: CRITICAL - ${room.booking_id} needs 3DS; ${uncharged
              .map((r) => `${r.booking_id} (Cloudbeds ${r.external_id})`)
              .join(
                ', ',
              )} of booking ${bookingId} were not charged. Charge them in Cloudbeds.`,
          );
          needsCheck = true;
        } else {
          logger.info(
            `${logPrefix}: Charge for ${room.booking_id} needs 3DS; sending the guest to finish it`,
          );
        }
        return {
          redirectUrl: result.redirectUrl,
          charged: charged > 0,
          needsCheck,
        };
      }
      charged += 1;
      if (result.status === 'successful') {
        logKpi({
          stat: KpiStat.PaymentSuccess,
          value: 1,
          contextName: logPrefix,
          clientId,
          contextId: room.booking_id,
        });
      } else if (result.status !== 'nothing_due') {
        logger.warn(
          `${logPrefix}: Charge for ${room.booking_id} is ${result.status}; check it in Cloudbeds`,
        );
        needsCheck = true;
      }
    }
    return { redirectUrl: null, charged: charged > 0, needsCheck };
  }

  /**
   * One room's charge, sorted by whether money can have moved. It is tried
   * with the card id from the payment form, then with the id Cloudbeds
   * returned when it stored the card, moving on only after a clear refusal
   * (no money moved). A timeout or 5xx is never retried.
   */
  private async chargeCloudbedsRoomBalance(
    hotelId: string,
    room: ReservationDTO,
    paymentMethodIds: string[],
    maxAmount: number,
  ): Promise<
    | { kind: 'charged'; result: CloudbedsBalanceCharge }
    | { kind: 'refused'; error: unknown }
    | { kind: 'unknown'; error: unknown }
  > {
    let lastRefusal: unknown = null;
    for (const paymentMethodId of paymentMethodIds) {
      try {
        const result =
          await cloudbedsSdkPaymentProviderService.chargeReservationBalance({
            hotelId,
            cloudbedsReservationId: room.external_id!,
            paymentMethodId,
            description: `Booking ${room.booking_id.toUpperCase()}`,
            returnUrl: `${config.SECURE_URL}/booking/success`,
            maxAmount,
          });
        if (result.status === 'failed' || result.status === 'canceled') {
          lastRefusal = result.status;
          continue;
        }
        return { kind: 'charged', result };
      } catch (error) {
        const refusedByCloudbeds =
          error instanceof CloudbedsAPIError && error.statusCode < 500;
        if (!refusedByCloudbeds) return { kind: 'unknown', error };
        lastRefusal = error;
      }
    }
    return { kind: 'refused', error: lastRefusal };
  }

  /** Cancels a just-created Cloudbeds room and makes it pending again, so the guest can retry. */
  private async undoCloudbedsBooking(
    reservation: ReservationDTO,
    hotel: Hotel,
  ): Promise<void> {
    try {
      const pmsService = await this.pmsServiceFactory.getReservationService(
        hotel.id,
      );
      await pmsService.cancelReservation({
        business_id: hotel.business_id,
        external_id: reservation.external_id,
        internal_id: reservation.booking_id,
        reason: 'Card could not be attached',
      });
      await this.reservationRepository.update(reservation.id!, {
        status: ReservationStatus.INACTIVE,
      });
    } catch (error) {
      logger.error(
        `undoCloudbedsBooking: CRITICAL - ${reservation.booking_id} is booked in Cloudbeds (${reservation.external_id}) without a card and could not be cancelled`,
        error,
      );
    }
  }

  /**
   * Zero-deposit: tokenize and store the card on the customer, skip the
   * charge entirely. The first real charge is deferred to the Mews
   * auto-charge executor, which reads the stored card token off the
   * customer record. Mirrors processShift4ZeroDepositCardCapture.
   */
  private async processMewsZeroDepositCardCapture(
    payment: Payment,
    reservations: ReservationDTO[],
    customer: Customer,
    hotel: Hotel,
    hotelConfig: HotelConfiguration | null,
    cardTokenData: MewsCardTokenRequest,
  ): Promise<{ success: true }> {
    try {
      const { mewsAccountId, creditCardId } =
        await mewsPaymentProviderService.captureCardWithoutCharge({
          hotelPhoneNumber: hotel.assistant_phone_number,
          customer: {
            firstName: customer.first_name ?? '',
            lastName: customer.last_name ?? '',
            email: customer.email ?? undefined,
            phone: customer.phone_number ?? undefined,
            country: hotel.country,
          },
          transactionId: cardTokenData.transactionId,
          expiration: cardTokenData.expiration,
        });

      await this.paymentService.updatePaymentStatusById(
        payment.id,
        PaymentStatus.COMPLETED,
      );

      await this.paymentService.updatePaymentById(payment.id, {
        payment_link_disabled: true,
        metadata: {
          ...(payment.metadata as PaymentCreationMetadata),
          mews_account_id: mewsAccountId,
          mews_credit_card_id: creditCardId,
        },
      });

      // Store the card token on the customer, consistent with how Shift4 stores its card_metadata.
      await customerService.updateCustomer(customer.id!, {
        card_metadata: {
          token: creditCardId,
          mews_account_id: mewsAccountId,
        },
      });

      logger.info(
        `processMewsZeroDepositCardCapture: Customer ${customer.id} card stored, no charge collected. Payment ${payment.id} marked COMPLETED.`,
      );

      await this.updateReservationPaymentStatusFromPaymentInfo(
        reservations,
        'CREDIT',
      );

      // Propagate mews_account_id and mews_credit_card_id to in-memory reservations so createReservation can read them
      for (const reservation of reservations) {
        if (reservation.payments) {
          const p = reservation.payments.find((pm) => pm.id === payment.id);
          if (p) {
            p.metadata = {
              ...(p.metadata ?? {}),
              mews_account_id: mewsAccountId,
              mews_credit_card_id: creditCardId,
            };
          }
        }
      }

      const createdReservations =
        await this.finalizePmsReservations(reservations);

      logKpi({
        stat: KpiStat.PaymentSetupSessionCompleted,
        value: 1,
        contextName: 'RoomReservationService.processMewsZeroDepositCardCapture',
        clientId: hotel.assistant_phone_number,
        contextId: payment.id,
      });

      this.sendZeroDepositCardCaptureConfirmationNotifications(
        reservations,
        hotel,
        createdReservations,
        hotelConfig,
      )
        .then(() => {
          logger.info(
            `Sent Mews zero-deposit card-capture confirmation for payment ${payment.id}`,
          );
        })
        .catch((err: Error) => {
          logger.error(
            `Failed to send Mews zero-deposit card-capture confirmation for payment ${payment.id}: ${err.message}`,
          );
        });

      return { success: true };
    } catch (postCaptureError) {
      logger.error(
        `processMewsZeroDepositCardCapture: CRITICAL - Card captured but post-capture processing failed. ` +
          `PaymentId: ${payment.id}. Manual reconciliation required.`,
        postCaptureError,
      );
      throw new PaymentSucceededProcessingFailedError(
        `Card was captured but booking finalisation failed. Contact support with reference: ${payment.id}.`,
        payment.id,
        payment.id,
      );
    }
  }

  /**
   * Send SMS notification to guest after successful auto-charge
   */
  private async sendAutoChargeGuestSMS(
    reservation: ReservationDTO,
    hotel: Hotel,
    hotelConfig: HotelConfiguration | null,
    chargeAmount: number,
    chargeDescription: string,
  ): Promise<void> {
    try {
      if (!hotel.sms_number) {
        logger.warn(
          `sendAutoChargeGuestSMS: Missing SMS number for reservation ${reservation.id}`,
        );
        return;
      }

      const toPhone = await resolveSmsTargetPhoneNumber(
        reservation.customer.phone_number,
        reservation.phone_number,
        hotelConfig?.twilio_configuration,
        hotel.country,
        false,
      );
      if (!toPhone) {
        logger.warn(
          `sendAutoChargeGuestSMS: No valid phone number for reservation ${reservation.id}`,
        );
        return;
      }

      const guestMessage = guestChargedSMSTemplate(
        reservation.customer.first_name || 'Guest',
        hotel.name,
        chargeAmount,
        hotel.currency,
        hotel.assistant_phone_number || hotel.sms_number,
        hotel.country as any,
        chargeDescription,
        hotelConfig?.sms_agent_enabled ?? false,
      );

      const smsContent: NotificationSMSContent = {
        message: guestMessage,
        from: hotel.sms_number,
        twilioConfiguration: hotelConfig?.twilio_configuration,
      };

      const smsPayload: NotificationPayload = {
        recipient: toPhone,
        content: smsContent,
      };

      const smsResult = await this.smsService.sendMessage(smsPayload);
      if (smsResult) {
        smsEvents.emitSmsSent({
          sessionId: reservation.session_id,
          message: smsContent.message,
          from: hotel.sms_number,
          to: toPhone,
          callerPhoneNumber: reservation.phone_number,
          assistantPhoneNumber: hotel.assistant_phone_number,
          timestamp: new Date(),
          hotelSmsNumber: hotel.sms_number,
          smsAgentEnabled: hotelConfig?.sms_agent_enabled || false,
          hotelId: hotel.id,
        });
        logger.info(
          `sendAutoChargeGuestSMS: SMS sent successfully for reservation ${reservation.id}`,
        );
      }
    } catch (error) {
      logger.error(
        `sendAutoChargeGuestSMS: Failed to send SMS for reservation ${reservation.id}: ${error}`,
      );
    }
  }

  /**
   * Handle Shift4 payment failure: update payment status to FAILED and send notification
   */
  private async handleShift4PaymentFailure(
    payment: Payment,
    reservations: ReservationDTO[],
    hotel: Hotel,
    saleResponseData: Shift4SaleTransactionResult,
  ): Promise<void> {
    try {
      // Update payment status to FAILED
      await this.paymentService.updatePaymentStatusById(
        payment.id,
        PaymentStatus.FAILED,
      );

      logger.warn(
        `handleShift4PaymentFailure: Payment ${payment.id} marked as FAILED. Response code: ${saleResponseData?.transaction?.responseCode}`,
      );

      // Send Telegram notification about failed payment
      try {
        const totalAmount = reservations?.reduce(
          (acc: number, reservation: any) =>
            acc +
            (Number(reservation.quote?.base_rate ?? 0) +
              Number(reservation.quote?.taxes ?? 0) +
              Number(reservation.quote?.fees ?? 0)),
          0,
        );

        const message: PaymentStatusMessage = {
          status: PaymentStatus.FAILED,
          phoneNumber: reservations[0].phone_number,
          amount: Number(payment.amount_charged),
          bookingId: null,
          guestFirstName: reservations[0].customer.first_name || '',
          guestLastName: reservations[0].customer.last_name || '',
          startDate: reservations[0].check_in,
          endDate: reservations[0].check_out,
          currency: hotel.currency,
          totalAmount,
          sessionType: reservations[0].type,
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
          `handleShift4PaymentFailure: Telegram notification sent for payment ${payment.id}`,
        );
      } catch (error) {
        logger.error(
          `handleShift4PaymentFailure: Error sending Telegram notification: ${JSON.stringify(error)}`,
        );
      }
    } catch (error) {
      logger.error(`handleShift4PaymentFailure failed`, error);
      throw error;
    }
  }

  /**
   * Build Shift4 sale transaction request for advance deposit
   */
  private buildShift4AdvanceDepositRequest(
    payment: Payment,
    reservations: ReservationDTO[],
    customer: Customer,
    cardTokenData: Shift4CardTokenRequest,
    hotel: Hotel,
    hotelConfig: HotelConfiguration | null,
    invoiceId: string,
  ): Shift4SaleTransactionRequest {
    const primaryReservation = reservations[0];
    const hotelTimezone = hotel.timezone;
    const checkInCheckOutTimes = hotelConfig?.check_in_check_out_configuration;
    const checkInTime = checkInCheckOutTimes?.check_in || '15:00';
    const checkOutTime = checkInCheckOutTimes?.check_out || '11:00';

    // Format arrival and departure date times
    const arrivalDateTime = dayjs
      .tz(primaryReservation.check_in, hotelTimezone)
      .hour(parseInt(checkInTime.split(':')[0]))
      .minute(parseInt(checkInTime.split(':')[1]))
      .format('YYYY-MM-DDTHH:mm:ss.SSSZ');

    const departureDateTime = dayjs
      .tz(primaryReservation.check_out, hotelTimezone)
      .hour(parseInt(checkOutTime.split(':')[0]))
      .minute(parseInt(checkOutTime.split(':')[1]))
      .format('YYYY-MM-DDTHH:mm:ss.SSSZ');

    // Calculate room rates
    const roomRates = reservations.map((res) => {
      const checkInDate = dayjs(res.check_in);
      const checkOutDate = dayjs(res.check_out);
      const nights = checkOutDate.diff(checkInDate, 'day');
      const reservationAmount = res.quote?.total_amount || 0;
      const perNightRate = reservationAmount / nights;

      return {
        nights,
        rate: roundCurrency(perNightRate),
      };
    });

    // Calculate total tax
    const totalTax = reservations.reduce(
      (sum, res) => sum + (res.quote?.taxes || 0),
      0,
    );

    return {
      dateTime: dayjs().tz(hotelTimezone).format('YYYY-MM-DDTHH:mm:ss.SSSZ'),
      apiOptions: [TransactionAuthorizationRequestOptions.RETURNEXPDATE],
      amount: {
        total: payment.amount_charged,
        tax: totalTax,
      },
      clerk: {
        numericId: 1,
      },
      customer: {
        addressLine1: customer.address?.address_first_line?.substring(0, 30),
        firstName: customer.first_name?.substring(0, 30),
        lastName: customer.last_name?.substring(0, 30),
        postalCode: customer.address?.postal_code
          ?.replace(/[^a-zA-Z0-9]/g, '')
          .substring(0, 9),
        emailAddress: customer.email?.substring(0, 80),
        ipAddress: customer.address?.ip_address,
      },
      transaction: {
        invoice: invoiceId,
        purchaseCard: {
          customerReference: invoiceId,
          destinationPostalCode: customer.address?.postal_code!,
          productDescriptors: ['Room Reservation'],
        },
        cardOnFile: {
          type: CardOnFileType.U01,
        },
        hotel: {
          arrivalDateTime,
          departureDateTime,
          primaryChargeType: HotelPrimaryChargeType.LODGING,
          roomRates,
          specialCode: HotelSpecialCode.ADVANCE_DEPOSIT,
        },
      },
      // 3DS only carried when the hotel toggle is on.
      ...(hotelConfig?.threeDS_config?.enabled === true && {
        threeDSecure: cardTokenData.threeDSecure,
      }),
      card: {
        present: CardPresent.NO,
        token: {
          value: cardTokenData.i4go_uniqueid,
        },
        expirationDate: parseInt(
          `${cardTokenData.i4go_expirationmonth}${cardTokenData.i4go_expirationyear.slice(-2)}`,
        ),
      },
    };
  }

  /**
   * Send payment success notifications (Telegram and SMS) for Shift4 payments
   */
  private async sendPaymentSuccessNotifications(
    payment: Payment,
    reservations: any[],
    hotel: Hotel,
    createdReservations: ReservationDTO[],
    hotelConfig: HotelConfiguration | null,
  ): Promise<void> {
    const guestFacingBookingIds =
      getGuestFacingReservationIds(createdReservations);
    const totalAmount = reservations?.reduce(
      (acc: number, reservation: any) =>
        acc +
        (Number(reservation.quote?.base_rate ?? 0) +
          Number(reservation.quote?.taxes ?? 0) +
          Number(reservation.quote?.fees ?? 0)),
      0,
    );

    // Send Telegram notification
    try {
      const message: PaymentStatusMessage = {
        status: PaymentStatus.COMPLETED,
        amount: Number(payment.amount_charged),
        bookingId: guestFacingBookingIds.length
          ? guestFacingBookingIds.join(', ')
          : null,
        guestFirstName: reservations[0].customer.first_name || '',
        guestLastName: reservations[0].customer.last_name || '',
        startDate: reservations[0].check_in,
        endDate: reservations[0].check_out,
        phoneNumber: reservations[0].phone_number,
        currency: hotel.currency,
        totalAmount,
        sessionType: reservations[0].type,
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
        `sendPaymentSuccessNotifications: Telegram sent for payment ${payment.id}`,
      );
    } catch (error) {
      logger.error(
        `sendPaymentSuccessNotifications: Error sending Telegram: ${JSON.stringify(error)}`,
      );
    }

    // Send SMS confirmation
    try {
      const smsBody = paymentSuccessSMSTemplate(
        formatDateToWords(dayjs(reservations[0].check_in), false),
        formatDateToWords(dayjs(reservations[0].check_out)),
        reservations[0].customer.email || '',
        roundCurrency(payment.amount_charged),
        hotel.currency,
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
          `sendPaymentSuccessNotifications: No valid phone number for payment ${payment.id}`,
        );
        return;
      }

      const smsPayload: NotificationPayload = {
        recipient: convertToPhoneNumber(smsRecipientPhoneNumber)!,
        content: smsContent,
      };

      await this.smsService.sendMessage(smsPayload);
      logger.info(
        `sendPaymentSuccessNotifications: SMS sent for payment ${payment.id}`,
      );
    } catch (error) {
      logger.error(
        `sendPaymentSuccessNotifications: Error sending SMS: ${JSON.stringify(error)}`,
      );
    }
  }

  /**
   * Marks the given reservations with a no-Dextr-payment status (see
   * `noDextrPaymentStatusFor`) and returns the secure review URL for the guest.
   * Called from both createSingleRoomReservation and createMultiRoomReservation.
   */
  private async finaliseNoPaymentCreation(
    reservationIds: string[],
    paymentStatus: ReservationPaymentStatus,
    reservationReviewId: string,
    hotelName: string,
    trx: Knex.Transaction,
  ): Promise<string> {
    await this.reservationRepository.updatePaymentStatus(
      reservationIds,
      paymentStatus,
      trx,
    );
    return getSecureReviewUrl(reservationReviewId, hotelName);
  }

  /**
   * Finds the payment linked to the given reservation IDs and validates it is in a state
   * that allows review page submission (not disabled, not already completed/cancelled).
   */
  private async findAndValidateReviewPayment(
    reservationIds: string[],
    bookingId: string,
  ): Promise<Payment & { reservation_ids: string[] }> {
    const payment =
      await this.paymentReservationRepository.findPaymentByReservationIds(
        reservationIds,
      );
    if (!payment) {
      throw new NoDataError(
        `submitReviewAndProcessReservation: Payment not found for booking ${bookingId}`,
      );
    }
    if (payment.payment_link_disabled) {
      throw new BadRequestError('This payment link has expired');
    }
    if (
      [PaymentStatus.CANCELLED, PaymentStatus.COMPLETED].includes(
        payment.payment_status,
      )
    ) {
      throw new BadRequestError(
        `submitReviewAndProcessReservation: Payment ${payment.id} is already ${payment.payment_status}`,
      );
    }
    return payment;
  }

  /**
   * Send booking confirmation SMS for no-payment reservations (no Telegram needed).
   */
  private async sendNoPaymentConfirmationSMS(
    createdReservations: ReservationDTO[],
    originalReservations: ReservationDTO[],
    hotel: Hotel,
    twilioConfiguration: TwilioConfiguration | null,
    failedRoomCount = 0,
  ): Promise<void> {
    try {
      if (!hotel.sms_number) {
        logger.warn(
          `sendNoPaymentConfirmationSMS: No SMS number configured for hotel ${hotel.id}`,
        );
        return;
      }
      if (!originalReservations?.length) {
        logger.warn(`sendNoPaymentConfirmationSMS: No reservations provided`);
        return;
      }
      const guestFacingBookingIds =
        getGuestFacingReservationIds(createdReservations);

      const firstReservation = originalReservations[0];
      const checkIn = formatDateToWords(
        dayjs(firstReservation.check_in),
        false,
      );
      const checkOut = formatDateToWords(dayjs(firstReservation.check_out));
      const email = firstReservation.customer?.email || '';
      const bookingIds = guestFacingBookingIds.length
        ? guestFacingBookingIds.join(', ')
        : undefined;
      const smsBody =
        failedRoomCount > 0
          ? bookingPartlyConfirmedSMSTemplate(
              checkIn,
              checkOut,
              email,
              failedRoomCount,
              failedRoomCount + originalReservations.length,
              bookingIds,
            )
          : bookingConfirmedSMSTemplate(checkIn, checkOut, email, bookingIds);

      const smsContent: NotificationSMSContent = {
        message: smsBody,
        from: convertToPhoneNumber(hotel.sms_number)!,
        twilioConfiguration: twilioConfiguration,
      };

      const smsRecipientPhoneNumber = await resolveSmsTargetPhoneNumber(
        firstReservation.customer?.phone_number,
        firstReservation.phone_number,
        twilioConfiguration,
        hotel.country,
        false,
      );

      if (!smsRecipientPhoneNumber) {
        logger.warn(
          `sendNoPaymentConfirmationSMS: No valid phone number for booking ${firstReservation.booking_id}`,
        );
        return;
      }

      const smsPayload: NotificationPayload = {
        recipient: convertToPhoneNumber(smsRecipientPhoneNumber)!,
        content: smsContent,
      };

      await this.smsService.sendMessage(smsPayload);
      logger.info(
        `sendNoPaymentConfirmationSMS: SMS sent for booking ${firstReservation.booking_id}`,
      );
    } catch (error) {
      logger.error(
        `sendNoPaymentConfirmationSMS: Error sending confirmation SMS: ${JSON.stringify(error)}`,
      );
    }
  }

  /**
   * No payment needed (no deposit, no autocharge. No card details collected. All payments to be collected by the hotel.)
   * @param createdReservations
   * @param originalReservations
   * @param hotel
   * @returns
   */
  private async sendNoPaymentBookingTelegramNotification(
    createdReservations: ReservationDTO[],
    originalReservations: ReservationDTO[],
    hotel: Hotel,
    failedBookingIds: string[] = [],
  ): Promise<void> {
    try {
      if (!hotel.telegram_alerts_group_id) {
        logger.warn(
          `sendNoPaymentBookingTelegramNotification: No Telegram group configured for hotel ${hotel.id}`,
        );
        return;
      }
      if (!originalReservations?.length) return;

      const guestFacingBookingIds =
        getGuestFacingReservationIds(createdReservations);

      const firstReservation = originalReservations[0];
      const totalAmount = originalReservations.reduce(
        (acc, r) => acc + getReservationTotalAmount(r),
        0,
      );

      const message: BookingConfirmedMessage = {
        phoneNumber: firstReservation.phone_number,
        bookingId: guestFacingBookingIds.length
          ? guestFacingBookingIds.join(', ')
          : null,
        guestFirstName: firstReservation.customer?.first_name || '',
        totalAmount,
        sessionType: firstReservation.type,
        paymentNote: BookingPaymentNote.COLLECT_AT_HOTEL,
        guestLastName: firstReservation.customer?.last_name || '',
        startDate: firstReservation.check_in,
        endDate: firstReservation.check_out,
        currency: hotel.currency,
        failedBookingIds,
      };

      const htmlMessage = noPaymentBookingConfirmedTemplate(message);

      await this.notificationFactory
        .getChatService(hotel.notification_type)
        .sendMessage({
          recipient: hotel.telegram_alerts_group_id,
          content: {
            message: htmlMessage,
            parseMode: 'HTML',
          },
        });
      logger.info(
        `sendNoPaymentBookingTelegramNotification: Telegram sent for booking ${firstReservation.booking_id}`,
      );
    } catch (error) {
      logger.error(
        `sendNoPaymentBookingTelegramNotification: Error sending Telegram: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Sends the review page link via SMS for no-payment reservations.
   * Only sends for CALL sessions, mirroring sendPaymentNotifications behaviour.
   */
  private async sendReviewLinkSMS(
    reviewUrl: string,
    sessionType: SessionType,
    customerPhone: string,
    hotel: {
      name: string;
      sms_number?: string;
      assistant_phone_number?: string;
      internal_phone_number?: string;
      country: string;
    },
    hotelConfiguration: HotelConfiguration | null,
  ): Promise<void> {
    try {
      // Only send review link SMS for CALL sessions
      if (sessionType !== SessionType.CALL) return;

      if (!hotel.sms_number) {
        logger.warn(`sendReviewLinkSMS: No SMS number configured for hotel`);
        return;
      }

      const smsBody = reviewLinkSMSTemplate(
        hotel.name,
        reviewUrl,
        config.REVIEW_TIMEOUT,
        hotel.internal_phone_number || hotel.assistant_phone_number || '',
        hotel.country as Country,
        hotelConfiguration?.sms_agent_enabled || false,
      );

      const smsContent: NotificationSMSContent = {
        message: smsBody,
        from: hotel.sms_number,
        twilioConfiguration: hotelConfiguration?.twilio_configuration,
      };
      const smsPayload: NotificationPayload = {
        recipient: customerPhone,
        content: smsContent,
      };

      await this.smsService.sendMessage(smsPayload);
      logger.info(
        `sendReviewLinkSMS: Review link SMS sent to ${customerPhone}`,
      );
    } catch (error) {
      logger.error(
        `sendReviewLinkSMS: Error sending review link SMS: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Handle PMS creation failure by sending escalation notification
   */
  private async handleShift4PMSReservationCreationFailure(
    reservations: any[],
    hotel: Hotel,
    payment: Payment,
    error: any,
  ): Promise<void> {
    logger.error(
      `handleShift4PMSReservationCreationFailure: Error creating PMS reservations: ${JSON.stringify(error)}`,
    );
    try {
      await escalationService.handleEscalation(
        {
          phone_number: reservations[0].phone_number,
          full_name: `${reservations[0].customer.first_name} ${reservations[0].customer.last_name}`,
          message: `Payment of ${formatCurrencyAmount(hotel.currency, payment.amount_charged)} collected from customer but failed to create reservation. Please check the reservation details and take action.\nCheck-in: ${dayjs(reservations[0].check_in).format('DD/MM/YYYY')}\nCheck-out: ${dayjs(reservations[0].check_out).format('DD/MM/YYYY')}`,
          session_id: reservations[0].session_id ?? '',
          status: EscalationStatus.OPEN,
        },
        hotel.assistant_phone_number,
      );
    } catch (escalationError) {
      logger.error(
        `handleShift4PMSReservationCreationFailure: Error sending escalation: ${JSON.stringify(escalationError)}`,
      );
    }
  }

  /**
   * Record credit card payment in Stayntouch PMS after successful Shift4 transaction
   */
  private async recordPaymentInStayntouch(
    createdReservations: ReservationDTO[],
    saleResponseData: Shift4SaleTransactionResult,
    payment: Payment,
  ): Promise<void> {
    try {
      logger.info(
        'recordPaymentInStayntouch: Recording payments for reservations',
        {
          reservation_count: createdReservations.length,
          payment_id: payment.id,
        },
      );

      const firstReservation = createdReservations[0];
      if (firstReservation.pms_provider !== PmsProvider.STAYNTOUCH) {
        logger.warn(
          'recordPaymentInStayntouch: Skipping payment recording for non-Stayntouch reservation',
          {
            reservation_id: firstReservation.id,
          },
        );
        return;
      }

      if (!saleResponseData || !payment) {
        logger.error(
          'recordPaymentInStayntouch: Missing saleResponseData or payment from Shift4 response',
        );
        return;
      }

      const cardData = saleResponseData.card;
      const transactionData = saleResponseData.transaction;

      if (!cardData || !transactionData) {
        logger.error(
          'recordPaymentInStayntouch: Missing card or transaction data from Shift4 response',
        );
        return;
      }
      const expirationDate = cardData.expirationDate;
      const transactionId = transactionData.cardOnFile?.transactionId;

      if (!expirationDate || !transactionId) {
        logger.error(
          'recordPaymentInStayntouch: Missing expirationDate or transactionId from Shift4 response',
        );
        return;
      }

      // Format expiry date as YYYY-MM from MMYY
      const mmyy = String(cardData.expirationDate).padStart(4, '0');
      const century = Math.floor(new Date().getFullYear() / 100);
      const expiryDate = `${century}${mmyy.slice(2)}-${mmyy.slice(0, 2)}`;

      // Extract last 4 digits from masked card number (e.g., "XXXXXXXXXXXX0027" -> "0027")
      const maskedCardNumber = cardData.number?.slice(-4) || '';

      const totalPayment = Number(payment.amount_charged);
      const perReservationAmounts = this.splitPaymentAcrossReservations(
        createdReservations,
        totalPayment,
      );

      for (const reservation of createdReservations) {
        if (!reservation.external_id) {
          logger.warn(
            'recordPaymentInStayntouch: Skipping reservation without external_id',
            {
              reservation_id: reservation.id,
            },
          );
          continue;
        }

        const reservationAmount = perReservationAmounts.get(reservation.id);
        if (reservationAmount == null) {
          logger.error(
            'recordPaymentInStayntouch: No split amount computed for reservation',
            {
              reservation_id: reservation.id,
              external_id: reservation.external_id,
              payment_id: payment.id,
            },
          );
          continue;
        }

        const paymentRequest: RecordCCPaymentRequest = {
          amount: reservationAmount,
          authorization_code: transactionData.authorizationCode,
          reference_text: `Shift4 Payment - Invoice ${transactionData.invoice}`,
          code:
            Shift4ToStayntouchCardTypeMap[cardData.type] || cardData.type || '',
          token: cardData.token.value,
          masked_card_number: maskedCardNumber,
          attach_cc_to_reservation: true,
          transaction_id: transactionId,
          req_reference_no: transactionId,
          expiry_date: expiryDate,
        };

        try {
          await new StayntouchReservationService(
            reservation.hotel_id,
          ).recordCCPayment({
            external_id: reservation.external_id,
            payment_data: paymentRequest,
          });

          logger.info(
            'recordPaymentInStayntouch: Successfully recorded payment',
            {
              reservation_id: reservation.id,
              external_id: reservation.external_id,
              amount: paymentRequest.amount,
            },
          );
        } catch (error) {
          logger.error(
            'recordPaymentInStayntouch: Failed to record payment for reservation',
            {
              error,
              reservation_id: reservation.id,
              external_id: reservation.external_id,
            },
          );
        }
      }

      if (createdReservations.length > 1 && perReservationAmounts.size > 0) {
        try {
          await this.addPaymentSplitNotes(
            createdReservations,
            perReservationAmounts,
            totalPayment,
            payment.currency || 'usd',
            transactionData.invoice,
          );
        } catch (error) {
          logger.error(
            'recordPaymentInStayntouch: Failed to add payment split notes (payments were recorded successfully)',
            {
              error,
              payment_id: payment.id,
              reservation_count: createdReservations.length,
            },
          );
        }
      }
    } catch (error) {
      logger.error('recordPaymentInStayntouch: Error recording payments', {
        error,
      });
    }
  }

  /**
   * Distributes a total payment across reservations proportionally based on
   * each reservation's quote deposit (`quote.amount_charged`). The last
   * reservation absorbs any rounding remainder so the sum is exact.
   */
  private splitPaymentAcrossReservations(
    reservations: ReservationDTO[],
    totalPayment: number,
  ): Map<string, number> {
    const result = new Map<string, number>();

    if (reservations.length === 1) {
      result.set(reservations[0].id, roundCurrency(totalPayment));
      return result;
    }

    const totalQuoteDeposit = reservations.reduce(
      (sum, r) => roundCurrency(sum + Number(r.quote?.amount_charged ?? 0)),
      0,
    );

    const useEqualSplit = totalQuoteDeposit <= 0;
    if (useEqualSplit) {
      logger.warn(
        'splitPaymentAcrossReservations: All quote deposits are zero — falling back to equal split',
        {
          reservation_count: reservations.length,
          total_payment: totalPayment,
          booking_id: reservations[0]?.booking_id,
        },
      );
    }

    let allocated = 0;
    for (let i = 0; i < reservations.length; i++) {
      const reservation = reservations[i];
      const isLast = i === reservations.length - 1;
      const share = isLast
        ? roundCurrency(totalPayment - allocated)
        : useEqualSplit
          ? roundCurrency(totalPayment / reservations.length)
          : roundCurrency(
              (Number(reservation.quote?.amount_charged ?? 0) /
                totalQuoteDeposit) *
                totalPayment,
            );
      result.set(reservation.id, share);
      allocated = roundCurrency(allocated + share);
    }

    return result;
  }

  /**
   * Adds a payment split summary note to each reservation in a multi-room
   * booking so hotel staff can see the full payment context on every stay card.
   */
  private async addPaymentSplitNotes(
    reservations: ReservationDTO[],
    perReservationAmounts: Map<string, number>,
    totalPayment: number,
    currency: string,
    invoiceId: string,
  ): Promise<void> {
    const bookingPrefix =
      reservations[0]?.booking_id?.replace(/_\d+$/, '') ?? '';

    const reservationsWithExternalId = reservations.filter(
      (r) => r.external_id,
    );

    const splitLines = reservationsWithExternalId
      .map((r) => {
        const confId = r.external_public_id;
        const amount = perReservationAmounts.get(r.id) ?? 0;
        return `  - Conf# ${confId} (${r.room_type || 'Room'}): ${formatCurrencyAmount(currency, amount)}`;
      })
      .join('\n');

    const noteText = [
      `Daisy Payment Summary (Booking ${bookingPrefix})`,
      `Total charged: ${formatCurrencyAmount(currency, totalPayment)} via Shift4 (Invoice ${invoiceId})`,
      `Split across ${reservationsWithExternalId.length} reservations:`,
      splitLines,
    ].join('\n');

    for (const reservation of reservationsWithExternalId) {
      try {
        await new StayntouchReservationService(
          reservation.hotel_id,
        ).addReservationNotes(reservation.external_id!, {
          notes: [{ description: noteText }],
        });
      } catch (error) {
        logger.error(
          'addPaymentSplitNotes: Failed to add note to reservation',
          {
            error,
            reservation_id: reservation.id,
            external_id: reservation.external_id,
          },
        );
      }
    }
  }

  /**
   * Handle post-payment success flow: update reservation status, create PMS reservations, send notifications
   */
  private async createReservationsPostShift4InitalDepositPaymentSuccess(
    payment: Payment,
    reservations: ReservationDTO[],
    hotel: Hotel,
    saleResponseData?: Shift4SaleTransactionResult,
    skipPaymentStatusUpdate = false,
  ): Promise<ReservationDTO[]> {
    let reservationTransaction: Knex.Transaction | undefined;
    try {
      reservationTransaction =
        await this.reservationRepository.startTransaction();

      // Update reservation payment status. Skipped for zero-deposit: no
      // money was collected, and updateReservationPaymentStatusFromPaymentInfo
      // would compute PENDING from $0 collected — same label as "nothing
      // collected, nothing scheduled," which is misleading for a card that's
      // on file with a real autocharge scheduled. Stripe's equivalent
      // zero-deposit flow (handleSetupSessionCompleted) leaves this field
      // untouched for the same reason; mirror that here.
      if (!skipPaymentStatusUpdate) {
        await this.updateReservationPaymentStatusFromPaymentInfo(
          reservations,
          'CREDIT',
          reservationTransaction,
        );
      }
      await reservationTransaction.commit();

      // Create PMS reservations
      let createdReservations: ReservationDTO[] = [];
      try {
        createdReservations = await this.finalizePmsReservations(reservations);
        logger.info(
          `handleShift4InitalDepositPaymentSuccess: Created ${createdReservations.length} PMS reservations`,
        );
      } catch (error) {
        await this.handleShift4PMSReservationCreationFailure(
          reservations,
          hotel,
          payment,
          error,
        );
        throw error;
      }

      return createdReservations;
    } catch (error) {
      if (reservationTransaction) {
        reservationTransaction.rollback();
      }
      logger.error(
        `handleShift4InitalDepositPaymentSuccess failed due to error`,
        error,
      );
      throw error;
    }
  }

  /**
   * Processes due auto-charges across all supported payment providers.
   * Called by Lambda/EventBridge every 5 minutes.
   * Checks for reservations with auto_charge enabled and finalizes_at <= now
   * @returns Summary of processed auto-charges
   */
  public async processDueAutoCharges(paymentProvider?: PaymentProvider) {
    try {
      logger.info(
        `processDueAutoCharges: Starting auto-charge processing job${paymentProvider ? ` for ${paymentProvider}` : ''}`,
      );

      const now = new Date();

      // Get reservations with auto_charge enabled and finalizes_at <= now.
      // paymentProvider scopes this to one provider's own scheduled job
      // (e.g. Mews running on a separate Lambda/cadence from Shift4) so
      // overlapping jobs never claim the same rows.
      const dueReservations =
        await this.reservationRepository.findReservationsWithDueAutoCharge(
          now,
          paymentProvider,
        );

      if (!dueReservations || dueReservations.length === 0) {
        logger.info(
          'processDueAutoCharges: No reservations with due auto-charges found',
        );
        return {
          success: true,
          message: 'No reservations with due auto-charges found',
          processed: 0,
          succeeded: 0,
          failed: 0,
          results: [],
        };
      }

      logger.info(
        `processDueAutoCharges: Found ${dueReservations.length} reservations with due auto-charges`,
      );

      // Group reservations by booking prefix and hotel_id
      // Multi-room bookings have booking_ids like BK123_1, BK123_2, etc
      // Extract the prefix (everything before the last _<number>) to group them together
      const bookingMap = new Map<string, typeof dueReservations>();
      for (const reservation of dueReservations) {
        // Extract booking prefix by removing _<number> suffix if present
        const bookingIdPrefix = reservation.booking_id.replace(/_\d+$/, '');
        const key = `${bookingIdPrefix}_${reservation.hotel_id}`;
        if (!bookingMap.has(key)) {
          bookingMap.set(key, []);
        }
        bookingMap.get(key)!.push(reservation);
      }

      const results: AutoChargeProcessingResult[] = [];
      let succeeded = 0;
      let failed = 0;

      // Process each booking with its own transaction
      for (const [key, reservations] of bookingMap.entries()) {
        const firstReservation = reservations[0];
        const bookingId = firstReservation.booking_id;
        const bookingIdPrefix = bookingId.replace(/_\d+$/, '');
        const hotelId = firstReservation.hotel_id;

        // Create a separate transaction for each booking to ensure atomicity at booking level
        let bookingTransaction: Knex.Transaction | undefined;
        let chargeSucceededAtGateway = false;

        try {
          const hotel = firstReservation.hotel;
          const hotelConfig = firstReservation.hotel_configuration;
          if (!hotel) {
            logger.warn(
              `processDueAutoCharges: Skipping bookings with prefix ${bookingIdPrefix} - no hotel found`,
            );
            continue;
          }

          let executor: IAutoChargeExecutor;
          try {
            executor = autoChargeExecutorFactory.getExecutor(
              hotel.payment_provider,
            );
          } catch {
            logger.info(
              `processDueAutoCharges: Skipping bookings with prefix ${bookingIdPrefix} - no auto-charge executor for payment provider ${hotel.payment_provider}`,
            );
            continue;
          }

          const autoChargeAmount = roundCurrency(
            firstReservation.auto_charge?.amount ?? 0,
          );
          if (!autoChargeAmount || autoChargeAmount <= 0) {
            logger.warn(
              `processDueAutoCharges: Skipping bookings with prefix ${bookingIdPrefix} - invalid auto-charge amount`,
            );
            continue;
          }

          logger.info(
            `processDueAutoCharges: Processing auto-charge for bookings with prefix ${bookingIdPrefix}, amount: ${autoChargeAmount}`,
          );

          // Get payment_id from auto_charge config
          const paymentId = firstReservation.auto_charge?.payment_id;
          if (!paymentId) {
            throw new NoDataError(
              `Payment ID not found in auto_charge config for bookings with prefix ${bookingIdPrefix}`,
            );
          }

          const chargeResult = await executor.executeAutoCharge({
            bookingIdPrefix,
            hotel,
            hotelConfig,
            reservations,
            amount: autoChargeAmount,
            paymentId,
            isManualCharge: false,
          });

          if (chargeResult.success) {
            chargeSucceededAtGateway = true;
            // Create transaction only after successful payment to ensure atomicity
            bookingTransaction = await db.transaction();

            // Update payment status to COMPLETED and set booking_confirmation_id
            await this.paymentService.updatePaymentStatusById(
              paymentId,
              PaymentStatus.COMPLETED,
              bookingTransaction,
            );

            const paymentDataToUpdate: Partial<Payment> = {
              booking_confirmation_id: chargeResult.bookingConfirmationId,
            };
            await this.paymentService.updatePaymentById(
              paymentId,
              paymentDataToUpdate,
              bookingTransaction,
            );

            // Persist Mews account/card ids so refunds (which require an
            // AccountId) work on auto-charge payments.
            if (chargeResult.mewsAccountId) {
              await this.paymentService.updatePaymentMetadata(
                paymentId,
                {
                  mews_account_id: chargeResult.mewsAccountId,
                  mews_credit_card_id: chargeResult.mewsCreditCardId,
                },
                bookingTransaction,
              );
            } else {
              logger.warn(
                `processDueAutoCharges: mews_account_id unresolved for payment ${paymentId}; refunds for this payment will fail`,
              );
            }

            // Disable auto-charge
            await this.setupAutoCharge(
              bookingIdPrefix,
              hotelId,
              { is_enabled: false },
              bookingTransaction,
            );

            // Update reservation payment status
            await this.updateReservationPaymentStatusFromPaymentInfo(
              reservations,
              'CREDIT',
              bookingTransaction,
            );

            // Commit transaction for this booking
            if (bookingTransaction) {
              await bookingTransaction.commit();
            }

            // Record payment in Stayntouch — Shift4-specific side effect, gated
            // explicitly since chargeResult.raw is only a Shift4SaleTransactionResult
            // when chargeResult.provider === SHIFT4. Mews has no equivalent step:
            // the charge is recorded against the Mews account by Mews itself.
            if (
              hotel.pms_provider === PmsProvider.STAYNTOUCH &&
              chargeResult.provider === PaymentProvider.SHIFT4 &&
              chargeResult.raw
            ) {
              const payment =
                await this.paymentService.getPaymentById(paymentId);
              if (payment) {
                await this.recordPaymentInStayntouch(
                  reservations,
                  chargeResult.raw as Shift4SaleTransactionResult,
                  payment,
                );
              }
            }

            // Record the autocharge on the Opera folio if the hotel is
            // Opera-backed through Calry (no-op for other PMS)
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

            // Send SMS notification to guest (outside transaction)
            await this.sendAutoChargeGuestSMS(
              firstReservation,
              hotel,
              hotelConfig,
              autoChargeAmount,
              'remaining balance',
            );

            succeeded++;
            results.push({
              booking_id: bookingIdPrefix,
              hotel_id: hotelId,
              success: true,
              amount: autoChargeAmount,
              payment_id: paymentId,
            });

            logger.info(
              `processDueAutoCharges: Successfully processed auto-charge for bookings with prefix ${bookingIdPrefix}`,
            );
          } else {
            failed++;
            results.push({
              booking_id: bookingIdPrefix,
              hotel_id: hotelId,
              success: false,
              amount: autoChargeAmount,
              error:
                chargeResult.error ??
                `Charge failed with response code: ${chargeResult.providerResponseCode}`,
            });

            try {
              await this.handleAutoChargeRetry(
                reservations,
                hotel,
                hotelConfig,
                bookingIdPrefix,
                hotelId,
                autoChargeAmount,
                `Response code: ${chargeResult.providerResponseCode}`,
              );
            } catch (retryError) {
              logger.error(
                `processDueAutoCharges: Failed to charge bookings with prefix ${bookingIdPrefix}, response code: ${chargeResult.providerResponseCode}`,
              );
            }
          }
        } catch (error) {
          // Rollback transaction for this booking if it exists
          if (bookingTransaction) {
            await bookingTransaction.rollback();
          }

          failed++;
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          results.push({
            booking_id: bookingIdPrefix,
            hotel_id: hotelId,
            success: false,
            error: errorMessage,
          });

          logger.error(
            `processDueAutoCharges: Error processing bookings with prefix ${bookingIdPrefix}: ${errorMessage}`,
          );

          const catchHotel = firstReservation.hotel;
          if (chargeSucceededAtGateway) {
            logger.error(
              `processDueAutoCharges: Charge succeeded at gateway but post-processing failed for bookings with prefix ${bookingIdPrefix}. Manual intervention required. Error: ${errorMessage}`,
            );
          } else {
            try {
              await this.handleAutoChargeRetry(
                reservations,
                catchHotel ?? {},
                firstReservation.hotel_configuration,
                bookingIdPrefix,
                hotelId,
                roundCurrency(firstReservation.auto_charge?.amount ?? 0),
                `Error: ${errorMessage}`,
              );
            } catch (retryError) {
              logger.error(
                `processShift4AutoCharges: Failed to update retry count for bookings with prefix ${bookingIdPrefix}: ${retryError}`,
              );
            }
          }
        }
      }

      logger.info(
        `processDueAutoCharges: Job completed - Processed: ${bookingMap.size}, Succeeded: ${succeeded}, Failed: ${failed}`,
      );

      return {
        success: true,
        message: 'Auto-charge processing completed',
        processed: bookingMap.size,
        succeeded,
        failed,
        results,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `processDueAutoCharges: Error in auto-charge processing job: ${errorMessage}`,
      );
      throw error;
    }
  }

  /**
   * Handles retry logic after a failed Shift4 auto-charge attempt.
   * Increments retry_count; when retries are exhausted, disables auto-charge and sends Telegram.
   */
  private async handleAutoChargeRetry(
    reservations: ReservationDTO[],
    hotel: {
      telegram_alerts_group_id?: string;
      currency?: string;
      notification_type?: ChatNotificationType;
    },
    hotelConfig: {
      payment_configuration?: {
        auto_charge_max_retries?: number | null;
      } | null;
    } | null,
    bookingIdPrefix: string,
    hotelId: string,
    amount: number,
    errorContext: string,
  ): Promise<void> {
    const maxRetries =
      hotelConfig?.payment_configuration?.auto_charge_max_retries ?? 3;
    const retryCount = (reservations[0].auto_charge?.retry_count ?? 0) + 1;

    if (retryCount >= maxRetries) {
      logger.error(
        `handleAutoChargeRetry: Retries exhausted (${retryCount}/${maxRetries}) for bookings with prefix ${bookingIdPrefix}. ${errorContext}`,
      );

      await this.setupAutoCharge(bookingIdPrefix, hotelId, {
        is_enabled: false,
      });

      await this.sendAutoChargeFailedTelegram(
        reservations,
        hotel,
        bookingIdPrefix,
        amount,
        { attempt: retryCount, maxRetries },
      );
    } else {
      logger.warn(
        `handleAutoChargeRetry: Charge attempt ${retryCount}/${maxRetries} failed for bookings with prefix ${bookingIdPrefix}. Will retry. ${errorContext}`,
      );

      const updatedAutoCharge: AutoChargeInfo = {
        ...reservations[0].auto_charge!,
        retry_count: retryCount,
      };
      await this.reservationRepository.updateMany(
        reservations.map((r: any) => r.id),
        { auto_charge: updatedAutoCharge },
      );
    }
  }

  private async sendAutoChargeFailedTelegram(
    reservations: any[],
    hotel: {
      telegram_alerts_group_id?: string;
      currency?: string;
      notification_type?: ChatNotificationType;
    },
    bookingIdPrefix: string,
    amount: number,
    retryInfo?: { attempt: number; maxRetries: number },
  ): Promise<void> {
    if (!hotel.telegram_alerts_group_id) return;

    try {
      const firstReservation = reservations[0];
      const totalAmount = reservations.reduce(
        (acc: number, r: any) =>
          roundCurrency(acc + getReservationTotalAmount(r)),
        0,
      );
      const message: PaymentStatusMessage = {
        status: PaymentStatus.FAILED,
        phoneNumber: firstReservation.phone_number,
        amount,
        bookingId: bookingIdPrefix,
        guestFirstName: firstReservation.customer.first_name || '',
        guestLastName: firstReservation.customer.last_name || '',
        startDate: firstReservation.check_in,
        endDate: firstReservation.check_out,
        currency: hotel.currency,
        totalAmount,
        sessionType: firstReservation.type,
        isAutoCharge: true,
        retryInfo,
      };
      const htmlMessage = paymentStatusTemplate(message);
      await this.notificationFactory
        .getChatService(hotel.notification_type)
        .sendMessage({
          recipient: hotel.telegram_alerts_group_id,
          content: { message: htmlMessage, parseMode: 'HTML' },
        });
      logger.info(
        `sendAutoChargeFailedTelegram: Telegram notification sent for failed auto-charge on bookings with prefix ${bookingIdPrefix}`,
      );
    } catch (notifyError) {
      logger.error(
        `sendAutoChargeFailedTelegram: Failed to send Telegram notification for bookings with prefix ${bookingIdPrefix}: ${notifyError}`,
      );
    }
  }

  public async getReservationsBySessionIds(sessionIds: string[]) {
    return this.reservationRepository.getReservationsBySessionIds(sessionIds);
  }

  public async getUnusedDiscountByPhoneNumberAndHotelId(
    phoneNumber: string,
    hotelId: string,
  ) {
    if (!phoneNumber) {
      throw new BadRequestError(
        'getUnusedDiscountByPhoneNumberAndHotelId:: Phone number is required',
      );
    }
    if (!hotelId) {
      throw new BadRequestError(
        'getUnusedDiscountByPhoneNumberAndHotelId:: Hotel ID is required',
      );
    }
    return this.discountService.getUnusedDiscountByPhoneNumberAndHotelId(
      phoneNumber,
      hotelId,
    );
  }

  public async getActiveDiscountByPhoneNumbers(
    customerPhoneNumber: string,
    hotelPhoneNumber: string,
  ) {
    const formattedCustomerPhoneNumber =
      convertToPhoneNumber(customerPhoneNumber);
    if (!formattedCustomerPhoneNumber) {
      throw new BadRequestError(
        'getActiveDiscountByPhoneNumbers:: Customer phone number is required',
      );
    }
    const formattedHotelPhoneNumber = convertToPhoneNumber(hotelPhoneNumber);
    if (!formattedHotelPhoneNumber) {
      throw new BadRequestError(
        'getActiveDiscountByPhoneNumbers:: Hotel phone number is required',
      );
    }

    const hotel = await this.hotelService.getHotelByAssistantPhoneNumber(
      formattedHotelPhoneNumber,
    );
    if (!hotel) {
      throw new NoDataError(
        `getActiveDiscountByPhoneNumbers:: Hotel not found for assistant phone number ${hotelPhoneNumber}`,
      );
    }
    const discount =
      await this.discountService.getUnusedDiscountByPhoneNumberAndHotelId(
        formattedCustomerPhoneNumber,
        hotel.id,
      );
    return cleanStringFields(discount);
  }

  /**
   * Returns escalation instruction message based on current time in hotel timezone.
   * Within call-forwarding window: message_call_forwarding; otherwise message_callback.
   */
  public async getEscalationInstructionMessage(
    assistantPhoneNumber: string,
  ): Promise<{ message: string }> {
    const formatted = convertToPhoneNumber(assistantPhoneNumber);
    if (!formatted) {
      throw new BadRequestError(
        'getEscalationInstructionMessage: Assistant phone number is required',
      );
    }
    const hotel =
      await this.hotelService.getHotelByAssistantPhoneNumber(formatted);
    if (!hotel) {
      throw new NoDataError(
        `getEscalationInstructionMessage: Hotel not found for assistant phone number ${formatted}`,
      );
    }
    const tz = hotel.timezone;
    const hotelConfig =
      config.ESCALATION_INSTRUCTION_CONFIG[hotel.id] ??
      config.ESCALATION_INSTRUCTION_CONFIG['default'];
    const { start, end, within_hours, outside_hours } = hotelConfig;

    if (tz && isWithinTimeWindow(tz, start, end)) {
      return { message: within_hours };
    }

    return { message: outside_hours };
  }

  public async getUnitGroups(assistantPhoneNumber: string) {
    const formattedAssistantPhoneNumber =
      convertToPhoneNumber(assistantPhoneNumber);
    if (!formattedAssistantPhoneNumber) {
      throw new BadRequestError(
        'getUnitGroups:: Assistant phone number is required',
      );
    }
    const hotel = await this.hotelService.getHotelByAssistantPhoneNumber(
      formattedAssistantPhoneNumber,
    );
    if (!hotel) {
      throw new NoDataError(
        `getUnitGroups:: Hotel not found for assistant phone number ${formattedAssistantPhoneNumber}`,
      );
    }

    const pmsService = await pmsServiceFactory.getReservationService(hotel.id);
    const roomsResponse = await pmsService.getRoomsInfo(
      String(hotel.business_id),
    );

    return cleanStringFields(roomsResponse);
  }

  /**
   * Cleans up expired discount entries based on each discount's individual expiry_days setting
   * Sets deleted_at to current UTC timestamp for non-deleted entries that were created more than expiry_days back
   */
  public async cleanupExpiredDiscounts() {
    try {
      logger.info(
        'cleanupExpiredDiscounts: Starting cleanup of expired discounts',
      );

      const currentUtc = dayjs().utc();

      // Get all non-deleted discount entries with their expiry_days
      const discounts = await this.discountService.getAllActiveDiscounts();

      let totalProcessed = discounts.length;
      let totalDeleted = 0;
      const expiredDiscountIds: string[] = [];

      logger.info(
        `cleanupExpiredDiscounts: Found ${totalProcessed} active discount entries to process`,
      );

      for (const discount of discounts) {
        // Calculate if this discount has expired based on its individual expiry_days
        const cutoffDate = dayjs(discount.created_at).add(
          discount.expiry_days,
          'days',
        );

        if (currentUtc.isAfter(cutoffDate)) {
          expiredDiscountIds.push(discount.id);
          logger.info(
            `cleanupExpiredDiscounts: Discount ${discount.id} expired: created ${discount.created_at}, expires after ${discount.expiry_days} days`,
          );
        }
      }

      // Batch update all expired discounts using repository
      if (expiredDiscountIds.length > 0) {
        totalDeleted =
          await this.discountService.markDiscountsAsDeleted(expiredDiscountIds);

        logger.info(
          `cleanupExpiredDiscounts: Marked ${totalDeleted} discount entries as deleted`,
        );
      } else {
        logger.info('cleanupExpiredDiscounts: No expired discounts found');
      }

      logger.info(
        `cleanupExpiredDiscounts: Cleanup completed. Processed ${totalProcessed} discount entries, deleted ${totalDeleted} entries`,
      );

      return {
        discounts_processed: totalProcessed,
        total_discounts_deleted: totalDeleted,
        expired_discount_ids: expiredDiscountIds,
      };
    } catch (error) {
      logger.error(
        `cleanupExpiredDiscounts: Error in cleanupExpiredDiscounts: ${error}`,
      );
      throw error;
    }
  }

  public async linkSessionToReservations(
    reservationIds: string[],
    sessionId: string,
  ) {
    await this.reservationRepository.linkSessionToReservations(
      reservationIds,
      sessionId,
    );
  }

  /**
   * Updates payment_status for reservations associated with a payment
   * @param reservationIds - Array of reservation IDs to update
   * @param paymentStatus - New payment status
   * @param transaction - Optional database transaction
   */
  public async updateReservationPaymentStatus(
    reservationIds: string[],
    paymentStatus: ReservationPaymentStatus,
    transaction?: Knex.Transaction,
  ) {
    if (!reservationIds?.length) {
      logger.warn(
        'updateReservationPaymentStatus: No reservation IDs provided',
      );
      return;
    }

    try {
      await this.reservationRepository.updatePaymentStatus(
        reservationIds,
        paymentStatus,
        transaction,
      );
      logger.info(
        `updateReservationPaymentStatus: Updated payment_status to ${paymentStatus} for ${reservationIds.length} reservations`,
      );
    } catch (error) {
      logger.error(
        `updateReservationPaymentStatus: Error updating payment status: ${JSON.stringify(error)}`,
      );
      throw error;
    }
  }

  public async getReservationStatusInWordsAfterAdvancePayment(
    bookingIdOrReservationIdOrExternalId: string,
    assistantPhoneNumber: string,
  ) {
    try {
      if (!bookingIdOrReservationIdOrExternalId) {
        throw new BadRequestError(
          'getReservationStatusInWordsAfterAdvancePayment: Booking ID or Reservation ID or External ID is required',
        );
      }

      const hotel =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          assistantPhoneNumber,
        );
      if (!hotel) {
        throw new NoDataError(
          'getReservationStatusInWordsAfterAdvancePayment: Hotel not found',
        );
      }

      const reservation =
        await this.reservationRepository.findReservationWithDetails(
          bookingIdOrReservationIdOrExternalId,
          hotel.id,
        );

      if (!reservation) {
        throw new NoDataError(
          `getReservationStatusInWordsAfterAdvancePayment: Reservation with ID ${bookingIdOrReservationIdOrExternalId} not found`,
        );
      }
      const reservationStatus = reservation.status;
      const payments = reservation.payments;
      const isNoPayment = hasNoDextrPayment(reservation.payment_status);

      let response: string;

      if (isNoPayment) {
        const guestFacingIds =
          await this.collectGuestFacingReservationIds(reservation);
        const reservationIdSentence =
          this.buildReservationIdSentence(guestFacingIds);

        switch (reservationStatus) {
          case ReservationStatus.ACTIVE:
            response = `Your reservation is confirmed and active. ${reservationIdSentence}`;
            break;
          case ReservationStatus.INACTIVE:
            response = `Your reservation has been created but is not yet confirmed. Please complete the review process to confirm your reservation.`;
            break;
          case ReservationStatus.CANCELLED:
            response = `Your reservation is cancelled.`;
            break;
          default:
            response = `Your reservation is in the ${reservationStatus} state.`;
            break;
        }
      } else {
        if (!payments || payments.length === 0) {
          throw new NoDataError(
            `getReservationStatusInWordsAfterAdvancePayment: Payment not found for reservation with ID ${bookingIdOrReservationIdOrExternalId}`,
          );
        }
        const paymentStatus = payments[0].payment_status;

        const guestFacingIds = await this.collectGuestFacingReservationIds(
          reservation,
          payments[0].id,
        );
        const reservationIdSentence =
          this.buildReservationIdSentence(guestFacingIds);

        switch (reservationStatus) {
          case ReservationStatus.ACTIVE:
            response = `Your payment was successful and the reservation is now active. The reservation details will be present in the confirmation mail. ${reservationIdSentence}`;
            break;
          case ReservationStatus.INACTIVE:
            switch (paymentStatus) {
              case PaymentStatus.COMPLETED:
                response = `Your payment was successful. Your reservation is being processed and you will receive a confirmation shortly.`;
                break;
              case PaymentStatus.PENDING:
                response = `Your reservation is not confirmed yet since no payment was made.`;
                break;
              case PaymentStatus.FAILED:
                response = `Your reservation is not confirmed yet since the payment failed. Please try again.`;
                break;
              default:
                response = `Your reservation is not confirmed yet.`;
                break;
            }
            break;
          case ReservationStatus.FAILED:
            response = `Your reservation is not confirmed yet. The hotel will contact you to confirm it.`;
            break;
          case ReservationStatus.CANCELLED:
            response = `Your reservation is cancelled.`;
            break;
          default:
            response = `Your reservation is in the ${reservationStatus} state.`;
            break;
        }
      }

      return cleanStringFields({
        reservation_status: response,
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * A single advance payment can cover multiple reservations (e.g. multi-room
   * bookings). This returns the distinct guest-facing IDs for every reservation
   * linked to the given payment, falling back to the single reservation if the
   * payment lookup yields nothing.
   */
  private async collectGuestFacingReservationIds(
    reservation: ReservationDTO,
    paymentId?: string,
  ): Promise<string[]> {
    const siblings = paymentId
      ? ((await this.reservationRepository.findManyReservationsWithDetailsByPaymentId(
          paymentId,
        )) ?? [reservation])
      : [reservation];

    return getGuestFacingReservationIds(siblings);
  }

  /**
   * Renders the "Your reservation ID(s) is/are ..." sentence, or an empty
   * string when no identifiers are available yet. A leading space is included
   * so the caller can append this directly to a preceding sentence.
   */
  private buildReservationIdSentence(guestFacingIds: string[]): string {
    if (guestFacingIds.length === 0) {
      return '';
    }
    if (guestFacingIds.length === 1) {
      return ` Your reservation ID is ${guestFacingIds[0]}. Use this ID for all communications.`;
    }
    return ` Your reservation IDs are ${guestFacingIds.join(', ')}. Use these IDs for all communications.`;
  }

  public async getCalendar(
    hotel_phone_number: string,
    start_date: string,
    end_date: string,
    room_id: string,
  ) {
    const formattedHotelPhoneNumber = convertToPhoneNumber(hotel_phone_number);
    if (!formattedHotelPhoneNumber) {
      throw new BadRequestError('getCalendar:: Hotel phone number is required');
    }
    const hotel =
      await this.hotelService.getHotelByAssistantPhoneNumber(
        hotel_phone_number,
      );
    if (!hotel) {
      throw new NoDataError(
        `getCalendar:: Hotel not found for assistant phone number ${hotel_phone_number}`,
      );
    }
    const calendar = await this.resNexusService.getCalendar(
      hotel.assistant_phone_number,
      start_date,
      end_date,
      room_id,
    );
    return calendar;
  }

  public async getHotelReservationList(
    hotel_id: string,
    page: number,
    limit: number,
    search?: string,
    channels?: SessionType[],
    statuses?: ReservationStatus[],
    payment_statuses?: ReservationPaymentStatus[],
    start_date?: Date,
    end_date?: Date,
    req?: GetRequestForPagination,
  ): Promise<HotelReservationListResponse> {
    const offset = (page - 1) * limit;

    const validChannels = channels
      ? channels.filter((t) => t !== SessionType.EXTERNAL)
      : Object.values(SessionType).filter((t) => t !== SessionType.EXTERNAL);

    // Get unique parent booking IDs with pagination and total count
    const [parentBookingIds, totalCount] = await Promise.all([
      this.reservationRepository.getUniqueParentBookingIds(
        hotel_id,
        offset,
        limit,
        search,
        validChannels,
        statuses,
        payment_statuses,
        start_date,
        end_date,
      ),
      this.reservationRepository.getUniqueParentBookingCount(
        hotel_id,
        search,
        validChannels,
        statuses,
        payment_statuses,
        start_date,
        end_date,
      ),
    ]);

    // Fetch all reservations for the paginated parent booking IDs
    let reservations =
      await this.reservationRepository.getReservationsByParentBookingIds(
        hotel_id,
        parentBookingIds,
      );
    reservations =
      await enrichReservationsWithPolicySignaturePresignedUrl(reservations);

    // Group reservations by parent booking ID
    const groupedReservations = this.groupReservationsByParentBookingId(
      reservations,
      parentBookingIds,
    );

    const totalPages = Math.ceil(totalCount / limit);

    const pagination: Pagination = {
      current_page: page,
      limit: limit,
      total: totalCount,
      total_pages: totalPages,
      next_page: '',
      prev_page: '',
    };

    if (req) {
      const paginationUrls = getPaginationUrls(
        req.base_path,
        req.query_params,
        page,
        limit,
        totalPages,
      );
      pagination.next_page = paginationUrls.next_page;
      pagination.prev_page = paginationUrls.prev_page;
    }

    return {
      data: groupedReservations,
      pagination,
    };
  }

  /**
   * Extracts the parent booking ID from a booking ID
   * For multi-room: BK12345_1 -> BK12345
   * For single-room: BK12345 -> BK12345
   */
  private getParentBookingId(bookingId: string): string {
    const underscoreIndex = bookingId.indexOf('_');
    if (underscoreIndex !== -1) {
      return bookingId.substring(0, underscoreIndex);
    }
    return bookingId;
  }

  /**
   * Groups reservations by their parent booking ID.
   * Single-room reservations get rooms: null
   * Multi-room reservations get aggregated values and rooms array
   */
  private groupReservationsByParentBookingId(
    reservations: ReservationDTO[],
    parentBookingIds: string[],
  ): GroupedReservation[] {
    // Group reservations by parent booking ID
    const reservationsByParent = new Map<string, ReservationDTO[]>();

    for (const reservation of reservations) {
      const parentId = this.getParentBookingId(reservation.booking_id);
      if (!reservationsByParent.has(parentId)) {
        reservationsByParent.set(parentId, []);
      }
      reservationsByParent.get(parentId)!.push(reservation);
    }

    const groupedReservations: GroupedReservation[] = [];

    for (const parentId of parentBookingIds) {
      const reservationsForParent = reservationsByParent.get(parentId);
      if (!reservationsForParent || reservationsForParent.length === 0) {
        continue;
      }

      if (reservationsForParent.length === 1) {
        // Single-room reservation
        const reservation = reservationsForParent[0];
        groupedReservations.push({
          id: reservation.id,
          booking_id: reservation.booking_id,
          external_id: reservation.external_id,
          session_id: reservation.session_id,
          check_in: reservation.check_in,
          check_out: reservation.check_out,
          status: reservation.status,
          previous_status: reservation.previous_status,
          payment_status: reservation.payment_status,
          phone_number: reservation.phone_number,
          type: reservation.type,
          business_id: reservation.business_id,
          created_at: reservation.created_at,
          updated_at: reservation.updated_at,
          customer: reservation.customer,
          num_adults: reservation.num_adults,
          num_children: reservation.num_children,
          num_pets: reservation.num_pets,
          room_type: reservation.room_type,
          room_id: reservation.room_id,
          payments: reservation.payments,
          quote: reservation.quote,
          discount: reservation.discount,
          customer_special_request: reservation.customer_special_request,
          notes_from_partner: reservation.notes_from_partner,
          rooms: null, // null for single room
          auto_charge: reservation.auto_charge,
        });
      } else {
        // Multi-room reservation - aggregate values
        const firstReservation = reservationsForParent[0];

        // Calculate aggregated values in a single pass
        const { totalAdults, totalChildren, totalPets } =
          reservationsForParent.reduce(
            (acc, r) => ({
              totalAdults: acc.totalAdults + r.num_adults,
              totalChildren: acc.totalChildren + r.num_children,
              totalPets: acc.totalPets + (r.num_pets || 0),
            }),
            { totalAdults: 0, totalChildren: 0, totalPets: 0 },
          );

        // Aggregate quote
        const aggregatedQuote: Partial<QuoteDTO> | null = this.aggregateQuotes(
          reservationsForParent,
        );

        // Build rooms array
        const rooms: RoomDetail[] = reservationsForParent.map((r) => ({
          id: r.id,
          booking_id: r.booking_id,
          external_id: r.external_id,
          room_type: r.room_type,
          room_id: r.room_id,
          num_adults: r.num_adults,
          num_children: r.num_children,
          num_pets: r.num_pets,
          status: r.status,
          previous_status: r.previous_status,
          payments: r.payments,
          quote: r.quote,
          discount: r.discount,
          customer_special_request: r.customer_special_request,
          notes_from_partner: r.notes_from_partner,
          created_at: r.created_at,
          updated_at: r.updated_at,
        }));

        groupedReservations.push({
          id: firstReservation.id,
          booking_id: parentId, // Use parent booking ID (without suffix)
          external_id: firstReservation.external_id,
          session_id: firstReservation.session_id,
          check_in: firstReservation.check_in,
          check_out: firstReservation.check_out,
          status: firstReservation.status,
          previous_status: firstReservation.previous_status,
          payment_status: firstReservation.payment_status,
          phone_number: firstReservation.phone_number,
          type: firstReservation.type,
          business_id: firstReservation.business_id,
          created_at: firstReservation.created_at,
          updated_at: firstReservation.updated_at,
          customer: firstReservation.customer,
          num_adults: totalAdults,
          num_children: totalChildren,
          num_pets: totalPets >= 0 ? totalPets : undefined,
          room_type: null, // null for multi-room (varies per room)
          room_id: null, // null for multi-room (varies per room)
          payments: firstReservation.payments,
          quote: aggregatedQuote,
          discount: null, // Discount varies per room, set to null at parent level
          customer_special_request: firstReservation.customer_special_request,
          notes_from_partner: firstReservation.notes_from_partner,
          rooms: rooms,
          auto_charge: firstReservation.auto_charge,
        });
      }
    }

    return groupedReservations;
  }

  /**
   * Aggregates quote values from multiple reservations
   */
  private aggregateQuotes(reservations: ReservationDTO[]) {
    const quotesWithData = reservations.filter((r) => r.quote !== null);
    if (quotesWithData.length === 0) {
      return null;
    }

    const firstQuote = quotesWithData[0].quote!;

    // Calculate all totals in a single pass
    const totals = quotesWithData.reduce(
      (acc, reservation) => {
        const quote = reservation.quote;
        return {
          baseRate: acc.baseRate + (quote?.base_rate || 0),
          taxes: acc.taxes + (quote?.taxes || 0),
          fees: acc.fees + (quote?.fees || 0),
          amountCharged: acc.amountCharged + (quote?.amount_charged || 0),
          totalAmount: acc.totalAmount + getReservationTotalAmount(reservation),
        };
      },
      { baseRate: 0, taxes: 0, fees: 0, amountCharged: 0, totalAmount: 0 },
    );

    return {
      id: firstQuote.id,
      reservation_id: firstQuote.reservation_id,
      base_rate: totals.baseRate,
      taxes: totals.taxes,
      fees: totals.fees,
      amount_charged: totals.amountCharged,
      total_amount: totals.totalAmount,
      created_at: firstQuote.created_at as Date,
      updated_at: firstQuote.updated_at as Date,
    };
  }

  /**
   * Exact (case-insensitive) last name + check-out date match — no fuzzy
   * matching, all statuses returned. Distinct from the guest-name lookup used
   * by getReservationDetails, which is intentionally approximate.
   */
  public async getReservationsByExactLastNameAndCheckout(
    hotelId: string,
    lastName: string,
    checkoutDate: string,
  ): Promise<ReservationDTO[]> {
    return this.reservationRepository.getReservationsByExactLastNameAndCheckout(
      hotelId,
      lastName,
      checkoutDate,
    );
  }

  public async getReservationsByBookingId(
    bookingId: string,
    hotelId: string,
  ): Promise<ReservationWithPricingBreakdown[]> {
    const reservations =
      await this.reservationRepository.findReservationsByBookingIdForHotel(
        bookingId,
        hotelId,
      );

    if (
      !reservations ||
      reservations.length === 0 ||
      reservations.some((r) => r.type === SessionType.EXTERNAL)
    ) {
      throw new NoDataError(
        `No reservation found for booking ID: ${bookingId}`,
      );
    }

    const withPricingBreakdown = reservations.map((reservation) => {
      const quote = reservation.quote;
      const hasPricingBreakdown = quote?.platform_pricing?.tax_rate != null;

      let pricingBreakdown: PricingBreakdown | undefined = undefined;
      let enrichedQuote = quote;
      if (hasPricingBreakdown && quote) {
        const taxRate = roundTaxRate(quote.platform_pricing!.tax_rate!);
        const baseRate = quote.base_rate ?? 0;
        // Resort fee = fees minus pet fee (PMS resort/facility fee only); clamp to non-negative
        const resortFeeGross = Math.max(
          0,
          (quote.fees ?? 0) - (quote.platform_pricing?.pet_fee_incl_tax ?? 0),
        );
        const resortFeeBase = roundCurrency(resortFeeGross / (1 + taxRate));
        const resortFeeTax = roundCurrency(resortFeeGross - resortFeeBase);

        // Pre-discount base = base_rate + winback_base + los_base (for PMS tax without discount)
        const winbackInclTax =
          quote.platform_pricing?.winback_discount_incl_tax ?? 0;
        const losInclTax =
          quote.platform_pricing?.length_of_stay_discount_incl_tax ?? 0;
        const winbackBase = taxRate >= 0 ? winbackInclTax / (1 + taxRate) : 0;
        const losBase = taxRate >= 0 ? losInclTax / (1 + taxRate) : 0;
        const preDiscountBase = baseRate + winbackBase + losBase;
        const pmsTax = roundCurrency(preDiscountBase * taxRate);

        // Expose derived taxes on discounted base in response when stored value missing, so quote total stays consistent
        const taxOnDiscountedBase =
          quote.taxes != null && quote.taxes !== 0
            ? quote.taxes
            : roundCurrency(baseRate * taxRate);
        if (quote.taxes == null || quote.taxes === 0) {
          enrichedQuote = { ...quote, taxes: taxOnDiscountedBase };
        }

        let petFeeInclTax: number | null = null;
        let petFeeBase: number | null = null;
        let petFeeTax: number | null = null;
        if (quote.platform_pricing?.pet_fee_incl_tax != null) {
          petFeeInclTax = quote.platform_pricing.pet_fee_incl_tax;
          petFeeBase = roundCurrency(petFeeInclTax / (1 + taxRate));
          petFeeTax = roundCurrency(petFeeInclTax - petFeeBase);
        }

        let winbackDiscountInclTax: number | null = null;
        let taxCredit: number | null = null;
        if (quote.platform_pricing?.winback_discount_incl_tax != null) {
          winbackDiscountInclTax =
            quote.platform_pricing.winback_discount_incl_tax;
          const discountPreTax =
            taxRate >= 0 ? winbackDiscountInclTax / (1 + taxRate) : 0;
          taxCredit = roundCurrency(discountPreTax * taxRate);
        }

        let lengthOfStayDiscountInclTax: number | null = null;
        let lengthOfStayTaxCredit: number | null = null;
        if (quote.platform_pricing?.length_of_stay_discount_incl_tax != null) {
          lengthOfStayDiscountInclTax =
            quote.platform_pricing.length_of_stay_discount_incl_tax;
          const losDiscountPreTax =
            taxRate >= 0 ? lengthOfStayDiscountInclTax / (1 + taxRate) : 0;
          lengthOfStayTaxCredit = roundCurrency(losDiscountPreTax * taxRate);
        }

        pricingBreakdown = {
          pms_base_rate: preDiscountBase,
          resort_fee_gross: resortFeeGross,
          resort_fee_base: resortFeeBase,
          resort_fee_tax: resortFeeTax,
          pms_tax: pmsTax,
          pet_fee_incl_tax: petFeeInclTax,
          pet_fee_base: petFeeBase,
          pet_fee_tax: petFeeTax,
          winback_discount_incl_tax: winbackDiscountInclTax,
          tax_credit: taxCredit,
          length_of_stay_discount_incl_tax: lengthOfStayDiscountInclTax,
          length_of_stay_tax_credit: lengthOfStayTaxCredit,
        };
      }

      return {
        ...reservation,
        ...(enrichedQuote ? { quote: enrichedQuote } : {}),
        has_pricing_breakdown: hasPricingBreakdown,
        ...(hasPricingBreakdown ? { pricing_breakdown: pricingBreakdown } : {}),
      };
    });
    return await enrichReservationsWithPolicySignaturePresignedUrl(
      withPricingBreakdown,
    );
  }

  public async getConversationSummaryByBookingId(
    bookingId: string,
    hotelId: string,
  ): Promise<ConversationSummary> {
    // Get reservation to extract session_id
    const reservations =
      await this.reservationRepository.findReservationsByBookingIdForHotel(
        bookingId,
        hotelId,
      );

    if (
      !reservations ||
      reservations.length === 0 ||
      reservations.some((r) => r.type === SessionType.EXTERNAL)
    ) {
      throw new NoDataError(
        `No reservation found for booking ID: ${bookingId}`,
      );
    }

    const sessionId = reservations[0].session_id;
    if (!sessionId) {
      throw new NoDataError(`No session found for booking ID: ${bookingId}`);
    }

    // Reuse existing conversation service
    const conversationSummary =
      await conversationService.getConversationSummaryBySessionid(sessionId);

    if (
      !conversationSummary ||
      (!conversationSummary.summary &&
        !conversationSummary.recording_url &&
        !conversationSummary.recording_presigned_url)
    ) {
      throw new NoDataError(
        `No conversation summary found for booking ID: ${bookingId}`,
      );
    }

    return conversationSummary;
  }

  public async getTranscriptsByBookingId(
    bookingId: string,
    hotelId: string,
    page: number = 1,
    limit: number = 10,
    req?: GetRequestForPagination,
  ): Promise<Transcript> {
    // Get reservation to extract session_id
    const reservations =
      await this.reservationRepository.findReservationsByBookingIdForHotel(
        bookingId,
        hotelId,
      );

    if (
      !reservations ||
      reservations.length === 0 ||
      reservations.some((r) => r.type === SessionType.EXTERNAL)
    ) {
      throw new NoDataError(
        `No reservation found for booking ID: ${bookingId}`,
      );
    }

    const sessionId = reservations[0].session_id;
    if (!sessionId) {
      throw new NoDataError(`No session found for booking ID: ${bookingId}`);
    }
    const channelType = reservations[0].type;
    const reservationCreatedDate = reservations[0].created_at;

    // Reuse existing conversation service - returns empty data if no transcripts
    const transcripts =
      await conversationService.getPaginatedConversationTranscriptBySessionId(
        sessionId,
        channelType,
        page,
        limit,
        req || { base_path: '', query_params: {} },
        reservationCreatedDate,
      );

    // Return empty result if no transcripts (not 404)
    if (!transcripts) {
      return {
        data: [],
        pagination: {
          current_page: page,
          limit: limit,
          total: 0,
          total_pages: 0,
          next_page: '',
          prev_page: '',
        },
      };
    }

    return transcripts;
  }

  /**
   * Marks payment as collected offline for a booking
   * @param bookingId The booking ID
   * @param hotelId The hotel ID
   * @param request The payment collection request data
   * @returns Payment collection response
   */
  public async markPaymentCollectedOffline(
    bookingId: string,
    hotelId: string,
    request: MarkPaymentCollectedRequest,
  ): Promise<MarkPaymentCollectedResponse> {
    const transaction = await db.transaction();

    try {
      // 1. Fetch all reservations for the booking ID (enriched with pricing_breakdown for correct total)
      const reservations = await this.getReservationsByBookingId(
        bookingId,
        hotelId,
      );

      if (!reservations || reservations.length === 0) {
        throw new NoDataError(
          `No reservation found for booking ID: ${bookingId}`,
        );
      }

      if (hasNoDextrPayment(reservations[0].payment_status)) {
        throw new BadRequestError(
          `Booking ${bookingId} ${noDextrPaymentReason(reservations[0].payment_status)}. Manual payment collection is not supported.`,
        );
      }

      const reservationIds = reservations.map((r) => r.id);

      // Filter only completed payments
      // Do not include refunded amount for calculating remaining amount
      let { totalReservationAmount, totalPaidAmount } =
        await this._getReservationPaymentInfo(reservations);
      totalReservationAmount = roundCurrency(totalReservationAmount);
      totalPaidAmount = roundCurrency(totalPaidAmount);

      // 3. Calculate remaining amount
      const remainingAmount = roundCurrency(
        totalReservationAmount - totalPaidAmount,
      );

      if (remainingAmount <= 0) {
        throw new BadRequestError(
          `Payment already fully collected for booking ID: ${bookingId}`,
        );
      }

      // 4. Validate requested amount
      const amountToCollect = roundCurrency(request.amount ?? remainingAmount);

      if (amountToCollect <= 0) {
        throw new BadRequestError(`Amount to collect must be positive`);
      }

      if (amountToCollect > remainingAmount) {
        throw new BadRequestError(
          `Requested amount (${roundCurrency(amountToCollect)}) exceeds remaining amount (${roundCurrency(remainingAmount)})`,
        );
      }

      // 5. Get currency from first reservation
      if (!reservations[0].hotel || !reservations[0].hotel.currency) {
        throw new BadRequestError(
          `Currency information is missing for the hotel associated with booking ID: ${bookingId}`,
        );
      }
      const currencyCode =
        Currency[reservations[0].hotel.currency as keyof typeof Currency];
      if (!currencyCode) {
        throw new BadRequestError(
          `markPaymentCollectedOffline: Unsupported currency symbol: ${reservations[0].hotel.currency}`,
        );
      }

      const paymentCreationData: Omit<
        Payment,
        | 'id'
        | 'created_at'
        | 'updated_at'
        | 'payment_link'
        | 'booking_confirmation_id'
      > = {
        hotel_id: hotelId,
        amount_charged: amountToCollect,
        payment_status: PaymentStatus.COMPLETED,
        currency: currencyCode,
        payment_provider: reservations[0].hotel.payment_provider,
      };

      // 6. Create offline payment record
      const offlinePayment = await this.paymentService.createPaymentWithoutLink(
        paymentCreationData,
        transaction,
      );

      // 7. Create junction table records linking payment to all reservations in the booking
      await this.paymentReservationRepository.linkPaymentToReservations(
        offlinePayment.id,
        reservationIds,
        transaction,
      );

      // diable auto charge if any
      await this.setupAutoCharge(
        bookingId,
        hotelId,
        { is_enabled: false },
        transaction,
      );

      await transaction.commit();

      await this.updateReservationPaymentStatusFromPaymentInfo(
        reservations,
        'CREDIT',
      );

      // 8. Return success response
      const newRemainingAmount = roundCurrency(
        remainingAmount - amountToCollect,
      );

      return {
        success: true,
        message: `Payment of ${formatCurrencyAmount(currencyCode, amountToCollect)} marked as collected offline`,
        payment_id: offlinePayment.id,
        amount_collected: amountToCollect,
        remaining_amount: newRemainingAmount,
        total_reservation_amount: totalReservationAmount,
        reservations_affected: reservationIds,
      };
    } catch (error) {
      await transaction.rollback();

      if (error instanceof BaseError) {
        throw error;
      }

      logger.error(
        `markPaymentCollectedOffline: Error marking payment as collected for booking ${bookingId}: ${error}`,
      );
      throw new BaseError(`Failed to mark payment as collected: ${error}`);
    }
  }

  /**
   * Charges an existing reservation directly using stored customer payment method
   * @param bookingId - The booking ID to charge
   * @param hotelId - The hotel ID for validation
   * @param request - The charge request with amount
   * @returns The charge result
   */
  public async chargeReservationImmediately(
    bookingId: string,
    hotelId: string,
    request: ChargeReservationRequest,
  ): Promise<ChargeReservationResponse> {
    const trx = await db.transaction();
    try {
      logger.info(
        `chargeReservationImmediately: Starting direct charge for booking ${bookingId} with amount ${roundCurrency(request.amount)}`,
      );

      const reservations = await this.getReservationsByBookingId(
        bookingId,
        hotelId,
      );
      if (!reservations || reservations.length === 0) {
        throw new NoDataError(
          `No reservations found for booking ID ${bookingId}`,
        );
      }

      if (hasNoDextrPayment(reservations[0].payment_status)) {
        throw new BadRequestError(
          `Booking ${bookingId} ${noDextrPaymentReason(reservations[0].payment_status)}. Direct charging is not supported.`,
        );
      }

      const reservationIds = reservations.map((r) => r.id);
      const firstReservation = reservations[0];
      const hotel = await this.hotelService.getHotelById(hotelId);
      if (!hotel) {
        throw new NoDataError(`Hotel not found for ID ${hotelId}`);
      }

      let result: ChargeProviderResult;
      switch (hotel.payment_provider) {
        case PaymentProvider.SHIFT4:
          result = await this.chargeReservationImmediatelyShift4(
            bookingId,
            hotelId,
            request,
            reservations,
            reservationIds,
            firstReservation,
            hotel,
            trx,
          );
          break;
        case PaymentProvider.MEWS:
          result = await this.chargeReservationImmediatelyMews(
            bookingId,
            hotelId,
            request,
            reservations,
            reservationIds,
            firstReservation,
            hotel,
            trx,
          );
          break;
        case PaymentProvider.CLOUDBEDS_SDK:
          logger.info(
            `chargeReservationImmediately: Skipping direct charge for Cloudbeds SDK hotel ${hotelId} — charging managed by Cloudbeds`,
          );
          await trx.rollback();
          return {
            success: false,
            message:
              'Direct charging is not supported for Cloudbeds SDK hotels. Charges are managed by Cloudbeds.',
            amount_charged: 0,
            reservation_ids: reservationIds,
          };
        default:
          result = await this.chargeReservationImmediatelyStripe(
            bookingId,
            hotelId,
            request,
            reservations,
            reservationIds,
            firstReservation,
            hotel,
            trx,
          );
          break;
      }

      if (!result.transactionCommitted) {
        await trx.commit();
      }

      if (
        result.success &&
        result.shift4SaleData &&
        result.shift4PaymentRecord &&
        hotel.pms_provider === PmsProvider.STAYNTOUCH
      ) {
        try {
          await this.recordPaymentInStayntouch(
            reservations,
            result.shift4SaleData,
            result.shift4PaymentRecord,
          );
        } catch (error) {
          logger.error(
            `chargeReservationImmediately: Failed to record Shift4 payment in Stayntouch for booking ${bookingId}: ${error}`,
          );
        }
      }

      // Record the charge on the Opera folio if the hotel is Opera-backed
      // through Calry (no-op for other PMS)
      if (result.success && result.paymentId) {
        const chargedPayment = await this.paymentService.getPaymentById(
          result.paymentId,
        );
        if (chargedPayment) {
          await recordCollectedPaymentInOpera({
            reservations,
            currency: hotel.currency,
            payment: chargedPayment,
            isAutoCharge: true,
          });
        }
      }

      if (result.success && request.send_guest_notification) {
        await this.sendChargeGuestSMS(
          bookingId,
          reservations,
          firstReservation,
          hotel,
          result.hotelConfiguration,
          request,
          result.paymentId,
        );
      }

      return {
        success: result.success,
        message: result.success
          ? `Payment of ${formatCurrencyAmount(hotel.currency, request.amount)} processed successfully`
          : result.errorMessage || 'Payment charge failed',
        payment_id: result.paymentId,
        amount_charged: roundCurrency(request.amount),
        charge_id: result.chargeId,
        payment_status: result.paymentStatus,
        reservation_ids: reservations.map((r) => r.id),
      };
    } catch (error) {
      if (!trx.isCompleted()) {
        await trx.rollback();
      }
      logger.error(
        `chargeReservationImmediately: Error charging reservation for booking ${bookingId}: ${error}`,
      );
      throw error;
    }
  }

  private async chargeReservationImmediatelyShift4(
    bookingId: string,
    hotelId: string,
    request: ChargeReservationRequest,
    reservations: ReservationWithPricingBreakdown[],
    reservationIds: string[],
    firstReservation: ReservationWithPricingBreakdown,
    hotel: Hotel,
    trx: Knex.Transaction,
  ): Promise<ChargeProviderResult> {
    const cardMetadata = firstReservation.customer.card_metadata;
    if (
      !cardMetadata ||
      !cardMetadata.token ||
      !cardMetadata.expiration_month ||
      !cardMetadata.expiration_year ||
      !cardMetadata.transaction_id
    ) {
      throw new BadRequestError(
        `Customer ${firstReservation.customer.id} does not have stored card metadata required for Shift4 charge`,
      );
    }

    const hotelShift4Config = config.HOTEL_SHIFT4_CONFIG[hotel.id];
    if (!hotelShift4Config) {
      throw new BadRequestError(
        `Shift4 payment configuration not found for hotel ${hotel.id}`,
      );
    }

    const hotelConfiguration =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        hotel.id,
      );
    const currencyCode = Currency[hotel.currency as keyof typeof Currency];
    const totalAdults = reservations.reduce(
      (sum, r) => sum + (r.num_adults || 0),
      0,
    );
    const totalChildren = reservations.reduce(
      (sum, r) => sum + (r.num_children || 0),
      0,
    );

    const invoiceId = await this.paymentService.generateUniqueInvoiceId();
    logger.info(
      `chargeReservationImmediately: Generated Shift4 invoice ID ${invoiceId} for booking ${bookingId}`,
    );

    const paymentMetadata: PaymentCreationMetadata = {
      hotel_id: hotel.id,
      hotel_name: hotel.name,
      hotel_phone_number: hotel.assistant_phone_number,
      hotel_sms_number: hotel.sms_number,
      hotel_url: hotel.url,
      hotel_country: hotel.country,
      payment_provider: hotel.payment_provider,
      customer_phone: firstReservation.customer.phone_number || '',
      check_in: dayjs(firstReservation.check_in).format('YYYY-MM-DD'),
      check_out: dayjs(firstReservation.check_out).format('YYYY-MM-DD'),
      num_adults: totalAdults,
      num_children: totalChildren,
      room_count: reservations.length,
      reservation_type: firstReservation.type,
    };

    const paymentCreationData: Omit<
      Payment,
      | 'id'
      | 'created_at'
      | 'updated_at'
      | 'payment_link'
      | 'booking_confirmation_id'
    > = {
      hotel_id: hotel.id,
      amount_charged: request.amount,
      currency: currencyCode,
      payment_status: PaymentStatus.PENDING,
      amount_refunded: 0,
      metadata: paymentMetadata,
      payment_provider: hotel.payment_provider,
      payment_link_id: invoiceId,
    };

    const shift4PaymentRecord =
      await this.paymentService.createPaymentWithoutLink(
        paymentCreationData,
        trx,
      );
    await this.paymentReservationRepository.linkPaymentToReservations(
      shift4PaymentRecord.id,
      reservationIds,
      trx,
    );

    // Commit the PENDING payment record before calling Shift4 so it is always
    // persisted — even if the charge succeeds but a downstream update fails.
    await trx.commit();

    const isManualCharge = true;
    const shift4ChargeResult = await shift4DelayedCharge({
      bookingId,
      hotel,
      hotelConfig: hotelConfiguration,
      reservations,
      chargeAmount: request.amount,
      invoiceId,
      isManualCharge,
    });

    if (shift4ChargeResult.success) {
      try {
        await this.paymentService.updatePaymentStatusById(
          shift4PaymentRecord.id,
          PaymentStatus.COMPLETED,
        );
        await this.paymentService.updatePaymentById(shift4PaymentRecord.id, {
          booking_confirmation_id: invoiceId,
        });
        await this.setupAutoChargeShift4(bookingId, hotelId, {
          is_enabled: false,
        });
        await this.updateReservationPaymentStatusFromPaymentInfo(
          reservations,
          'CREDIT',
        );
        logger.info(
          `chargeReservationImmediately: Shift4 charge successful for booking ${bookingId}, payment ${shift4PaymentRecord.id}`,
        );
      } catch (updateError) {
        logger.error(
          `chargeReservationImmediately: CRITICAL - Shift4 charge succeeded but post-charge updates failed. ` +
            `Booking: ${bookingId}, InvoiceId: ${invoiceId}, PaymentId: ${shift4PaymentRecord.id}, Amount: ${roundCurrency(request.amount)}. ` +
            `Manual reconciliation required.`,
          updateError,
        );
        throw new PaymentSucceededProcessingFailedError(
          `Payment was collected but booking finalisation failed. Contact support with reference: ${invoiceId}.`,
          shift4PaymentRecord.id,
          invoiceId,
        );
      }
    }

    return {
      success: shift4ChargeResult.success,
      paymentId: shift4PaymentRecord.id,
      chargeId: invoiceId,
      paymentStatus: shift4ChargeResult.success
        ? PaymentStatus.COMPLETED
        : PaymentStatus.PENDING,
      errorMessage: shift4ChargeResult.success
        ? undefined
        : `Payment charge failed with response code: ${shift4ChargeResult.responseCode}`,
      hotelConfiguration,
      shift4SaleData: shift4ChargeResult.result ?? undefined,
      shift4PaymentRecord,
      transactionCommitted: true,
    };
  }

  private async chargeReservationImmediatelyMews(
    bookingId: string,
    hotelId: string,
    request: ChargeReservationRequest,
    reservations: ReservationWithPricingBreakdown[],
    reservationIds: string[],
    firstReservation: ReservationWithPricingBreakdown,
    hotel: Hotel,
    trx: Knex.Transaction,
  ): Promise<ChargeProviderResult> {
    const creditCardId = firstReservation.customer.card_metadata?.token;
    if (!creditCardId) {
      throw new BadRequestError(
        `Customer ${firstReservation.customer.id} does not have a stored Mews card token for direct charge`,
      );
    }

    const hotelConfiguration =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        hotel.id,
      );
    const currencyCode = Currency[hotel.currency as keyof typeof Currency];
    const totalAdults = reservations.reduce(
      (sum, r) => sum + (r.num_adults || 0),
      0,
    );
    const totalChildren = reservations.reduce(
      (sum, r) => sum + (r.num_children || 0),
      0,
    );

    const paymentMetadata: PaymentCreationMetadata = {
      hotel_id: hotel.id,
      hotel_name: hotel.name,
      hotel_phone_number: hotel.assistant_phone_number,
      hotel_sms_number: hotel.sms_number,
      hotel_url: hotel.url,
      hotel_country: hotel.country,
      payment_provider: hotel.payment_provider,
      customer_phone: firstReservation.customer.phone_number || '',
      check_in: dayjs(firstReservation.check_in).format('YYYY-MM-DD'),
      check_out: dayjs(firstReservation.check_out).format('YYYY-MM-DD'),
      num_adults: totalAdults,
      num_children: totalChildren,
      room_count: reservations.length,
      reservation_type: firstReservation.type,
    };

    // No invoice concept for Mews — payment_link_id is left unset.
    const paymentCreationData: Omit<
      Payment,
      | 'id'
      | 'created_at'
      | 'updated_at'
      | 'payment_link'
      | 'booking_confirmation_id'
    > = {
      hotel_id: hotel.id,
      amount_charged: request.amount,
      currency: currencyCode,
      payment_status: PaymentStatus.PENDING,
      amount_refunded: 0,
      metadata: paymentMetadata,
      payment_provider: hotel.payment_provider,
    };

    const mewsPaymentRecord =
      await this.paymentService.createPaymentWithoutLink(
        paymentCreationData,
        trx,
      );
    await this.paymentReservationRepository.linkPaymentToReservations(
      mewsPaymentRecord.id,
      reservationIds,
      trx,
    );

    // Commit the PENDING payment record before calling Mews so it is always
    // persisted — even if the charge succeeds but a downstream update fails.
    await trx.commit();

    const executor: IAutoChargeExecutor = autoChargeExecutorFactory.getExecutor(
      PaymentProvider.MEWS,
    );
    const mewsChargeResult = await executor.executeAutoCharge({
      bookingIdPrefix: bookingId,
      hotel,
      hotelConfig: hotelConfiguration,
      reservations,
      amount: request.amount,
      paymentId: mewsPaymentRecord.id,
      isManualCharge: true,
    });

    if (mewsChargeResult.success) {
      try {
        await this.paymentService.updatePaymentStatusById(
          mewsPaymentRecord.id,
          PaymentStatus.COMPLETED,
        );
        await this.paymentService.updatePaymentById(mewsPaymentRecord.id, {
          booking_confirmation_id: mewsChargeResult.bookingConfirmationId,
        });
        // Persist Mews account/card ids so refunds (which require an
        // AccountId) work on this charge.
        if (mewsChargeResult.mewsAccountId) {
          // Best-effort enrichment: a failure here must not fail an already
          // successful charge, so it is not allowed to reach the outer catch.
          try {
            await this.paymentService.updatePaymentMetadata(
              mewsPaymentRecord.id,
              {
                mews_account_id: mewsChargeResult.mewsAccountId,
                mews_credit_card_id: mewsChargeResult.mewsCreditCardId,
              },
            );
          } catch (metadataError) {
            logger.error(
              `chargeReservationImmediately: Failed to persist mews_account_id for payment ${mewsPaymentRecord.id}; refunds for this payment will fail`,
              metadataError,
            );
          }
        } else {
          logger.warn(
            `chargeReservationImmediately: mews_account_id unresolved for payment ${mewsPaymentRecord.id}; refunds for this payment will fail`,
          );
        }
        await this.setupAutoChargeMews(bookingId, hotelId, {
          is_enabled: false,
        });
        await this.updateReservationPaymentStatusFromPaymentInfo(
          reservations,
          'CREDIT',
        );
        logger.info(
          `chargeReservationImmediately: Mews charge successful for booking ${bookingId}, payment ${mewsPaymentRecord.id}`,
        );
      } catch (updateError) {
        logger.error(
          `chargeReservationImmediately: CRITICAL - Mews charge succeeded but post-charge updates failed. ` +
            `Booking: ${bookingId}, PaymentId: ${mewsPaymentRecord.id}, Amount: ${roundCurrency(request.amount)}. ` +
            `Manual reconciliation required.`,
          updateError,
        );
        throw new PaymentSucceededProcessingFailedError(
          `Payment was collected but booking finalisation failed. Contact support with reference: ${mewsPaymentRecord.id}.`,
          mewsPaymentRecord.id,
          mewsChargeResult.bookingConfirmationId || mewsPaymentRecord.id,
        );
      }
    }

    return {
      success: mewsChargeResult.success,
      paymentId: mewsPaymentRecord.id,
      chargeId: mewsChargeResult.bookingConfirmationId,
      paymentStatus: mewsChargeResult.success
        ? PaymentStatus.COMPLETED
        : PaymentStatus.PENDING,
      errorMessage: mewsChargeResult.success
        ? undefined
        : `Payment charge failed: ${mewsChargeResult.error || 'Unknown error'}`,
      hotelConfiguration,
      transactionCommitted: true,
    };
  }

  private async chargeReservationImmediatelyCloudbeds(
    bookingId: string,
    hotelId: string,
    request: ChargeReservationRequest,
    reservations: ReservationWithPricingBreakdown[],
    reservationIds: string[],
    firstReservation: ReservationWithPricingBreakdown,
    hotel: Hotel,
    trx: Knex.Transaction,
  ): Promise<ChargeProviderResult> {
    const paymentMethodId = firstReservation.customer.card_metadata?.token;
    if (!paymentMethodId) {
      throw new BadRequestError(
        `Customer ${firstReservation.customer.id} does not have a stored Cloudbeds paymentMethodId for direct charge`,
      );
    }

    const cloudbedsReservationId = firstReservation.external_id;
    if (!cloudbedsReservationId) {
      throw new BadRequestError(
        `Reservation ${firstReservation.id} is missing external_id (Cloudbeds reservationID)`,
      );
    }

    const hotelConfiguration =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        hotel.id,
      );
    const currencyCode = Currency[hotel.currency as keyof typeof Currency];
    const totalAdults = reservations.reduce(
      (sum, r) => sum + (r.num_adults || 0),
      0,
    );
    const totalChildren = reservations.reduce(
      (sum, r) => sum + (r.num_children || 0),
      0,
    );

    const paymentMetadata: PaymentCreationMetadata = {
      hotel_id: hotel.id,
      hotel_name: hotel.name,
      hotel_phone_number: hotel.assistant_phone_number,
      hotel_sms_number: hotel.sms_number,
      hotel_url: hotel.url,
      hotel_country: hotel.country,
      payment_provider: hotel.payment_provider,
      customer_phone: firstReservation.customer.phone_number || '',
      check_in: dayjs(firstReservation.check_in).format('YYYY-MM-DD'),
      check_out: dayjs(firstReservation.check_out).format('YYYY-MM-DD'),
      num_adults: totalAdults,
      num_children: totalChildren,
      room_count: reservations.length,
      reservation_type: firstReservation.type,
    };

    const paymentCreationData: Omit<
      Payment,
      | 'id'
      | 'created_at'
      | 'updated_at'
      | 'payment_link'
      | 'booking_confirmation_id'
    > = {
      hotel_id: hotel.id,
      amount_charged: request.amount,
      currency: currencyCode,
      payment_status: PaymentStatus.PENDING,
      amount_refunded: 0,
      metadata: paymentMetadata,
      payment_provider: hotel.payment_provider,
    };

    const cbPaymentRecord = await this.paymentService.createPaymentWithoutLink(
      paymentCreationData,
      trx,
    );
    await this.paymentReservationRepository.linkPaymentToReservations(
      cbPaymentRecord.id,
      reservationIds,
      trx,
    );

    await trx.commit();

    const executor: IAutoChargeExecutor = autoChargeExecutorFactory.getExecutor(
      PaymentProvider.CLOUDBEDS_SDK,
    );
    const cbChargeResult = await executor.executeAutoCharge({
      bookingIdPrefix: bookingId,
      hotel,
      hotelConfig: hotelConfiguration,
      reservations,
      amount: request.amount,
      paymentId: cbPaymentRecord.id,
      isManualCharge: true,
    });

    if (cbChargeResult.success) {
      try {
        await this.paymentService.updatePaymentStatusById(
          cbPaymentRecord.id,
          PaymentStatus.COMPLETED,
        );
        await this.paymentService.updatePaymentById(cbPaymentRecord.id, {
          booking_confirmation_id: cbChargeResult.bookingConfirmationId,
          metadata: {
            ...paymentMetadata,
            cloudbeds_payment_method_id: paymentMethodId,
          },
        });
        await this.updateReservationPaymentStatusFromPaymentInfo(
          reservations,
          'CREDIT',
        );
        logger.info(
          `chargeReservationImmediately: Cloudbeds charge successful for booking ${bookingId}, payment ${cbPaymentRecord.id}`,
        );
      } catch (updateError) {
        logger.error(
          `chargeReservationImmediately: CRITICAL - Cloudbeds charge succeeded but post-charge updates failed. ` +
            `Booking: ${bookingId}, PaymentId: ${cbPaymentRecord.id}, Amount: ${roundCurrency(request.amount)}. ` +
            `Manual reconciliation required.`,
          updateError,
        );
        throw new PaymentSucceededProcessingFailedError(
          `Payment was collected but booking finalisation failed. Contact support with reference: ${cbPaymentRecord.id}.`,
          cbPaymentRecord.id,
          cbChargeResult.bookingConfirmationId || cbPaymentRecord.id,
        );
      }
    }

    return {
      success: cbChargeResult.success,
      paymentId: cbPaymentRecord.id,
      chargeId: cbChargeResult.bookingConfirmationId,
      paymentStatus: cbChargeResult.success
        ? PaymentStatus.COMPLETED
        : PaymentStatus.PENDING,
      errorMessage: cbChargeResult.success
        ? undefined
        : `Payment charge failed: ${cbChargeResult.error || 'Unknown error'}`,
      hotelConfiguration,
      transactionCommitted: true,
    };
  }

  private async chargeReservationImmediatelyStripe(
    bookingId: string,
    hotelId: string,
    request: ChargeReservationRequest,
    reservations: ReservationWithPricingBreakdown[],
    reservationIds: string[],
    firstReservation: ReservationWithPricingBreakdown,
    hotel: Hotel,
    trx: Knex.Transaction,
  ): Promise<ChargeProviderResult> {
    if (!firstReservation.customer.payment_provider_customer_id) {
      throw new BadRequestError(
        `Customer ${firstReservation.customer.id} does not have a payment provider customer ID`,
      );
    }

    const hotelConfiguration =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        hotel.id,
        trx,
      );

    const metadata: PaymentCreationMetadata = {
      hotel_id: hotel.id,
      hotel_name: hotel.name,
      hotel_phone_number: hotel.assistant_phone_number,
      hotel_sms_number: hotel.sms_number,
      hotel_url: hotel.url,
      hotel_country: hotel.country,
      payment_provider: hotel.payment_provider,
      customer_phone: firstReservation.customer.phone_number,
      check_in: dayjs(firstReservation.check_in).format('YYYY-MM-DD'),
      check_out: dayjs(firstReservation.check_out).format('YYYY-MM-DD'),
      num_adults: firstReservation.num_adults,
      num_children: firstReservation.num_children,
      room_count: reservations.length,
      reservation_type: firstReservation.type,
    };

    // Generate payment description for Stripe
    const description =
      request.reason ||
      this.paymentService.generatePaymentDescription(
        dayjs(firstReservation.check_in).format('YYYY-MM-DD'),
        dayjs(firstReservation.check_out).format('YYYY-MM-DD'),
      );

    const connectedAccountId =
      hotelConfiguration?.payment_account_id ?? undefined;
    const currencyCode = Currency[hotel.currency as keyof typeof Currency];

    // Create a payment Record and charge customer using payment intent
    const chargeResult = await this.paymentService.createAndChargePaymentIntent(
      {
        amount: request.amount,
        currency: currencyCode,
        description,
        customerId: firstReservation.customer.payment_provider_customer_id,
        metadata,
        connectedAccountId,
        payment_provider: hotel.payment_provider,
      },
      reservationIds,
      trx,
    );

    if (chargeResult.success) {
      // Disable any existing auto-charge since manual charge was made
      await this.setupAutoCharge(
        bookingId,
        hotelId,
        { is_enabled: false },
        trx,
      );
      logger.info(
        `chargeReservationImmediately: Stripe charge successful for booking ${bookingId}, payment ${chargeResult.paymentRecord?.id ?? ''}`,
      );
    }

    return {
      success: chargeResult.success,
      paymentId: chargeResult.paymentRecord?.id,
      chargeId: chargeResult.chargeId,
      paymentStatus: chargeResult.paymentRecord?.payment_status,
      errorMessage: chargeResult.success
        ? undefined
        : `Payment charge failed: ${chargeResult.error || 'Unknown error'}`,
      hotelConfiguration,
    };
  }

  private async sendChargeGuestSMS(
    bookingId: string,
    reservations: ReservationWithPricingBreakdown[],
    firstReservation: ReservationWithPricingBreakdown,
    hotel: Hotel,
    hotelConfiguration: HotelConfiguration | null | undefined,
    request: ChargeReservationRequest,
    paymentId: string | undefined,
  ): Promise<void> {
    try {
      const toPhone = await resolveSmsTargetPhoneNumber(
        firstReservation.customer.phone_number,
        firstReservation.phone_number,
        hotelConfiguration?.twilio_configuration,
        hotel.country,
        false,
      );
      if (!toPhone) {
        logger.warn(
          `chargeReservationImmediately: No valid phone number for booking ${bookingId}`,
        );
        return;
      }

      const smsContent = {
        message: guestChargedSMSTemplate(
          firstReservation.customer.first_name || 'Guest',
          hotel.name,
          request.amount,
          hotel.currency,
          hotel.internal_phone_number || hotel.sms_number || '',
          hotel.country,
          request.reason,
          hotelConfiguration?.sms_agent_enabled || false,
        ),
        from: hotel.sms_number,
        twilioConfiguration: hotelConfiguration?.twilio_configuration,
      };

      const smsResult = await this.smsService.sendMessage({
        recipient: toPhone,
        content: smsContent,
      });

      if (smsResult) {
        smsEvents.emitSmsSent({
          sessionId: reservations[0].session_id,
          message: smsContent.message,
          from: hotel.sms_number,
          to: toPhone,
          callerPhoneNumber: firstReservation.phone_number,
          assistantPhoneNumber: hotel.assistant_phone_number,
          timestamp: new Date(),
          hotelSmsNumber: hotel.sms_number,
          smsAgentEnabled: hotelConfiguration?.sms_agent_enabled || false,
          hotelId: hotel.id,
        });
      }
    } catch (error) {
      logger.error(
        `chargeReservationImmediately: Failed to send guest notification SMS for booking ${bookingId}, payment ${paymentId}: ${error}`,
      );
    }
  }

  /**
   * Sends booking link SMS to the caller
   * @param bookingLink - The booking link URL
   * @param callerPhoneNumber - The phone number to send SMS to
   * @param assistantPhoneNumber - The hotel assistant phone number
   */
  public async sendBookingLinkSMS(
    bookingLink: string,
    callerPhoneNumber: string,
    assistantPhoneNumber: string,
    sessionId: string,
  ): Promise<void> {
    // Get hotel details
    const hotel =
      await this.hotelService.getHotelByAssistantPhoneNumber(
        assistantPhoneNumber,
      );
    if (!hotel) {
      throw new NoDataError(
        `sendBookingLinkSMS: Hotel not found for assistant phone number: ${assistantPhoneNumber}`,
      );
    }

    const hotelConfiguration =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        hotel.id,
      );

    if (!hotel.sms_number) {
      throw new BadRequestError(
        `sendBookingLinkSMS: Hotel ${hotel.name} does not have an SMS number configured`,
      );
    }

    // Generate SMS message
    const message = bookingLinkSMSTemplate(hotel.name, bookingLink);

    const smsContent = {
      message,
      from: hotel.sms_number,
      twilioConfiguration: hotelConfiguration?.twilio_configuration,
    };
    // Send SMS
    const smsResult = await this.smsService.sendMessage({
      recipient: callerPhoneNumber,
      content: smsContent,
    });
    logger.info(
      `sendBookingLinkSMS: Booking link SMS sent to ${callerPhoneNumber} for hotel ${hotel.name}`,
    );

    if (smsResult) {
      smsEvents.emitSmsSent({
        sessionId,
        message: smsContent.message,
        from: smsContent.from,
        to: callerPhoneNumber,
        callerPhoneNumber: callerPhoneNumber,
        assistantPhoneNumber: assistantPhoneNumber,
        timestamp: new Date(),
        hotelSmsNumber: hotel.sms_number,
        smsAgentEnabled: hotelConfiguration?.sms_agent_enabled || false,
        hotelId: hotel.id,
      });
    }
  }

  public async sendSMS(
    message: string,
    callerPhoneNumber: string,
    assistantPhoneNumber: string,
    sessionId: string,
  ): Promise<void> {
    const hotel =
      await this.hotelService.getHotelByAssistantPhoneNumber(
        assistantPhoneNumber,
      );
    if (!hotel) {
      throw new NoDataError(
        `sendSMS: Hotel not found for assistant phone number: ${assistantPhoneNumber}`,
      );
    }

    const hotelConfiguration =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        hotel.id,
      );

    if (!hotel.sms_number) {
      throw new BadRequestError(
        `sendSMS: Hotel ${hotel.name} does not have an SMS number configured`,
      );
    }

    const smsContent = {
      message,
      from: hotel.sms_number,
      twilioConfiguration: hotelConfiguration?.twilio_configuration,
    };

    const smsResult = await this.smsService.sendMessage({
      recipient: callerPhoneNumber,
      content: smsContent,
    });
    logger.info(
      `sendSMS: SMS sent to ${callerPhoneNumber} for hotel ${hotel.name}`,
    );

    if (smsResult) {
      smsEvents.emitSmsSent({
        sessionId,
        message: smsContent.message,
        from: smsContent.from,
        to: callerPhoneNumber,
        callerPhoneNumber: callerPhoneNumber,
        assistantPhoneNumber: assistantPhoneNumber,
        timestamp: new Date(),
        hotelSmsNumber: hotel.sms_number,
        smsAgentEnabled: hotelConfiguration?.sms_agent_enabled || false,
        hotelId: hotel.id,
      });
    }
  }

  /**
   * Setup auto-charge for Shift4 reservations
   * Stores auto-charge configuration in the reservation record
   * @param bookingIdPrefix - The booking ID for single-room reservation. The common prefix otherwise
   * @param hotelId - The hotel ID
   * @param request - The auto-charge setup request
   * @param transaction - Optional transaction
   * @returns Auto-charge setup response
   */
  public async setupAutoChargeShift4(
    bookingIdPrefix: string,
    hotelId: string,
    request: SetupAutoChargeRequest,
    transaction?: Knex.Transaction,
  ): Promise<SetupAutoChargeResponse> {
    const trx = transaction || (await db.transaction());
    try {
      // 1. Get reservations by booking ID
      const reservations = await this.getReservationsByBookingId(
        bookingIdPrefix,
        hotelId,
      );

      if (!reservations.length) {
        throw new NoDataError(
          `No reservations found for booking ID prefix: ${bookingIdPrefix}`,
        );
      }

      if (hasNoDextrPayment(reservations[0].payment_status)) {
        throw new BadRequestError(
          `Booking ${bookingIdPrefix} ${noDextrPaymentReason(reservations[0].payment_status)}. Auto-charge is not supported.`,
        );
      }

      const reservation = reservations[0];
      const customer = reservation.customer;
      const hotel = reservation.hotel;
      if (!hotel) {
        throw new NoDataError('Hotel information not found for reservation');
      }

      const existingAutoChargeConfig = reservation.auto_charge;

      if (request.is_enabled === false) {
        const pendingPaymentId = existingAutoChargeConfig?.payment_id;
        if (pendingPaymentId) {
          // Cancel the payment if not already cancelled. Payment may already be cancelled in scenarios
          // where the reservation is cancelled.
          const payment = await this.paymentService.getPaymentById(
            pendingPaymentId,
            trx,
          );
          if (
            payment?.payment_status &&
            statusOfPaymentsToCancelAfterDisablingAutoCharge.includes(
              payment.payment_status,
            )
          ) {
            await this.paymentService.cancelPayments(
              [pendingPaymentId],
              false,
              trx,
            );
          }
        }

        // Disable auto-charge by clearing auto_charge field
        const disabledAutoChargeConfig = {
          ...existingAutoChargeConfig,
          is_enabled: false,
        };
        await this.reservationRepository.updateMany(
          reservations.map((r) => r.id),
          { auto_charge: disabledAutoChargeConfig },
          trx,
        );
        logger.info(
          `setupAutoChargeShift4: Auto-charge disabled for bookings ${bookingIdPrefix}`,
        );
        if (!transaction) {
          await trx.commit();
        }
        return {
          success: true,
          message: 'Auto-charge disabled successfully',
        };
      }

      // 2. Determine finalization datetime
      let finalizeAt: Date;
      if (request.finalizes_at) {
        finalizeAt = new Date(request.finalizes_at);
      } else {
        // Get default from hotel configuration
        const hotelConfig =
          await this.hotelConfigurationService.getHotelConfigurationByHotelId(
            hotelId,
          );
        if (
          hotelConfig?.payment_configuration?.auto_charge_days_before == null ||
          !hotelConfig?.payment_configuration?.auto_charge_time
        ) {
          if (!transaction) {
            await trx.rollback();
          }
          return {
            success: false,
            message:
              'No auto-charge time specified and no default configured for hotel',
          };
        }

        // Calculate auto-charge datetime using days before and time
        const [hours, minutes, seconds] =
          hotelConfig.payment_configuration.auto_charge_time
            .split(':')
            .map(Number);

        // Create finalize date at the specified time in hotel's timezone, then convert to UTC
        finalizeAt = dayjs(reservation.check_in)
          .subtract(
            hotelConfig.payment_configuration.auto_charge_days_before,
            'days',
          )
          .hour(hours)
          .minute(minutes)
          .second(seconds)
          .millisecond(0)
          .tz(hotel.timezone, true)
          .toDate();
      }

      // Validate finalizeAt is in the future
      const now = new Date();
      if (finalizeAt <= now) {
        // Set finalization time to 30 seconds in the future to avoid immediate finalization
        finalizeAt = dayjs(now).add(30, 'seconds').toDate();
      }

      // 3. Calculate charge amount
      let chargeAmount: number;
      if (request.amount) {
        chargeAmount = roundCurrency(request.amount);
      } else {
        // Calculate remaining amount (total - total paid)
        let { totalReservationAmount, totalPaidAmount } =
          await this._getReservationPaymentInfo(reservations, trx);
        totalReservationAmount = roundCurrency(totalReservationAmount);
        totalPaidAmount = roundCurrency(totalPaidAmount);
        chargeAmount = roundCurrency(totalReservationAmount - totalPaidAmount);

        if (chargeAmount <= 0) {
          throw new BadRequestError(
            'No remaining amount to charge for this reservation',
          );
        }
      }

      // 4. Create payment record in PENDING state with pre-generated invoice ID
      const currencyCode = Currency[hotel.currency as keyof typeof Currency];

      // Generate unique invoice ID for Shift4 delayed charge
      const invoiceId = await this.paymentService.generateUniqueInvoiceId();
      logger.info(`setupAutoChargeShift4: generated invoice ID ${invoiceId}`);

      // Sum adults and children across all reservations in the booking
      const totalAdults = reservations.reduce(
        (sum, r) => sum + (r.num_adults || 0),
        0,
      );
      const totalChildren = reservations.reduce(
        (sum, r) => sum + (r.num_children || 0),
        0,
      );

      const paymentMetadata: PaymentCreationMetadata = {
        hotel_id: hotel.id,
        check_in: dayjs(reservation.check_in).format('YYYY-MM-DD'),
        check_out: dayjs(reservation.check_out).format('YYYY-MM-DD'),
        num_adults: totalAdults,
        num_children: totalChildren,
        room_count: reservations.length,
        customer_phone: customer.phone_number || '',
        email: customer.email || '',
        reservation_type: reservation.type,
        hotel_name: hotel.name,
        hotel_phone_number: hotel.assistant_phone_number || '',
        hotel_sms_number: hotel.sms_number || '',
        hotel_country: hotel.country || '',
        hotel_url: hotel.url || '',
        payment_provider: hotel.payment_provider,
      };

      const paymentCreationData: Omit<
        Payment,
        | 'id'
        | 'created_at'
        | 'updated_at'
        | 'payment_link'
        | 'booking_confirmation_id'
      > = {
        hotel_id: hotel.id,
        amount_charged: chargeAmount,
        currency: currencyCode,
        payment_status: PaymentStatus.PENDING,
        amount_refunded: 0,
        metadata: paymentMetadata,
        payment_provider: hotel.payment_provider,
        payment_link_id: invoiceId,
      };

      const paymentRecord = await paymentService.createPaymentWithoutLink(
        paymentCreationData,
        trx,
      );

      // Link payment to reservations
      const reservationIds = reservations.map((r) => r.id);
      await this.paymentReservationRepository.linkPaymentToReservations(
        paymentRecord.id,
        reservationIds,
        trx,
      );

      // 5. Update reservations with auto_charge configuration including payment_id
      const autoChargeConfig: AutoChargeInfo = {
        is_enabled: true,
        finalizes_at: finalizeAt,
        amount: chargeAmount,
        payment_id: paymentRecord.id,
        retry_count: 0,
      };

      // For multi-room reservations, each reservation will have identical auto-charge configurations
      await this.reservationRepository.updateMany(
        reservations.map((r) => r.id),
        { auto_charge: autoChargeConfig },
        trx,
      );

      logger.info(
        `setupAutoChargeShift4: Auto-charge setup completed for booking ID prefix ${bookingIdPrefix}, finalizes at ${finalizeAt}`,
      );

      if (!transaction) {
        await trx.commit();
      }
      return {
        success: true,
        message: 'Auto-charge setup successfully',
        finalizes_at: finalizeAt,
        charge_amount: chargeAmount,
      };
    } catch (error) {
      if (!transaction) {
        await trx.rollback();
      }
      logger.error(
        `setupAutoChargeShift4: Error setting up auto-charge for booking ID prefix ${bookingIdPrefix}: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Sets up auto-charge for a Mews-payment-provider reservation. Simpler than
   * setupAutoChargeShift4 — Mews has no invoice concept, the stored card token
   * lives on customer.card_metadata.token (charged directly at execution time),
   * so this just creates a PENDING payment record to track the pending charge
   * and writes the auto_charge block onto the reservations.
   */
  public async setupAutoChargeMews(
    bookingIdPrefix: string,
    hotelId: string,
    request: SetupAutoChargeRequest,
    transaction?: Knex.Transaction,
  ): Promise<SetupAutoChargeResponse> {
    const trx = transaction || (await db.transaction());
    try {
      const reservations = await this.getReservationsByBookingId(
        bookingIdPrefix,
        hotelId,
      );

      if (!reservations.length) {
        throw new NoDataError(
          `No reservations found for booking ID prefix: ${bookingIdPrefix}`,
        );
      }

      if (hasNoDextrPayment(reservations[0].payment_status)) {
        throw new BadRequestError(
          `Booking ${bookingIdPrefix} ${noDextrPaymentReason(reservations[0].payment_status)}. Auto-charge is not supported.`,
        );
      }

      const reservation = reservations[0];
      const customer = reservation.customer;
      const hotel = reservation.hotel;
      if (!hotel) {
        throw new NoDataError('Hotel information not found for reservation');
      }

      const existingAutoChargeConfig = reservation.auto_charge;

      if (request.is_enabled === false) {
        const pendingPaymentId = existingAutoChargeConfig?.payment_id;
        if (pendingPaymentId) {
          const payment = await this.paymentService.getPaymentById(
            pendingPaymentId,
            trx,
          );
          if (
            payment?.payment_status &&
            statusOfPaymentsToCancelAfterDisablingAutoCharge.includes(
              payment.payment_status,
            )
          ) {
            await this.paymentService.cancelPayments(
              [pendingPaymentId],
              false,
              trx,
            );
          }
        }

        const disabledAutoChargeConfig = {
          ...existingAutoChargeConfig,
          is_enabled: false,
        };
        await this.reservationRepository.updateMany(
          reservations.map((r) => r.id),
          { auto_charge: disabledAutoChargeConfig },
          trx,
        );
        logger.info(
          `setupAutoChargeMews: Auto-charge disabled for bookings ${bookingIdPrefix}`,
        );
        if (!transaction) {
          await trx.commit();
        }
        return {
          success: true,
          message: 'Auto-charge disabled successfully',
        };
      }

      let finalizeAt: Date;
      if (request.finalizes_at) {
        finalizeAt = new Date(request.finalizes_at);
      } else {
        const hotelConfig =
          await this.hotelConfigurationService.getHotelConfigurationByHotelId(
            hotelId,
          );
        if (
          hotelConfig?.payment_configuration?.auto_charge_days_before == null ||
          !hotelConfig?.payment_configuration?.auto_charge_time
        ) {
          if (!transaction) {
            await trx.rollback();
          }
          return {
            success: false,
            message:
              'No auto-charge time specified and no default configured for hotel',
          };
        }

        const [hours, minutes, seconds] =
          hotelConfig.payment_configuration.auto_charge_time
            .split(':')
            .map(Number);

        finalizeAt = dayjs(reservation.check_in)
          .subtract(
            hotelConfig.payment_configuration.auto_charge_days_before,
            'days',
          )
          .hour(hours)
          .minute(minutes)
          .second(seconds)
          .millisecond(0)
          .tz(hotel.timezone, true)
          .toDate();
      }

      const now = new Date();
      if (finalizeAt <= now) {
        finalizeAt = dayjs(now).add(30, 'seconds').toDate();
      }

      let chargeAmount: number;
      if (request.amount) {
        chargeAmount = roundCurrency(request.amount);
      } else {
        let { totalReservationAmount, totalPaidAmount } =
          await this._getReservationPaymentInfo(reservations, trx);
        totalReservationAmount = roundCurrency(totalReservationAmount);
        totalPaidAmount = roundCurrency(totalPaidAmount);
        chargeAmount = roundCurrency(totalReservationAmount - totalPaidAmount);

        if (chargeAmount <= 0) {
          throw new BadRequestError(
            'No remaining amount to charge for this reservation',
          );
        }
      }

      const currencyCode = Currency[hotel.currency as keyof typeof Currency];

      const totalAdults = reservations.reduce(
        (sum, r) => sum + (r.num_adults || 0),
        0,
      );
      const totalChildren = reservations.reduce(
        (sum, r) => sum + (r.num_children || 0),
        0,
      );

      const paymentMetadata: PaymentCreationMetadata = {
        hotel_id: hotel.id,
        check_in: dayjs(reservation.check_in).format('YYYY-MM-DD'),
        check_out: dayjs(reservation.check_out).format('YYYY-MM-DD'),
        num_adults: totalAdults,
        num_children: totalChildren,
        room_count: reservations.length,
        customer_phone: customer.phone_number || '',
        email: customer.email || '',
        reservation_type: reservation.type,
        hotel_name: hotel.name,
        hotel_phone_number: hotel.assistant_phone_number || '',
        hotel_sms_number: hotel.sms_number || '',
        hotel_country: hotel.country || '',
        hotel_url: hotel.url || '',
        payment_provider: hotel.payment_provider,
      };

      const paymentCreationData: Omit<
        Payment,
        | 'id'
        | 'created_at'
        | 'updated_at'
        | 'payment_link'
        | 'booking_confirmation_id'
      > = {
        hotel_id: hotel.id,
        amount_charged: chargeAmount,
        currency: currencyCode,
        payment_status: PaymentStatus.PENDING,
        amount_refunded: 0,
        metadata: paymentMetadata,
        payment_provider: hotel.payment_provider,
      };

      const paymentRecord = await paymentService.createPaymentWithoutLink(
        paymentCreationData,
        trx,
      );

      const reservationIds = reservations.map((r) => r.id);
      await this.paymentReservationRepository.linkPaymentToReservations(
        paymentRecord.id,
        reservationIds,
        trx,
      );

      const autoChargeConfig: AutoChargeInfo = {
        is_enabled: true,
        finalizes_at: finalizeAt,
        amount: chargeAmount,
        payment_id: paymentRecord.id,
        retry_count: 0,
      };

      await this.reservationRepository.updateMany(
        reservations.map((r) => r.id),
        { auto_charge: autoChargeConfig },
        trx,
      );

      logger.info(
        `setupAutoChargeMews: Auto-charge setup completed for booking ID prefix ${bookingIdPrefix}, finalizes at ${finalizeAt}`,
      );

      if (!transaction) {
        await trx.commit();
      }
      return {
        success: true,
        message: 'Auto-charge setup successfully',
        finalizes_at: finalizeAt,
        charge_amount: chargeAmount,
      };
    } catch (error) {
      if (!transaction) {
        await trx.rollback();
      }
      logger.error(
        `setupAutoChargeMews: Error setting up auto-charge for booking ID prefix ${bookingIdPrefix}: ${error}`,
      );
      throw error;
    }
  }

  public async setupAutoChargeAuthorizeNet(
    bookingIdPrefix: string,
    hotelId: string,
    request: SetupAutoChargeRequest,
    transaction?: Knex.Transaction,
  ): Promise<SetupAutoChargeResponse> {
    const trx = transaction || (await db.transaction());
    try {
      const reservations = await this.getReservationsByBookingId(
        bookingIdPrefix,
        hotelId,
      );

      if (!reservations.length) {
        throw new NoDataError(
          `No reservations found for booking ID prefix: ${bookingIdPrefix}`,
        );
      }

      if (hasNoDextrPayment(reservations[0].payment_status)) {
        throw new BadRequestError(
          `Booking ${bookingIdPrefix} ${noDextrPaymentReason(reservations[0].payment_status)}. Auto-charge is not supported.`,
        );
      }

      const reservation = reservations[0];
      const customer = reservation.customer;
      const hotel = reservation.hotel;
      if (!hotel) {
        throw new NoDataError('Hotel information not found for reservation');
      }

      const existingAutoChargeConfig = reservation.auto_charge;

      if (request.is_enabled === false) {
        const pendingPaymentId = existingAutoChargeConfig?.payment_id;
        if (pendingPaymentId) {
          const payment = await this.paymentService.getPaymentById(
            pendingPaymentId,
            trx,
          );
          if (
            payment?.payment_status &&
            statusOfPaymentsToCancelAfterDisablingAutoCharge.includes(
              payment.payment_status,
            )
          ) {
            await this.paymentService.cancelPayments(
              [pendingPaymentId],
              false,
              trx,
            );
          }
        }

        const disabledAutoChargeConfig = {
          ...existingAutoChargeConfig,
          is_enabled: false,
        };
        await this.reservationRepository.updateMany(
          reservations.map((r) => r.id),
          { auto_charge: disabledAutoChargeConfig },
          trx,
        );
        logger.info(
          `setupAutoChargeAuthorizeNet: Auto-charge disabled for bookings ${bookingIdPrefix}`,
        );
        if (!transaction) {
          await trx.commit();
        }
        return {
          success: true,
          message: 'Auto-charge disabled successfully',
        };
      }

      let finalizeAt: Date;
      if (request.finalizes_at) {
        finalizeAt = new Date(request.finalizes_at);
      } else {
        const hotelConfig =
          await this.hotelConfigurationService.getHotelConfigurationByHotelId(
            hotelId,
          );
        if (
          hotelConfig?.payment_configuration?.auto_charge_days_before == null ||
          !hotelConfig?.payment_configuration?.auto_charge_time
        ) {
          if (!transaction) {
            await trx.rollback();
          }
          return {
            success: false,
            message:
              'No auto-charge time specified and no default configured for hotel',
          };
        }

        const [hours, minutes, seconds] =
          hotelConfig.payment_configuration.auto_charge_time
            .split(':')
            .map(Number);

        finalizeAt = dayjs(reservation.check_in)
          .subtract(
            hotelConfig.payment_configuration.auto_charge_days_before,
            'days',
          )
          .hour(hours)
          .minute(minutes)
          .second(seconds)
          .millisecond(0)
          .tz(hotel.timezone, true)
          .toDate();
      }

      const now = new Date();
      if (finalizeAt <= now) {
        finalizeAt = dayjs(now).add(30, 'seconds').toDate();
      }

      let chargeAmount: number;
      if (request.amount) {
        chargeAmount = roundCurrency(request.amount);
      } else {
        let { totalReservationAmount, totalPaidAmount } =
          await this._getReservationPaymentInfo(reservations, trx);
        totalReservationAmount = roundCurrency(totalReservationAmount);
        totalPaidAmount = roundCurrency(totalPaidAmount);
        chargeAmount = roundCurrency(totalReservationAmount - totalPaidAmount);

        if (chargeAmount <= 0) {
          throw new BadRequestError(
            'No remaining amount to charge for this reservation',
          );
        }
      }

      const currencyCode = Currency[hotel.currency as keyof typeof Currency];

      const totalAdults = reservations.reduce(
        (sum, r) => sum + (r.num_adults || 0),
        0,
      );
      const totalChildren = reservations.reduce(
        (sum, r) => sum + (r.num_children || 0),
        0,
      );

      const paymentMetadata: PaymentCreationMetadata = {
        hotel_id: hotel.id,
        check_in: dayjs(reservation.check_in).format('YYYY-MM-DD'),
        check_out: dayjs(reservation.check_out).format('YYYY-MM-DD'),
        num_adults: totalAdults,
        num_children: totalChildren,
        room_count: reservations.length,
        customer_phone: customer.phone_number || '',
        email: customer.email || '',
        reservation_type: reservation.type,
        hotel_name: hotel.name,
        hotel_phone_number: hotel.assistant_phone_number || '',
        hotel_sms_number: hotel.sms_number || '',
        hotel_country: hotel.country || '',
        hotel_url: hotel.url || '',
        payment_provider: hotel.payment_provider,
      };

      const paymentCreationData: Omit<
        Payment,
        | 'id'
        | 'created_at'
        | 'updated_at'
        | 'payment_link'
        | 'booking_confirmation_id'
      > = {
        hotel_id: hotel.id,
        amount_charged: chargeAmount,
        currency: currencyCode,
        payment_status: PaymentStatus.PENDING,
        amount_refunded: 0,
        metadata: paymentMetadata,
        payment_provider: hotel.payment_provider,
      };

      const paymentRecord = await paymentService.createPaymentWithoutLink(
        paymentCreationData,
        trx,
      );

      const reservationIds = reservations.map((r) => r.id);
      await this.paymentReservationRepository.linkPaymentToReservations(
        paymentRecord.id,
        reservationIds,
        trx,
      );

      const autoChargeConfig: AutoChargeInfo = {
        is_enabled: true,
        finalizes_at: finalizeAt,
        amount: chargeAmount,
        payment_id: paymentRecord.id,
        retry_count: 0,
      };

      await this.reservationRepository.updateMany(
        reservations.map((r) => r.id),
        { auto_charge: autoChargeConfig },
        trx,
      );

      logger.info(
        `setupAutoChargeAuthorizeNet: Auto-charge setup completed for booking ID prefix ${bookingIdPrefix}, finalizes at ${finalizeAt}`,
      );

      if (!transaction) {
        await trx.commit();
      }
      return {
        success: true,
        message: 'Auto-charge setup successfully',
        finalizes_at: finalizeAt,
        charge_amount: chargeAmount,
      };
    } catch (error) {
      if (!transaction) {
        await trx.rollback();
      }
      logger.error(
        `setupAutoChargeAuthorizeNet: Error setting up auto-charge for booking ID prefix ${bookingIdPrefix}: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Sets up auto-charge for a reservation
   * Routes to appropriate implementation based on payment provider
   * @param bookingId - The booking ID
   * @param hotelId - The hotel ID
   * @param request - The auto-charge setup request
   * @returns Auto-charge setup response
   */
  public async setupAutoCharge(
    bookingId: string,
    hotelId: string,
    request: SetupAutoChargeRequest,
    transaction?: Knex.Transaction,
  ): Promise<SetupAutoChargeResponse> {
    try {
      const hotel = await this.hotelService.getHotelById(hotelId);
      if (!hotel) {
        throw new NoDataError('Hotel information not found for reservation');
      }

      if (hotel.payment_provider === PaymentProvider.NOT_APPLICABLE) {
        throw new BadRequestError(
          `Hotel ${hotelId} does not require payment. Auto-charge is not supported.`,
        );
      }

      if (hotel.payment_provider === PaymentProvider.CLOUDBEDS_SDK) {
        logger.info(
          `Skipping auto-charge setup for Cloudbeds SDK hotel ${hotel.id} — charging managed by Cloudbeds`,
        );
        return {
          success: true,
          message: 'Auto-charge is managed by Cloudbeds for this hotel.',
        };
      }

      // Route to appropriate implementation based on payment provider
      if (hotel.payment_provider === PaymentProvider.SHIFT4) {
        return await this.setupAutoChargeShift4(
          bookingId,
          hotelId,
          request,
          transaction,
        );
      } else if (hotel.payment_provider === PaymentProvider.MEWS) {
        return await this.setupAutoChargeMews(
          bookingId,
          hotelId,
          request,
          transaction,
        );
      } else if (hotel.payment_provider === PaymentProvider.AUTHORIZE_NET) {
        return await this.setupAutoChargeAuthorizeNet(
          bookingId,
          hotelId,
          request,
          transaction,
        );
      } else if (hotel.payment_provider === PaymentProvider.RESNEXUS) {
        // ResNexus auto-charges the balance itself off the card it already
        // holds. Setting up a Dextr auto-charge would charge the guest twice.
        logger.info(
          `setupAutoCharge: Hotel ${hotelId} is on ResNexus-native payments, auto-charge is owned by ResNexus. Skipping.`,
        );
        return {
          success: true,
          message: 'Auto-charge is handled by ResNexus',
        };
      } else {
        return await this.setupAutoChargeStripe(
          bookingId,
          hotelId,
          request,
          transaction,
        );
      }
    } catch (error) {
      logger.error(
        `setupAutoCharge: Error setting up auto-charge for booking ${bookingId}: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Sets up auto-charge for a reservation using Stripe invoices
   * @param bookingId - The booking ID. Will be the common prefix in case of multi-room reservations
   * @param hotelId - The hotel ID
   * @param request - The auto-charge setup request
   * @returns Auto-charge setup response
   */
  private async setupAutoChargeStripe(
    bookingId: string,
    hotelId: string,
    request: SetupAutoChargeRequest,
    transaction?: Knex.Transaction,
  ): Promise<SetupAutoChargeResponse> {
    const trx = transaction || (await db.transaction());
    try {
      // 1. Get reservations by booking ID
      const reservations = await this.getReservationsByBookingId(
        bookingId,
        hotelId,
      );

      if (!reservations.length) {
        throw new NoDataError(
          `No reservations found for booking ID: ${bookingId}`,
        );
      }

      if (hasNoDextrPayment(reservations[0].payment_status)) {
        throw new BadRequestError(
          `Booking ${bookingId} ${noDextrPaymentReason(reservations[0].payment_status)}. Auto-charge is not supported.`,
        );
      }

      const reservation = reservations[0]; // Use first reservation for hotel and customer details
      const customer = reservation.customer;
      if (!customer.payment_provider_customer_id) {
        throw new BadRequestError(
          'Customer must have a Stripe customer ID to setup auto-charge',
        );
      }
      const hotel = reservation.hotel;
      if (!hotel) {
        throw new NoDataError('Hotel information not found for reservation');
      }
      const connectedAccountId =
        (await this.hotelConfigurationService.getPaymentAccountIdByHotelId(
          hotelId,
          trx,
        )) ?? undefined;

      if (request.is_enabled === false) {
        // Disable auto-charge by removing existing invoice and clearing auto_charge field
        if (reservation.auto_charge?.invoice_id) {
          await this.paymentService.disableAutoCharge(
            reservation.auto_charge.invoice_id,
            connectedAccountId,
          );

          // Cancel the linked PENDING payment
          const linkedPayment =
            await this.paymentService.findPaymentByInvoiceId(
              reservation.auto_charge.invoice_id,
            );
          if (
            linkedPayment?.payment_status &&
            statusOfPaymentsToCancelAfterDisablingAutoCharge.includes(
              linkedPayment.payment_status,
            )
          ) {
            await this.paymentService.cancelPayments(
              [linkedPayment.id],
              false,
              trx,
            );
          }

          await this.reservationRepository.updateMany(
            reservations.map((r) => r.id),
            { auto_charge: { ...reservation.auto_charge, is_enabled: false } },
            trx,
          );
          logger.info(
            `setupAutoCharge: Auto-charge disabled for booking ${bookingId}`,
          );
          if (!transaction) {
            await trx.commit();
          }
          return {
            success: true,
            message: 'Auto-charge disabled successfully',
          };
        } else {
          if (!transaction) {
            await trx.rollback();
          }
          return {
            success: false,
            message: 'No existing auto-charge to disable',
          };
        }
      }

      const currencyCode = Currency[hotel.currency as keyof typeof Currency];

      // 2. Determine finalization datetime
      let finalizeAt: Date;
      if (request.finalizes_at) {
        finalizeAt = new Date(request.finalizes_at);
      } else {
        // Get default from hotel configuration
        const hotelConfig =
          await this.hotelConfigurationService.getHotelConfigurationByHotelId(
            hotelId,
          );
        if (
          hotelConfig?.payment_configuration?.auto_charge_days_before == null ||
          !hotelConfig?.payment_configuration?.auto_charge_time
        ) {
          if (!transaction) {
            await trx.rollback();
          }
          return {
            success: false,
            message:
              'No auto-charge time specified and no default configured for hotel',
          };
        }

        // Calculate auto-charge datetime using days before and time
        const [hours, minutes, seconds] =
          hotelConfig.payment_configuration.auto_charge_time
            .split(':')
            .map(Number);

        // Create finalize date at the specified time in hotel's timezone, then convert to UTC
        finalizeAt = dayjs(reservation.check_in)
          .subtract(
            hotelConfig.payment_configuration.auto_charge_days_before,
            'days',
          )
          .hour(hours)
          .minute(minutes)
          .second(seconds)
          .millisecond(0)
          .tz(hotel.timezone, true) // parse in hotel timezone without conversion
          .toDate();
      }

      //Validate finalizeAt is in the future
      const now = new Date();
      if (finalizeAt <= now) {
        // Set finalization time to 30 seconds in the future to avoid immediate finalization
        finalizeAt = dayjs(now).add(30, 'seconds').toDate();
      }

      // 3. Calculate charge amount
      let chargeAmount: number;
      if (request.amount) {
        chargeAmount = roundCurrency(request.amount);
      } else {
        // Calculate remaining amount (total - total paid)
        let { totalReservationAmount, totalPaidAmount } =
          await this._getReservationPaymentInfo(reservations, trx);
        totalReservationAmount = roundCurrency(totalReservationAmount);
        totalPaidAmount = roundCurrency(totalPaidAmount);
        chargeAmount = roundCurrency(totalReservationAmount - totalPaidAmount);

        if (chargeAmount <= 0) {
          throw new BadRequestError(
            'No remaining amount to charge for this reservation',
          );
        }
      }
      // 4. Create or update Stripe invoice for auto-charge
      const paymentDescription = paymentService.generatePaymentDescription(
        dayjs(reservation.check_in).format('YYYY-MM-DD'),
        dayjs(reservation.check_out).format('YYYY-MM-DD'),
      );

      let invoice: any = null;
      let existingInvoiceId = reservation.auto_charge?.invoice_id;

      // If there's an existing invoice, check whether it can still be modified.
      // Paid/void/open/uncollectible invoices cannot be updated — we must create
      // a fresh invoice instead.
      if (existingInvoiceId) {
        try {
          const existingInvoice =
            await this.paymentService.getInvoiceByInvoiceId(
              existingInvoiceId,
              connectedAccountId,
            );
          if (existingInvoice.status !== 'draft') {
            logger.info(
              `setupAutoCharge: Existing invoice ${existingInvoiceId} is ${existingInvoice.status} and cannot be modified for booking ${bookingId}. Will create a new invoice.`,
            );
            // Attempt to void the invoice so Stripe doesn't collect on it.
            // For `paid`/`void` invoices this will fail — that's expected.
            try {
              await this.paymentService.voidInvoice(
                existingInvoiceId,
                connectedAccountId,
              );
            } catch (voidError) {
              logger.info(
                `setupAutoCharge: Could not void invoice ${existingInvoiceId} (status: ${existingInvoice.status}) for booking ${bookingId}. Proceeding with new invoice.`,
                { error: voidError },
              );
            }
            // Cancel the stale PENDING payment linked to the old invoice
            const stalePayment =
              await this.paymentService.findPaymentByInvoiceId(
                existingInvoiceId,
              );
            if (
              stalePayment?.payment_status &&
              statusOfPaymentsToCancelAfterDisablingAutoCharge.includes(
                stalePayment.payment_status,
              )
            ) {
              await this.paymentService.cancelPayments(
                [stalePayment.id],
                false,
                trx,
              );
            }
            existingInvoiceId = undefined;
          }
        } catch (invoiceCheckError) {
          logger.warn(
            `setupAutoCharge: Failed to retrieve invoice ${existingInvoiceId} for booking ${bookingId}. Will create a new invoice.`,
            { error: invoiceCheckError },
          );
          existingInvoiceId = undefined;
        }
      }

      if (existingInvoiceId) {
        const amountChanged =
          chargeAmount !== roundCurrency(reservation.auto_charge?.amount ?? 0);

        if (amountChanged) {
          // Amount changed — cancel both the old payment and invoice, then fall
          // through to the create path for a clean 1:1 mapping.
          logger.info(
            `setupAutoCharge: Charge amount changed from ${reservation.auto_charge?.amount ?? 0} to ${chargeAmount} for booking ${bookingId}. Replacing invoice and payment.`,
          );
          const oldPayment =
            await this.paymentService.findPaymentByInvoiceId(existingInvoiceId);
          if (
            oldPayment?.payment_status &&
            statusOfPaymentsToCancelAfterDisablingAutoCharge.includes(
              oldPayment.payment_status,
            )
          ) {
            await this.paymentService.cancelPayments(
              [oldPayment.id],
              false,
              trx,
            );
          }
          await this.paymentService.disableAutoCharge(
            existingInvoiceId,
            connectedAccountId,
          );
          // Clear so we fall through to the create path below
          existingInvoiceId = undefined;
        } else if (
          finalizeAt.getTime() !==
          new Date(reservation.auto_charge!.finalizes_at!).getTime()
        ) {
          // Only finalization time changed — update the existing invoice in place
          invoice = await this.paymentService.updateAutoCharge(
            existingInvoiceId,
            {
              auto_finalize_at: Math.floor(finalizeAt.getTime() / 1000),
              auto_advance: true,
              connectedAccountId,
            },
          );
        }
      }

      if (!existingInvoiceId) {
        // Create payment metadata using existing PaymentMetadata structure
        const paymentMetadata: PaymentCreationMetadata = {
          hotel_id: hotel.id,
          check_in: dayjs(reservation.check_in).format('YYYY-MM-DD'),
          check_out: dayjs(reservation.check_out).format('YYYY-MM-DD'),
          num_adults: reservation.num_adults,
          num_children: reservation.num_children,
          room_count: reservations.length,
          customer_phone: customer.phone_number || '',
          email: customer.email || '',
          reservation_type: reservation.type,
          hotel_name: hotel.name,
          hotel_phone_number: hotel.assistant_phone_number || '',
          hotel_sms_number: hotel.sms_number || '',
          hotel_country: hotel.country || '',
          hotel_url: hotel.url || '',
          payment_provider: hotel.payment_provider,
        };

        const autoFinalizeAtUnix = Math.floor(finalizeAt.getTime() / 1000);

        const paymentCreationData: Omit<
          Payment,
          | 'id'
          | 'created_at'
          | 'updated_at'
          | 'payment_link'
          | 'booking_confirmation_id'
        > = {
          hotel_id: hotel.id,
          amount_charged: chargeAmount,
          currency: currencyCode,
          payment_status: PaymentStatus.PENDING,
          amount_refunded: 0,
          metadata: paymentMetadata,
          payment_provider: hotel.payment_provider,
        };

        // 6. Create payment record
        const paymentRecord =
          await paymentService.createPaymentWithoutLink(paymentCreationData);

        const invoiceMetadata: PaymentMetadata = {
          ...paymentMetadata,
          payment_id: paymentRecord.id,
          source: SOURCE,
        };
        invoice = await this.paymentService.createInvoice({
          customer_id: customer.payment_provider_customer_id,
          amount: chargeAmount,
          currency: currencyCode,
          description: paymentDescription,
          auto_finalize_at: autoFinalizeAtUnix,
          metadata: invoiceMetadata,
          connectedAccountId,
        });
        if (!invoice || !invoice.id) {
          throw new BadRequestError(
            'Failed to create Stripe invoice for auto-charge',
          );
        }

        const paymentDataToUpdate: Partial<Payment> = {
          payment_link_id: invoice.id,
        };
        await this.paymentService.updatePaymentById(
          paymentRecord.id,
          paymentDataToUpdate,
          trx,
        );

        // 7. Link payment to reservations
        const reservationIds = reservations.map((r) => r.id);
        await this.paymentReservationRepository.linkPaymentToReservations(
          paymentRecord.id,
          reservationIds,
          trx,
        );

        // Create invoice item for remaining amount
        const itemDescription = `Remaining payment for booking ${bookingId}: ${paymentDescription}`;
        await this.paymentService.createInvoiceItem({
          customer: customer.payment_provider_customer_id,
          invoice: invoice.id,
          amount: chargeAmount,
          currency: currencyCode,
          description: itemDescription,
          connectedAccountId,
        });
      }

      const invoiceId = invoice?.id ?? reservation.auto_charge?.invoice_id;
      // 8. Update reservations with auto_charge configuration
      const autoChargeConfig: AutoChargeInfo = {
        is_enabled: true,
        finalizes_at: finalizeAt,
        invoice_id: invoiceId,
        amount: chargeAmount,
      };

      await this.reservationRepository.updateMany(
        reservations.map((r) => r.id),
        { auto_charge: autoChargeConfig },
        trx,
      );

      logger.info(
        `setupAutoCharge: Auto-charge setup completed for booking ${bookingId}, invoice: ${invoiceId}`,
      );

      if (!transaction) {
        await trx.commit();
      }
      return {
        success: true,
        message: 'Auto-charge setup successfully',
        finalizes_at: finalizeAt,
        charge_amount: chargeAmount,
      };
    } catch (error) {
      if (!transaction) {
        await trx.rollback();
      }
      logger.error(
        `setupAutoCharge: Error setting up auto-charge for booking ${bookingId}: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Thin public wrapper around the shared utility for callers that hold a
   * service reference (e.g. GuestCheckinSummaryService).
   * Prefer importing {@link getReservationTotalAmount} from `utils/reservation`
   * directly when the service reference is not otherwise needed.
   */
  public getReservationTotalAmount(
    reservation: ReservationWithPricingBreakdown,
  ): number {
    return getReservationTotalAmount(reservation);
  }

  /**
   * Helper function to calculate total reservation amount and get payment information
   * @param reservations - Array of reservations
   * @returns Object containing total amount, payment IDs, and total paid amount
   */
  private async _getReservationPaymentInfo(
    reservations: ReservationDTO[],
    transaction?: Knex.Transaction,
  ): Promise<{
    totalReservationAmount: number;
    reservationIds: string[];
    payments: Payment[];
    totalPaidAmount: number;
    totalRefundedAmount: number;
  }> {
    const totalReservationAmount = reservations.reduce((sum, r) => {
      return roundCurrency(sum + getReservationTotalAmount(r));
    }, 0);

    if (totalReservationAmount <= 0) {
      throw new NoDataError(`No valid reservation amount found`);
    }

    // Get reservation IDs to fetch their payments
    const reservationIds = reservations.map((r) => r.id);
    const paymentIds =
      await this.paymentReservationRepository.getPaymentIdsByReservationIds(
        reservationIds,
      );

    if (_.isEmpty(paymentIds)) {
      throw new NoDataError(`No payments found for reservations`);
    }

    const payments = await this.paymentService.findPaymentsByIds(
      paymentIds,
      [
        PaymentStatus.COMPLETED,
        PaymentStatus.REFUNDED,
        PaymentStatus.REFUND_FAILED,
      ],
      transaction,
    );
    const totalPaidAmount = payments.reduce(
      (sum, p) => sum + p.amount_charged,
      0,
    );
    const totalRefundedAmount = payments.reduce(
      (sum, p) => sum + (p.amount_refunded || 0),
      0,
    );

    return {
      totalReservationAmount,
      reservationIds,
      payments,
      totalPaidAmount,
      totalRefundedAmount,
    };
  }

  /**
   * Updates reservation payment status based on payment information
   * @param reservations - Array of reservations to update
   * @param transaction - Optional database transaction
   */
  public async updateReservationPaymentStatusFromPaymentInfo(
    reservations: ReservationDTO[],
    action: 'CREDIT' | 'REFUND',
    transaction?: Knex.Transaction,
  ) {
    const trx = transaction || (await db.transaction());
    try {
      if (_.isEmpty(reservations)) {
        logger.warn(
          'updateReservationPaymentStatusFromPaymentInfo: No reservations provided',
        );
        return;
      }

      // No-Dextr-payment statuses are terminal: there is no payments row to derive from
      const payableReservations = reservations.filter(
        (r) => !hasNoDextrPayment(r.payment_status),
      );
      if (_.isEmpty(payableReservations)) {
        logger.info(
          'updateReservationPaymentStatusFromPaymentInfo: No reservation has a Dextr payment, skipping',
        );
        return;
      }

      // Get payment information for the payable reservations only
      let {
        totalReservationAmount,
        reservationIds,
        totalPaidAmount,
        totalRefundedAmount,
      } = await this._getReservationPaymentInfo(
        payableReservations,
        transaction,
      );
      totalReservationAmount = roundCurrency(totalReservationAmount);
      totalPaidAmount = roundCurrency(totalPaidAmount);
      totalRefundedAmount = roundCurrency(totalRefundedAmount);

      // Determine payment status based on amounts
      let paymentStatus: ReservationPaymentStatus;
      switch (action) {
        case 'CREDIT':
          // After a credit, check if fully paid or partially paid
          if (totalPaidAmount >= totalReservationAmount) {
            paymentStatus = ReservationPaymentStatus.FULLY_PAID;
          } else if (totalPaidAmount > 0) {
            paymentStatus = ReservationPaymentStatus.PARTIALLY_PAID;
          } else {
            paymentStatus = ReservationPaymentStatus.PENDING;
          }
          break;
        case 'REFUND':
          // After a refund, check if fully refunded or partially refunded
          if (totalRefundedAmount >= totalPaidAmount) {
            paymentStatus = ReservationPaymentStatus.FULLY_REFUNDED;
          } else if (totalRefundedAmount > 0) {
            paymentStatus = ReservationPaymentStatus.PARTIALLY_REFUNDED;
          } else {
            paymentStatus =
              payableReservations[0].payment_status ||
              ReservationPaymentStatus.PENDING;
          }
          break;
        default:
          throw new BadRequestError(`Invalid action: ${action}`);
      }

      // Update all reservations with the determined payment status
      await this.updateReservationPaymentStatus(
        reservationIds,
        paymentStatus,
        trx,
      );

      if (!transaction) {
        await trx.commit();
      }

      logger.info(
        `updateReservationPaymentStatusFromPaymentInfo: Updated ${reservationIds.length} reservations to ${paymentStatus}. Total amount: ${roundCurrency(totalReservationAmount)}, Paid: ${roundCurrency(totalPaidAmount)}`,
      );
    } catch (error) {
      if (!transaction) {
        await trx.rollback();
      }
      const err = error as Error;
      logger.error(
        `updateReservationPaymentStatusFromPaymentInfo: Error updating reservation payment status: ${err.message}`,
      );
      throw error;
    }
  }

  /**
   * Calculates payment summary for a booking
   */
  async calculateBookingPaymentSummary(
    bookingId: string,
    hotelId: string,
  ): Promise<BookingRefundSummary> {
    try {
      // Get reservations for the booking to validate hotel access
      const reservations = await this.getReservationsByBookingId(
        bookingId,
        hotelId,
      );
      if (_.isEmpty(reservations)) {
        throw new NoDataError(
          `No reservations found for booking ${bookingId} in hotel ${hotelId}`,
        );
      }

      if (hasNoDextrPayment(reservations[0].payment_status)) {
        throw new BadRequestError(
          `Booking ${bookingId} ${noDextrPaymentReason(reservations[0].payment_status)}. Payment summary is not available.`,
        );
      }

      const hotel = reservations[0].hotel;
      if (!hotel) {
        throw new NoDataError(
          `calculateBookingPaymentSummary. Hotel not found for reservation with booking ID prefix ${bookingId}`,
        );
      }

      const {
        totalReservationAmount,
        reservationIds,
        payments,
        totalPaidAmount,
      } = await this._getReservationPaymentInfo(reservations);

      const totalRefundedAmount = payments.reduce(
        (sum, p) => sum + (p.amount_refunded || 0),
        0,
      );
      const refundablePayments =
        await this.paymentService.getRefundablePaymentsByReservationIds(
          reservationIds,
          hotelId,
          hotel.timezone,
        );
      const refundableAmount = refundablePayments.reduce(
        (sum, p) => sum + p.refundableAmount,
        0,
      );

      return {
        bookingId,
        totalReservationAmount: roundCurrency(totalReservationAmount),
        totalPaidAmount: roundCurrency(totalPaidAmount),
        totalRefundedAmount: roundCurrency(totalRefundedAmount),
        refundableAmount: roundCurrency(refundableAmount),
        remainingAmount: roundCurrency(
          totalReservationAmount - totalPaidAmount,
        ),
      };
    } catch (error) {
      logger.error(
        `calculateBookingRefundSummary: Error calculating refund summary for booking ${bookingId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Processes a refund for a booking
   */
  async processBookingRefund(
    bookingId: string,
    hotelId: string,
    params: RefundRequest,
  ): Promise<RefundProcessResult> {
    try {
      // Get hotel details for connected account ID
      const hotel = await this.hotelService.getHotelById(hotelId);
      if (!hotel) {
        throw new NoDataError(`Hotel not found for ID ${hotelId}`);
      }

      if (hotel.payment_provider === PaymentProvider.CLOUDBEDS_SDK) {
        throw new BadRequestError(
          'Refunds are not supported for Cloudbeds SDK payments. Refunds must be processed manually in the Cloudbeds dashboard.',
        );
      }

      const hotelConfiguration =
        await this.hotelConfigurationService.getHotelConfigurationByHotelId(
          hotel.id,
        );

      // Get refund summary first to validate the request
      // All the reservations for a particular booking ID prefix will have the same customer and card metadata
      const reservations = await this.getReservationsByBookingId(
        bookingId,
        hotelId,
      );
      if (_.isEmpty(reservations)) {
        throw new NoDataError(
          `No reservations found for booking ${bookingId} in hotel ${hotelId}`,
        );
      }

      if (hasNoDextrPayment(reservations[0].payment_status)) {
        throw new BadRequestError(
          `Booking ${bookingId} ${noDextrPaymentReason(reservations[0].payment_status)}. Refunds are not applicable.`,
        );
      }
      const firstReservation = reservations[0];
      const customer = firstReservation.customer;
      if (!customer) {
        throw new NoDataError(
          `processBookingRefund: No customer found for reservation having booking ID prefix ${bookingId}`,
        );
      }
      const cardMetadata = customer.card_metadata;
      const reservationIds = reservations.map((r) => r.id);
      const refundablePayments =
        await this.paymentService.getRefundablePaymentsByReservationIds(
          reservationIds,
          hotelId,
          hotel.timezone,
        );
      const refundableAmount = roundCurrency(
        refundablePayments.reduce((sum, p) => sum + p.refundableAmount, 0),
      );
      if (refundableAmount <= 0) {
        throw new BadRequestError(
          `No refundable amount available for booking ${bookingId}`,
        );
      }

      // Call payment service to process the refund
      let checkInCheckOutTimes =
        hotelConfiguration?.check_in_check_out_configuration ?? {
          check_in: config.DEFAULT_CHECK_IN_TIME,
          check_out: config.DEFAULT_CHECK_OUT_TIME,
        };

      const result = await this.paymentService.processBookingRefund({
        refundablePayments: refundablePayments,
        requestedRefundAmount: roundCurrency(params.refundAmount),
        refundableAmount: refundableAmount,
        reason: params.reason,
        initiatedBy: params.initiatedBy,
        connectedAccountId: hotelConfiguration?.payment_account_id ?? undefined,
        cardMetadata,
        checkInDate: firstReservation.check_in,
        checkOutDate: firstReservation.check_out,
        hotelCheckInTime: checkInCheckOutTimes.check_in,
        hotelCheckOutTime: checkInCheckOutTimes.check_out,
      });

      // Reverse the refunded amount on the Opera folio if the hotel is
      // Opera-backed through Calry (no-op for other PMS). Posted per refunded
      // payment so each reversal carries its own reference.
      for (const refunded of result.selectedPayments) {
        if (refunded.status === 'failed') continue;
        const payment = await this.paymentService.getPaymentById(
          refunded.paymentId,
        );
        if (!payment) continue;
        await recordRefundInOpera({
          reservations,
          amount: refunded.refundAmount,
          currency: payment.currency || hotel.currency,
          payment,
        });
      }

      if (result.success && params.sendGuestNotification) {
        await this.sendGuestRefundNotification(
          bookingId,
          firstReservation,
          hotel,
          hotelConfiguration,
          roundCurrency(params.refundAmount),
          params.reason,
        );
      }

      return result;
    } catch (error) {
      logger.error(
        `processBookingRefund: Error processing refund for booking ${bookingId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Sends refund notification SMS to guest
   */
  private async sendGuestRefundNotification(
    bookingId: string,
    reservation: ReservationDTO,
    hotel: Hotel,
    hotelConfiguration: HotelConfiguration | null,
    refundAmount: number,
    reason?: string,
  ): Promise<void> {
    try {
      const toPhone = await resolveSmsTargetPhoneNumber(
        reservation.customer.phone_number,
        reservation.phone_number,
        hotelConfiguration?.twilio_configuration,
        hotel.country,
        false,
      );
      if (!toPhone) {
        logger.warn(
          `sendGuestRefundNotification: No valid phone number for booking ${bookingId}`,
        );
        return;
      }

      const smsContent = {
        message: guestRefundedSMSTemplate(
          reservation.customer.first_name || 'Guest',
          hotel.name,
          roundCurrency(refundAmount),
          hotel.currency,
          hotel.internal_phone_number || hotel.sms_number || '',
          hotel.country,
          reason,
          hotelConfiguration?.sms_agent_enabled || false,
        ),
        from: hotel.sms_number,
        twilioConfiguration: hotelConfiguration?.twilio_configuration,
      };

      const smsResult = await this.smsService.sendMessage({
        recipient: toPhone,
        content: smsContent,
      });

      if (smsResult) {
        smsEvents.emitSmsSent({
          sessionId: reservation.session_id,
          message: smsContent.message,
          from: hotel.sms_number,
          to: toPhone,
          callerPhoneNumber: reservation.phone_number,
          assistantPhoneNumber: hotel.assistant_phone_number,
          timestamp: new Date(),
          hotelSmsNumber: hotel.sms_number,
          smsAgentEnabled: hotelConfiguration?.sms_agent_enabled || false,
          hotelId: hotel.id,
        });
      }
    } catch (error) {
      logger.error(
        `sendGuestRefundNotification: Failed to send guest refund notification SMS for booking ${bookingId}: ${error}`,
      );
    }
  }

  /**
   * Updates ResNexus reservation notes to reflect payment updates
   * @param reservations
   */
  async updateResnexusNotesForPaymentUpdate(reservations: ReservationDTO[]) {
    if (_.isEmpty(reservations)) {
      logger.warn(
        'updateResnexusNotesForPaymentUpdate: No reservations provided',
      );
      return;
    }
    try {
      const pms = reservations[0].pms_provider;
      if (pms !== PmsProvider.RESNEXUS) {
        return;
      }
      // ResNexus-native hotels own their own ledger, so the partner-notes
      // channel that carries paid/balance back to ResNexus is redundant there.
      // It still runs for ResNexus hotels whose money moves on Stripe.
      if (
        reservations[0].hotel?.payment_provider === PaymentProvider.RESNEXUS
      ) {
        return;
      }
      let title = '';
      if (reservations.length > 1) {
        title = `Multi-Room Reservation (${reservations.length} rooms)`;
      }

      // Get payment summary once for all reservations
      const paymentSummary =
        await this._getReservationPaymentInfo(reservations);

      // Process all reservations in parallel
      await Promise.all(
        reservations.map(async (reservation) => {
          try {
            const hotel = reservation.hotel;
            if (!hotel) {
              logger.warn(
                `updateResnexusNotesForPaymentUpdate: No hotel found for reservation ${reservation.id}`,
              );
              return;
            }

            const notes = generateResNexusPartnerNotes({
              currency: hotel.currency,
              baseRate: roundCurrency(paymentSummary.totalReservationAmount),
              amountPaid: roundCurrency(
                paymentSummary.totalPaidAmount -
                  paymentSummary.totalRefundedAmount,
              ),
              existingNotes: title,
            });

            if (!reservation.quote) {
              logger.warn(
                `updateResnexusNotesForPaymentUpdate: No quote found for reservation ${reservation.id}`,
              );
              return;
            }

            const updatedReservationDetails: ReservationDetails = {
              ...reservation,
              quote: reservation.quote.quote_object.raw_response,
              external_id: reservation.booking_id.toUpperCase(),
              business_id: reservation.business_id.toString(),
              check_in: dayjs(reservation.check_in).format('YYYY-MM-DD'),
              check_out: dayjs(reservation.check_out).format('YYYY-MM-DD'),
            };

            await this.resNexusService.callModifyReservationAPI({
              ...convertToModifyReservationRequest(updatedReservationDetails),
              notes_from_partner: notes,
            });

            await this.reservationRepository.update(reservation.id, {
              notes_from_partner: notes, // replace the existing notes with the new notes
            });
            logger.info(
              `updateResnexusNotesForPaymentUpdate: Successfully updated notes for reservation ${reservation.id}`,
            );
          } catch (error) {
            logger.error(
              `updateResnexusNotesForPaymentUpdate: Error updating ResNexus notes for reservation ${reservation.id}: ${error}`,
            );
          }
        }),
      );
    } catch (error) {
      logger.error(
        `updateResnexusNotesForPaymentUpdate: Error updating ResNexus notes: ${error}`,
      );
      return;
    }
  }

  /**
   * Updates StayNTouch reservation notes to reflect payment updates
   * @param reservations
   */
  async updateStayntouchNotesForPaymentUpdate(reservations: ReservationDTO[]) {
    if (_.isEmpty(reservations)) {
      logger.warn(
        'updateStayntouchNotesForPaymentUpdate: No reservations provided',
      );
      return;
    }
    try {
      const pms = reservations[0].pms_provider;
      if (pms !== PmsProvider.STAYNTOUCH) {
        return;
      }

      const paymentSummary =
        await this._getReservationPaymentInfo(reservations);
      const hotel = reservations[0].hotel;
      if (!hotel) {
        throw new NoDataError(
          `updateStayntouchNotesForPaymentUpdate: No hotel found for reservation ${reservations[0].id}`,
        );
      }
      const stayntouchPublicReservationIds = reservations
        .map((r) => r.external_public_id)
        .filter(Boolean)
        .join(', ');
      const currency = hotel.currency;
      const amountPaid = roundCurrency(
        paymentSummary.totalPaidAmount - paymentSummary.totalRefundedAmount,
      );
      const remainingAmount = roundCurrency(
        paymentSummary.totalReservationAmount - amountPaid,
      );
      const date = dayjs().tz(hotel.timezone).format('YYYY-MM-DD');
      const noteDescription = `${date} - A refund has been made by Dextr against the reservations ${stayntouchPublicReservationIds}. Balance Due = ${formatCurrencyAmount(currency, remainingAmount)} | Already Paid = ${formatCurrencyAmount(currency, amountPaid)}`;

      await Promise.all(
        reservations.map(async (reservation) => {
          try {
            if (!reservation.external_id) {
              logger.warn(
                `updateStayntouchNotesForPaymentUpdate: No external_id for reservation ${reservation.id}`,
              );
              return;
            }
            await new StayntouchReservationService(
              hotel.id,
            ).addReservationNotes(reservation.external_id, {
              notes: [{ description: noteDescription }],
            });
            logger.info(
              `updateStayntouchNotesForPaymentUpdate: Successfully added notes for reservation ${reservation.id}`,
            );
          } catch (error) {
            logger.error(
              `updateStayntouchNotesForPaymentUpdate: Error adding notes for reservation ${reservation.id}: ${error}`,
            );
          }
        }),
      );
    } catch (error) {
      logger.error(
        `updateStayntouchNotesForPaymentUpdate: Error updating StayNTouch notes: ${error}`,
      );
    }
  }

  /**
   * Posts a Cloudbeds reservation note reflecting payment/refund updates.
   */
  async createCloudbedsNotesForRefund(
    reservations: ReservationDTO[],
    paymentId: string,
    refund: Stripe.Refund,
  ) {
    if (_.isEmpty(reservations)) {
      logger.warn(
        'createCloudbedsNotesForPaymentUpdate: No reservations provided',
      );
      return;
    }
    try {
      const pms = reservations[0].pms_provider;
      if (pms !== PmsProvider.CLOUDBEDS) {
        return;
      }

      const refundAmount = roundCurrency(refund.amount / 100);

      let hotel = reservations[0].hotel;
      if (!hotel) {
        hotel = await this.hotelService.getHotelById(reservations[0].hotel_id);
        if (!hotel) {
          throw new NoDataError(
            `createCloudbedsNotesForPaymentUpdate: No hotel found for reservation ${reservations[0].id}`,
          );
        }
      }

      const { propertyID, apiToken } = await resolveCloudbedsCredentials(hotel);

      const payment = await this.paymentService.getPaymentById(paymentId);
      if (!payment) {
        throw new NoDataError(
          `createCloudbedsNotesForPaymentUpdate: No payment found for paymentId ${paymentId}`,
        );
      }

      const cloudbedsReservationIds = reservations
        .map((r) => r.external_id)
        .filter(Boolean);
      const cloudbedsReservationIdsString = cloudbedsReservationIds.join(', ');
      const currency = hotel.currency;
      const amountNote = formatCurrencyAmount(currency, refundAmount);
      const reservationLabel =
        cloudbedsReservationIds.length > 1 ? 'reservations' : 'reservation';
      const prefix =
        cloudbedsReservationIds.length > 1 ? 'A combined amount of ' : '';
      const cloudbedsNote = `${prefix}${amountNote} has been refunded via Dextr for ${reservationLabel} ${cloudbedsReservationIdsString}`;

      await Promise.all(
        reservations.map(async (reservation) => {
          try {
            if (!reservation.external_id) {
              logger.warn(
                `createCloudbedsNotesForPaymentUpdate: No external_id for reservation ${reservation.id}`,
              );
              return;
            }
            const result = await cloudbedsClient.postReservationNote(
              {
                propertyID: String(propertyID),
                reservationID: reservation.external_id,
                reservationNote: cloudbedsNote,
              },
              { apiToken, hotelId: hotel.id },
            );
            logger.info(
              `createCloudbedsNotesForPaymentUpdate: Posted note ${result.reservationNoteID} for reservation ${reservation.id}`,
            );
          } catch (error) {
            logger.error(
              `createCloudbedsNotesForPaymentUpdate: Error posting note for reservation ${reservation.id}: ${error}`,
            );
          }
        }),
      );
    } catch (error) {
      logger.error(
        `createCloudbedsNotesForPaymentUpdate: Error updating Cloudbeds notes: ${error}`,
      );
    }
  }

  /**
   * Sends onboarding SMS to all reservations with check-in date as today + days
   * for hotels that have onboarding SMS enabled
   * @param days - Number of days from today for the check-in date
   * @param timezones - Array of IANA timezones (e.g., ["America/Los_Angeles"]) to filter hotels
   */
  /**
   * Private helper method to send onboarding SMS for a single reservation
   * @param reservation The reservation to send SMS for
   * @param hotel The hotel associated with the reservation
   * @param config The onboarding SMS configuration
   * @returns True if SMS was sent successfully, false otherwise
   */
  private async sendOnboardingSmsForReservation(
    reservation: ReservationDTO,
    hotel: Hotel,
    config: OnboardingSmsConfiguration,
    hotelConfig: HotelConfiguration | null,
  ): Promise<boolean> {
    try {
      // Skip if onboarding SMS already sent (idempotency check)
      if (reservation.onboarding_sms_sent) {
        logger.info(
          `sendOnboardingSmsForReservation: Skipping reservation ${reservation.id} - onboarding SMS already sent`,
        );
        return false;
      }

      // Get room number and door code from configuration
      const roomId = reservation.room_id?.toString();
      let roomNumber = null;
      let doorCode = null;

      if (roomId && config.room_config && config.room_config[roomId]) {
        const roomConfig = config.room_config[roomId];
        roomNumber = roomConfig.room_number;
        doorCode = roomConfig.door_code;
      }

      // Build dynamic variables object with all available data
      const variables = buildTemplateVariables(
        reservation,
        hotel,
        config,
        roomNumber,
        doorCode,
      );

      // Render the message template
      const message = renderMessageTemplate(config.message_template, variables);

      // Resolve phone number: prefer customer phone if valid Twilio number, else fall back to reservation phone
      const toPhone = await resolveSmsTargetPhoneNumber(
        reservation.customer.phone_number,
        reservation.phone_number,
        hotelConfig?.twilio_configuration,
        hotel.country,
        false,
      );
      if (!toPhone) {
        logger.warn(
          `sendOnboardingSmsForReservation: No valid phone number for reservation ${reservation.id}`,
        );
        return false;
      }

      // Send SMS
      const smsContent: NotificationSMSContent = {
        from: hotel.sms_number,
        message: message,
        twilioConfiguration: hotelConfig?.twilio_configuration,
      };

      const smsPayload: NotificationPayload = {
        recipient: toPhone,
        content: smsContent,
      };

      await this.smsService.sendMessage(smsPayload);

      // Mark onboarding SMS as sent
      await this.reservationRepository.update(reservation.id, {
        onboarding_sms_sent: true,
      });

      logger.info(
        `sendOnboardingSmsForReservation: Onboarding SMS sent to ${toPhone} for reservation ${reservation.id}`,
      );
      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `sendOnboardingSmsForReservation: Error sending onboarding SMS for reservation ${reservation.id}: ${errorMessage}`,
      );
      throw error;
    }
  }

  /**
   * Checks if a reservation qualifies for immediate onboarding SMS and sends it
   * Called when a reservation becomes ACTIVE after the scheduled SMS trigger has run
   * @param reservation The reservation that just became ACTIVE
   */
  private async checkAndSendImmediateOnboardingSms(
    reservation: ReservationDTO,
  ): Promise<void> {
    try {
      // Get hotel details
      const hotel = reservation.hotel;
      if (!hotel) {
        logger.warn(
          `checkAndSendImmediateOnboardingSms: No hotel found for reservation ${reservation.id}`,
        );
        return;
      }

      // Get hotel configuration
      const hotelConfig =
        await this.hotelConfigurationService.getHotelConfigurationByHotelId(
          hotel.id,
        );

      // Skip if no configuration, or onboarding SMS not enabled
      if (!hotelConfig?.onboarding_sms_configuration?.enabled) {
        logger.info(
          `checkAndSendImmediateOnboardingSms: Onboarding SMS not enabled for hotel ${hotel.name} (${hotel.id})`,
        );
        return;
      }

      const config = hotelConfig.onboarding_sms_configuration;

      // Get days before check-in from configuration (default to 1 if not specified)
      const daysBeforeCheckIn = config.days_before_check_in ?? 1;
      const hotelTimezone = hotel.timezone;

      // Parse check-in date and time
      const checkInDateStr = dayjs(reservation.check_in).format('YYYY-MM-DD');
      const checkInTime = config.check_in_time || '15:00'; // Default to 3 PM if not specified

      // Combine date and time to get the exact check-in datetime
      const checkInDateTime = dayjs.tz(
        `${checkInDateStr} ${checkInTime}`,
        hotelTimezone,
      );

      // Calculate when the scheduled SMS would be sent (N days before check-in time)
      const scheduledSmsDateTime = checkInDateTime.subtract(
        daysBeforeCheckIn,
        'day',
      );
      const now = dayjs().tz(hotelTimezone);

      // If the current time is past when the scheduled SMS would have been sent,
      // send the onboarding SMS immediately
      if (
        now.isAfter(scheduledSmsDateTime) &&
        !reservation.onboarding_sms_sent
      ) {
        logger.info(
          `checkAndSendImmediateOnboardingSms: Reservation ${reservation.id} created after scheduled SMS time. ` +
            `Check-in: ${checkInDateTime.format('YYYY-MM-DD HH:mm:ss')}, Scheduled SMS: ${scheduledSmsDateTime.format('YYYY-MM-DD HH:mm:ss')}, Now: ${now.format('YYYY-MM-DD HH:mm:ss')}`,
        );

        await this.sendOnboardingSmsForReservation(
          reservation,
          hotel,
          config,
          hotelConfig,
        );
        logger.info(
          `checkAndSendImmediateOnboardingSms: Immediate onboarding SMS sent for reservation ${reservation.id}`,
        );
      } else {
        logger.info(
          `checkAndSendImmediateOnboardingSms: Reservation ${reservation.id} will receive SMS via scheduled job. ` +
            `Scheduled SMS: ${scheduledSmsDateTime.format('YYYY-MM-DD HH:mm:ss')}, Now: ${now.format('YYYY-MM-DD HH:mm:ss')}`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `checkAndSendImmediateOnboardingSms: Error for reservation ${reservation.id}: ${errorMessage}`,
      );
      // Don't throw - this is a non-critical operation that shouldn't block reservation activation
    }
  }

  /**
   * Builds the customer creation payload from reservation request params and
   * creates the customer via `customerService.createCustomer`.
   *
   * @param reservationParams - Reservation request params containing customer-related fields
   * @param hotelId - Hotel id the customer belongs to
   * @param customerPhoneNumber - Canonical phone number to store on the customer row
   * @param transaction - Knex transaction
   * @returns The created `Customer`
   */
  private async createCustomerFromReservationParams(
    reservationParams: {
      customer_first_name?: string;
      customer_last_name?: string;
      customer_email?: string;
      customer_address_state_or_province?: string;
      customer_address_postal_code?: string;
    },
    hotelId: string,
    customerPhoneNumber: string,
    transaction: Knex.Transaction,
  ): Promise<Customer> {
    const customerCreationData: Partial<Customer> = {
      phone_number: customerPhoneNumber,
      hotel_id: hotelId,
      ...(reservationParams.customer_first_name && {
        first_name: reservationParams.customer_first_name,
      }),
      ...(reservationParams.customer_last_name && {
        last_name: reservationParams.customer_last_name,
      }),
      ...(reservationParams.customer_email && {
        email: reservationParams.customer_email,
      }),
    };
    if (
      reservationParams.customer_address_state_or_province ||
      reservationParams.customer_address_postal_code
    ) {
      customerCreationData.address = {
        state_or_province: reservationParams.customer_address_state_or_province,
        postal_code: reservationParams.customer_address_postal_code,
      };
    }
    const customerData = await this.customerService.createCustomer(
      customerCreationData,
      transaction,
    );
    if (!customerData) {
      throw new BadRequestError(
        'createCustomerFromReservationParams: Failed to process customer information',
      );
    }
    return customerData;
  }

  async sendOnboardingSmsForCheckIns(
    days: number,
    timezones: string[],
  ): Promise<OnboardingSmsResult[]> {
    try {
      logger.info(
        `sendOnboardingSmsForCheckIns: Starting onboarding SMS job for check-ins in ${days} day(s) for timezones ${timezones.join(', ')}`,
      );

      // Get all hotels filtered by timezones
      const hotels = await this.hotelService.getHotelsByTimezone(timezones);

      if (!hotels || hotels.length === 0) {
        logger.warn('sendOnboardingSmsForCheckIns: No hotels found');
        return [];
      }

      // Process each hotel in parallel
      const processHotel = async (
        hotel: Hotel,
      ): Promise<OnboardingSmsResult> => {
        try {
          // Get hotel configuration
          const hotelConfig =
            await this.hotelConfigurationService.getHotelConfigurationByHotelId(
              hotel.id,
            );

          // Skip if no configuration, or onboarding SMS not enabled
          if (!hotelConfig?.onboarding_sms_configuration?.enabled) {
            logger.info(
              `sendOnboardingSmsForCheckIns: Onboarding SMS not enabled for hotel ${hotel.name} (${hotel.id})`,
            );
            return {
              hotel_id: hotel.id,
              hotel_name: hotel.name,
              reservations_processed: 0,
              sms_sent: 0,
              errors: [],
            };
          }

          const config = hotelConfig.onboarding_sms_configuration;

          // Calculate target date in the hotel's timezone
          const hotelTimezone = hotel.timezone;
          const targetDate = dayjs()
            .tz(hotelTimezone)
            .add(days, 'day')
            .startOf('day')
            .format('YYYY-MM-DD');

          logger.info(
            `sendOnboardingSmsForCheckIns: Processing hotel ${hotel.name} (${hotel.id}) for check-ins on ${targetDate}`,
          );

          // Find all reservations with check-in date as target date
          const reservations =
            await this.reservationRepository.findReservationsForSendingOnboardingSMS(
              hotel.id,
              targetDate,
              [ReservationStatus.ACTIVE],
            );

          logger.info(
            `sendOnboardingSmsForCheckIns: Found ${reservations.length} reservations for hotel ${hotel.name} with check-in on ${targetDate}`,
          );

          const result: OnboardingSmsResult = {
            hotel_id: hotel.id,
            hotel_name: hotel.name,
            reservations_processed: reservations.length,
            sms_sent: 0,
            errors: [],
          };

          // Process each reservation in parallel
          const processReservation = async (reservation: ReservationDTO) => {
            try {
              const sent = await this.sendOnboardingSmsForReservation(
                reservation,
                hotel,
                config,
                hotelConfig,
              );
              return { success: sent, skipped: !sent };
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : 'Unknown error';
              return {
                success: false,
                skipped: false,
                error: {
                  reservation_id: reservation.id,
                  error: errorMessage,
                },
              };
            }
          };

          // Process all reservations in parallel
          const reservationResults = await Promise.all(
            reservations.map(processReservation),
          );

          // Aggregate results
          reservationResults.forEach((res) => {
            if (res.success) {
              result.sms_sent++;
            } else if (!res.skipped && res.error) {
              result.errors.push(res.error);
            }
          });

          return result;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          logger.error(
            `sendOnboardingSmsForCheckIns: Error processing hotel ${hotel.name} (${hotel.id}): ${errorMessage}`,
          );
          return {
            hotel_id: hotel.id,
            hotel_name: hotel.name,
            reservations_processed: 0,
            sms_sent: 0,
            errors: [
              {
                reservation_id: 'N/A',
                error: errorMessage,
              },
            ],
          };
        }
      };

      // Run all hotel processing in parallel and collect results
      const results = await Promise.all(hotels.map(processHotel));

      logger.info('sendOnboardingSmsForCheckIns: Onboarding SMS job completed');
      return results;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(`sendOnboardingSmsForCheckIns: Error: ${errorMessage}`);
      throw error;
    }
  }

  async getPaymentsByExternalId(externalId: string): Promise<
    Array<
      Payment & {
        reservation_ids: string[];
        hotel_id: string;
      }
    >
  > {
    const reservations =
      await this.reservationRepository.findByExternalId(externalId);

    if (reservations.length === 0) {
      return [];
    }

    const reservationIds = reservations.map((reservation) => reservation.id);
    const paymentIds =
      await this.paymentService.getPaymentIdsByReservationIds(reservationIds);

    if (paymentIds.length === 0) {
      return [];
    }

    return this.paymentService.getPaymentsWithReservationsAndHotelId(
      paymentIds,
    );
  }
}

// Create singleton instances
const smsService = new SMSNotificationService();
const reservationRepository = new ReservationRepository();
const paymentReservationRepository = new PaymentReservationRepository();

const bookingReviewRepository = new BookingReviewRepository();

const getRoomReservationService = () => {
  return new RoomReservationService(
    paymentService,
    resNexusService,
    reservationRepository,
    customerService,
    quoteService,
    hotelService,
    hotelConfigurationService,
    smsService,
    discountService,
    paymentReservationRepository,
    notificationFactory,
    channelService,
    pmsServiceFactory,
    bookingReviewRepository,
    authorizeNetService,
  );
};

export default getRoomReservationService();
