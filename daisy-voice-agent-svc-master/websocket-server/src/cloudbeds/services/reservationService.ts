/**
 * Cloudbeds Reservation Service
 *
 * Implements the PMS-agnostic `IPMSReservationService` interface against
 * Cloudbeds' v1.3 API. Covers single- and multi-room availability, quotes,
 * reservation creation, cancellation, and modification (date, room type,
 * rate changes) via `PUT /putReservation`.
 *
 * Credential model:
 * - `hotels.business_id` carries the Cloudbeds `propertyID`.
 * - Bearer token is resolved from `hotel_configurations.external_auth_config`
 *   (encrypted at rest) via `resolveCloudbedsCredentials` (see
 *   `cloudbedsCredentials.ts`), which also refuses hotels whose integration
 *   has been marked disabled.
 *
 * Payment integration (from Stripe webhook):
 * - `cardToken` = `customer.payment_provider_customer_id`
 * - `paymentAuthorizationCode` = latest payment's `booking_confirmation_id`
 *   (set by `stripeWebhookService.handlePaymentIntentSucceeded`).
 *
 * `sourceID` on new reservations comes from
 * `hotel_configurations.dextr_pms_source_id`, Dextr's channel identifier
 * within the hotel's Cloudbeds account.
 */

import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import config from '../../config';
import { Hotel } from '../../dtos/Hotel';
import { Reservation as ReservationDTO } from '../../dtos/Reservation';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { BadRequestError } from '../../errors/BadRequestError';
import { NoDataError } from '../../errors/NoDataError';
import { Hotel as HotelModel } from '../../models/Hotel';
import { HotelConfiguration } from '../../models/HotelConfiguration';
import {
  GetAvailabilityRequestParams,
  GetSingleRoomAvailabilityRequestParams,
} from '../../models/request/availability';
import { PeoplePerRoom } from '../../models/request/roomReservation';
import {
  ExternalModificationDateEntry,
  ExternalModificationInfo,
} from '../../pms/types/ExternalModification';
import {
  CreateReservationParams,
  CreateReservationResponse,
  IPMSReservationService,
  ReservationNotesContext,
} from '../../pms/types/IPMSReservationService';
import { PMSQuote } from '../../pms/types/Quote';
import { PMSQuoteRequest } from '../../pms/types/QuoteRequest';
import {
  determineDateModificationScenario,
  groupContiguousDates,
} from '../../pms/utils/dateModification';
import { hotelService } from '../../services/hotel/hotelService';
import { hotelConfigurationService } from '../../services/hotelConfiguration/hotelConfigurationService';
import { validateAndCorrectDates } from '../../services/roomReservation/helper';
import { getPetFeeStrategy } from '../../services/roomReservation/petFeeStrategies';
import { PaymentProvider } from '../../types/enums';
import {
  DepositType,
  InitialDepositPolicy,
} from '../../types/hotelConfiguration';
import { withTimeoutWithFallback } from '../../utils/async';
import {
  formatCurrencyAmount,
  roundCurrency,
  truncateCurrency,
} from '../../utils/helper';
import { KpiStat, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import cloudbedsClient, { CloudbedsClient } from '../client/CloudbedsClient';
import {
  CloudbedsAPIError,
  CloudbedsConfigurationError,
  CloudbedsRoomUnavailableError,
} from '../errors';
import {
  CloudbedsGetReservationResponseData,
  CloudbedsItem,
  CloudbedsPetFeeQuote,
  CloudbedsPostItemRequest,
  CloudbedsPostReservationRequest,
  CloudbedsPutReservationRoomEntry,
  CloudbedsRate,
  CloudbedsRateDetailed,
  CloudbedsRoomInfo,
  CloudbedsRoomType,
  CloudbedsTaxOrFee,
} from '../types';
import {
  mapCloudbedsGetReservationToReservationDTO,
  mapCloudbedsStatus,
} from '../utils/mapGetReservationToReservationDTO';
import { resolveCloudbedsCredentials } from './cloudbedsCredentials';
dayjs.extend(utc);
dayjs.extend(timezone);

import {
  validateGetRateQuery,
  validateGetRoomTypesQuery,
} from '../validators/availabilityValidator';
import {
  validateCancelReservationParams,
  validateCreateReservationParams,
} from '../validators/reservationValidator';
import { validateGetRoomTypesCatalogQuery } from '../validators/roomTypesCatalogValidator';

/** `getReservations` pages for {@link CloudbedsReservationService.getArrivalsOrThrow}: Cloudbeds' largest page, and a cap. */
const ARRIVAL_PAGE_SIZE = 100;
const ARRIVAL_PAGES_MAX = 10;

export interface CloudbedsRoomGroup {
  room_id: string;
  room_name: string;
  available_units: number;
  deposit_rule_info: Record<string, unknown>;
  cancel_rule_info: Record<string, unknown>;
  pricing: {
    base_rate: number;
    taxes: number;
    fees: number;
    total_amount: number;
    /** Initial deposit amount after applying the hotel's deposit policy. Equals total_amount when no policy is configured. */
    amountCharged: number;
    currency: string;
    stay_dates: Array<{
      date: string;
      rate_amount: number;
      total_amount: number;
    }>;
  };
  raw_response: CloudbedsRate;
}

export interface CloudbedsAvailabilityResponse {
  groups: CloudbedsRoomGroup[];
  discount: null;
  date_correction_details?: string;
}

export class CloudbedsReservationService implements IPMSReservationService {
  private client: CloudbedsClient;

  constructor(client: CloudbedsClient) {
    this.client = client;
  }

  /**
   * Converts a Cloudbeds rate entry into PMS-agnostic pricing shape.
   *
   * `base_rate` = sum of per-night rates from `roomRateDetailed`.
   *
   * `taxes` / `fees` = sum of all exclusive, rate-applicable charges applied
   * on top of `base_rate`. Inclusive taxes are already embedded in the nightly
   * rates and are not double-counted.
   *
   * amountType semantics (per Cloudbeds docs):
   *   percentage            – % of base rate (total accommodation amount)
   *   percentage_rate_based – % of base rate (rate-based variant, same result)
   *   fixed                 – fixed amount per room night:  × numNights
   *   fixed_per_person      – fixed per person per night:   × numPersons × numNights
   *                           uses amountAdult / amountChild when set
   *   fixed_per_accomodation – flat amount per accommodation (per stay)
   *   fixed_per_reservation  – flat amount per reservation  (per stay)
   */
  private mapRateToPricing(
    rate: CloudbedsRate,
    taxesAndFees: CloudbedsTaxOrFee[] = [],
    currency: string,
    numAdults = 1,
    numChildren = 0,
  ): CloudbedsRoomGroup['pricing'] {
    const detailed = rate.roomRateDetailed ?? [];
    const baseRate = roundCurrency(
      detailed.reduce((sum, entry) => sum + Number(entry.rate ?? 0), 0),
    );
    const numNights = detailed.length || 1;

    // `amount`/`adultRate`/`childRate` are intentionally left unrounded here —
    // rounding these inputs before they're multiplied/divided compounds error
    // versus Cloudbeds, which truncates only the final tax/fee line amount. Each
    // branch below truncates its `computed` result exactly once, with
    // `truncateCurrency` to match Cloudbeds, whose tax engine drops everything
    // past the second decimal (truncates to the cent) rather than rounding. This
    // makes Dextr's stored total equal Cloudbeds' folio exactly — no drift.
    // Two-pass computation: fees first, then taxes (which may reference fees
    // via `feesCharged`). This mirrors Cloudbeds' behaviour where a tax
    // configured with feesCharged is calculated on (baseRate + those fees).
    const feeItems = taxesAndFees.filter((t) => t.type === 'fee');
    const taxItems = taxesAndFees.filter((t) => t.type === 'tax');

    const computeAmount = (
      taxOrFee: CloudbedsTaxOrFee,
      percentageBase: number,
    ): number => {
      const amount = parseFloat(taxOrFee.amount);
      switch (taxOrFee.amountType) {
        case 'percentage':
        case 'percentage_rate_based':
          return truncateCurrency(percentageBase * (amount / 100));
        case 'fixed':
          return truncateCurrency(amount * numNights);
        case 'fixed_per_person': {
          const adultRate = taxOrFee.amountAdult
            ? parseFloat(taxOrFee.amountAdult)
            : amount;
          const childRate = taxOrFee.amountChild
            ? parseFloat(taxOrFee.amountChild)
            : amount;
          return truncateCurrency(
            (adultRate * numAdults + childRate * numChildren) * numNights,
          );
        }
        case 'fixed_per_accomodation':
        case 'fixed_per_reservation':
          return truncateCurrency(amount);
        default:
          logger.warn(
            'CloudbedsReservationService.mapRateToPricing: unsupported amountType, skipping',
            {
              taxID: taxOrFee.taxID,
              name: taxOrFee.name,
              amountType: taxOrFee.amountType,
            },
          );
          return 0;
      }
    };

    // Pass 1: compute fees and index by feeID
    const feeById = new Map<string, number>();
    let fees = 0;
    for (const fee of feeItems) {
      const computed = computeAmount(fee, baseRate);
      if (fee.feeID) feeById.set(fee.feeID, computed);
      fees += computed;
    }

    // Pass 2: compute taxes — include referenced fee amounts in the base
    let taxes = 0;
    for (const tax of taxItems) {
      let taxBase = baseRate;
      if (tax.feesCharged?.length) {
        for (const feeId of tax.feesCharged) {
          taxBase += feeById.get(feeId) ?? 0;
        }
      }
      taxes += computeAmount(tax, taxBase);
    }
    taxes = roundCurrency(taxes);
    fees = roundCurrency(fees);
    const totalAmount = roundCurrency(baseRate + taxes + fees);

    return {
      base_rate: baseRate,
      taxes,
      fees,
      total_amount: totalAmount,
      amountCharged: totalAmount, // overridden later by applyInitialDepositPolicy
      stay_dates: detailed.map((entry) => ({
        date: entry.date,
        rate_amount: roundCurrency(Number(entry.rate ?? 0)),
        total_amount: roundCurrency(Number(entry.rate ?? 0)),
      })),
      currency,
    };
  }

  /**
   * Fetches and returns only the taxes/fees that apply exclusively on top of
   * room rates (i.e. `availableFor` includes "rate" (i.e. taxes and fees applicable for reservations) and
   * `inclusiveOrExclusive === "exclusive"`).
   * List of availableFor values:
   * - product: Items
   * - rate: Reservations
   * - fee: Fees -- this tax is charged on top of some fees
   * - custom_item: Custom item - this tax was charged for a custom item
   */
  private async fetchTaxesAndFees(
    propertyID: string,
    apiToken: string,
    hotelId: string,
  ): Promise<CloudbedsTaxOrFee[]> {
    try {
      const all = await this.client.getTaxesAndFees(
        {
          propertyID,
          includeCustomItemTaxes: true,
          includeDeleted: false,
          includeExpired: false,
        },
        { apiToken, hotelId },
      );
      // TODO: Map this to the fee ID when multiple hotels are onboarded, since each hotel
      // can have different names for pet fees
      const PET_FEE_PATTERN = /\bpet[\s_-]*fee\b/i;
      return all.filter(
        (t) =>
          t.inclusiveOrExclusive === 'exclusive' &&
          Array.isArray(t.availableFor) &&
          t.availableFor.includes('rate') &&
          !PET_FEE_PATTERN.test(t.name ?? ''),
      );
    } catch (error) {
      logger.error(
        'CloudbedsReservationService.fetchTaxesAndFees: failed, taxes will default to 0',
        {
          propertyID,
          hotelId,
          error: (error as Error).message,
        },
      );
      return [];
    }
  }

  /**
   * Fetches the total price of the pet-fee item from Cloudbeds `GET /getItems`.
   *
   * Looks for an item whose name is exactly "Pet Fee" (case-insensitive).
   * Uses `grandTotal` (price + item-level taxes/fees) when the API returns it,
   * falling back to the base `price` when `grandTotal` is null.
   * Returns `null` on failure or when no matching item exists.
   */
  private async fetchPetFeeItem(
    propertyID: string,
    apiToken: string,
    hotelId: string,
  ): Promise<CloudbedsItem | null> {
    try {
      const items = await this.client.getItems(
        { propertyID },
        { apiToken, hotelId },
      );
      // TODO: Map this to the fee ID when multiple hotels are onboarded, since each hotel
      // can have different names for pet fees
      const petItem = items.find((item) =>
        /\bpet[\s_-]*fee\b/i.test(item.name.trim()),
      );
      if (!petItem) return null;
      return petItem;
    } catch (error) {
      logger.error('CloudbedsReservationService.fetchPetFeeItem: failed', {
        propertyID,
        hotelId,
        error: (error as Error)?.message,
      });
      return null;
    }
  }

  /**
   * Applies the pet fee to a pricing snapshot and returns the updated pricing.
   *
   * Fee resolution order:
   * 1. If `hotelConfig.pet_fee_configuration` is set, the configured strategy
   *    determines the fee amount (per-night-per-pet, flat fee, etc.).
   * 2. Otherwise the Cloudbeds item price is applied as a flat fee per pet
   *    (`petFeeItemPrice × numPets`).
   *
   * The result is added to `fees`; `total_amount` is recalculated as
   * `base_rate + taxes + fees`.
   */
  private applyPetFee(
    pricing: CloudbedsRoomGroup['pricing'],
    startDate: string,
    endDate: string,
    roomTypeID: string,
    numPets: number,
    petFeeAddon: CloudbedsItem | null,
    hotelId: string,
    hotelConfig?: HotelConfiguration | null,
  ): CloudbedsRoomGroup['pricing'] {
    if (numPets <= 0) return pricing;

    let petFeeAmount = 0;

    const strategy = getPetFeeStrategy(
      hotelId,
      hotelConfig?.pet_fee_configuration,
      roomTypeID,
    );
    // If a pet fee strategy is configured in Dextr, use it to calculate the pet fee. Else, use the pet fee addon returned by Cloudbeds.
    if (strategy) {
      const quoteAdapter: CloudbedsPetFeeQuote = {
        check_in: startDate,
        check_out: endDate,
        unit_group_id: roomTypeID,
        base_rate: pricing.base_rate,
        taxes: pricing.taxes,
        fees: pricing.fees,
        total_amount: pricing.total_amount,
        amountCharged: pricing.total_amount,
      };
      strategy.validatePetCount(numPets);
      petFeeAmount = roundCurrency(
        strategy.calculatePetFee(quoteAdapter, numPets) || 0,
      );
    } else if (petFeeAddon) {
      // If a pet fee addon is returned by Cloudbeds, use it to calculate the pet fee. Use it as a flat fee per reservation.
      const petFeeItemPrice = petFeeAddon.grandTotal ?? petFeeAddon.price;
      petFeeAmount = roundCurrency(petFeeItemPrice);
    }

    if (petFeeAmount <= 0) return pricing;

    logger.info('CloudbedsReservationService.applyPetFee: applying pet fee', {
      hotelId,
      numPets,
      petFeeAmount,
      source: strategy ? 'pet_fee_configuration' : 'cloudbeds_items',
    });

    const fees = roundCurrency(pricing.fees + petFeeAmount);
    const total_amount = roundCurrency(
      pricing.base_rate + pricing.taxes + fees,
    );
    return { ...pricing, fees, total_amount };
  }

  /**
   * Applies the hotel's initial deposit policy to a quote and returns the
   * adjusted `amountCharged`.
   *
   * Resolution:
   * 1. If the policy is disabled or has no tiers, `amountCharged` stays equal
   *    to `total_amount` (full charge).
   * 2. The first matching tier (by night count) sets `amountCharged`.
   * 3. `amountCharged` is capped at `total_amount`.
   *
   * Value=0 (PERCENTAGE or FLAT) results in amountCharged=0, enabling the
   * card-only setup flow when the payment provider supports autocharge.
   */
  private applyInitialDepositPolicy(
    quote: PMSQuote,
    checkIn: string,
    checkOut: string,
    policy: InitialDepositPolicy | null | undefined,
    paymentProvider: PaymentProvider,
  ): PMSQuote {
    if (paymentProvider === PaymentProvider.NOT_APPLICABLE) {
      quote.amountCharged = 0;
      logger.info(
        'CloudbedsReservationService.applyInitialDepositPolicy: Payment provider is NOT_APPLICABLE, setting amountCharged to 0',
      );
      return quote;
    }

    if (!policy?.enabled || !policy.tiers?.length) {
      return quote;
    }

    const nights = dayjs(checkOut).diff(dayjs(checkIn), 'day');
    const matchedTier = policy.tiers.find((tier) => {
      const meetsMin = nights >= tier.min_nights;
      const meetsMax = tier.max_nights == null || nights <= tier.max_nights;
      return meetsMin && meetsMax;
    });

    if (!matchedTier) {
      logger.info(
        'CloudbedsReservationService.applyInitialDepositPolicy: No matching tier',
        { nights },
      );
      return quote;
    }

    let depositAmount: number | undefined;

    switch (matchedTier.deposit_type) {
      case DepositType.PERCENTAGE: {
        const pct = matchedTier.value;
        if (pct == null) {
          logger.info(
            'CloudbedsReservationService.applyInitialDepositPolicy: PERCENTAGE tier missing value',
            { nights },
          );
          return quote;
        }
        depositAmount = roundCurrency((quote.total_amount * pct) / 100);
        logger.info(
          'CloudbedsReservationService.applyInitialDepositPolicy: applying percentage deposit',
          {
            nights,
            pct,
            total_amount: quote.total_amount,
            depositAmount,
          },
        );
        break;
      }
      case DepositType.FLAT: {
        const flat = matchedTier.value;
        if (flat == null) {
          logger.info(
            'CloudbedsReservationService.applyInitialDepositPolicy: FLAT tier missing value',
            { nights },
          );
          return quote;
        }
        depositAmount = roundCurrency(flat);
        logger.info(
          'CloudbedsReservationService.applyInitialDepositPolicy: applying flat deposit',
          {
            nights,
            flat,
            depositAmount,
          },
        );
        break;
      }
      default:
        logger.info(
          `CloudbedsReservationService.applyInitialDepositPolicy: deposit_type "${matchedTier.deposit_type}" not yet supported`,
          { nights },
        );
        return quote;
    }

    if (depositAmount == null) {
      return quote;
    }

    quote.amountCharged = roundCurrency(
      Math.min(depositAmount, quote.total_amount),
    );
    return quote;
  }

  // ========== ROOM INFO ==========

  async getRoomsInfo(
    businessId: string,
  ): Promise<{ rooms: CloudbedsRoomInfo[]; note: string }> {
    const hotel = await hotelService.getHotelByBusinessId(businessId);
    if (!hotel) {
      throw new NoDataError(
        `CloudbedsReservationService.getRoomsInfo: Hotel not found for business_id ${businessId}`,
      );
    }
    const { propertyID, apiToken, hotelId } =
      await resolveCloudbedsCredentials(hotel);

    const query = validateGetRoomTypesCatalogQuery({ propertyIDs: propertyID });
    const data = await this.client.getRoomTypesCatalog(query, {
      apiToken,
      hotelId,
    });

    const note =
      'This is static room type information only. To check if rooms are available for specific dates, you must call the availability tool.';
    // Cloudbeds' adultsIncluded/childrenIncluded count guests covered by the
    // base rate before extra-person fees, not a maximum occupancy cap — Cloudbeds
    // has no such field, so we can't populate max_adults/max_children here.
    const roomInfo: CloudbedsRoomInfo[] = data.map((rt) => ({
      room_id: rt.roomTypeID,
      room_name: rt.roomTypeName,
      room_code: rt.roomTypeNameShort,
      description: rt.roomTypeDescription,
      max_occupancy: rt.maxGuests,
    }));
    return { rooms: roomInfo, note };
  }

  async getRoomTypeMap(businessId: string): Promise<Map<string, string>> {
    const roomsInfo = await this.getRoomsInfo(businessId);
    const rooms = roomsInfo.rooms;
    return new Map(rooms.map((r) => [String(r.room_id), r.room_name]));
  }

  // ========== AVAILABILITY ==========

  /**
   * Single entry point for all rate → pricing → deposit computation.
   *
   * Combines three steps that always run together:
   * 1. `mapRateToPricing`   — converts raw Cloudbeds rate to structured pricing
   * 2. `applyPetFee`        — adds pet fee when pets are present
   * 3. `applyInitialDepositPolicy` — computes `amountCharged` from the hotel's deposit policy
   *
   * Returns a fully populated `PMSQuote` ready to use in both availability
   * and quote responses. Extra fields (e.g. `room_type_id`) can be merged
   * in by the caller.
   */
  private computePricing({
    rate,
    taxesAndFees,
    currency,
    checkIn,
    checkOut,
    numAdults,
    numChildren,
    numPets,
    petFeeAddon,
    roomTypeID,
    hotelId,
    hotelConfig,
    paymentProvider,
  }: {
    rate: CloudbedsRate;
    taxesAndFees: CloudbedsTaxOrFee[];
    currency: string;
    checkIn: string;
    checkOut: string;
    numAdults: number;
    numChildren: number;
    numPets: number;
    petFeeAddon: CloudbedsItem | null;
    roomTypeID: string;
    hotelId: string;
    hotelConfig: HotelConfiguration | null | undefined;
    paymentProvider: PaymentProvider;
  }): CloudbedsRoomGroup['pricing'] {
    // Some hotels have room-type-specific taxes/fees, so we filter by room type when the hotel is in the configured list. Otherwise we apply all rate-applicable taxes/fees.
    const shouldFilterByRoomType =
      config.CLOUDBEDS_ROOM_TYPE_TAX_FILTER_HOTEL_IDS.includes(hotelId);
    const applicableTaxesAndFees = shouldFilterByRoomType
      ? taxesAndFees.filter(
          (t) =>
            !t.isRoomTypeRestricted ||
            t.roomTypes.some((rt) => rt.roomTypeID === roomTypeID),
        )
      : taxesAndFees;
    let pricing = this.mapRateToPricing(
      rate,
      applicableTaxesAndFees,
      currency,
      numAdults,
      numChildren,
    );
    if (numPets > 0) {
      pricing = this.applyPetFee(
        pricing,
        checkIn,
        checkOut,
        roomTypeID,
        numPets,
        petFeeAddon,
        hotelId,
        hotelConfig,
      );
    }

    const quote: PMSQuote = {
      base_rate: pricing.base_rate,
      taxes: pricing.taxes,
      fees: pricing.fees,
      total_amount: pricing.total_amount,
      amountCharged: pricing.total_amount,
      raw_response: rate,
      pricing,
    };
    const { amountCharged } = this.applyInitialDepositPolicy(
      quote,
      checkIn,
      checkOut,
      hotelConfig?.initial_deposit_policy,
      paymentProvider,
    );
    return { ...pricing, amountCharged: roundCurrency(amountCharged || 0) };
  }

  /**
   * Fetches available room types and per-room-type pricing for a date
   * range / occupancy. Returns a structure compatible with the other PMS
   * integrations so `roomReservationService` can consume it unchanged.
   */
  async getRoomAvailabilityWithQuote(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    _phoneNumber: string,
    hotelPhoneNumber: string,
  ): Promise<CloudbedsAvailabilityResponse> {
    return this.getRoomAvailabilityWithQuoteCore(
      availabilityParams,
      hotelPhoneNumber,
      (query, ctx) => this.client.getRoomTypes(query, ctx),
      'getRoomAvailabilityWithQuote',
    );
  }

  /**
   * Same as {@link getRoomAvailabilityWithQuote}, but sources room types from
   * `getAvailableRoomTypes` instead of `getRoomTypes`. Cloudbeds support's
   * recommended workaround for a Cloudbeds bug where `getRoomTypes`
   * intermittently errors for same-day check-ins. Not part of
   * `IPMSReservationService` — used internally to back
   * {@link getRoomAvailabilityWithQuoteLiteV2}.
   */
  async getRoomAvailabilityWithQuoteV2(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    _phoneNumber: string,
    hotelPhoneNumber: string,
  ): Promise<CloudbedsAvailabilityResponse> {
    return this.getRoomAvailabilityWithQuoteCore(
      availabilityParams,
      hotelPhoneNumber,
      (query, ctx) => this.client.getAvailableRoomTypes(query, ctx),
      'getRoomAvailabilityWithQuoteV2',
    );
  }

  private async getRoomAvailabilityWithQuoteCore(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    hotelPhoneNumber: string,
    fetchRoomTypes: CloudbedsClient['getRoomTypes'],
    logContext: string,
  ): Promise<CloudbedsAvailabilityResponse> {
    let {
      start_date,
      end_date,
      num_adults,
      num_children = 0,
      num_pets = 0,
    } = availabilityParams;

    const hotel =
      await hotelService.getHotelByAssistantPhoneNumber(hotelPhoneNumber);
    if (!hotel) {
      throw new NoDataError(
        `CloudbedsReservationService.${logContext}: Hotel not found for phone ${hotelPhoneNumber}`,
      );
    }
    const currency = hotel.currency;
    const credentials = await resolveCloudbedsCredentials(hotel);
    const { propertyID, apiToken, hotelId } = credentials;

    const hotelConfig =
      await hotelConfigurationService.getHotelConfigurationByHotelId(hotel.id);
    const dateResult = validateAndCorrectDates(
      start_date,
      end_date,
      hotel.timezone,
      hotelConfig,
    );
    start_date = dateResult.start_date;
    end_date = dateResult.end_date;
    const dateCorrectionDetails = dateResult.dateCorrectionDetails;

    const [availabilityResponse, taxesAndFees, petFeeAddon] = await Promise.all(
      [
        fetchRoomTypes(
          validateGetRoomTypesQuery({
            propertyIDs: propertyID,
            startDate: start_date,
            endDate: end_date,
            adults: num_adults,
            children: num_children,
          }),
          { apiToken, hotelId },
        ),
        this.fetchTaxesAndFees(propertyID, apiToken, hotelId),
        num_pets > 0
          ? this.fetchPetFeeItem(propertyID, apiToken, hotelId)
          : Promise.resolve(null),
      ],
    );

    const availableRoomTypes: CloudbedsRoomType[] = availabilityResponse.filter(
      (info) => info.roomsAvailable > 0,
    );

    if (availableRoomTypes.length === 0) {
      logger.info(
        `CloudbedsReservationService.${logContext}: No availability`,
        {
          start_date,
          end_date,
          hotelId,
        },
      );
      return {
        groups: [],
        discount: null,
        ...(dateCorrectionDetails && {
          date_correction_details: dateCorrectionDetails,
        }),
      };
    }

    const AvailabilityWithRatePromises = availableRoomTypes.map(
      async (rt): Promise<CloudbedsRoomGroup | null> => {
        try {
          const rate = await this.client.getRate(
            validateGetRateQuery({
              propertyID,
              roomTypeID: rt.roomTypeID,
              startDate: start_date,
              endDate: end_date,
              adults: num_adults,
              children: num_children,
              detailedRates: true, // fetches the rate for each night of the stay
            }),
            { apiToken, hotelId },
          );

          if (!rate) return null;

          const pricing = this.computePricing({
            rate,
            taxesAndFees,
            currency,
            checkIn: start_date,
            checkOut: end_date,
            numAdults: num_adults,
            numChildren: num_children,
            numPets: num_pets,
            petFeeAddon,
            roomTypeID: rt.roomTypeID,
            hotelId,
            hotelConfig,
            paymentProvider: hotel.payment_provider,
          });

          return {
            room_id: rt.roomTypeID,
            room_name: rt.roomTypeName,
            available_units: rt.roomsAvailable,
            deposit_rule_info: {},
            cancel_rule_info: {},
            pricing,
            raw_response: rate,
          };
        } catch (error) {
          logger.error(
            `CloudbedsReservationService.${logContext}: getRate failed`,
            {
              roomTypeID: rt.roomTypeID,
              error: (error as Error).message,
            },
          );
          return null;
        }
      },
    );

    const AvailabilityWithRateResponses = (
      await Promise.all(AvailabilityWithRatePromises)
    ).filter((g): g is CloudbedsRoomGroup => g !== null);

    if (hotel.payment_provider === PaymentProvider.NOT_APPLICABLE) {
      for (const group of AvailabilityWithRateResponses) {
        if (group.pricing) {
          group.pricing.amountCharged = 0;
        }
      }
    }

    logKpi({
      stat: KpiStat.CloudbedsReservationAvailabilityRequested,
      value: 1,
      contextName: 'cloudbedsReservationService',
      clientId: hotelId,
    });

    return {
      groups: AvailabilityWithRateResponses,
      discount: null,
      ...(dateCorrectionDetails && {
        date_correction_details: dateCorrectionDetails,
      }),
    };
  }

  /**
   * Simplified natural-language availability response matching the tone
   * used by other PMS integrations. One sentence per available room type.
   */
  async getRoomAvailabilityWithQuoteLite(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
  ): Promise<{
    groups: Array<Record<string, string>>;
    discount: null;
    message?: string;
    date_correction_details?: string;
  }> {
    return this.getRoomAvailabilityWithQuoteLiteCore(
      availabilityParams,
      phoneNumber,
      hotelPhoneNumber,
      (params, ph, hph) => this.getRoomAvailabilityWithQuote(params, ph, hph),
      'getRoomAvailabilityWithQuoteLite',
    );
  }

  /**
   * Same as {@link getRoomAvailabilityWithQuoteLite}, but sources room types
   * from `getAvailableRoomTypes` instead of `getRoomTypes` (via
   * {@link getRoomAvailabilityWithQuoteV2}). Cloudbeds support's recommended
   * workaround for a Cloudbeds bug where `getRoomTypes` intermittently
   * errors for same-day check-ins.
   */
  async getRoomAvailabilityWithQuoteLiteV2(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
  ): Promise<{
    groups: Array<Record<string, string>>;
    discount: null;
    message?: string;
    date_correction_details?: string;
  }> {
    return this.getRoomAvailabilityWithQuoteLiteCore(
      availabilityParams,
      phoneNumber,
      hotelPhoneNumber,
      (params, ph, hph) => this.getRoomAvailabilityWithQuoteV2(params, ph, hph),
      'getRoomAvailabilityWithQuoteLiteV2',
    );
  }

  private async getRoomAvailabilityWithQuoteLiteCore(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
    fetchQuote: (
      params: GetSingleRoomAvailabilityRequestParams,
      phoneNumber: string,
      hotelPhoneNumber: string,
    ) => Promise<CloudbedsAvailabilityResponse>,
    logContext: string,
  ): Promise<{
    groups: Array<Record<string, string>>;
    discount: null;
    message?: string;
    date_correction_details?: string;
  }> {
    const hotel =
      await hotelService.getHotelByAssistantPhoneNumber(hotelPhoneNumber);
    if (!hotel) {
      throw new NoDataError(
        `CloudbedsReservationService.${logContext}: Hotel not found for phone ${hotelPhoneNumber}`,
      );
    }

    const hotelConfig =
      await hotelConfigurationService.getHotelConfigurationByHotelId(hotel.id);
    const dateResult = validateAndCorrectDates(
      availabilityParams.start_date,
      availabilityParams.end_date,
      hotel.timezone,
      hotelConfig,
    );
    const correctedParams = {
      ...availabilityParams,
      start_date: dateResult.start_date,
      end_date: dateResult.end_date,
    };
    const dateCorrectionDetails = dateResult.dateCorrectionDetails;

    const availabilityResponse = await fetchQuote(
      correctedParams,
      phoneNumber,
      hotelPhoneNumber,
    );

    const {
      start_date,
      end_date,
      num_adults,
      num_children = 0,
    } = correctedParams;
    const nights = Math.max(1, dayjs(end_date).diff(dayjs(start_date), 'day'));
    const adultsText = num_adults === 1 ? '1 adult' : `${num_adults} adults`;
    const childrenText =
      num_children === 1 ? '1 child' : `${num_children} children`;
    const isNoPayment =
      hotel.payment_provider === PaymentProvider.NOT_APPLICABLE;

    if (availabilityResponse.groups.length === 0) {
      return {
        groups: [],
        discount: null,
        message: `No rooms are available for ${adultsText} and ${childrenText} with check-in on ${start_date} and check-out on ${end_date}. Please try different dates or occupancy.`,
        ...(dateCorrectionDetails && {
          date_correction_details: dateCorrectionDetails,
        }),
      };
    }

    const groups = availabilityResponse.groups.map((group) => {
      const { base_rate, taxes, total_amount, amountCharged, currency, fees } =
        group.pricing;
      const effectiveDeposit = isNoPayment ? 0 : amountCharged;
      let description = `For ${adultsText} and ${childrenText}, with check-in on ${start_date} and check-out on ${end_date}, the ${group.room_name} (room_id: ${group.room_id}) has a base rate of ${formatCurrencyAmount(currency, base_rate)} for ${nights} night${nights > 1 ? 's' : ''}, taxes of ${formatCurrencyAmount(currency, taxes)}, fees of ${formatCurrencyAmount(currency, fees)}, and a total of ${formatCurrencyAmount(currency, total_amount)}.`;
      if (!isNoPayment) {
        description += ` The initial deposit to secure the reservation is ${formatCurrencyAmount(currency, effectiveDeposit)}.`;
      } else {
        description += ` No payment is required to secure this reservation.`;
      }
      return { [group.room_name]: description };
    });

    return {
      groups,
      discount: null,
      ...(dateCorrectionDetails && {
        date_correction_details: dateCorrectionDetails,
      }),
    };
  }

  async getMultiRoomAvailabilityWithQuote(
    availabilityParams: GetAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
  ): Promise<CloudbedsAvailabilityResponse> {
    try {
      // TODO: Some hotels adjust room rates based on occupancy (num_adults / num_children).
      // For now we default to 1 adult / 0 children for multi-room availability;
      // revisit when per-room occupancy pricing is needed.
      const singleRoomParams: GetSingleRoomAvailabilityRequestParams = {
        ...availabilityParams,
        num_adults: 1,
        num_children: 0,
      };

      return await this.getRoomAvailabilityWithQuote(
        singleRoomParams,
        phoneNumber,
        hotelPhoneNumber,
      );
    } catch (error) {
      logger.error(
        'CloudbedsReservationService.getMultiRoomAvailabilityWithQuote: Error fetching availability',
        { error },
      );
      throw error;
    }
  }

  async getMultiRoomAvailabilityWithQuoteLite(
    availabilityParams: GetAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
  ): Promise<{
    groups: Array<Record<string, string>>;
    discount: null;
    message?: string;
    date_correction_details?: string;
  }> {
    return this.getMultiRoomAvailabilityWithQuoteLiteCore(
      availabilityParams,
      phoneNumber,
      hotelPhoneNumber,
      (params, ph, hph) => this.getRoomAvailabilityWithQuote(params, ph, hph),
      'getMultiRoomAvailabilityWithQuoteLite',
    );
  }

  /**
   * Same as {@link getMultiRoomAvailabilityWithQuoteLite}, but sources room
   * types from `getAvailableRoomTypes` instead of `getRoomTypes` (via
   * {@link getRoomAvailabilityWithQuoteV2}). Cloudbeds support's recommended
   * workaround for a Cloudbeds bug where `getRoomTypes` intermittently
   * errors for same-day check-ins.
   */
  async getMultiRoomAvailabilityWithQuoteLiteV2(
    availabilityParams: GetAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
  ): Promise<{
    groups: Array<Record<string, string>>;
    discount: null;
    message?: string;
    date_correction_details?: string;
  }> {
    return this.getMultiRoomAvailabilityWithQuoteLiteCore(
      availabilityParams,
      phoneNumber,
      hotelPhoneNumber,
      (params, ph, hph) => this.getRoomAvailabilityWithQuoteV2(params, ph, hph),
      'getMultiRoomAvailabilityWithQuoteLiteV2',
    );
  }

  private async getMultiRoomAvailabilityWithQuoteLiteCore(
    availabilityParams: GetAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
    fetchQuote: (
      params: GetSingleRoomAvailabilityRequestParams,
      phoneNumber: string,
      hotelPhoneNumber: string,
    ) => Promise<CloudbedsAvailabilityResponse>,
    logContext: string,
  ): Promise<{
    groups: Array<Record<string, string>>;
    discount: null;
    message?: string;
    date_correction_details?: string;
  }> {
    const singleRoomParams: GetSingleRoomAvailabilityRequestParams = {
      ...availabilityParams,
      num_adults: 1,
      num_children: 0,
    };

    const hotel =
      await hotelService.getHotelByAssistantPhoneNumber(hotelPhoneNumber);
    if (!hotel) {
      throw new NoDataError(
        `CloudbedsReservationService.${logContext}: Hotel not found for phone ${hotelPhoneNumber}`,
      );
    }
    if (!hotel.business_id) {
      throw new CloudbedsConfigurationError(
        `CloudbedsReservationService.${logContext}: Hotel ${hotel.id} is missing business_id`,
      );
    }

    const hotelConfig =
      await hotelConfigurationService.getHotelConfigurationByHotelId(hotel.id);
    const dateResult = validateAndCorrectDates(
      availabilityParams.start_date,
      availabilityParams.end_date,
      hotel.timezone,
      hotelConfig,
    );
    const correctedParams = {
      ...singleRoomParams,
      start_date: dateResult.start_date,
      end_date: dateResult.end_date,
    };
    const dateCorrectionDetails = dateResult.dateCorrectionDetails;

    const availabilityResponse = await fetchQuote(
      correctedParams,
      phoneNumber,
      hotelPhoneNumber,
    );

    const { start_date, end_date } = correctedParams;
    const nights = Math.max(1, dayjs(end_date).diff(dayjs(start_date), 'day'));
    const isNoPayment =
      hotel.payment_provider === PaymentProvider.NOT_APPLICABLE;

    if (availabilityResponse.groups.length === 0) {
      return {
        groups: [],
        discount: null,
        message: `No rooms are available with check-in on ${start_date} and check-out on ${end_date} for the requested dates and occupancy. Please try different dates or occupancy.`,
        ...(dateCorrectionDetails && {
          date_correction_details: dateCorrectionDetails,
        }),
      };
    }

    const roomsInfo = await this.getRoomsInfo(hotel.business_id);
    const roomMetaMap = new Map(roomsInfo.rooms.map((r) => [r.room_id, r]));

    const groups = availabilityResponse.groups.map((group) => {
      const { base_rate, taxes, total_amount, amountCharged, currency, fees } =
        group.pricing;
      const effectiveDeposit = isNoPayment ? 0 : amountCharged;
      const meta = roomMetaMap.get(group.room_id);
      const maxOccupancyText = meta?.max_occupancy
        ? ` The maximum occupancy of the room is ${meta.max_occupancy === 1 ? '1 person' : `${meta.max_occupancy} people`}.`
        : '';

      let description = `For room ${group.room_name} (room_id: ${group.room_id}), ${group.available_units} unit${group.available_units === 1 ? ' is' : 's are'} available, with check-in on ${start_date} and check-out on ${end_date}, the base rate is ${formatCurrencyAmount(currency, base_rate)} for ${nights} night${nights > 1 ? 's' : ''} (prices shown are for one adult), taxes of ${formatCurrencyAmount(currency, taxes)}, fees of ${formatCurrencyAmount(currency, fees)}, and a total of ${formatCurrencyAmount(currency, total_amount)}.`;
      if (!isNoPayment) {
        description += ` The initial deposit to secure the reservation is ${formatCurrencyAmount(currency, effectiveDeposit)}.`;
      } else {
        description += ` No payment is required to secure this reservation.`;
      }
      description += maxOccupancyText;
      description += ` You cannot book beyond the ${group.available_units} available unit${group.available_units === 1 ? '' : 's'}.`;
      if ((availabilityParams.num_pets ?? 0) > 0) {
        description += ` All amounts have the pet fees pre-applied.`;
      }
      return { [group.room_name]: description };
    });

    return {
      groups,
      discount: null,
      ...(dateCorrectionDetails && {
        date_correction_details: dateCorrectionDetails,
      }),
    };
  }

  /**
   * Web V2 availability is not used for Cloudbeds hotels in the initial
   * rollout — voice/SMS flows use the single-room methods above. Calling
   * this surfaces the gap explicitly rather than silently returning.
   */
  async getAllRatesForRoomType(): Promise<never> {
    throw new BadRequestError(
      'CloudbedsReservationService: getAllRatesForRoomType is not yet supported for Cloudbeds',
    );
  }

  async getWebRoomAvailabilityV2(): Promise<never> {
    throw new BadRequestError(
      'CloudbedsReservationService: web V2 availability is not yet supported for Cloudbeds',
    );
  }

  // ========== QUOTE ==========

  async getQuote(params: PMSQuoteRequest): Promise<PMSQuote> {
    const {
      business_id,
      room_id,
      check_in,
      check_out,
      num_adults,
      num_children = 0,
      num_pets = 0,
      hotel_id,
    } = params;

    const hotel = await hotelService.getHotelById(hotel_id);
    if (!hotel) {
      throw new NoDataError(
        `CloudbedsReservationService.getQuote: Hotel not found for hotel_id ${hotel_id}`,
      );
    }
    const currency = hotel.currency;
    const credentials = await resolveCloudbedsCredentials(hotel);
    const { propertyID, apiToken, hotelId } = credentials;
    if (propertyID !== String(business_id)) {
      logger.warn(
        'CloudbedsReservationService.getQuote: business_id mismatch against hotels.business_id',
        {
          request_business_id: business_id,
          hotel_property_id: propertyID,
        },
      );
    }

    const roomTypeID = String(room_id);

    const [rate, rateTaxes, petFeeItem, hotelConfig] = await Promise.all([
      this.client.getRate(
        validateGetRateQuery({
          propertyID,
          roomTypeID,
          startDate: check_in,
          endDate: check_out,
          adults: num_adults,
          children: num_children,
          detailedRates: true,
        }),
        { apiToken, hotelId },
      ),
      this.fetchTaxesAndFees(propertyID, apiToken, hotelId),
      num_pets > 0
        ? this.fetchPetFeeItem(propertyID, apiToken, hotelId)
        : Promise.resolve(null),
      hotelConfigurationService.getHotelConfigurationByHotelId(hotel_id),
    ]);

    if (!rate) {
      throw new CloudbedsRoomUnavailableError(
        `CloudbedsReservationService.getQuote: No rate returned for room_id ${room_id}`,
      );
    }

    const pricing = this.computePricing({
      rate,
      taxesAndFees: rateTaxes,
      currency,
      checkIn: check_in,
      checkOut: check_out,
      numAdults: num_adults,
      numChildren: num_children,
      numPets: num_pets,
      petFeeAddon: petFeeItem,
      roomTypeID,
      hotelId,
      hotelConfig,
      paymentProvider: hotel.payment_provider,
    });

    const quote: PMSQuote = {
      base_rate: pricing.base_rate,
      taxes: pricing.taxes,
      fees: pricing.fees,
      total_amount: pricing.total_amount,
      amountCharged: pricing.amountCharged,
      currency: pricing.currency,
      raw_response: rate,
      room_type_id: room_id,
      pricing,
    };

    return quote;
  }

  async getQuoteForModification(
    existingReservation: ReservationDTO,
    newCheckIn: string,
    newCheckOut: string,
    _discount: unknown,
  ): Promise<PMSQuote> {
    const hotelId =
      existingReservation.hotel?.id ?? existingReservation.hotel_id;
    if (!hotelId) {
      throw new NoDataError(
        'CloudbedsReservationService.getQuoteForModification: hotel_id is required',
      );
    }

    const hotel = await hotelService.getHotelById(hotelId);
    if (!hotel) {
      throw new NoDataError(
        `CloudbedsReservationService.getQuoteForModification: Hotel not found for hotel_id ${hotelId}`,
      );
    }

    const currency = hotel.currency;
    const credentials = await resolveCloudbedsCredentials(hotel);
    const { propertyID, apiToken, hotelId: credHotelId } = credentials;

    const roomTypeID = String(existingReservation.room_id);
    const numAdults = existingReservation.num_adults;
    const numChildren = existingReservation.num_children ?? 0;
    const numPets = existingReservation.num_pets ?? 0;

    // When the room type differs from the stored quote, existing per-night
    // pricing was for the old room and cannot be reused.
    const storedRoomTypeId =
      existingReservation.quote?.quote_object?.room_type_id;
    const roomChanged =
      storedRoomTypeId != null &&
      existingReservation.room_id !== storedRoomTypeId;

    // Build per-night map from the stored raw_response
    const existingDetailed: CloudbedsRateDetailed[] =
      existingReservation.quote?.quote_object?.raw_response?.roomRateDetailed ??
      [];
    const existingPricingMap = new Map<string, CloudbedsRateDetailed>();
    if (!roomChanged) {
      for (const entry of existingDetailed) {
        existingPricingMap.set(entry.date, entry);
      }
    }

    // Partition new date range into retained (reuse) vs new (fetch)
    const retainedEntries: CloudbedsRateDetailed[] = [];
    const newDateStrings: string[] = [];
    let cursor = dayjs(newCheckIn);
    const checkOutDay = dayjs(newCheckOut);
    while (cursor.isBefore(checkOutDay)) {
      const dateStr = cursor.format('YYYY-MM-DD');
      const existing = existingPricingMap.get(dateStr);
      if (existing) {
        retainedEntries.push(existing);
      } else {
        newDateStrings.push(dateStr);
      }
      cursor = cursor.add(1, 'day');
    }

    // Fetch rates only for new dates, grouped into contiguous ranges
    const freshEntries: CloudbedsRateDetailed[] = [];
    if (newDateStrings.length > 0) {
      const contiguousRanges = groupContiguousDates(newDateStrings);
      const rangeResults = await Promise.all(
        contiguousRanges.map(async (range) => {
          const startDate = range[0];
          const endDate = dayjs(range[range.length - 1])
            .add(1, 'day')
            .format('YYYY-MM-DD');
          const rateResponse = await this.client.getRate(
            validateGetRateQuery({
              propertyID,
              roomTypeID,
              startDate,
              endDate,
              adults: numAdults,
              children: numChildren,
              detailedRates: true,
            }),
            { apiToken, hotelId: credHotelId },
          );
          return rateResponse?.roomRateDetailed ?? [];
        }),
      );
      for (const entries of rangeResults) {
        freshEntries.push(...entries);
      }
    }

    const mergedDetailed = [...retainedEntries, ...freshEntries].sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    if (mergedDetailed.length === 0) {
      throw new CloudbedsRoomUnavailableError(
        'CloudbedsReservationService.getQuoteForModification: No rate data available for the requested dates',
      );
    }

    // Build synthetic CloudbedsRate from merged per-night data
    const syntheticRate: CloudbedsRate = {
      rateID:
        existingReservation.quote?.quote_object?.raw_response?.rateID ?? '',
      isDerived: false,
      roomRate: mergedDetailed.reduce((s, e) => s + Number(e.rate ?? 0), 0),
      totalRate: mergedDetailed.reduce(
        (s, e) => s + Number(e.totalRate ?? 0),
        0,
      ),
      roomsAvailable: 1,
      daysOfWeek: null,
      roomRateDetailed: mergedDetailed,
    };

    logger.info(
      'CloudbedsReservationService.getQuoteForModification: Modification quote built',
      {
        retained_dates: retainedEntries.length,
        fresh_dates: freshEntries.length,
        room_changed: roomChanged,
      },
    );

    const [rateTaxes, petFeeItem, hotelConfig] = await Promise.all([
      this.fetchTaxesAndFees(propertyID, apiToken, credHotelId),
      numPets > 0
        ? this.fetchPetFeeItem(propertyID, apiToken, credHotelId)
        : Promise.resolve(null),
      hotelConfigurationService.getHotelConfigurationByHotelId(hotelId),
    ]);

    const pricing = this.computePricing({
      rate: syntheticRate,
      taxesAndFees: rateTaxes,
      currency,
      checkIn: newCheckIn,
      checkOut: newCheckOut,
      numAdults,
      numChildren,
      numPets,
      petFeeAddon: petFeeItem,
      roomTypeID,
      hotelId: credHotelId,
      hotelConfig,
      paymentProvider: hotel.payment_provider,
    });

    const quote: PMSQuote = {
      base_rate: pricing.base_rate,
      taxes: pricing.taxes,
      fees: pricing.fees,
      total_amount: pricing.total_amount,
      amountCharged: pricing.amountCharged,
      currency: pricing.currency,
      raw_response: syntheticRate,
      room_type_id: existingReservation.room_id,
      pricing,
    };

    return quote;
  }

  // ========== RESERVATION LIFECYCLE ==========

  async createReservation(
    params: CreateReservationParams,
  ): Promise<CreateReservationResponse> {
    validateCreateReservationParams(params);
    const { reservation, customer, quote } = params;

    const credentials = await resolveCloudbedsCredentials(reservation.hotel_id);
    const { propertyID, apiToken, hotelId } = credentials;

    const hotelConfig =
      await hotelConfigurationService.getHotelConfigurationByHotelId(hotelId);
    const sourceId = hotelConfig?.dextr_pms_source_id;

    const roomTypeID = String(reservation.room_id);
    if (!roomTypeID || !/^\d+$/.test(roomTypeID)) {
      throw new BadRequestError(
        `CloudbedsReservationService.createReservation: invalid room_id ${reservation.room_id}`,
      );
    }

    const startDate = dayjs(reservation.check_in).format('YYYY-MM-DD');
    const endDate = dayjs(reservation.check_out).format('YYYY-MM-DD');

    const cardToken = config.CLOUDBEDS_CARD_TOKEN_ENABLED
      ? customer.payment_provider_customer_id
      : undefined;
    const paymentAuthorizationCode = config.CLOUDBEDS_CARD_TOKEN_ENABLED
      ? reservation.payments
          ?.filter(
            (payment) =>
              payment.payment_provider === PaymentProvider.STRIPE &&
              payment.booking_confirmation_id,
          )
          .sort(
            (a, b) =>
              (a.created_at?.getTime() ?? 0) - (b.created_at?.getTime() ?? 0),
          )[0]?.booking_confirmation_id
      : undefined;

    const payload: CloudbedsPostReservationRequest = {
      propertyID,
      startDate,
      endDate,
      guestFirstName: customer.first_name ?? '',
      guestLastName: customer.last_name ?? '',
      guestEmail: customer.email,
      guestPhone: customer.phone_number,
      guestCountry: customer.address?.country,
      guestZip: customer.address?.postal_code,
      guestState: customer.address?.state_or_province,
      guestCity: customer.address?.city,
      rooms: [{ roomTypeID, quantity: 1 }],
      adults: [{ roomTypeID, quantity: reservation.num_adults }],
      children: [{ roomTypeID, quantity: reservation.num_children ?? 0 }],
      paymentMethod: cardToken ? 'credit' : 'cash',
      ...(cardToken && { cardToken }),
      ...(cardToken &&
        paymentAuthorizationCode && { paymentAuthorizationCode }),
      thirdPartyIdentifier: reservation.booking_id,
      ...(sourceId && { sourceID: sourceId }),
      specialRequests: reservation.customer_special_request,
      sendEmailConfirmation: true,
    };

    const response = await this.client.postReservation(payload, {
      apiToken,
      hotelId,
    });

    logger.info(
      'CloudbedsReservationService.createReservation: reservation created',
      {
        booking_id: reservation.booking_id,
        cloudbeds_reservation_id: response.reservationID,
        quote_total: quote?.total_amount,
      },
    );

    logKpi({
      stat: KpiStat.CloudbedsReservationCreated,
      value: 1,
      contextName: 'cloudbedsReservationService',
      clientId: hotelId,
      contextId: response.reservationID,
    });

    const numPets = reservation.num_pets ?? 0;
    if (numPets > 0) {
      await this.linkPetFeeToReservation({
        propertyID,
        reservationID: response.reservationID,
        numPets,
        checkIn: startDate,
        checkOut: endDate,
        roomTypeID,
        quote,
        apiToken,
        hotelId,
        bookingId: reservation.booking_id,
      });
    }

    return {
      reservation_id: response.reservationID,
    };
  }

  /**
   * Fetches the property's pet-fee item and posts it to an existing reservation
   * via `POST /postItem`. Failures are logged but never re-thrown so that a
   * successfully created reservation is never rolled back.
   *
   * Quantity resolution:
   * - Strategy configured: strategyFee / itemUnitPrice (rounded).
   * - No strategy: 1 (Cloudbeds item price is treated as a flat fee).
   */
  private async linkPetFeeToReservation({
    propertyID,
    reservationID,
    numPets,
    checkIn,
    checkOut,
    roomTypeID,
    quote,
    apiToken,
    hotelId,
    bookingId,
  }: {
    propertyID: string;
    reservationID: string;
    numPets: number;
    checkIn: string;
    checkOut: string;
    roomTypeID: string;
    quote: {
      base_rate: number;
      taxes: number;
      fees: number;
      total_amount: number;
      amount_charged: number;
    };
    apiToken: string;
    hotelId: string;
    bookingId?: string;
  }): Promise<void> {
    try {
      const [petFeeItem, hotelConfig] = await Promise.all([
        this.fetchPetFeeItem(propertyID, apiToken, hotelId),
        hotelConfigurationService.getHotelConfigurationByHotelId(hotelId),
      ]);

      if (!petFeeItem) {
        logger.warn(
          'CloudbedsReservationService.linkPetFeeToReservation: no pet fee item found, skipping postItem',
          {
            propertyID,
            reservationID,
            hotelId,
            bookingId,
            numPets,
          },
        );
        return;
      }

      const strategy = getPetFeeStrategy(
        hotelId,
        hotelConfig?.pet_fee_configuration,
        roomTypeID,
      );

      let itemQuantity: number;
      if (strategy) {
        const pricingQuote: CloudbedsPetFeeQuote = {
          check_in: checkIn,
          check_out: checkOut,
          unit_group_id: roomTypeID,
          base_rate: quote.base_rate,
          taxes: quote.taxes,
          fees: quote.fees,
          total_amount: quote.total_amount,
          amountCharged: quote.amount_charged,
        };
        const strategyFee = strategy.calculatePetFee(pricingQuote, numPets);
        const itemUnitPrice = petFeeItem.grandTotal ?? petFeeItem.price;
        itemQuantity =
          itemUnitPrice > 0 ? Math.round(strategyFee / itemUnitPrice) : 0;
      } else {
        itemQuantity = 1;
      }

      const postItemPayload: CloudbedsPostItemRequest = {
        propertyID,
        reservationID,
        itemID: petFeeItem.itemID,
        itemQuantity,
      };

      const result = await this.client.postItem(postItemPayload, {
        apiToken,
        hotelId,
      });

      logger.info(
        'CloudbedsReservationService.linkPetFeeToReservation: pet fee item linked',
        {
          reservationID,
          hotelId,
          bookingId,
          numPets,
          itemQuantity,
          usingStrategy: Boolean(strategy),
          itemID: petFeeItem.itemID,
          soldProductID: result.soldProductID,
          transactionID: result.transactionID,
        },
      );
    } catch (error) {
      logger.error(
        'CloudbedsReservationService.linkPetFeeToReservation: failed to post pet fee item',
        {
          propertyID,
          reservationID,
          hotelId,
          bookingId,
          error: (error as Error)?.message,
        },
      );
    }
  }

  async cancelReservation(params: {
    business_id: string;
    external_id: string;
    internal_id: string;
    reason?: string;
  }): Promise<{ status: boolean; reservation_id: string }> {
    const validated = validateCancelReservationParams(params);

    // Business ID alone cannot resolve credentials — cancellation is
    // invoked with the full reservation context, so look up the hotel via
    // its business id to get the API token.
    const hotel = await hotelService.getHotelByBusinessId(
      validated.business_id,
    );
    if (!hotel) {
      throw new NoDataError(
        `CloudbedsReservationService.cancelReservation: Hotel not found for business_id ${validated.business_id}`,
      );
    }
    const credentials = await resolveCloudbedsCredentials(hotel);

    const response = await this.client.putReservation(
      {
        propertyID: credentials.propertyID,
        reservationID: validated.external_id,
        status: 'canceled',
        reason: validated.reason,
      },
      { apiToken: credentials.apiToken, hotelId: credentials.hotelId },
    );

    logger.info(
      'CloudbedsReservationService.cancelReservation: reservation cancelled',
      {
        external_id: validated.external_id,
        status: response.status,
      },
    );

    logKpi({
      stat: KpiStat.CloudbedsReservationCancelled,
      value: 1,
      contextName: 'cloudbedsReservationService',
      clientId: credentials.hotelId,
      contextId: validated.external_id,
    });

    return {
      status: true,
      reservation_id: response.reservationID,
    };
  }

  async modifyReservation(
    existingReservation: ReservationDTO,
    newCheckIn: string,
    newCheckOut: string,
    _discount: unknown,
    newRoomTypeId?: number | string,
    newRateId?: number,
  ): Promise<PMSQuote> {
    const externalId = existingReservation.external_id;
    if (!externalId) {
      throw new BadRequestError(
        'CloudbedsReservationService.modifyReservation: external_id is required',
      );
    }

    const hotelId =
      existingReservation.hotel?.id ?? existingReservation.hotel_id;
    if (!hotelId) {
      throw new NoDataError(
        'CloudbedsReservationService.modifyReservation: hotel_id is required',
      );
    }

    const credentials = await resolveCloudbedsCredentials(hotelId);
    const { propertyID, apiToken, hotelId: credHotelId } = credentials;

    const roomTypeID = String(newRoomTypeId ?? existingReservation.room_id);

    const rooms: CloudbedsPutReservationRoomEntry[] = [
      {
        roomTypeID,
        checkinDate: newCheckIn,
        checkoutDate: newCheckOut,
        adults: existingReservation.num_adults,
        children: existingReservation.num_children ?? 0,
        ...(newRateId && { rateID: String(newRateId) }),
      },
    ];

    logger.info(
      'CloudbedsReservationService.modifyReservation: modifying reservation',
      {
        reservationID: externalId,
        roomTypeID,
        checkinDate: newCheckIn,
        checkoutDate: newCheckOut,
        newRoomTypeId,
        newRateId,
      },
    );

    await this.client.putReservation(
      { propertyID, reservationID: externalId, rooms },
      { apiToken, hotelId: credHotelId },
    );

    const quote = await this.getQuoteForModification(
      {
        ...existingReservation,
        ...(newRoomTypeId && { room_id: newRoomTypeId }),
      } as ReservationDTO,
      newCheckIn,
      newCheckOut,
      null,
    );

    logger.info(
      'CloudbedsReservationService.modifyReservation: reservation modified',
      {
        reservationID: externalId,
        total_amount: quote.total_amount,
      },
    );

    return quote;
  }

  // ========== VALIDATION ==========

  /**
   * New bookings pass stay dates as their original `YYYY-MM-DD` strings;
   * reservations loaded from Postgres `date` columns arrive as local-midnight
   * Dates. Strings are kept as-is because parsing one into a Date yields UTC
   * midnight, which formats to the previous day in timezones behind UTC.
   */
  private toStayDate(value: Date | string): string {
    return typeof value === 'string'
      ? value
      : dayjs(value).format('YYYY-MM-DD');
  }

  /**
   * Validates that the rooms required for the given reservations are
   * still bookable against the live Cloudbeds inventory. Throws when any
   * room type has insufficient remaining availability.
   */
  async validateRoomAvailability(
    reservations: ReservationDTO[] | null,
  ): Promise<void> {
    if (!reservations || reservations.length === 0) {
      throw new NoDataError(
        'CloudbedsReservationService.validateRoomAvailability: No reservations provided',
      );
    }

    const first = reservations[0];
    if (!first.hotel) {
      throw new NoDataError(
        'CloudbedsReservationService.validateRoomAvailability: reservation missing hotel context',
      );
    }
    const credentials = await resolveCloudbedsCredentials(
      first.hotel as unknown as Hotel,
    );
    const { propertyID, apiToken, hotelId } = credentials;

    const roomTypesQuery = validateGetRoomTypesQuery({
      propertyIDs: propertyID,
      startDate: this.toStayDate(first.check_in),
      endDate: this.toStayDate(first.check_out),
      adults: first.num_adults,
      children: first.num_children ?? 0,
    });

    let roomTypesData: CloudbedsRoomType[];
    try {
      roomTypesData = await this.client.getRoomTypes(roomTypesQuery, {
        apiToken,
        hotelId,
      });
    } catch (error) {
      // getRoomTypes intermittently errors for same-day check-ins (the bug the
      // V2 availability routes work around). Cloudbeds gives no distinct error
      // for it, so retry any same-day API failure via getAvailableRoomTypes and
      // rethrow the original error if that fails too.
      const isSameDayCheckIn =
        roomTypesQuery.startDate ===
        dayjs().tz(first.hotel.timezone).format('YYYY-MM-DD');
      if (!(error instanceof CloudbedsAPIError) || !isSameDayCheckIn) {
        throw error;
      }
      logger.warn(
        'CloudbedsReservationService.validateRoomAvailability: getRoomTypes failed for a same-day check-in, retrying with getAvailableRoomTypes',
        { hotelId, propertyID, error: error.message },
      );
      try {
        roomTypesData = await this.client.getAvailableRoomTypes(
          roomTypesQuery,
          { apiToken, hotelId },
        );
      } catch (fallbackError) {
        logger.error(
          'CloudbedsReservationService.validateRoomAvailability: getAvailableRoomTypes fallback also failed',
          { hotelId, propertyID, error: (fallbackError as Error).message },
        );
        throw error;
      }
    }

    if (roomTypesData.length === 0) {
      throw new CloudbedsRoomUnavailableError(
        'The selected room(s) are no longer available for the requested dates',
      );
    }

    const availabilityByType = new Map<string, number>();
    for (const rt of roomTypesData) {
      availabilityByType.set(
        rt.roomTypeID,
        (availabilityByType.get(rt.roomTypeID) ?? 0) + rt.roomsAvailable,
      );
    }

    const requiredPerType = new Map<string, number>();
    for (const r of reservations) {
      const typeId = String(r.room_id);
      requiredPerType.set(typeId, (requiredPerType.get(typeId) ?? 0) + 1);
    }

    for (const [typeId, requiredCount] of requiredPerType.entries()) {
      const actual = availabilityByType.get(typeId) ?? 0;
      if (actual < requiredCount) {
        throw new CloudbedsRoomUnavailableError(
          `Room type ${typeId} is no longer available for the requested dates`,
        );
      }
    }
  }

  /**
   * Looks up a Cloudbeds reservation by PMS reservation id when no local row exists.
   */
  async lookupReservationsById(
    hotel: HotelModel,
    reservationId: string,
  ): Promise<ReservationDTO[]> {
    try {
      const credentials = await resolveCloudbedsCredentials(
        hotel as unknown as Hotel,
      );
      const ctx = {
        apiToken: credentials.apiToken,
        hotelId: credentials.hotelId,
      };

      const [byIdResult, bySourceResult] = await Promise.allSettled([
        this.client.getReservation(
          { propertyID: credentials.propertyID, reservationID: reservationId },
          ctx,
        ),
        this.client.getReservationsBySource(
          {
            propertyID: credentials.propertyID,
            sourceReservationId: reservationId,
            includeGuestsDetails: true,
          },
          ctx,
        ),
      ]);

      const reservation =
        (byIdResult.status === 'fulfilled' ? byIdResult.value : undefined) ??
        (bySourceResult.status === 'fulfilled' &&
        bySourceResult.value.length > 0
          ? bySourceResult.value[0]
          : undefined);

      if (!reservation) {
        logger.warn(
          'CloudbedsReservationService.lookupReservationsById: no results from either lookup',
          {
            hotelId: hotel.id,
            reservationId,
          },
        );
        logKpi({
          stat: KpiStat.CloudbedsReservationLookupNoResult,
          value: 1,
          contextName: 'cloudbedsReservationService',
          clientId: hotel.id,
          contextId: reservationId,
        });
        return [];
      }

      logKpi({
        stat: KpiStat.CloudbedsReservationLookupSuccess,
        value: 1,
        contextName: 'cloudbedsReservationService',
        clientId: hotel.id,
        contextId: reservationId,
      });

      const { configuration } =
        await hotelService.getHotelWithConfigurationsAndChannels(hotel.id);

      return [
        mapCloudbedsGetReservationToReservationDTO(
          reservation,
          hotel,
          configuration,
        ),
      ];
    } catch (error) {
      logger.error(
        'CloudbedsReservationService.lookupReservationsById failed',
        {
          error,
          hotelId: hotel.id,
          reservationId,
        },
      );
      return [];
    }
  }

  async lookupReservationsByPhone(
    _hotel: HotelModel,
    _phoneNumber: string,
    _maxResults?: number,
  ): Promise<ReservationDTO[]> {
    throw new Error('CloudBeds: lookupReservationsByPhone not implemented ');
  }

  async getExternalModificationInfo(
    reservationDetails: ReservationDTO,
    newCheckIn: string,
    newCheckOut: string,
    newRoomTypeId?: number | string,
    newRateId?: number,
  ): Promise<ExternalModificationInfo> {
    const existingCheckIn = dayjs
      .utc(reservationDetails.check_in)
      .format('YYYY-MM-DD');
    const existingCheckOut = dayjs
      .utc(reservationDetails.check_out)
      .format('YYYY-MM-DD');
    const roomChanged = !!newRoomTypeId;
    const existingRateId = Number(reservationDetails.rate_id) || 0;

    const scenario = determineDateModificationScenario(
      existingCheckIn,
      existingCheckOut,
      newCheckIn,
      newCheckOut,
    );

    const zeroResult = (
      overrides: Partial<ExternalModificationInfo> = {},
    ): ExternalModificationInfo => ({
      scenario,
      pricingDelta: 0,
      available: true,
      rate_id: newRateId ?? existingRateId,
      rate_code: '',
      room_type_id: newRoomTypeId ?? reservationDetails.room_id,
      adults: reservationDetails.num_adults,
      children: reservationDetails.num_children ?? 0,
      currency: reservationDetails.hotel?.currency ?? 'USD',
      newDateBreakdown: [],
      ...overrides,
    });

    if (scenario === 'same_dates' && !roomChanged) {
      return zeroResult();
    }

    if (scenario === 'stay_reduction' && !roomChanged) {
      return zeroResult();
    }

    const hotelId = reservationDetails.hotel?.id ?? reservationDetails.hotel_id;
    if (!hotelId) {
      throw new NoDataError(
        'CloudbedsReservationService.getExternalModificationInfo: hotel_id is required',
      );
    }

    const hotel = await hotelService.getHotelById(hotelId);
    if (!hotel) {
      throw new NoDataError(
        `CloudbedsReservationService.getExternalModificationInfo: Hotel not found for hotel_id ${hotelId}`,
      );
    }

    const currency = hotel.currency;
    const credentials = await resolveCloudbedsCredentials(hotel);
    const { propertyID, apiToken, hotelId: credHotelId } = credentials;
    const roomTypeID = String(newRoomTypeId ?? reservationDetails.room_id);

    // Identify dates that need fresh pricing: dates NOT in the existing
    // booking range, or ALL dates when the room type is changing.
    const existingDateSet = new Set<string>();
    let cursor = dayjs(existingCheckIn);
    while (cursor.isBefore(dayjs(existingCheckOut))) {
      existingDateSet.add(cursor.format('YYYY-MM-DD'));
      cursor = cursor.add(1, 'day');
    }

    const newDateStrings: string[] = [];
    cursor = dayjs(newCheckIn);
    const checkOutDay = dayjs(newCheckOut);
    while (cursor.isBefore(checkOutDay)) {
      const dateStr = cursor.format('YYYY-MM-DD');
      if (roomChanged || !existingDateSet.has(dateStr)) {
        newDateStrings.push(dateStr);
      }
      cursor = cursor.add(1, 'day');
    }

    if (newDateStrings.length === 0) {
      return zeroResult({ currency });
    }

    // Fetch rates only for new dates, grouped into contiguous ranges
    const freshEntries: CloudbedsRateDetailed[] = [];
    try {
      const contiguousRanges = groupContiguousDates(newDateStrings);
      const rangeResults = await Promise.all(
        contiguousRanges.map(async (range) => {
          const startDate = range[0];
          const endDate = dayjs(range[range.length - 1])
            .add(1, 'day')
            .format('YYYY-MM-DD');
          const rateResponse = await this.client.getRate(
            validateGetRateQuery({
              propertyID,
              roomTypeID,
              startDate,
              endDate,
              adults: reservationDetails.num_adults,
              children: reservationDetails.num_children ?? 0,
              detailedRates: true,
            }),
            { apiToken, hotelId: credHotelId },
          );
          if (!rateResponse || Number(rateResponse.roomsAvailable) === 0) {
            throw new CloudbedsRoomUnavailableError('Room not available');
          }
          return rateResponse?.roomRateDetailed ?? [];
        }),
      );
      for (const entries of rangeResults) {
        freshEntries.push(...entries);
      }
    } catch {
      return zeroResult({ available: false, currency });
    }

    const newDateBreakdown: ExternalModificationDateEntry[] = [];
    let additionalAmount = 0;
    for (const dr of freshEntries) {
      const drRate = parseFloat(String(dr.rate)) || 0;
      additionalAmount += drRate;
      newDateBreakdown.push({
        date: dr.date,
        room_type: reservationDetails.room_type ?? roomTypeID,
        rate_code: '',
        amount: drRate,
        currency,
      });
    }

    return {
      scenario,
      pricingDelta: roundCurrency(additionalAmount),
      available: true,
      rate_id: newRateId ?? existingRateId,
      rate_code: '',
      room_type_id: newRoomTypeId ?? reservationDetails.room_id,
      adults: reservationDetails.num_adults,
      children: reservationDetails.num_children ?? 0,
      currency,
      newDateBreakdown,
    };
  }

  async modifyExternalDirectReservation(
    reservationDetails: ReservationDTO,
    newCheckIn: string,
    newCheckOut: string,
    newRoomTypeId?: number | string,
    newRateId?: number,
  ): Promise<ExternalModificationInfo> {
    const externalId = reservationDetails.external_id;
    if (!externalId) {
      throw new BadRequestError(
        'CloudbedsReservationService.modifyExternalDirectReservation: external_id is required',
      );
    }

    if (newRateId && !newRoomTypeId) {
      throw new BadRequestError(
        'CloudbedsReservationService.modifyExternalDirectReservation: newRateId can only be specified when newRoomTypeId is also provided',
      );
    }

    const hotelId = reservationDetails.hotel?.id ?? reservationDetails.hotel_id;
    if (!hotelId) {
      throw new NoDataError(
        'CloudbedsReservationService.modifyExternalDirectReservation: hotel_id is required',
      );
    }

    const credentials = await resolveCloudbedsCredentials(hotelId);
    const { propertyID, apiToken, hotelId: credHotelId } = credentials;

    const fullReservation = await this.client.getReservation(
      { propertyID, reservationID: externalId },
      { apiToken, hotelId: credHotelId },
    );

    const additionalItems = Number(
      fullReservation.balanceDetailed?.additionalItems ?? 0,
    );
    if (additionalItems > 0) {
      throw new BadRequestError(
        'This reservation has additional items (add-ons) and cannot be modified through Dextr. Please modify it directly in Cloudbeds.',
      );
    }

    const info = await this.getExternalModificationInfo(
      reservationDetails,
      newCheckIn,
      newCheckOut,
      newRoomTypeId,
      newRateId,
    );

    const roomChanged = !!newRoomTypeId;
    if ((info.scenario === 'same_dates' && !roomChanged) || !info.available) {
      return info;
    }

    const roomTypeID = String(newRoomTypeId ?? reservationDetails.room_id);

    const rooms: CloudbedsPutReservationRoomEntry[] = [
      {
        roomTypeID,
        checkinDate: newCheckIn,
        checkoutDate: newCheckOut,
        adults: reservationDetails.num_adults,
        children: reservationDetails.num_children ?? 0,
        ...(newRateId && { rateID: String(newRateId) }),
      },
    ];

    logger.info(
      'CloudbedsReservationService.modifyExternalDirectReservation: modifying external reservation',
      {
        reservationID: externalId,
        roomTypeID,
        checkinDate: newCheckIn,
        checkoutDate: newCheckOut,
      },
    );

    await this.client.putReservation(
      { propertyID, reservationID: externalId, rooms },
      { apiToken, hotelId: credHotelId },
    );

    logger.info(
      'CloudbedsReservationService.modifyExternalDirectReservation: external reservation modified',
      {
        reservationID: externalId,
        pricingDelta: info.pricingDelta,
      },
    );

    return info;
  }

  async cancelExternalDirectReservation(
    reservationDetails: ReservationDTO,
    reason?: string,
  ): Promise<{ status: boolean; reservation_id: string }> {
    try {
      const externalId = reservationDetails.external_id;
      if (!externalId) {
        throw new BadRequestError(
          'CloudbedsReservationService.cancelExternalDirectReservation: external_id is required',
        );
      }

      const businessId = reservationDetails.business_id?.toString();
      if (!businessId) {
        throw new BadRequestError(
          'CloudbedsReservationService.cancelExternalDirectReservation: business_id is required',
        );
      }

      logger.info(
        'CloudbedsReservationService.cancelExternalDirectReservation: cancelling external reservation',
        {
          external_id: externalId,
          booking_id: reservationDetails.booking_id,
        },
      );

      return await this.cancelReservation({
        business_id: businessId,
        external_id: externalId,
        internal_id: reservationDetails.booking_id,
        reason,
      });
    } catch (error) {
      logger.error(
        'CloudbedsReservationService.cancelExternalDirectReservation: failed',
        {
          error: (error as Error)?.message,
          booking_id: reservationDetails.booking_id,
          external_id: reservationDetails.external_id,
        },
      );
      throw error;
    }
  }

  async getRateIdByCode(..._args: any[]): Promise<undefined> {
    return undefined;
  }

  async validateMultiRoomOccupancy(
    peoplePerRoom: PeoplePerRoom,
    roomsInfo: { rooms: CloudbedsRoomInfo[] },
    _hotelId: string,
  ): Promise<void> {
    if (!roomsInfo || !Array.isArray(roomsInfo.rooms)) {
      throw new BadRequestError('Invalid rooms information provided');
    }
    const roomMap = new Map(roomsInfo.rooms.map((r) => [String(r.room_id), r]));
    const inputRoomIds = Array.from(new Set(Object.keys(peoplePerRoom)));

    for (const roomId of inputRoomIds) {
      const room = roomMap.get(roomId);
      if (!room) {
        throw new BadRequestError(`Invalid room type id: ${roomId}`);
      }

      const occupantGroups = peoplePerRoom[roomId];
      if (!Array.isArray(occupantGroups)) {
        throw new BadRequestError(
          `Invalid occupant groups for room type id: ${roomId}`,
        );
      }
      for (const occupantGroup of occupantGroups) {
        if (occupantGroup.num_adults < 1) {
          throw new BadRequestError(
            `${room.room_name}: At least one adult is required per room`,
          );
        }

        const totalGuests =
          occupantGroup.num_adults + occupantGroup.num_children;
        if (room.max_occupancy != null && totalGuests > room.max_occupancy) {
          throw new BadRequestError(
            `${room.room_name}: Total guests (${totalGuests}) exceeds maximum occupancy (${room.max_occupancy})`,
          );
        }

        if (
          room.max_adults != null &&
          occupantGroup.num_adults > room.max_adults
        ) {
          throw new BadRequestError(
            `${room.room_name}: Adults (${occupantGroup.num_adults}) exceeds maximum adults (${room.max_adults})`,
          );
        }

        if (
          room.max_children != null &&
          occupantGroup.num_children > room.max_children
        ) {
          throw new BadRequestError(
            `${room.room_name}: Children (${occupantGroup.num_children}) exceeds maximum children (${room.max_children})`,
          );
        }
      }
    }
  }

  // TODO: Implement discount support for Cloudbeds when required.
  shouldFetchDiscount(): boolean {
    return false;
  }

  // TODO: Implement PMS-specific partner notes for Cloudbeds when required.
  buildPartnerNotes(_context: ReservationNotesContext): string | null {
    return null;
  }

  /**
   * Looks up Cloudbeds reservations by guest name when no local row exists.
   */
  async lookupReservationsByGuestQueryFromPms(
    hotel: HotelModel,
    guestName: string,
    timeoutMs: number = 12 * 1000,
  ): Promise<ReservationDTO[]> {
    const trimmedGuestName = guestName.trim();
    if (trimmedGuestName.length < 2) {
      return [];
    }

    return withTimeoutWithFallback(
      () =>
        this.lookupReservationsByGuestQueryFromPmsUncapped(
          hotel,
          trimmedGuestName,
        ),
      timeoutMs,
      [],
      () => {
        logger.error(
          `lookupReservationsByGuestQueryFromPms timed out after ${timeoutMs}ms. ${JSON.stringify({ guestName: trimmedGuestName })}`,
        );
      },
    );
  }

  private async lookupReservationsByGuestQueryFromPmsUncapped(
    hotel: HotelModel,
    trimmedGuestName: string,
  ): Promise<ReservationDTO[]> {
    try {
      const credentials = await resolveCloudbedsCredentials(
        hotel as unknown as Hotel,
      );
      const ctx = {
        apiToken: credentials.apiToken,
        hotelId: credentials.hotelId,
      };
      const nameParts = trimmedGuestName
        .split(/\s+/)
        .filter((part) => part.length > 0);

      const reservations =
        nameParts.length === 1
          ? await this.client.getReservationsByGuestName(
              {
                propertyID: credentials.propertyID,
                lastName: trimmedGuestName,
                includeGuestsDetails: true,
              },
              ctx,
            )
          : await this.client.getReservationsByGuestName(
              {
                propertyID: credentials.propertyID,
                firstName: nameParts.slice(0, -1).join(' '),
                lastName: nameParts[nameParts.length - 1],
                includeGuestsDetails: true,
              },
              ctx,
            );

      if (!reservations.length) {
        return [];
      }

      const { configuration } =
        await hotelService.getHotelWithConfigurationsAndChannels(hotel.id);

      return reservations.map((reservation) =>
        mapCloudbedsGetReservationToReservationDTO(
          reservation,
          hotel,
          configuration,
        ),
      );
    } catch (error) {
      logger.error(
        'CloudbedsReservationService.lookupReservationsByGuestQueryFromPms failed',
        {
          error,
          hotelId: hotel.id,
          guestName: trimmedGuestName,
        },
      );
      return [];
    }
  }

  /**
   * Looks up Cloudbeds reservations by last name only, returning the raw
   * API response (unlike lookupReservationsByGuestQueryFromPms, which maps
   * to ReservationDTO and drops the `balance` field). Unlike that method, a
   * single-word query is never treated as a first name here — callers that
   * already know they have a last name and need its actual balance (e.g.
   * Prospector Inn's door-code payment guard) should use this instead.
   */
  async getReservationsByExactLastNameFromCloudbeds(
    hotel: HotelModel,
    lastName: string,
    timeoutMs: number = 12 * 1000,
  ): Promise<CloudbedsGetReservationResponseData[]> {
    const trimmedLastName = lastName.trim();
    if (trimmedLastName.length < 2) {
      return [];
    }

    return withTimeoutWithFallback(
      () =>
        this.getReservationsByExactLastNameFromCloudbedsUncapped(
          hotel,
          trimmedLastName,
        ),
      timeoutMs,
      [],
      () => {
        logger.error(
          `getReservationsByExactLastNameFromCloudbeds timed out after ${timeoutMs}ms. ${JSON.stringify({ lastName: trimmedLastName })}`,
        );
      },
    );
  }

  private async getReservationsByExactLastNameFromCloudbedsUncapped(
    hotel: HotelModel,
    trimmedLastName: string,
  ): Promise<CloudbedsGetReservationResponseData[]> {
    try {
      const credentials = await resolveCloudbedsCredentials(
        hotel as unknown as Hotel,
      );
      const ctx = {
        apiToken: credentials.apiToken,
        hotelId: credentials.hotelId,
      };

      return await this.client.getReservationsByGuestName(
        {
          propertyID: credentials.propertyID,
          lastName: trimmedLastName,
          includeGuestsDetails: true,
        },
        ctx,
      );
    } catch (error) {
      logger.error(
        'CloudbedsReservationService.getReservationsByExactLastNameFromCloudbeds failed',
        {
          error,
          hotelId: hotel.id,
          lastName: trimmedLastName,
        },
      );
      return [];
    }
  }

  /**
   * {@link getReservationByIdOrThrow} for callers that treat a failed lookup
   * like a missing reservation: null when Cloudbeds has no such reservation,
   * and also, logged, when the lookup fails.
   */
  async getReservationByIdFromCloudbeds(
    hotel: HotelModel,
    reservationId: string,
    timeoutMs: number = 12 * 1000,
  ): Promise<CloudbedsGetReservationResponseData | null> {
    try {
      return await this.getReservationByIdOrThrow(
        hotel,
        reservationId,
        timeoutMs,
      );
    } catch (error) {
      logger.error(
        'CloudbedsReservationService.getReservationByIdFromCloudbeds failed',
        {
          error,
          hotelId: hotel.id,
          reservationId,
        },
      );
      return null;
    }
  }

  /**
   * Looks up a single Cloudbeds reservation by its Cloudbeds reservation ID,
   * falling back to the third-party/source (OTA) reservation ID Cloudbeds
   * holds as `thirdPartyIdentifier`, and returns the raw API response
   * (including `balance` and `assigned`). Both lookups are fired in parallel,
   * but a direct match is returned without waiting on the source lookup. The
   * whole lookup is bounded by `timeoutMs`.
   *
   * A source match must carry exactly this id and be for this property. A
   * cancelled copy only counts when there is no live one, and an id that more
   * than one live reservation carries throws rather than picking one. The
   * match is read again by its reservation ID, since list rows have no
   * `assigned` rooms.
   *
   * Null only when Cloudbeds answered both lookups and has no such
   * reservation; a lookup it couldn't answer (credentials, network, rate
   * limit, server error, timeout) throws instead of reading as "not found".
   */
  async getReservationByIdOrThrow(
    hotel: HotelModel,
    reservationId: string,
    timeoutMs: number = 8 * 1000,
  ): Promise<CloudbedsGetReservationResponseData | null> {
    const { propertyID, apiToken, hotelId } = await resolveCloudbedsCredentials(
      hotel as unknown as Hotel,
    );
    const ctx = { apiToken, hotelId };
    const deadline = Date.now() + timeoutMs;
    // Set once a direct match is returned: the source lookup's timer can
    // still fire after that, but nothing is waiting on it any more.
    let foundDirectly = false;
    const onTimeout = (lookup: string) => () => {
      if (foundDirectly) return;
      logger.error(
        `getReservationByIdOrThrow: ${lookup} lookup timed out after ${timeoutMs}ms. ${JSON.stringify({ reservationId })}`,
      );
    };

    // Both start now; a null result is a timeout.
    let directError: unknown;
    const byIdPromise =
      withTimeoutWithFallback<CloudbedsGetReservationResponseData | null>(
        () =>
          this.client.getReservation(
            { propertyID, reservationID: reservationId },
            ctx,
          ),
        timeoutMs,
        null,
        onTimeout('direct'),
      ).catch((error: unknown) => {
        directError = error;
        return null;
      });
    let sourceError: unknown;
    const bySourcePromise = withTimeoutWithFallback<
      CloudbedsGetReservationResponseData[] | null
    >(
      () =>
        this.client.getReservationsBySource(
          {
            propertyID,
            sourceReservationId: reservationId,
            includeGuestsDetails: true,
          },
          ctx,
        ),
      timeoutMs,
      null,
      onTimeout('source'),
    ).catch((error: unknown) => {
      sourceError = error;
      return null;
    });

    const byId = await byIdPromise;
    if (byId) {
      foundDirectly = true;
      return byId;
    }

    const bySource = await bySourcePromise;
    const sourceMatch =
      bySource && this.findSourceMatch(bySource, reservationId, propertyID);
    if (sourceMatch) {
      const reservation =
        await withTimeoutWithFallback<CloudbedsGetReservationResponseData | null>(
          () =>
            this.client.getReservation(
              { propertyID, reservationID: sourceMatch.reservationID },
              ctx,
            ),
          Math.max(deadline - Date.now(), 0),
          null,
          onTimeout('source match'),
        );
      if (!reservation) {
        throw new CloudbedsAPIError(
          `getReservationByIdOrThrow: reading reservation ${sourceMatch.reservationID} ` +
            `(source id ${reservationId}) timed out`,
          504,
        );
      }
      return reservation;
    }

    if (this.isUnknownReservationError(directError) && bySource) {
      return null;
    }

    const failure = (error: unknown) =>
      error === undefined
        ? `timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error);
    throw new CloudbedsAPIError(
      `getReservationByIdOrThrow: could not look up reservation ${reservationId} ` +
        `(direct: ${failure(directError)}; ` +
        `source: ${bySource ? 'no match' : failure(sourceError)})`,
      502,
    );
  }

  /**
   * The reservation a source (OTA) id names among `getReservations` rows: a
   * row for this property whose `thirdPartyIdentifier` is the id, a live one
   * before a cancelled copy. Throws when more than one live reservation has it.
   */
  private findSourceMatch(
    rows: CloudbedsGetReservationResponseData[],
    sourceId: string,
    propertyID: string,
  ): CloudbedsGetReservationResponseData | null {
    const id = sourceId.trim().toLowerCase();
    const matches = rows.filter(
      (row) =>
        row.thirdPartyIdentifier?.trim().toLowerCase() === id &&
        (!row.propertyID || String(row.propertyID) === propertyID),
    );
    const live = new Map(
      matches
        .filter(
          (row) =>
            mapCloudbedsStatus(row.status) !== ReservationStatus.CANCELLED,
        )
        .map((row) => [row.reservationID, row]),
    );
    if (live.size > 1) {
      throw new CloudbedsAPIError(
        `getReservationByIdOrThrow: source id ${sourceId} matches ${live.size} live reservations`,
        409,
      );
    }
    return [...live.values()][0] ?? matches[0] ?? null;
  }

  /**
   * How `getReservation` answers an id Cloudbeds doesn't know: a
   * `success: false` envelope on HTTP 200, or a 400 or 404. Rate limits,
   * auth errors and timeouts are failed lookups, not unknown ids.
   */
  private isUnknownReservationError(error: unknown): boolean {
    return (
      error instanceof CloudbedsAPIError &&
      [200, 400, 404].includes(error.statusCode)
    );
  }

  /**
   * The reservations checking in on `checkInDate` (YYYY-MM-DD) whose main
   * guest has this last name, with guest details. Throws when Cloudbeds
   * can't be asked, so callers can fail closed.
   */
  async getArrivalsByLastNameOrThrow(
    hotel: HotelModel,
    lastName: string,
    checkInDate: string,
    timeoutMs: number = 8 * 1000,
  ): Promise<CloudbedsGetReservationResponseData[]> {
    const { propertyID, apiToken, hotelId } = await resolveCloudbedsCredentials(
      hotel as unknown as Hotel,
    );
    const arrivals = await withTimeoutWithFallback<
      CloudbedsGetReservationResponseData[] | null
    >(
      () =>
        this.client.getReservationsByGuestName(
          {
            propertyID,
            lastName,
            checkInFrom: checkInDate,
            checkInTo: checkInDate,
            includeGuestsDetails: true,
          },
          { apiToken, hotelId },
        ),
      timeoutMs,
      null,
    );
    if (!arrivals) {
      throw new CloudbedsAPIError(
        `getArrivalsByLastNameOrThrow: timed out after ${timeoutMs}ms`,
        504,
      );
    }
    return arrivals;
  }

  /**
   * Every reservation checking in from `checkInFrom` to `checkInTo`
   * (YYYY-MM-DD, both included), whatever its status, with guest details,
   * read page by page: 100 a page, up to 10 pages, the last page logged as a
   * warning when more remain. Each reservation once. Throws when Cloudbeds
   * can't be asked or the pages don't all arrive within `timeoutMs`, so
   * callers can fail closed.
   */
  async getArrivalsOrThrow(
    hotel: HotelModel,
    checkInFrom: string,
    checkInTo: string,
    timeoutMs: number = 8 * 1000,
  ): Promise<CloudbedsGetReservationResponseData[]> {
    return this.listReservationsOrThrow(
      hotel,
      { checkInFrom, checkInTo },
      timeoutMs,
      'getArrivalsOrThrow',
    );
  }

  /**
   * Every reservation staying on `date` (YYYY-MM-DD): checking in from
   * `checkInFrom` up to `date` and checking out on or after it, whatever its
   * status, with guest details, read page by page as
   * {@link getArrivalsOrThrow} reads arrivals. Throws when Cloudbeds can't be
   * asked or the pages don't all arrive within `timeoutMs`, so callers can
   * fail closed.
   */
  async getStaysOnDateOrThrow(
    hotel: HotelModel,
    checkInFrom: string,
    date: string,
    timeoutMs: number = 8 * 1000,
  ): Promise<CloudbedsGetReservationResponseData[]> {
    return this.listReservationsOrThrow(
      hotel,
      { checkInFrom, checkInTo: date, checkOutFrom: date },
      timeoutMs,
      'getStaysOnDateOrThrow',
    );
  }

  private async listReservationsOrThrow(
    hotel: HotelModel,
    dates: { checkInFrom: string; checkInTo: string; checkOutFrom?: string },
    timeoutMs: number,
    caller: string,
  ): Promise<CloudbedsGetReservationResponseData[]> {
    const { propertyID, apiToken, hotelId } = await resolveCloudbedsCredentials(
      hotel as unknown as Hotel,
    );
    const reservations = await withTimeoutWithFallback<
      CloudbedsGetReservationResponseData[] | null
    >(
      () =>
        this.readArrivalPages(
          { propertyID, ...dates },
          { apiToken, hotelId },
          caller,
        ),
      timeoutMs,
      null,
    );
    if (!reservations) {
      throw new CloudbedsAPIError(
        `${caller}: timed out after ${timeoutMs}ms`,
        504,
      );
    }
    return reservations;
  }

  private async readArrivalPages(
    query: {
      propertyID: string;
      checkInFrom: string;
      checkInTo: string;
      checkOutFrom?: string;
    },
    ctx: { apiToken: string; hotelId: string },
    caller: string,
  ): Promise<CloudbedsGetReservationResponseData[]> {
    const arrivals = new Map<string, CloudbedsGetReservationResponseData>();
    for (let pageNumber = 1; pageNumber <= ARRIVAL_PAGES_MAX; pageNumber++) {
      const page = await this.client.getReservationsByCheckInDate(
        {
          ...query,
          includeGuestsDetails: true,
          pageNumber,
          pageSize: ARRIVAL_PAGE_SIZE,
        },
        ctx,
      );
      page.reservations.forEach((reservation) =>
        arrivals.set(String(reservation.reservationID), reservation),
      );
      // A short page ends the list, unless Cloudbeds' total says more remain.
      const more =
        page.reservations.length >= ARRIVAL_PAGE_SIZE ||
        (page.total !== null &&
          page.reservations.length > 0 &&
          arrivals.size < page.total);
      if (!more) return [...arrivals.values()];
    }
    logger.warn(`${caller}: stopped before the last page`, {
      hotelId: ctx.hotelId,
      checkInFrom: query.checkInFrom,
      checkInTo: query.checkInTo,
      checkOutFrom: query.checkOutFrom,
      pages: ARRIVAL_PAGES_MAX,
      arrivals: arrivals.size,
    });
    return [...arrivals.values()];
  }

  // ========== DOOR CODE ==========

  /**
   * Resolves the door lock code for a Cloudbeds reservation.
   *
   * Strategy (per Cloudbeds integrations guidance):
   * 1. **Door Lock API** — `GET /doorlock/v1/keys/{propertyId}?reservationId=…`
   *    Look for a completed `access_code` key and return its `keyCode`.
   * 2. **Custom field fallback** — `GET /getReservation` → read the custom
   *    field whose shortcode matches `door_lock_config.door_lock_custom_field`.
   *
   * Returns the code string when found, `null` otherwise.
   */
  async resolveDoorCode(
    hotel: Hotel,
    reservationId: string,
    doorLockCustomFieldShortcode?: string,
  ): Promise<string | null> {
    try {
      const credentials = await resolveCloudbedsCredentials(hotel);
      const { propertyID, apiToken, hotelId } = credentials;
      const ctx = { apiToken, hotelId };

      // Path 1: Door Lock API
      const doorLockCode = await this.resolveDoorCodeFromDoorLockApi(
        propertyID,
        reservationId,
        ctx,
      );
      if (doorLockCode) {
        logger.info(
          'CloudbedsReservationService.resolveDoorCode: found via Door Lock API',
          { hotelId, reservationId },
        );
        return doorLockCode;
      }

      // Path 2: Custom field fallback
      if (doorLockCustomFieldShortcode) {
        const customFieldCode = await this.resolveDoorCodeFromCustomField(
          propertyID,
          reservationId,
          doorLockCustomFieldShortcode,
          ctx,
        );
        if (customFieldCode) {
          logger.info(
            'CloudbedsReservationService.resolveDoorCode: found via custom field',
            {
              hotelId,
              reservationId,
              shortcode: doorLockCustomFieldShortcode,
            },
          );
          return customFieldCode;
        }
      }

      logger.warn(
        'CloudbedsReservationService.resolveDoorCode: no door code found',
        { hotelId, reservationId },
      );
      return null;
    } catch (error) {
      logger.error(
        'CloudbedsReservationService.resolveDoorCode: unexpected error',
        {
          hotelId: hotel.id,
          reservationId,
          error: (error as Error).message,
        },
      );
      return null;
    }
  }

  private async resolveDoorCodeFromDoorLockApi(
    propertyID: string,
    reservationId: string,
    ctx: { apiToken: string; hotelId: string },
  ): Promise<string | null> {
    try {
      const keys = await this.client.getDoorLockKeys(
        { propertyId: propertyID, reservationId },
        ctx,
      );

      const accessCodeKey = keys.find(
        (key) =>
          key.keyType === 'access_code' &&
          key.status === 'completed' &&
          key.keyCode,
      );

      return accessCodeKey?.keyCode ?? null;
    } catch (error) {
      logger.warn(
        'CloudbedsReservationService.resolveDoorCodeFromDoorLockApi: failed',
        {
          propertyID,
          reservationId,
          error: (error as Error).message,
        },
      );
      return null;
    }
  }

  private async resolveDoorCodeFromCustomField(
    propertyID: string,
    reservationId: string,
    shortcode: string,
    ctx: { apiToken: string; hotelId: string },
  ): Promise<string | null> {
    try {
      const reservation = await this.client.getReservation(
        { propertyID, reservationID: reservationId },
        ctx,
      );

      const customField = reservation.customFields?.find(
        (field) => field.shortcode === shortcode && field.isActive,
      );

      return customField?.customFieldValue ?? null;
    } catch (error) {
      logger.warn(
        'CloudbedsReservationService.resolveDoorCodeFromCustomField: failed',
        {
          propertyID,
          reservationId,
          shortcode,
          error: (error as Error).message,
        },
      );
      return null;
    }
  }
}

const cloudbedsReservationService = new CloudbedsReservationService(
  cloudbedsClient,
);
export default cloudbedsReservationService;
