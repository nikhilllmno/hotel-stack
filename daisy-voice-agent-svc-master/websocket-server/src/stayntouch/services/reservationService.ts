/**
 * Stayntouch Service
 *
 * Provides high-level business logic for interacting with Stayntouch PMS API.
 * Implements a two-step availability flow:
 * 1. Get available room types with rate codes
 * 2. Get detailed pricing for each room type
 *
 * Configuration:
 * - STAYNTOUCH_BASE_URL: API base URL (e.g., https://api.stayntouch.com/connect)
 * - STAYNTOUCH_TOKEN: API authentication token
 * - business_id: Hotel-specific business ID from database (passed as parameter)
 *
 * Rate Selection Logic:
 * - Uses the first rate_id from the availability response for each room type
 * - This logic can be enhanced in future to support rate selection strategies
 *
 * Decimal Precision:
 * - All monetary values are formatted to exactly two decimal places
 */

import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Currency } from '../../dtos/enum/Currency';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { SessionType } from '../../dtos/enum/SessionType';
import { Reservation as ReservationDTO } from '../../dtos/Reservation';
import { BadRequestError } from '../../errors/BadRequestError';
import { NoDataError } from '../../errors/NoDataError';
import { Discount } from '../../models/Discount';
import { Hotel } from '../../models/Hotel';
import { HotelConfiguration as HotelConfigurationDTO } from '../../models/HotelConfiguration';
import {
  GetAvailabilityRequestParams,
  GetSingleRoomAvailabilityRequestParams,
} from '../../models/request/availability';
import { PeoplePerRoom } from '../../models/request/roomReservation';
import {
  CreateReservationParams,
  CreateReservationResponse,
  IPMSReservationService,
  ReservationNotesContext,
} from '../../pms/types/IPMSReservationService';
import { PMSQuote } from '../../pms/types/Quote';
import { PMSQuoteRequest } from '../../pms/types/QuoteRequest';
import { hotelService, HotelService } from '../../services/hotel/hotelService';
import {
  hotelConfigurationService,
  HotelConfigurationService,
} from '../../services/hotelConfiguration/hotelConfigurationService';
import { validateAndCorrectDates } from '../../services/roomReservation/helper';
import { PaymentProvider } from '../../types/enums';
import { withTimeoutWithFallback } from '../../utils/async';
import {
  groupContiguousDates,
  numberToWords,
  roundCurrency,
} from '../../utils/helper';
import { KpiStat, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import { StayntouchClient } from '../client/StayntouchClient';
import {
  Addon,
  AddReservationNotesRequest,
  AvailabilityResponse,
  CancelRuleInfo,
  DepositRuleInfo,
  GetRateResponse,
  GetReservationResponse,
  GetReservationStayDateResponse,
  RecordCCPaymentRequest,
  RestrictionsResponse,
  RoomAvailabilityWithQuoteResponse,
  RoomRatesResponse,
  RoomType,
  RoomTypeRestriction,
  SearchReservationsParams,
  StayDate,
} from '../types';
import {
  ReservationAddon,
  ReservationGuest,
  ReservationNote,
  ReservationStayDate,
  UpdateReservationGuest,
  UpdateReservationRequest,
} from '../types/ReservationRequest';
import { StayntouchRoomInfo } from '../types/RoomsInfoResponse';
import {
  ADDON_MODIFICATION_BLOCKED_NOTE,
  applyInitialDepositPolicyToStayntouchQuote,
  applyPetFeeToStayntouchQuote,
  hasBlockingAddons,
  resolveAddonQuantity,
  StayntouchPetFeeQuote,
} from '../utils/helper';
import { mapStayntouchSearchResultsToReservationDTOs } from '../utils/mapSearchResultsToReservationDTOs';
import { validateCreateReservationParams } from '../validators/reservationValidator';
dayjs.extend(utc);
dayjs.extend(timezone);

import type {
  ExternalModificationDateEntry,
  ExternalModificationInfo,
} from '../../pms/types/ExternalModification';
import { determineDateModificationScenario } from '../../pms/utils/dateModification';

export type {
  DateModificationScenario,
  ExternalModificationDateEntry,
  ExternalModificationInfo,
} from '../../pms/types/ExternalModification';

export interface RoomAvailabilityWithRates {
  room_type_id: number;
  room_type_name: string;
  rate_id: number;
  rate_code: string;
  availability: number;
  adr: number;
  deposit_rule_info: DepositRuleInfo | {};
  cancel_rule_info: CancelRuleInfo | {};
  pricing: RoomRatesResponse;
}

export interface UnifiedAvailabilityData {
  rooms: RoomAvailabilityWithRates[];
  from_date: string;
  to_date: string;
  adults: number;
  children: number;
}

export class StayntouchReservationService implements IPMSReservationService {
  private client: StayntouchClient;
  private hotelId: string;
  private hotelService: HotelService;
  private hotelConfigurationService: HotelConfigurationService;

  constructor(
    hotelId: string,
    hotelSvc: HotelService = hotelService,
    hotelConfigSvc: HotelConfigurationService = hotelConfigurationService,
  ) {
    this.hotelId = hotelId;
    this.client = new StayntouchClient(hotelId);
    this.hotelService = hotelSvc;
    this.hotelConfigurationService = hotelConfigSvc;
  }

  /**
   * Returns true if the given PMS rate code is in the hotel's configured
   * `rate_code_config.allowed` list. Rate codes not in this list are ignored
   * to reduce information overflow and agent hallucination.
   * If no config is set, nothing is allowed — the hotel must opt in explicitly.
   */
  private isAllowedRateCode(
    rateCode: string | null | undefined,
    hotelConfig: HotelConfigurationDTO | null | undefined,
  ): boolean {
    if (!rateCode) return false;
    const allowed = hotelConfig?.rate_code_config?.allowed;
    if (!allowed || allowed.length === 0) return true; // If no configuration exists, show all rate codes
    return allowed.includes(rateCode.toUpperCase());
  }

  /**
   * Returns true if the given PMS rate code is in the hotel's configured
   * `rate_code_config.full_deposit` list — meaning the full reservation amount
   * must be collected upfront as the initial deposit (e.g. advance-purchase
   * rates). Bypasses the hotel's tiered initial_deposit_policy.
   */
  private requiresFullDeposit(
    rateCode: string | null | undefined,
    hotelConfig: HotelConfigurationDTO | null | undefined,
  ): boolean {
    if (!rateCode) return false;
    const fullDeposit = hotelConfig?.rate_code_config?.full_deposit;
    if (!fullDeposit || fullDeposit.length === 0) return false;
    return fullDeposit.includes(rateCode.toUpperCase());
  }

  private async getHotelRatesWithCache(
    stayntouchHotelId: number,
  ): Promise<GetRateResponse[]> {
    try {
      const cachedRates = await this.hotelService.getCachedHotelRates(
        this.hotelId,
      );
      if (cachedRates && cachedRates.length > 0) {
        logger.info(
          'getHotelRatesWithCache: Using cached hotel rates from DB',
          {
            hotelId: this.hotelId,
            rateCount: cachedRates.length,
          },
        );
        return cachedRates;
      }
    } catch (dbError) {
      logger.error(
        'getHotelRatesWithCache: Failed to read cached rates from DB, falling back to API',
        {
          error: dbError,
          hotelId: this.hotelId,
        },
      );
    }

    logger.info(
      'getHotelRatesWithCache: No cached rates found, fetching from Stayntouch API',
      {
        hotelId: this.hotelId,
        stayntouchHotelId,
      },
    );
    return this.client.getHotelRates(stayntouchHotelId);
  }

  /**
   * Fetches the hotel's configured addons and returns the first addon whose name
   * contains "pet" (case-insensitive), or null if none is found or the request fails.
   * Used to attach the correct pet fee addon when creating a reservation and to
   * calculate estimated pet fee costs in quotes.
   */
  private async fetchPetFeeAddon(businessId: string): Promise<Addon | null> {
    try {
      const addonsResponse = await this.client.getAddons(Number(businessId), {
        per_page: 50,
      });
      const petFeeAddon =
        addonsResponse.results.find((addon) =>
          /pet[\s_-]*fee/i.test(addon.name),
        ) ?? null;

      if (petFeeAddon) {
        logger.info(
          'StayntouchReservationService.fetchPetFeeAddon: Found pet fee addon',
          {
            id: petFeeAddon.id,
            name: petFeeAddon.name,
            amount: petFeeAddon.amount,
          },
        );
      } else {
        logger.info(
          'StayntouchReservationService.fetchPetFeeAddon: No pet fee addon found for hotel',
          { businessId },
        );
      }

      return petFeeAddon;
    } catch (error) {
      logger.warn(
        'StayntouchReservationService.fetchPetFeeAddon: Failed to fetch addons, skipping pet fee',
        { error },
      );
      return null;
    }
  }

  /**
   * Shared setup for both availability-with-quote methods.
   * Resolves hotel + config, corrects dates, fetches availability, and pre-loads
   * the pet-fee addon.  Returns null when the availability response is empty so
   * callers can return early without duplicating the guard.
   */
  private async _getAvailabilityContext(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    hotelPhoneNumber: string,
    methodName: string,
  ) {
    let {
      start_date,
      end_date,
      num_adults,
      num_children = 0,
      num_pets = 0,
    } = availabilityParams;

    logger.info(`${methodName}: Checking availability`, {
      start_date,
      end_date,
      num_adults,
      num_children,
      num_pets,
    });

    const hotel =
      await this.hotelService.getHotelByAssistantPhoneNumber(hotelPhoneNumber);
    if (!hotel) {
      throw new NoDataError(
        `${methodName}: Hotel not found for phone ${hotelPhoneNumber}`,
      );
    }

    const businessId = hotel.business_id;
    if (!businessId) {
      throw new NoDataError(
        `${methodName}: Hotel ${hotel.id} does not have a business_id configured`,
      );
    }

    const hotelConfig =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        hotel.id,
      );

    const dateResult = validateAndCorrectDates(
      start_date,
      end_date,
      hotel.timezone,
      hotelConfig,
    );
    start_date = dateResult.start_date;
    end_date = dateResult.end_date;
    const { dateCorrectionDetails } = dateResult;

    const availabilityResponse = await this.client.getAvailability(
      businessId.toString(),
      {
        from_date: start_date,
        to_date: end_date,
        adults: num_adults,
        children: num_children,
      },
    );

    if (
      !availabilityResponse.results ||
      availabilityResponse.results.length === 0
    ) {
      logger.info(`${methodName}: No availability found for the given dates`);
      return null;
    }

    const petFeeAddon =
      num_pets > 0 ? await this.fetchPetFeeAddon(businessId) : null;

    return {
      hotel,
      businessId,
      hotelConfig,
      start_date,
      end_date,
      dateCorrectionDetails,
      availabilityResponse,
      petFeeAddon,
    };
  }

  /**
   * Maximum number of extra nights the system will suggest when a guest's
   * requested stay is shorter than the minimum length-of-stay restriction.
   * E.g. guest asks for 2 nights, min stay is 4 → extension = 2 → within
   * threshold. Min stay is 5 → extension = 3 → exceeds threshold, skip.
   */
  private static readonly MAX_MIN_STAY_EXTENSION_NIGHTS = 2;

  /**
   * When StayNTouch returns no availability, checks whether a minimum-stay
   * restriction (`min_length_of_stay` or `min_stay_through`) is the cause.
   * If so, and the required extension is within MAX_MIN_STAY_EXTENSION_NIGHTS,
   * returns a descriptive message suggesting the extended stay dates.
   *
   * Mirrors the ResNexus getUnavailabilityDescription pattern but uses the
   * StayNTouch /restrictions/room_type endpoint instead of a calendar API.
   */
  private async _getMinStayUnavailabilityDescriptions(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    hotelPhoneNumber: string,
    methodName: string,
    excludeRoomTypeIds?: Set<number>,
    resolvedCtx?: {
      hotel: Hotel;
      hotelConfig: HotelConfigurationDTO | null;
      start_date: string;
      end_date: string;
    },
  ): Promise<Array<{ [key: string]: string }>> {
    try {
      const { num_adults, num_children = 0 } = availabilityParams;

      let hotel: Hotel;
      let start_date: string;
      let end_date: string;

      if (resolvedCtx) {
        hotel = resolvedCtx.hotel;
        start_date = resolvedCtx.start_date;
        end_date = resolvedCtx.end_date;
      } else {
        const fetchedHotel =
          await this.hotelService.getHotelByAssistantPhoneNumber(
            hotelPhoneNumber,
          );
        if (!fetchedHotel?.business_id) return [];
        hotel = fetchedHotel;

        const hotelConfig =
          await this.hotelConfigurationService.getHotelConfigurationByHotelId(
            hotel.id,
          );

        const dateResult = validateAndCorrectDates(
          availabilityParams.start_date,
          availabilityParams.end_date,
          hotel.timezone,
          hotelConfig,
        );
        start_date = dateResult.start_date;
        end_date = dateResult.end_date;
      }

      if (!hotel.business_id) return [];

      const lengthOfStay = dayjs(end_date).diff(dayjs(start_date), 'day');
      if (lengthOfStay <= 0) return [];

      let restrictions: RestrictionsResponse;
      try {
        restrictions = await this.client.getRoomTypeRestrictions({
          hotel_id: hotel.business_id,
          from_date: start_date,
          to_date: end_date,
        });
      } catch (error) {
        logger.warn(
          `${methodName}: Failed to fetch restrictions, skipping min-stay check`,
          { error: (error as Error).message },
        );
        return [];
      }

      if (!restrictions.restrictions?.length) return [];

      const roomTypeNameMap = new Map<number, string>();
      if (hotel.room_types?.results) {
        for (const rt of hotel.room_types.results) {
          roomTypeNameMap.set(rt.id, rt.name);
        }
      }

      const minStayDescriptions: Array<{ [key: string]: string }> = [];
      const adultsText = num_adults === 1 ? '1 adult' : `${num_adults} adults`;
      const childrenText =
        num_children === 0
          ? '0 children'
          : num_children === 1
            ? '1 child'
            : `${num_children} children`;

      for (const restriction of restrictions.restrictions) {
        if (excludeRoomTypeIds?.has(restriction.room_type_id)) continue;

        const minStay = this._getEffectiveMinStay(
          restriction,
          start_date,
          end_date,
        );
        if (minStay === null || minStay <= lengthOfStay) continue;

        const extensionNights = minStay - lengthOfStay;
        if (
          extensionNights >
          StayntouchReservationService.MAX_MIN_STAY_EXTENSION_NIGHTS
        ) {
          continue;
        }

        const suggestedCheckout = dayjs(start_date)
          .add(minStay, 'day')
          .format('YYYY-MM-DD');
        const restrictedRoomTypeId = restriction.room_type_id;
        const roomName =
          roomTypeNameMap.get(restrictedRoomTypeId) ??
          `room_type_${restrictedRoomTypeId}`;

        const description =
          `For ${adultsText} and ${childrenText}, ` +
          `room ${roomName} (room_id: ${restrictedRoomTypeId}) is not available ` +
          `for check-in ${start_date} to check-out ${end_date} ` +
          `due to a minimum stay requirement of ${minStay} night${minStay > 1 ? 's' : ''}. ` +
          `Your requested stay is ${lengthOfStay} night${lengthOfStay > 1 ? 's' : ''}. ` +
          `We have availability if you extend your stay from ${start_date} to ${suggestedCheckout} (${minStay} night${minStay > 1 ? 's' : ''}).`;

        minStayDescriptions.push({
          [roomName]: description,
        });
      }

      if (minStayDescriptions.length > 0) {
        logger.info(
          `${methodName}: Min-stay restriction detected for dates ${start_date} to ${end_date}`,
          { restrictionCount: minStayDescriptions.length },
        );
      }

      return minStayDescriptions;
    } catch (error) {
      logger.warn(
        `${methodName}: Error checking min-stay restrictions, returning empty`,
        { error: (error as Error).message },
      );
      return [];
    }
  }

  /**
   * Finds the effective minimum-stay for a room type given the guest's
   * requested check-in and check-out dates.
   *
   * Two restriction types are relevant:
   *  - `min_length_of_stay` — arrival-based: only the check-in date is
   *    tested against the restriction's date ranges.
   *  - `min_stay_through` — stay-through: every night of the stay
   *    (check-in up to but not including check-out) is tested.  If *any*
   *    night falls inside a restricted range, the restriction applies.
   *
   * Returns the highest applicable value across both types, or null if
   * no restriction covers this stay.
   */
  private _getEffectiveMinStay(
    restriction: RoomTypeRestriction,
    checkInDate: string,
    checkOutDate: string,
  ): number | null {
    let maxMinStay = 0;

    for (const entry of restriction.min_length_of_stay ?? []) {
      for (const range of entry.date_ranges) {
        if (checkInDate >= range.from_date && checkInDate <= range.to_date) {
          maxMinStay = Math.max(maxMinStay, entry.value);
        }
      }
    }

    const lastNight = dayjs(checkOutDate)
      .subtract(1, 'day')
      .format('YYYY-MM-DD');
    for (const entry of restriction.min_stay_through ?? []) {
      for (const range of entry.date_ranges) {
        const overlapStart =
          checkInDate < range.from_date ? range.from_date : checkInDate;
        const overlapEnd =
          lastNight > range.to_date ? range.to_date : lastNight;
        if (overlapStart <= overlapEnd) {
          maxMinStay = Math.max(maxMinStay, entry.value);
        }
      }
    }

    return maxMinStay > 0 ? maxMinStay : null;
  }

  /**
   * Fetches room rates for a single room-type/rate-code pair and applies all
   * pricing transformations that are identical across both quote methods:
   * currency rounding, pet-fee addon, and initial-deposit policy.
   */
  private async _computeRoomTypePricing(params: {
    businessId: string | number;
    start_date: string;
    end_date: string;
    num_adults: number;
    num_children: number;
    num_pets: number;
    rateId: number;
    rateCode: string;
    roomType: { id: number; name: string };
    petFeeAddon: Addon | null;
    hotelConfig: HotelConfigurationDTO | null;
    paymentProvider: PaymentProvider;
  }): Promise<{
    finalPricing: RoomRatesResponse;
    quote: StayntouchPetFeeQuote;
  }> {
    const {
      businessId,
      start_date,
      end_date,
      num_adults,
      num_children,
      num_pets,
      rateId,
      rateCode,
      roomType,
      petFeeAddon,
      hotelConfig,
      paymentProvider,
    } = params;

    const pricing = await this.client.getRoomRates(businessId.toString(), {
      from_date: start_date,
      to_date: end_date,
      adults: num_adults,
      children: num_children,
      rate_id: rateId,
      room_type_id: roomType.id,
    });

    let finalPricing: RoomRatesResponse = {
      ...pricing,
      total_stay_cost: roundCurrency(pricing.total_stay_cost),
      total_inclusive_tax: roundCurrency(pricing.total_inclusive_tax),
      total_exclusive_tax: roundCurrency(pricing.total_exclusive_tax),
      total_exclusive_tourist_tax: roundCurrency(
        pricing.total_exclusive_tourist_tax,
      ),
      stay_dates: pricing.stay_dates.map((date) => ({
        ...date,
        rate_amount: roundCurrency(date.rate_amount),
        addon_amount: roundCurrency(date.addon_amount),
        exclusive_tax: roundCurrency(date.exclusive_tax),
        exclusive_tourist_tax: roundCurrency(date.exclusive_tourist_tax),
        inclusive_tax: roundCurrency(date.inclusive_tax),
        total_amount: roundCurrency(date.total_amount),
        adults: num_adults,
        children: num_children,
      })),
    };

    const initial_addons = finalPricing.stay_dates.reduce(
      (sum, date) => sum + date.addon_amount,
      0,
    );
    const base_rate = roundCurrency(
      finalPricing.total_stay_cost -
        finalPricing.total_exclusive_tax -
        initial_addons,
    );

    let quote: StayntouchPetFeeQuote = {
      check_in: start_date,
      check_out: end_date,
      unit_group_id: roomType.id,
      base_rate,
      taxes: finalPricing.total_exclusive_tax,
      fees: roundCurrency(initial_addons),
      total_amount: finalPricing.total_stay_cost,
      amountCharged: finalPricing.total_stay_cost,
    };

    if (num_pets > 0 && petFeeAddon) {
      const updatedQuote = applyPetFeeToStayntouchQuote(
        quote,
        finalPricing.stay_dates,
        petFeeAddon,
        num_pets,
      );
      quote = updatedQuote;
      finalPricing = {
        ...finalPricing,
        total_stay_cost: quote.total_amount,
        total_exclusive_tax: quote.taxes,
      };
    }

    const forceFullDeposit = this.requiresFullDeposit(rateCode, hotelConfig);
    const depositAmount = applyInitialDepositPolicyToStayntouchQuote(
      start_date,
      end_date,
      finalPricing,
      hotelConfig?.initial_deposit_policy,
      forceFullDeposit,
      paymentProvider,
    );
    const amountCharged = depositAmount ?? quote.amountCharged;
    quote = { ...quote, amountCharged };
    finalPricing = { ...finalPricing, amountCharged };

    return { finalPricing, quote };
  }

  /**
   * Orchestrates the two-step API flow to get complete availability data.
   * Step 1: Get available room types with rate codes.
   * Step 2: Get detailed pricing for each room type using the first rate_id.
   */
  async getRoomAvailabilityWithQuote(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
  ): Promise<RoomAvailabilityWithQuoteResponse> {
    const { num_adults, num_children = 0, num_pets = 0 } = availabilityParams;
    const methodName =
      'StayntouchReservationService.getRoomAvailabilityWithQuote';

    try {
      const ctx = await this._getAvailabilityContext(
        availabilityParams,
        hotelPhoneNumber,
        methodName,
      );
      if (!ctx) {
        return { groups: [], discount: null };
      }
      const {
        hotel,
        businessId,
        hotelConfig,
        start_date,
        end_date,
        dateCorrectionDetails,
        availabilityResponse,
        petFeeAddon,
      } = ctx;

      const roomRatePromises: Promise<RoomAvailabilityWithRates | null>[] = [];

      for (const rateResult of availabilityResponse.results) {
        const {
          rate_id: rateId,
          rate_code: rateCode,
          deposit_rule_info: depositRuleInfo,
          cancel_rule_info: cancelRuleInfo,
        } = rateResult;

        // Only surface rate codes configured as allowed for this hotel.
        // Other rate codes are ignored to reduce information overflow / agent hallucination.
        if (!this.isAllowedRateCode(rateCode, hotelConfig)) continue;

        for (const roomType of rateResult.room_types) {
          if (roomType.availability > 0) {
            roomRatePromises.push(
              (async () => {
                try {
                  const { finalPricing } = await this._computeRoomTypePricing({
                    businessId,
                    start_date,
                    end_date,
                    num_adults,
                    num_children,
                    num_pets,
                    rateId,
                    rateCode,
                    roomType,
                    petFeeAddon,
                    hotelConfig,
                    paymentProvider: hotel.payment_provider,
                  });
                  return {
                    room_type_id: roomType.id,
                    room_type_name: roomType.name,
                    rate_id: rateId,
                    rate_code: rateCode,
                    availability: roomType.availability,
                    adr: roundCurrency(roomType.adr),
                    deposit_rule_info: depositRuleInfo,
                    cancel_rule_info: cancelRuleInfo,
                    pricing: finalPricing,
                  };
                } catch (error) {
                  logger.error(
                    `Failed to fetch rates for room type ${roomType.id}`,
                    {
                      error,
                      room_type_id: roomType.id,
                      rate_id: rateId,
                    },
                  );
                  return null;
                }
              })(),
            );
          }
        }
      }

      const roomsWithRatesResults = await Promise.all(roomRatePromises);
      const roomsWithRates = roomsWithRatesResults.filter(
        (r): r is RoomAvailabilityWithRates => r !== null,
      );

      logger.info(`${methodName}: Successfully fetched complete availability`, {
        roomCount: roomsWithRates.length,
      });

      const isNoPayment =
        hotel.payment_provider === PaymentProvider.NOT_APPLICABLE;
      const groups = roomsWithRates.map((room) => ({
        room_id: room.room_type_id,
        room_name: room.room_type_name,
        rate_code: room.rate_code,
        available_units: room.availability,
        deposit_rule_info: room.deposit_rule_info,
        cancel_rule_info: room.cancel_rule_info,
        pricing: isNoPayment
          ? { ...room.pricing, amountCharged: 0 }
          : room.pricing,
      }));

      return {
        groups,
        discount: null,
        ...(dateCorrectionDetails && {
          date_correction_details: dateCorrectionDetails,
        }),
      };
    } catch (error) {
      logger.error(`${methodName}: Error fetching availability`, { error });
      throw error;
    }
  }

  async getRoomAvailabilityWithQuoteLite(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionType: SessionType,
  ): Promise<any> {
    const { num_adults, num_children = 0, num_pets = 0 } = availabilityParams;
    const methodName =
      'StayntouchReservationService.getRoomAvailabilityWithQuoteLite';

    try {
      const ctx = await this._getAvailabilityContext(
        availabilityParams,
        hotelPhoneNumber,
        methodName,
      );
      if (!ctx) {
        const minStayGroups = await this._getMinStayUnavailabilityDescriptions(
          availabilityParams,
          hotelPhoneNumber,
          methodName,
        );
        return { groups: minStayGroups };
      }
      const {
        hotel,
        businessId,
        hotelConfig,
        start_date,
        end_date,
        dateCorrectionDetails,
        availabilityResponse,
        petFeeAddon,
      } = ctx;

      // Group available room types by their id so all rate codes for the same
      // room are combined into a single response entry instead of one entry per
      // (room, rate) pair — which inflates the response and causes hallucination.
      const roomTypeMap = new Map<
        number,
        { roomType: RoomType; rates: { rateId: number; rateCode: string }[] }
      >();

      for (const rateResult of availabilityResponse.results) {
        const { rate_id: rateId, rate_code: rateCode } = rateResult;

        // Only surface rate codes configured as allowed for this hotel.
        // Other rate codes are ignored to reduce information overflow / agent hallucination.
        if (!this.isAllowedRateCode(rateCode, hotelConfig)) continue;

        for (const roomType of rateResult.room_types) {
          if (roomType.availability > 0) {
            if (!roomTypeMap.has(roomType.id)) {
              roomTypeMap.set(roomType.id, { roomType, rates: [] });
            }
            roomTypeMap.get(roomType.id)!.rates.push({ rateId, rateCode });
          }
        }
      }

      const roomQuotePromises = Array.from(roomTypeMap.values()).map(
        async ({ roomType, rates }) => {
          try {
            const ratePricingResults = await Promise.all(
              rates.map(async ({ rateId, rateCode }) => {
                try {
                  const { finalPricing, quote } =
                    await this._computeRoomTypePricing({
                      businessId,
                      start_date,
                      end_date,
                      num_adults,
                      num_children,
                      num_pets,
                      rateId,
                      rateCode,
                      roomType,
                      petFeeAddon,
                      hotelConfig,
                      paymentProvider: hotel.payment_provider,
                    });
                  return { rateCode, finalPricing, quote };
                } catch (error) {
                  logger.info(
                    `${methodName}: Rate ${rateCode} for room type ${roomType.id} unavailable`,
                    { error: (error as Error).message },
                  );
                  return null;
                }
              }),
            );

            const validRates = ratePricingResults.filter(
              (
                r,
              ): r is {
                rateCode: string;
                finalPricing: RoomRatesResponse;
                quote: StayntouchPetFeeQuote;
              } => r !== null,
            );
            if (validRates.length === 0) return null;

            const adultsText =
              num_adults === 1 ? '1 adult' : `${num_adults} adults`;
            const childrenText =
              num_children === 0
                ? '0 children'
                : num_children === 1
                  ? '1 child'
                  : `${num_children} children`;
            const lengthOfStay = dayjs(end_date).diff(dayjs(start_date), 'day');
            const isNoPayment =
              hotel.payment_provider === PaymentProvider.NOT_APPLICABLE;

            const rateDescriptions = validRates.map(
              ({ rateCode, finalPricing, quote }) => {
                const baseRateText = numberToWords(
                  quote.base_rate,
                  hotel.currency,
                );
                const taxesText = numberToWords(quote.taxes, hotel.currency);
                const feesText = numberToWords(quote.fees, hotel.currency);
                const totalAmountInWords = numberToWords(
                  quote.total_amount,
                  hotel.currency,
                );
                const effectiveDeposit = isNoPayment ? 0 : quote.amountCharged;
                const amountChargedInWords = numberToWords(
                  effectiveDeposit,
                  hotel.currency,
                );
                const averageNightlyRate =
                  finalPricing.stay_dates.length > 0
                    ? finalPricing.stay_dates.reduce(
                        (sum: number, date: StayDate) =>
                          sum + date.total_amount,
                        0,
                      ) / finalPricing.stay_dates.length
                    : 0;
                const averageNightlyRateText = numberToWords(
                  averageNightlyRate,
                  hotel.currency,
                );

                let rateDesc = `Rate code ${rateCode}: average nightly rate ${averageNightlyRateText}, base rate ${baseRateText} for ${lengthOfStay} night${lengthOfStay > 1 ? 's' : ''}, taxes ${taxesText}, fees ${feesText}, total ${totalAmountInWords}.`;
                if (!isNoPayment) {
                  rateDesc += ` Deposit ${amountChargedInWords}.`;
                } else {
                  rateDesc += ` No payment is required to secure this reservation.`;
                }
                return rateDesc;
              },
            );

            const description = `For ${adultsText} and ${childrenText}, with check-in on ${start_date} and check-out on ${end_date}, room ${roomType.name} (room_id: ${roomType.id}) has the following available rates: ${rateDescriptions.join(' ')}`;

            return { [roomType.name]: description };
          } catch (error) {
            logger.info(`${methodName}: Room type ${roomType.id} unavailable`, {
              error: (error as Error).message,
            });
            return null;
          }
        },
      );

      const roomQuoteResults = await Promise.all(roomQuotePromises);
      const groupsWithQuotes = roomQuoteResults.filter(
        (r): r is { [key: string]: string } => r !== null,
      );

      if (groupsWithQuotes.length === 0) {
        logger.info(
          `${methodName}: No availability for dates ${start_date} to ${end_date}`,
        );
      }

      const minStayGroups = await this._getMinStayUnavailabilityDescriptions(
        availabilityParams,
        hotelPhoneNumber,
        methodName,
        new Set(roomTypeMap.keys()),
        { hotel, hotelConfig, start_date, end_date },
      );

      return {
        groups: [...groupsWithQuotes, ...minStayGroups],
        discount: null,
        ...(dateCorrectionDetails && {
          date_correction_details: dateCorrectionDetails,
        }),
      };
    } catch (error) {
      logger.error(`${methodName}: Error fetching availability`, { error });
      throw error;
    }
  }

  async getRoomAvailabilityWithQuoteLiteV2(..._args: any[]): Promise<any> {
    throw new Error(
      'StayntouchReservationService: getRoomAvailabilityWithQuoteLiteV2 not supported',
    );
  }

  async getMultiRoomAvailabilityWithQuoteLiteV2(..._args: any[]): Promise<any> {
    throw new Error(
      'StayntouchReservationService: getMultiRoomAvailabilityWithQuoteLiteV2 not supported',
    );
  }

  async getAllRatesForRoomType(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    roomTypeId: number,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionType: SessionType,
  ): Promise<any> {
    const { num_adults, num_children = 0, num_pets = 0 } = availabilityParams;
    const methodName = 'StayntouchReservationService.getAllRatesForRoomType';

    try {
      const ctx = await this._getAvailabilityContext(
        availabilityParams,
        hotelPhoneNumber,
        methodName,
      );
      if (!ctx) {
        return { groups: [] };
      }
      const {
        hotel,
        businessId,
        hotelConfig,
        start_date,
        end_date,
        dateCorrectionDetails,
        availabilityResponse,
        petFeeAddon,
      } = ctx;

      const roomTypeMap = new Map<
        number,
        { roomType: RoomType; rates: { rateId: number; rateCode: string }[] }
      >();

      for (const rateResult of availabilityResponse.results) {
        const { rate_id: rateId, rate_code: rateCode } = rateResult;

        for (const roomType of rateResult.room_types) {
          if (roomType.id === roomTypeId && roomType.availability > 0) {
            if (!roomTypeMap.has(roomType.id)) {
              roomTypeMap.set(roomType.id, { roomType, rates: [] });
            }
            roomTypeMap.get(roomType.id)!.rates.push({ rateId, rateCode });
          }
        }
      }

      const roomQuotePromises = Array.from(roomTypeMap.values()).map(
        async ({ roomType, rates }) => {
          try {
            const ratePricingResults = await Promise.all(
              rates.map(async ({ rateId, rateCode }) => {
                try {
                  const { finalPricing, quote } =
                    await this._computeRoomTypePricing({
                      businessId,
                      start_date,
                      end_date,
                      num_adults,
                      num_children,
                      num_pets,
                      rateId,
                      rateCode,
                      roomType,
                      petFeeAddon,
                      hotelConfig,
                      paymentProvider: hotel.payment_provider,
                    });
                  return { rateCode, finalPricing, quote };
                } catch (error) {
                  logger.info(
                    `${methodName}: Rate ${rateCode} for room type ${roomType.id} unavailable`,
                    { error: (error as Error).message },
                  );
                  return null;
                }
              }),
            );

            const validRates = ratePricingResults.filter(
              (
                r,
              ): r is {
                rateCode: string;
                finalPricing: RoomRatesResponse;
                quote: StayntouchPetFeeQuote;
              } => r !== null,
            );
            if (validRates.length === 0) return null;

            const adultsText =
              num_adults === 1 ? '1 adult' : `${num_adults} adults`;
            const childrenText =
              num_children === 0
                ? '0 children'
                : num_children === 1
                  ? '1 child'
                  : `${num_children} children`;
            const lengthOfStay = dayjs(end_date).diff(dayjs(start_date), 'day');
            const isNoPayment =
              hotel.payment_provider === PaymentProvider.NOT_APPLICABLE;

            const rateDescriptions = validRates.map(
              ({ rateCode, finalPricing, quote }) => {
                const baseRateText = numberToWords(
                  quote.base_rate,
                  hotel.currency,
                );
                const taxesText = numberToWords(quote.taxes, hotel.currency);
                const feesText = numberToWords(quote.fees, hotel.currency);
                const totalAmountInWords = numberToWords(
                  quote.total_amount,
                  hotel.currency,
                );
                const effectiveDeposit = isNoPayment ? 0 : quote.amountCharged;
                const amountChargedInWords = numberToWords(
                  effectiveDeposit,
                  hotel.currency,
                );
                const averageNightlyRate =
                  finalPricing.stay_dates.length > 0
                    ? finalPricing.stay_dates.reduce(
                        (sum: number, date: StayDate) =>
                          sum + date.total_amount,
                        0,
                      ) / finalPricing.stay_dates.length
                    : 0;
                const averageNightlyRateText = numberToWords(
                  averageNightlyRate,
                  hotel.currency,
                );

                let rateDesc = `Rate code ${rateCode}: average nightly rate ${averageNightlyRateText}, base rate ${baseRateText} for ${lengthOfStay} night${lengthOfStay > 1 ? 's' : ''}, taxes ${taxesText}, fees ${feesText}, total ${totalAmountInWords}.`;
                if (!isNoPayment) {
                  rateDesc += ` Deposit ${amountChargedInWords}.`;
                } else {
                  rateDesc += ` No payment is required to secure this reservation.`;
                }
                return rateDesc;
              },
            );

            const description = `For ${adultsText} and ${childrenText}, with check-in on ${start_date} and check-out on ${end_date}, room ${roomType.name} (room_id: ${roomType.id}) has the following available rates: ${rateDescriptions.join(' ')}`;

            return { [roomType.name]: description };
          } catch (error) {
            logger.info(`${methodName}: Room type ${roomType.id} unavailable`, {
              error: (error as Error).message,
            });
            return null;
          }
        },
      );

      const roomQuoteResults = await Promise.all(roomQuotePromises);
      const groupsWithQuotes = roomQuoteResults.filter(
        (r): r is { [key: string]: string } => r !== null,
      );

      if (groupsWithQuotes.length === 0) {
        logger.info(
          `${methodName}: No rates available for room type ${roomTypeId} between ${start_date} and ${end_date}`,
        );
      }

      return {
        groups: groupsWithQuotes,
        discount: null,
        ...(dateCorrectionDetails && {
          date_correction_details: dateCorrectionDetails,
        }),
      };
    } catch (error) {
      logger.error(
        `${methodName}: Error fetching rates for room type ${roomTypeId}`,
        { error },
      );
      throw error;
    }
  }

  /**
   * Shared setup for the multi-room availability flow. Mirrors the ResNexus
   * approach: probe availability with a single adult per room. If a room type is
   * available for one adult, its inventory is available and the guest can choose
   * the actual occupancy per room later at booking time.
   *
   * Reuses `_getAvailabilityContext` by building a synthetic single-room request
   * with `num_adults: 1`.
   */
  private async _getMultiRoomAvailabilityContext(
    availabilityParams: GetAvailabilityRequestParams,
    hotelPhoneNumber: string,
    methodName: string,
  ) {
    const singleRoomParams: GetSingleRoomAvailabilityRequestParams = {
      start_date: availabilityParams.start_date,
      end_date: availabilityParams.end_date,
      num_adults: 1,
      num_children: 0,
      num_pets: availabilityParams.num_pets ?? 0,
      session_type: availabilityParams.session_type,
      booking_link: availabilityParams.booking_link,
    };

    return this._getAvailabilityContext(
      singleRoomParams,
      hotelPhoneNumber,
      methodName,
    );
  }

  /**
   * Groups available room types and computes per-rate pricing (one adult per room)
   * for the multi-room availability flow. Shared by the full and lite variants.
   *
   * Returns one entry per room type, each carrying its allowed rate codes with
   * pricing plus static room metadata (max occupancy, description) so the agent
   * can distribute guests across rooms.
   */
  private async _buildMultiRoomAvailabilityGroups(
    ctx: NonNullable<
      Awaited<
        ReturnType<StayntouchReservationService['_getAvailabilityContext']>
      >
    >,
    numPets: number,
    methodName: string,
  ) {
    const {
      businessId,
      hotelConfig,
      start_date,
      end_date,
      availabilityResponse,
      petFeeAddon,
      hotel,
    } = ctx;

    // Static room metadata (capacity, description) — analogous to the ResNexus
    // generateUnitGroupMetadata step.
    const roomsInfo = await this.getRoomsInfo(businessId.toString());
    const roomMetaMap = new Map<number, StayntouchRoomInfo>(
      roomsInfo.rooms.map((r) => [r.room_id, r]),
    );

    // Group available room types by id, collecting every allowed rate code so all
    // rates for the same room are combined into a single response entry.
    const roomTypeMap = new Map<
      number,
      {
        roomType: RoomType;
        availability: number;
        rates: {
          rateId: number;
          rateCode: string;
          depositRuleInfo: DepositRuleInfo | {};
          cancelRuleInfo: CancelRuleInfo | {};
        }[];
      }
    >();

    for (const rateResult of availabilityResponse.results) {
      const {
        rate_id: rateId,
        rate_code: rateCode,
        deposit_rule_info: depositRuleInfo,
        cancel_rule_info: cancelRuleInfo,
      } = rateResult;

      if (!this.isAllowedRateCode(rateCode, hotelConfig)) continue;

      for (const roomType of rateResult.room_types) {
        if (roomType.availability > 0) {
          if (!roomTypeMap.has(roomType.id)) {
            roomTypeMap.set(roomType.id, {
              roomType,
              availability: roomType.availability,
              rates: [],
            });
          }
          roomTypeMap
            .get(roomType.id)!
            .rates.push({ rateId, rateCode, depositRuleInfo, cancelRuleInfo });
        }
      }
    }

    const groupPromises = Array.from(roomTypeMap.values()).map(
      async ({ roomType, availability, rates }) => {
        const ratePricingResults = await Promise.all(
          rates.map(async (rate) => {
            try {
              const { finalPricing, quote } =
                await this._computeRoomTypePricing({
                  businessId,
                  start_date,
                  end_date,
                  num_adults: 1,
                  num_children: 0,
                  num_pets: numPets,
                  rateId: rate.rateId,
                  rateCode: rate.rateCode,
                  roomType,
                  petFeeAddon,
                  hotelConfig,
                  paymentProvider: hotel.payment_provider,
                });
              return { ...rate, finalPricing, quote };
            } catch (error) {
              logger.info(
                `${methodName}: Rate ${rate.rateCode} for room type ${roomType.id} unavailable`,
                {
                  error: (error as Error).message,
                },
              );
              return null;
            }
          }),
        );

        const validRates = ratePricingResults.filter(
          (r): r is NonNullable<typeof r> => r !== null,
        );
        if (validRates.length === 0) return null;

        return {
          roomType,
          availability,
          meta: roomMetaMap.get(roomType.id) ?? null,
          rates: validRates,
        };
      },
    );

    const groups = await Promise.all(groupPromises);
    return groups.filter((g): g is NonNullable<typeof g> => g !== null);
  }

  async getMultiRoomAvailabilityWithQuote(
    availabilityParams: GetAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionType: SessionType,
  ): Promise<any> {
    const methodName =
      'StayntouchReservationService.getMultiRoomAvailabilityWithQuote';
    const numPets = availabilityParams.num_pets ?? 0;

    try {
      const ctx = await this._getMultiRoomAvailabilityContext(
        availabilityParams,
        hotelPhoneNumber,
        methodName,
      );
      if (!ctx) {
        return { groups: [], discount: null };
      }
      const { hotel, dateCorrectionDetails } = ctx;

      const builtGroups = await this._buildMultiRoomAvailabilityGroups(
        ctx,
        numPets,
        methodName,
      );

      const isNoPayment =
        hotel.payment_provider === PaymentProvider.NOT_APPLICABLE;
      const groups = builtGroups.map((group) => ({
        room_id: group.roomType.id,
        room_name: group.roomType.name,
        ...(group.meta?.description && { description: group.meta.description }),
        max_occupancy: group.meta?.max_occupancy ?? null,
        available_units: group.availability,
        rates: group.rates.map((rate) => ({
          rate_code: rate.rateCode,
          deposit_rule_info: rate.depositRuleInfo,
          cancel_rule_info: rate.cancelRuleInfo,
          base_rate: rate.quote.base_rate,
          taxes: rate.quote.taxes,
          fees: rate.quote.fees,
          total_amount: rate.quote.total_amount,
          amount_charged: isNoPayment ? 0 : rate.quote.amountCharged,
          pricing: rate.finalPricing,
        })),
      }));

      logger.info(
        `${methodName}: Successfully fetched multi-room availability`,
        {
          roomTypeCount: groups.length,
        },
      );

      return {
        groups,
        discount: null,
        ...(dateCorrectionDetails && {
          date_correction_details: dateCorrectionDetails,
        }),
      };
    } catch (error) {
      logger.error(`${methodName}: Error fetching availability`, { error });
      throw error;
    }
  }

  async getMultiRoomAvailabilityWithQuoteLite(
    availabilityParams: GetAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionType: SessionType,
  ): Promise<any> {
    const methodName =
      'StayntouchReservationService.getMultiRoomAvailabilityWithQuoteLite';
    const numPets = availabilityParams.num_pets ?? 0;

    try {
      const ctx = await this._getMultiRoomAvailabilityContext(
        availabilityParams,
        hotelPhoneNumber,
        methodName,
      );
      if (!ctx) {
        return { groups: [], discount: null };
      }
      const { hotel, start_date, end_date, dateCorrectionDetails } = ctx;

      const builtGroups = await this._buildMultiRoomAvailabilityGroups(
        ctx,
        numPets,
        methodName,
      );

      const lengthOfStay = dayjs(end_date).diff(dayjs(start_date), 'day');

      const isNoPayment =
        hotel.payment_provider === PaymentProvider.NOT_APPLICABLE;
      const groups = builtGroups.map((group) => {
        const rateDescriptions = group.rates.map((rate) => {
          const baseRateText = numberToWords(
            rate.quote.base_rate,
            hotel.currency,
          );
          const taxesText = numberToWords(rate.quote.taxes, hotel.currency);
          const feesText = numberToWords(rate.quote.fees, hotel.currency);
          const totalAmountInWords = numberToWords(
            rate.quote.total_amount,
            hotel.currency,
          );
          const effectiveDeposit = isNoPayment ? 0 : rate.quote.amountCharged;
          const amountChargedInWords = numberToWords(
            effectiveDeposit,
            hotel.currency,
          );
          const averageNightlyRate =
            rate.finalPricing.stay_dates.length > 0
              ? rate.finalPricing.stay_dates.reduce(
                  (sum: number, date: StayDate) => sum + date.total_amount,
                  0,
                ) / rate.finalPricing.stay_dates.length
              : 0;
          const averageNightlyRateText = numberToWords(
            averageNightlyRate,
            hotel.currency,
          );

          let rateDesc = `Rate code ${rate.rateCode}: average nightly rate ${averageNightlyRateText}, base rate ${baseRateText} for ${lengthOfStay} night${lengthOfStay > 1 ? 's' : ''}, taxes ${taxesText}, fees ${feesText}, total ${totalAmountInWords}.`;
          if (!isNoPayment) {
            rateDesc += ` Deposit ${amountChargedInWords}.`;
          } else {
            rateDesc += ` No payment is required to secure this reservation.`;
          }
          return rateDesc;
        });

        const maxOccupancy = group.meta?.max_occupancy;
        const maxOccupancyText = maxOccupancy
          ? ` The maximum occupancy of the room is ${maxOccupancy === 1 ? '1 person' : `${maxOccupancy} people`}.`
          : '';

        const availableUnitsText =
          group.availability === 1
            ? '1 unit is available'
            : `${group.availability} units are available`;
        const bookingLimitText =
          group.availability === 1
            ? 'You cannot book beyond the 1 available unit.'
            : `You cannot book beyond the ${group.availability} available units.`;

        let description = `For room ${group.roomType.name} (room_id: ${group.roomType.id}), ${availableUnitsText}, with check-in on ${start_date} and check-out on ${end_date}, the following rates are available (prices shown are for one adult): ${rateDescriptions.join(' ')}${maxOccupancyText}. ${bookingLimitText}`;
        if (numPets > 0) {
          description += ` All amounts have the pet fees pre-applied.`;
        }

        return { [group.roomType.name]: description };
      });

      logger.info(
        `${methodName}: Successfully fetched multi-room availability (lite)`,
        {
          roomTypeCount: groups.length,
        },
      );

      return {
        groups,
        discount: null,
        ...(dateCorrectionDetails && {
          date_correction_details: dateCorrectionDetails,
        }),
      };
    } catch (error) {
      logger.error(`${methodName}: Error fetching availability`, { error });
      throw error;
    }
  }

  async getWebRoomAvailabilityV2(...args: any[]): Promise<any> {
    throw new Error(
      'getWebRoomAvailabilityV2 not yet implemented for Stayntouch',
    );
  }

  async createReservation(
    params: CreateReservationParams,
  ): Promise<CreateReservationResponse> {
    try {
      // Validate params with Joi
      validateCreateReservationParams(params);
      const { reservation, customer, quote } = params;
      const address = customer.address;

      logger.info(
        'StayntouchReservationService.createReservation: Creating reservation',
        {
          reservation_id: reservation.id,
          customer_id: customer.id,
          quote_id: quote.id,
        },
      );

      // Get hotel information
      const hotel = await this.hotelService.getHotelById(reservation.hotel_id);
      if (!hotel) {
        throw new NoDataError(
          `StayntouchReservationService.createReservation: Hotel not found with ID ${reservation.hotel_id}`,
        );
      }

      const businessId = hotel.business_id;
      if (!businessId) {
        throw new NoDataError(
          `StayntouchReservationService.createReservation: Hotel ${hotel.id} does not have a business_id configured`,
        );
      }

      // Extract rate_id and room_type_id from quote's raw_response
      const rawResponse = quote.quote_object?.raw_response;
      if (!rawResponse || !rawResponse.rate_id || !rawResponse.room_type_id) {
        throw new Error(
          'Quote does not contain required Stayntouch rate_id and room_type_id',
        );
      }

      const rateId = rawResponse.rate_id.toString();
      const roomTypeId = rawResponse.room_type_id.toString();

      // Always verify room availability before creating a reservation to avoid
      // creating bookings for rooms that have been taken since the quote was issued.
      await this.checkRoomAvailabilityBeforeReservationCreation({
        businessId: businessId.toString(),
        roomTypeId: Number(roomTypeId),
        rateId: Number(rateId),
        checkIn: dayjs(reservation.check_in).format('YYYY-MM-DD'),
        checkOut: dayjs(reservation.check_out).format('YYYY-MM-DD'),
        numAdults: reservation.num_adults,
        numChildren: reservation.num_children ?? 0,
      });

      const numPets = reservation.num_pets ?? 0;

      // Fetch the pet fee addon so it can be attached to the reservation payload
      const petFeeAddon =
        numPets > 0 ? await this.fetchPetFeeAddon(businessId) : null;

      // Generate stay_dates array for each night
      const checkIn = dayjs(reservation.check_in);
      const checkOut = dayjs(reservation.check_out);
      const stayDates: ReservationStayDate[] = [];

      let currentDate = checkIn;
      while (currentDate.isBefore(checkOut)) {
        stayDates.push({
          date: currentDate.format('YYYY-MM-DD'),
          rate_id: rateId,
          room_type_id: roomTypeId,
          adults: reservation.num_adults,
          children: reservation.num_children ?? 0,
        });
        currentDate = currentDate.add(1, 'day');
      }

      // Validate required customer fields
      if (!customer.first_name || !customer.last_name || !customer.email) {
        throw new Error(
          'StayntouchReservationService.createReservation: Customer must have first_name, last_name, and email',
        );
      }

      // Prepare guest data - always pass full guest details
      const guestData: ReservationGuest[] = [
        {
          first_name: customer.first_name,
          last_name: customer.last_name,
          email: customer.email,
          ...(address &&
          (address.city ||
            address.state_or_province ||
            address.postal_code ||
            address.country)
            ? {
                address: {
                  ...(address.city && { city: address.city }),
                  ...(address.state_or_province && {
                    state: address.state_or_province,
                  }),
                  ...(address.postal_code && {
                    postal_code: address.postal_code,
                  }),
                  ...(address.country && { country_code: address.country }),
                },
              }
            : {}),
          mobile_phone: customer.phone_number,
          is_primary: true,
        },
      ];

      // Prepare notes array
      // Notes are already generated upstream when pets are present
      const notes = reservation.notes_from_partner
        ? [{ description: reservation.notes_from_partner }]
        : undefined;

      // If a pet fee addon is configured and pets are present, attach it so StayNTouch handles the fee natively
      const addons =
        numPets > 0 && petFeeAddon
          ? [
              {
                id: petFeeAddon.id,
                quantity: resolveAddonQuantity(
                  petFeeAddon.amount_type,
                  numPets,
                ),
              },
            ]
          : undefined;

      const createReservationPayload = {
        hotel_id: Number(businessId),
        arrival_date: dayjs(reservation.check_in).format('YYYY-MM-DD'),
        departure_date: dayjs(reservation.check_out).format('YYYY-MM-DD'),
        stay_dates: stayDates,
        guests: guestData,
        ...(notes && { notes }),
        ...(addons && { addons }),
      };

      // Create reservation in Stayntouch (guest will be created automatically if not exists)
      const reservationResponse = await this.client.createReservation(
        createReservationPayload,
      );

      // Fetch the reservation to get the confirmation_number (external_public_id)
      const reservationDetails = await this.client.getReservation(
        reservationResponse.id.toString(),
      );

      // Stayntouch doesn't persist mobile_phone via the reservation create flow,
      // so we explicitly update the primary guest with the mobile phone afterwards.
      await this.updatePrimaryGuestMobilePhone(
        reservationResponse.id,
        reservationDetails.guests,
        customer.phone_number,
      );

      logger.info(
        'StayntouchReservationService.createReservation: Reservation created successfully',
        {
          stayntouch_reservation_id: reservationResponse.id,
          confirmation_number: reservationDetails.confirmation_number,
          reservation_id: reservation.id,
        },
      );

      return {
        reservation_id: reservationResponse.id.toString(),
        external_public_id: reservationDetails.confirmation_number,
      };
    } catch (error) {
      logger.error(
        'StayntouchReservationService.createReservation: Error creating reservation',
        { error },
      );
      throw error;
    }
  }

  /**
   * Stayntouch does not persist `mobile_phone` when supplied through the
   * reservation create payload. After the reservation is created we explicitly
   * update the primary guest via `PUT /guests/{id}` so the phone number is
   * captured against the guest profile. Failures are logged but swallowed so
   * they never block a successful reservation.
   */
  private async updatePrimaryGuestMobilePhone(
    stayntouchReservationId: number,
    guests: GetReservationResponse['guests'],
    phoneNumber: string | null | undefined,
  ): Promise<void> {
    try {
      const primaryGuest = guests?.find((g) => g.is_primary) ?? guests?.[0];
      if (primaryGuest?.id && phoneNumber) {
        await this.client.updateGuest(primaryGuest.id, {
          mobile_phone: phoneNumber,
        });
      } else {
        logger.warn(
          'StayntouchReservationService.updatePrimaryGuestMobilePhone: Skipping guest mobile_phone update',
          {
            stayntouch_reservation_id: stayntouchReservationId,
            has_primary_guest: Boolean(primaryGuest?.id),
            has_phone_number: Boolean(phoneNumber),
          },
        );
      }
    } catch (updateError) {
      logger.error(
        'StayntouchReservationService.updatePrimaryGuestMobilePhone: Failed to update guest mobile_phone',
        {
          error: updateError,
          stayntouch_reservation_id: stayntouchReservationId,
        },
      );
    }
  }

  async cancelReservation(params: {
    business_id: string;
    external_id: string;
    internal_id: string;
    reason?: string;
    send_cancellation_email?: boolean | null | undefined;
    refund_deposit?: boolean;
    charge_penalty?: boolean;
  }): Promise<{ status: boolean; errors?: string[] }> {
    try {
      logger.info(
        'StayntouchReservationService.cancelReservation: Cancelling reservation',
        {
          external_id: params.external_id,
          business_id: params.business_id,
        },
      );

      const sendCancellationEmail = params.send_cancellation_email ?? true;
      const cancelResponse = await this.client.cancelReservation(
        params.external_id,
        {
          reason: params.reason,
          send_cancellation_email: sendCancellationEmail,
          refund_deposit: params.refund_deposit ?? false,
          charge_penalty: params.charge_penalty ?? false,
        },
      );

      if (!cancelResponse.status) {
        logger.error(
          'StayntouchReservationService.cancelReservation: Cancellation failed',
          {
            external_id: params.external_id,
            errors: cancelResponse.errors,
          },
        );
        throw new Error(
          `Failed to cancel reservation: ${cancelResponse.errors?.join(', ') || 'Unknown error'}`,
        );
      }

      logger.info(
        'StayntouchReservationService.cancelReservation: Reservation cancelled successfully',
        {
          external_id: params.external_id,
        },
      );

      return cancelResponse;
    } catch (error) {
      logger.error(
        'StayntouchReservationService.cancelReservation: Error cancelling reservation',
        {
          error,
          external_id: params.external_id,
        },
      );
      throw error;
    }
  }

  /**
   * Modifies a Stayntouch reservation via PUT /reservations/{id}.
   *
   * Recalculates the quote for the new dates, then (when the reservation is
   * ACTIVE) pushes the date change to the Stayntouch API.  Returns the updated
   * PMSQuote so the caller can persist it to the database.
   */
  async modifyReservation(
    reservationDetails: ReservationDTO,
    newCheckIn: string,
    newCheckOut: string,
    discount: Discount | null,
    newRoomTypeId?: number,
    newRateId?: number,
    arrivalTime?: string,
    departureTime?: string,
    guests?: UpdateReservationGuest[],
    addons?: ReservationAddon[],
    notes?: ReservationNote[],
  ): Promise<PMSQuote> {
    try {
      const stayntouchReservationId = reservationDetails.external_id;
      if (!stayntouchReservationId) {
        throw new BadRequestError(
          'StayntouchReservationService.modifyReservation: external_id is required',
        );
      }
      if (!newCheckIn || !newCheckOut) {
        throw new BadRequestError(
          'StayntouchReservationService.modifyReservation: newCheckIn and newCheckOut are required',
        );
      }

      // Recalculate the quote for the new date window (and room if changed).
      const quote = await this.getQuoteForModification(
        reservationDetails,
        newCheckIn,
        newCheckOut,
        discount,
        newRoomTypeId,
        newRateId,
      );

      if (reservationDetails.status === ReservationStatus.ACTIVE) {
        // Fetch the current reservation from Stayntouch to extract the persisted
        // rate_id / room_type_id that must be included on every stay_date entry.
        const currentReservation = await this.client.getReservation(
          stayntouchReservationId,
        );
        const existingStayDate = currentReservation.stay_dates?.[0];
        if (!existingStayDate) {
          throw new BadRequestError(
            'StayntouchReservationService.modifyReservation: Current reservation has no stay_dates; cannot determine rate_id and room_type_id',
          );
        }

        const roomChanged =
          !!newRoomTypeId && newRoomTypeId !== existingStayDate.room_type_id;
        const rateId = (
          roomChanged && newRateId ? newRateId : existingStayDate.rate_id
        ).toString();
        const roomTypeId = roomChanged
          ? newRoomTypeId.toString()
          : existingStayDate.room_type_id.toString();
        const adults = existingStayDate.adults;
        const children = existingStayDate.children ?? 0;

        const existingDateSet = new Set(
          (currentReservation.stay_dates ?? []).map((sd) => sd.date),
        );

        const checkIn = dayjs(newCheckIn);
        const checkOut = dayjs(newCheckOut);
        const stayDates: ReservationStayDate[] = [];
        let currentDate = checkIn;
        while (currentDate.isBefore(checkOut)) {
          const dateStr = currentDate.format('YYYY-MM-DD');
          // When room changes, all dates must be sent to update the room_type_id in Stayntouch.
          // Otherwise only send new dates; Stayntouch removes the ones not included.
          if (roomChanged || !existingDateSet.has(dateStr)) {
            stayDates.push({
              date: dateStr,
              rate_id: rateId,
              room_type_id: roomTypeId,
              adults,
              children,
            });
          }
          currentDate = currentDate.add(1, 'day');
        }

        const updatePayload: UpdateReservationRequest = {
          arrival_date: checkIn.format('YYYY-MM-DD'),
          departure_date: checkOut.format('YYYY-MM-DD'),
          stay_dates: stayDates,
          ...(arrivalTime && { arrival_time: arrivalTime }),
          ...(departureTime && { departure_time: departureTime }),
          ...(guests?.length && { guests: guests }),
          ...(addons?.length && { addons: addons }),
          notes: [...(notes ?? []), { description: 'Updated via Dextr' }],
        };

        const response = await this.client.updateReservation(
          stayntouchReservationId,
          updatePayload,
        );

        logger.info(
          'StayntouchReservationService.modifyReservation: Reservation modified successfully',
          {
            reservation_id: response.id,
            warnings: response.warnings,
          },
        );
      }

      return quote;
    } catch (error) {
      logger.error(
        'StayntouchReservationService.modifyReservation: Error modifying reservation',
        { error },
      );
      throw error;
    }
  }

  async recordCCPayment(params: {
    external_id: string;
    payment_data: RecordCCPaymentRequest;
  }) {
    try {
      logger.info(
        'StayntouchReservationService.recordCCPayment: Recording CC payment',
        {
          external_id: params.external_id,
          amount: params.payment_data.amount,
          transaction_id: params.payment_data.transaction_id,
        },
      );

      const recordResponse = await this.client.recordCCPayment(
        params.external_id,
        params.payment_data,
      );

      logger.info(
        'StayntouchReservationService.recordCCPayment: Successfully recorded CC payment',
        {
          external_id: params.external_id,
          status: recordResponse.status,
        },
      );

      return recordResponse;
    } catch (error) {
      logger.error(
        'StayntouchReservationService.recordCCPayment: Error recording CC payment',
        {
          error,
          external_id: params.external_id,
        },
      );
      throw error;
    }
  }

  async addReservationNotes(
    external_id: string,
    noteData: AddReservationNotesRequest,
  ): Promise<void> {
    try {
      logger.info(
        'StayntouchReservationService.addReservationNotes: Adding notes to reservation',
        {
          external_id,
          note_count: noteData.notes.length,
        },
      );

      await this.client.addReservationNotes(external_id, noteData);

      logger.info(
        'StayntouchReservationService.addReservationNotes: Successfully added notes',
        {
          external_id,
        },
      );
    } catch (error) {
      logger.error(
        'StayntouchReservationService.addReservationNotes: Error adding notes',
        {
          error,
          external_id,
        },
      );
      throw error;
    }
  }

  async getRoomsInfo(
    businessId: string,
  ): Promise<{ rooms: StayntouchRoomInfo[]; note: string }> {
    try {
      logger.info(
        'StayntouchReservationService.getRoomsInfo: Fetching room types from database',
        { businessId },
      );

      const hotel = await this.hotelService.getHotelByBusinessId(businessId);

      if (!hotel) {
        throw new NoDataError(
          `Hotel not found with business_id: ${businessId}`,
        );
      }

      const note =
        'This is static room type information only. To check if rooms are available for specific dates, you must call the availability tool.';

      if (!hotel.room_types) {
        logger.warn(
          'StayntouchReservationService.getRoomsInfo: No room types cached in database, fetching from API',
          {
            businessId,
            hotel_id: hotel.id,
          },
        );

        // Fallback to API call if not cached
        const roomTypesResponse = await this.client.getRoomTypes(
          businessId,
          50,
        );

        if (
          !roomTypesResponse.results ||
          roomTypesResponse.results.length === 0
        ) {
          logger.warn(
            'StayntouchReservationService.getRoomsInfo: No room types found',
            { businessId },
          );
          return { rooms: [], note };
        }

        const rooms: StayntouchRoomInfo[] = roomTypesResponse.results.map(
          (roomType) => ({
            room_id: roomType.id,
            room_name: roomType.name,
            room_code: roomType.code,
            description: roomType.description,
            max_occupancy: roomType.max_occupancy,
            image_url: roomType.image_url,
            image_urls: roomType.image_urls,
            suite: roomType.suite,
            pseudo: roomType.pseudo,
            room_type_ids: roomType.room_type_ids,
          }),
        );

        return { rooms, note };
      }

      const rooms: StayntouchRoomInfo[] = hotel.room_types.results.map(
        (roomType) => ({
          room_id: roomType.id,
          room_name: roomType.name,
          room_code: roomType.code,
          description: roomType.description,
          max_occupancy: roomType.max_occupancy,
          image_url: roomType.image_url,
          image_urls: roomType.image_urls,
          suite: roomType.suite,
          pseudo: roomType.pseudo,
          room_type_ids: roomType.room_type_ids,
        }),
      );

      logger.info(
        'StayntouchReservationService.getRoomsInfo: Successfully fetched room types from database',
        {
          businessId,
          hotel_id: hotel.id,
          count: rooms.length,
        },
      );

      return { rooms, note };
    } catch (error) {
      logger.error(
        'StayntouchReservationService.getRoomsInfo: Error fetching room types',
        { error, businessId },
      );
      throw error;
    }
  }

  /**
   * Get a map of room IDs to room type names
   * @param businessId - Business/property ID
   * @param roomIds - Optional list of room IDs to filter the map by
   * @param roomsInfo - Optional cached rooms info to avoid an extra lookup
   * @returns Map of room_id to room_name
   */
  async getRoomTypeMap(
    businessId: number | string,
    roomIds?: number[],
    roomsInfo?: { rooms: StayntouchRoomInfo[]; note: string },
  ): Promise<Map<string, string>> {
    const businessIdStr = String(businessId);

    try {
      const roomsInfoResponse =
        roomsInfo ?? (await this.getRoomsInfo(businessIdStr));
      const rooms = roomsInfoResponse.rooms;

      const roomNameMap = new Map<string, string>();
      for (const room of rooms) {
        roomNameMap.set(String(room.room_id), room.room_name);
      }

      if (!roomIds || roomIds.length === 0) {
        return roomNameMap;
      }

      const result = new Map<string, string>();
      for (const roomId of roomIds) {
        const roomName = roomNameMap.get(String(roomId));
        if (roomName) {
          result.set(String(roomId), roomName);
        } else {
          const errMsg = `StayntouchReservationService.getRoomTypeMap: No room found for room id: ${roomId}`;
          logger.error(errMsg, { businessId });
          throw new NoDataError(errMsg);
        }
      }

      return result;
    } catch (error) {
      logger.error(
        'StayntouchReservationService.getRoomTypeMap: Error building room type map',
        {
          error,
          businessId,
          roomIds,
        },
      );
      throw error;
    }
  }

  async getQuote(params: PMSQuoteRequest): Promise<PMSQuote> {
    try {
      const {
        business_id,
        room_id,
        check_in,
        check_out,
        num_adults,
        num_children = 0,
        hotel_id,
        caller_phone_num,
        num_pets = 0,
        rate_code: requestedRateCode,
      } = params;

      // room_id may arrive as a string after a DB round-trip (column is stored as string).
      const roomTypeId = Number(room_id);

      if (Number.isNaN(roomTypeId) || roomTypeId <= 0) {
        throw new BadRequestError('Invalid room_id: ' + room_id);
      }

      logger.info('StayntouchReservationService.getQuote: Fetching quote', {
        business_id,
        room_id: roomTypeId,
        check_in,
        check_out,
        num_adults,
        num_children,
        num_pets,
        requested_rate_code: requestedRateCode ?? null,
      });

      // Fetch hotel configuration up-front so we can filter rate codes per hotel settings.
      const hotelDetails = hotel_id
        ? await this.hotelService.getHotelWithConfigurationsAndChannels(
            hotel_id,
          )
        : null;

      const hotelConfig = hotelDetails?.configuration;
      const hotel = hotelDetails?.hotel;
      if (!hotel) {
        throw new NoDataError(
          `getQuote: Hotel not found for hotel_id: ${hotel_id}`,
        );
      }
      // Step 1: Get availability to find rate_id
      const availabilityResponse = await this.client.getAvailability(
        business_id.toString(),
        {
          from_date: check_in,
          to_date: check_out,
          adults: num_adults,
          children: num_children,
        },
      );

      // Find the rate result and room type in the availability response
      let rateId: number | null = null;
      let rateCode: string | null = null;
      let depositRuleInfo: any = {};
      let cancelRuleInfo: any = {};

      for (const result of availabilityResponse.results) {
        // Removed this check to allow all rate codes to be returned.
        // // Only surface rate codes configured as allowed for this hotel.
        // if (!this.isAllowedRateCode(result.rate_code, hotelConfig)) {
        //   continue;
        // }

        // When a specific rate code was requested, skip results that do not match it.
        if (
          requestedRateCode &&
          result.rate_code?.toUpperCase() !== requestedRateCode.toUpperCase()
        ) {
          continue;
        }

        const roomType = result.room_types.find((rt) => rt.id === roomTypeId);
        if (roomType) {
          rateId = result.rate_id;
          rateCode = result.rate_code;
          depositRuleInfo = result.deposit_rule_info;
          cancelRuleInfo = result.cancel_rule_info;
          break;
        }
      }

      if (!rateId || !rateCode) {
        const rateDesc = requestedRateCode
          ? ` with rate code "${requestedRateCode}"`
          : '';
        throw new NoDataError(
          `Room type ${roomTypeId} not available or has no rates${rateDesc}`,
        );
      }

      logger.info('StayntouchReservationService.getQuote: Found rate', {
        room_id: roomTypeId,
        rate_id: rateId,
        rate_code: rateCode,
      });

      // Step 2: Get detailed pricing for this room type and rate
      const pricingResponse = await this.client.getRoomRates(
        business_id.toString(),
        {
          rate_id: rateId,
          room_type_id: roomTypeId,
          from_date: check_in,
          to_date: check_out,
          adults: num_adults,
          children: num_children,
        },
      );

      // Format pricing with exactly two decimal places
      let formattedPricing = this.formatMonetaryValues(pricingResponse);

      // Capture the pre-modification pricing as the historical API snapshot
      const rawPricingSnapshot = formattedPricing;

      // Fetch pet fee addon so quote totals reflect the StayNTouch-configured pet fee amount
      const petFeeAddon =
        num_pets > 0
          ? await this.fetchPetFeeAddon(business_id.toString())
          : null;

      // Calculate total fees from addon amounts (pre-tax)
      const initial_addons = formattedPricing.stay_dates.reduce(
        (sum, date) => sum + date.addon_amount,
        0,
      );

      // Calculate initial base rate (total cost minus taxes and addons)
      const base_rate = roundCurrency(
        formattedPricing.total_stay_cost -
          formattedPricing.total_exclusive_tax -
          initial_addons,
      );

      // Build the raw_response object - this is the historical record of the API response
      const raw_response = {
        availability: availabilityResponse,
        pricing: rawPricingSnapshot,
        room_type_id: roomTypeId,
        rate_id: rateId,
        rate_code: rateCode,
        check_in,
        check_out,
        num_adults,
        num_children,
        num_pets,
      };

      // Build the PMSQuote object
      let quote: PMSQuote = {
        base_rate: base_rate, // total cost minus taxes and addons
        taxes: formattedPricing.total_exclusive_tax, // (sum of stay_dates exclusive_tax. Taxes from our end like pet fee tax will be added downstream)
        fees: roundCurrency(initial_addons), // addons are received from Stayntouch. Fees from our end (like pet fees) will be added downstream
        total_amount: formattedPricing.total_stay_cost, // sum of stay_dates rate_amount, exclusive_tax, addon_amount. Will be updated with any addition from our end downstream
        amountCharged: formattedPricing.total_stay_cost, // Default to full amount, will be updated by deposit policy if configured
        currency:
          Currency[hotel.currency as keyof typeof Currency].toUpperCase(),

        raw_response, // Store the complete API response
        // Spread additional fields for easy access
        room_type_id: roomTypeId,
        rate_id: rateId,
        rate_code: rateCode,
        pricing: formattedPricing,
        deposit_rule_info: depositRuleInfo,
        cancel_rule_info: cancelRuleInfo,
      };

      // Create a quote object for applying pet fees
      let quoteForModifications: StayntouchPetFeeQuote = {
        check_in,
        check_out,
        unit_group_id: roomTypeId,
        base_rate: quote.base_rate,
        taxes: quote.taxes,
        fees: quote.fees,
        total_amount: quote.total_amount,
        amountCharged: quote.amountCharged,
      };

      // Apply pet fees using the addon if pets are present and the addon is configured
      if (num_pets && num_pets > 0 && petFeeAddon) {
        const updatedQuote = applyPetFeeToStayntouchQuote(
          quoteForModifications,
          formattedPricing.stay_dates,
          petFeeAddon,
          num_pets,
        );

        quoteForModifications = updatedQuote;

        formattedPricing = {
          ...formattedPricing,
          total_stay_cost: quoteForModifications.total_amount,
          total_exclusive_tax: quoteForModifications.taxes,
        };

        // Sync updated values back onto the quote
        quote.taxes = quoteForModifications.taxes;
        quote.fees = quoteForModifications.fees;
        quote.total_amount = quoteForModifications.total_amount;
        quote.amountCharged = quoteForModifications.amountCharged;
        quote.pricing = formattedPricing;
      }

      const forceFullDeposit = this.requiresFullDeposit(rateCode, hotelConfig);
      const depositAmount = applyInitialDepositPolicyToStayntouchQuote(
        check_in,
        check_out,
        formattedPricing,
        hotelConfig?.initial_deposit_policy,
        forceFullDeposit,
        hotel.payment_provider,
      );
      if (depositAmount != null) {
        quote.amountCharged = depositAmount;
      }

      logger.info(
        'StayntouchReservationService.getQuote: Quote created successfully',
        {
          base_rate: quote.base_rate,
          taxes: quote.taxes,
          fees: quote.fees,
          total_amount: quote.total_amount,
          amountCharged: quote.amountCharged,
        },
      );

      return quote;
    } catch (error) {
      logger.error(
        'StayntouchReservationService.getQuote: Error fetching quote',
        { error },
      );
      throw error;
    }
  }

  async getQuoteForModification(
    existingReservationFromDB: ReservationDTO,
    newCheckIn: string,
    newCheckOut: string,
    discount: Discount | null,
    newRoomTypeId?: number,
    newRateId?: number,
  ): Promise<PMSQuote> {
    try {
      const externalId = existingReservationFromDB.external_id;
      if (!externalId) {
        throw new NoDataError(
          'StayntouchReservationService.getQuoteForModification: No external_id found on reservation',
        );
      }
      const existingReservationFromPMS =
        await this.client.getReservation(externalId);
      if (!existingReservationFromPMS) {
        throw new NoDataError(
          'StayntouchReservationService.getQuoteForModification: No reservation found for the given id',
        );
      }
      const existingStayDates: GetReservationStayDateResponse[] =
        existingReservationFromPMS.stay_dates ?? [];
      const existingCheckIn =
        existingReservationFromPMS.arrival_date ?? existingStayDates[0]?.date;
      const existingCheckOut = existingReservationFromPMS.departure_date;

      const quoteObject = existingReservationFromDB.quote?.quote_object;
      if (!quoteObject) {
        throw new Error(
          'StayntouchReservationService.getQuoteForModification: No quote_object found on reservation',
        );
      }

      const roomChanged =
        !!newRoomTypeId && newRoomTypeId !== existingStayDates[0]?.room_type_id;

      // No date change and no room change -- return existing quote as-is
      if (
        newCheckIn === existingCheckIn &&
        newCheckOut === existingCheckOut &&
        !roomChanged
      ) {
        return quoteObject;
      }

      const rateId: number = newRateId ?? existingStayDates[0]?.rate_id ?? 0;
      const roomTypeId: number = roomChanged
        ? newRoomTypeId
        : (existingStayDates[0]?.room_type_id ?? 0);
      const rateCode: string = existingReservationFromDB.rate_code ?? '';
      const numAdults: number =
        existingStayDates[0]?.adults ?? existingReservationFromDB.num_adults;
      const numChildren: number =
        existingStayDates[0]?.children ??
        existingReservationFromDB.num_children ??
        0;
      const numPets: number = existingReservationFromDB.num_pets ?? 0;
      const businessId = existingReservationFromDB.business_id;

      logger.info(
        'StayntouchReservationService.getQuoteForModification: Computing modification quote',
        {
          reservation_id: existingReservationFromDB.id,
          existing_check_in: existingCheckIn,
          existing_check_out: existingCheckOut,
          new_check_in: newCheckIn,
          new_check_out: newCheckOut,
          rate_id: rateId,
          room_type_id: roomTypeId,
        },
      );

      // Build a map of existing stay_date pricing keyed by date string
      const quoteStayDates: StayDate[] = quoteObject.pricing?.stay_dates ?? [];
      const existingPricingMap = new Map<string, StayDate>();
      for (const sd of quoteStayDates) {
        existingPricingMap.set(sd.date, sd);
      }

      // Partition new date range into overlapping (reuse) and new (fetch)
      const retainedDates: StayDate[] = [];
      const newDateStrings: string[] = [];

      let cursor = dayjs(newCheckIn);
      const checkOutDay = dayjs(newCheckOut);
      while (cursor.isBefore(checkOutDay)) {
        const dateStr = cursor.format('YYYY-MM-DD');
        // When room changes, existing pricing is for the old room and cannot be reused
        const existing = !roomChanged
          ? existingPricingMap.get(dateStr)
          : undefined;
        if (existing) {
          retainedDates.push(existing);
        } else {
          newDateStrings.push(dateStr);
        }
        cursor = cursor.add(1, 'day');
      }

      // Fetch pricing for new dates grouped into contiguous ranges
      const freshDates: StayDate[] = [];
      if (newDateStrings.length > 0) {
        const contiguousRanges = groupContiguousDates(newDateStrings);

        const rangeResults = await Promise.all(
          contiguousRanges.map(async (range) => {
            const fromDate = range[0];
            const toDate = dayjs(range[range.length - 1])
              .add(1, 'day')
              .format('YYYY-MM-DD');

            const pricing = await this.client.getRoomRates(
              businessId.toString(),
              {
                rate_id: rateId,
                room_type_id: roomTypeId,
                from_date: fromDate,
                to_date: toDate,
                adults: numAdults,
                children: numChildren,
              },
            );

            return this.formatMonetaryValues(pricing);
          }),
        );

        for (const result of rangeResults) {
          freshDates.push(...result.stay_dates);
        }
      }

      // Merge and sort all stay_dates by date
      const mergedStayDates = [...retainedDates, ...freshDates].sort((a, b) =>
        a.date.localeCompare(b.date),
      );

      // Recompute pricing totals from merged stay_dates
      const totalExclusiveTax = roundCurrency(
        mergedStayDates.reduce((s, d) => s + d.exclusive_tax, 0),
      );
      const totalInclusiveTax = roundCurrency(
        mergedStayDates.reduce((s, d) => s + d.inclusive_tax, 0),
      );
      const totalExclusiveTouristTax = roundCurrency(
        mergedStayDates.reduce((s, d) => s + d.exclusive_tourist_tax, 0),
      );
      const totalStayCost = roundCurrency(
        mergedStayDates.reduce((s, d) => s + d.total_amount, 0),
      );
      const totalAddons = roundCurrency(
        mergedStayDates.reduce((s, d) => s + d.addon_amount, 0),
      );
      const baseRate = roundCurrency(
        totalStayCost - totalExclusiveTax - totalAddons,
      );

      const mergedPricing: RoomRatesResponse = {
        total_stay_cost: totalStayCost,
        total_inclusive_tax: totalInclusiveTax,
        total_exclusive_tax: totalExclusiveTax,
        total_exclusive_tourist_tax: totalExclusiveTouristTax,
        stay_dates: mergedStayDates,
      };

      // Build PMSQuote (same shape as getQuote)
      let quote: PMSQuote = {
        base_rate: baseRate,
        taxes: totalExclusiveTax,
        fees: roundCurrency(totalAddons),
        total_amount: totalStayCost,
        amountCharged: totalStayCost,
        currency: quoteObject.currency,
        room_type_id: roomTypeId,
        rate_id: rateId,
        rate_code: rateCode,
        pricing: mergedPricing,
      };

      // Apply pet fees
      let quoteForPetFee: StayntouchPetFeeQuote = {
        check_in: newCheckIn,
        check_out: newCheckOut,
        unit_group_id: roomTypeId,
        base_rate: quote.base_rate,
        taxes: quote.taxes,
        fees: quote.fees,
        total_amount: quote.total_amount,
        amountCharged: quote.amountCharged,
      };

      if (numPets > 0) {
        const petFeeAddon = await this.fetchPetFeeAddon(businessId);
        if (petFeeAddon) {
          quoteForPetFee = applyPetFeeToStayntouchQuote(
            quoteForPetFee,
            mergedStayDates,
            petFeeAddon,
            numPets,
          );
          quote.base_rate = quoteForPetFee.base_rate;
          quote.taxes = quoteForPetFee.taxes;
          quote.fees = quoteForPetFee.fees;
          quote.total_amount = quoteForPetFee.total_amount;
          quote.amountCharged = quoteForPetFee.amountCharged;
          quote.pricing = {
            ...mergedPricing,
            total_stay_cost: quoteForPetFee.total_amount,
            total_exclusive_tax: quoteForPetFee.taxes,
          };
        }
      }

      // Apply deposit policy
      const hotelWithConfig =
        await this.hotelService.getHotelWithConfigurationsAndChannels(
          existingReservationFromDB.hotel_id,
        );
      const hotelConfig = hotelWithConfig?.configuration;
      const hotel = hotelWithConfig?.hotel;
      if (!hotel) {
        throw new NoDataError(
          `getQuote: Hotel not found for hotel ID ${existingReservationFromDB.hotel_id}`,
        );
      }
      const forceFullDeposit = this.requiresFullDeposit(rateCode, hotelConfig);
      const depositAmount = applyInitialDepositPolicyToStayntouchQuote(
        newCheckIn,
        newCheckOut,
        quote.pricing as RoomRatesResponse,
        hotelConfig?.initial_deposit_policy,
        forceFullDeposit,
        hotel.payment_provider,
      );
      if (depositAmount != null) {
        quote.amountCharged = depositAmount;
      }

      // If an initial amount was already collected, and the full amount needn't be collected for any more modifications,
      // preserve it in the quote. The modification flow in RoomReservationService handles charging/refunding the delta.
      if (
        existingReservationFromDB.quote &&
        existingReservationFromDB.quote.amount_charged > 0 &&
        !forceFullDeposit
      ) {
        quote.amountCharged = existingReservationFromDB.quote.amount_charged;
      }

      logger.info(
        'StayntouchReservationService.getQuoteForModification: Modification quote computed',
        {
          base_rate: quote.base_rate,
          taxes: quote.taxes,
          fees: quote.fees,
          total_amount: quote.total_amount,
          amountCharged: quote.amountCharged,
          retained_dates: retainedDates.length,
          fresh_dates: freshDates.length,
        },
      );

      return quote;
    } catch (error) {
      logger.error(
        'StayntouchReservationService.getQuoteForModification: Error computing modification quote',
        { error },
      );
      throw error;
    }
  }

  /**
   * Verifies that the specific room type is still available for the requested dates
   * before creating a reservation. Throws a NoDataError if availability is not found.
   */
  private async checkRoomAvailabilityBeforeReservationCreation(params: {
    businessId: string;
    roomTypeId: number;
    rateId: number;
    checkIn: string;
    checkOut: string;
    numAdults: number;
    numChildren: number;
  }): Promise<void> {
    const {
      businessId,
      roomTypeId,
      rateId,
      checkIn,
      checkOut,
      numAdults,
      numChildren,
    } = params;

    let availabilityResponse: AvailabilityResponse;
    try {
      availabilityResponse = await this.client.getAvailability(businessId, {
        from_date: checkIn,
        to_date: checkOut,
        adults: numAdults,
        children: numChildren,
      });
    } catch (error) {
      if (error instanceof NoDataError) {
        throw new NoDataError(
          'The selected room is no longer available for the requested dates',
        );
      }
      throw error;
    }

    if (
      !availabilityResponse.results ||
      availabilityResponse.results.length === 0
    ) {
      throw new NoDataError(
        'The selected room is no longer available for the requested dates',
      );
    }

    // Availability must be checked against the exact rate_id from the quote,
    // since the reservation is always booked for a specific rate id/code.
    const rateResult = availabilityResponse.results.find(
      (r) => r.rate_id === rateId,
    );
    const roomType = rateResult?.room_types.find((rt) => rt.id === roomTypeId);
    const availability = roomType?.availability ?? 0;

    if (availability < 1) {
      logger.info(
        'StayntouchReservationService.checkRoomAvailabilityBeforeCreate: Room no longer available for the requested rate',
        { businessId, roomTypeId, rateId, checkIn, checkOut },
      );
      throw new NoDataError(
        'The selected room is no longer available for the requested dates',
      );
    }
  }

  /**
   * Validates that the rooms in the given reservations are still available for booking.
   * Fetches current availability from the PMS and throws if any reserved room is no longer available.
   */
  async validateRoomAvailability(
    reservations: ReservationDTO[] | null,
  ): Promise<void> {
    if (!reservations?.length) {
      throw new NoDataError(
        'validateRoomAvailability: Unable to validate room availability — reservation data could not be retrieved',
      );
    }

    const firstRes = reservations[0];
    const hotelId = firstRes.hotel?.id;
    if (!hotelId) return;

    const checkInDate = dayjs(firstRes.check_in).format('YYYY-MM-DD');
    const checkOutDate = dayjs(firstRes.check_out).format('YYYY-MM-DD');
    const businessId = firstRes.business_id;

    if (!businessId) {
      throw new NoDataError(
        'validateRoomAvailability: Business ID not found in reservation',
      );
    }

    let availabilityResponse: AvailabilityResponse;
    try {
      availabilityResponse = await this.client.getAvailability(
        businessId.toString(),
        {
          from_date: checkInDate,
          to_date: checkOutDate,
          adults: firstRes.num_adults,
          children: firstRes.num_children || 0,
        },
      );
    } catch (error) {
      if (error instanceof NoDataError) {
        throw new NoDataError(
          'The selected room(s) are no longer available for the requested dates',
        );
      }
      throw error;
    }

    if (
      !availabilityResponse.results ||
      availabilityResponse.results.length === 0
    ) {
      throw new NoDataError(
        'The selected room(s) are no longer available for the requested dates',
      );
    }

    // Count how many units of each room type are required
    const requiredUnitsPerRoom = new Map<number, number>();
    for (const reservation of reservations) {
      const roomId = Number(reservation.room_id);
      requiredUnitsPerRoom.set(
        roomId,
        (requiredUnitsPerRoom.get(roomId) || 0) + 1,
      );
    }

    // TODO: Code changes will be needed if each room can have a different rate code in the
    // multi-room reservation flow. Current logic uses one sample reservation per room type.
    // Check if each required room type has enough availability for its rate
    for (const [roomTypeId, requiredCount] of requiredUnitsPerRoom.entries()) {
      const sampleReservation = reservations.find(
        (r) => Number(r.room_id) === roomTypeId,
      );
      const rateCode =
        sampleReservation?.rate_code ??
        sampleReservation?.quote?.quote_object?.rate_code;
      const rateId =
        sampleReservation?.quote?.quote_object?.raw_response?.rate_id ??
        sampleReservation?.rate_id;

      const rateResult = rateCode
        ? availabilityResponse.results.find(
            (r) => r.rate_code?.toUpperCase() === rateCode.toUpperCase(),
          )
        : rateId != null
          ? availabilityResponse.results.find(
              (r) => r.rate_id === Number(rateId),
            )
          : undefined;

      const roomType = rateResult?.room_types.find(
        (rt) => rt.id === roomTypeId,
      );
      const availability = roomType?.availability ?? 0;

      if (availability < requiredCount) {
        const roomTypeName = reservations.find(
          (r) => Number(r.room_id) === roomTypeId,
        )?.room_type;
        throw new NoDataError(
          `Room ${roomTypeName || roomTypeId} is no longer available for the selected dates`,
        );
      }
    }
  }

  /**
   * Formats all monetary values in the pricing response to exactly two decimal places
   */
  private formatMonetaryValues(pricing: RoomRatesResponse): RoomRatesResponse {
    return {
      total_stay_cost: roundCurrency(pricing.total_stay_cost),
      total_inclusive_tax: roundCurrency(pricing.total_inclusive_tax),
      total_exclusive_tax: roundCurrency(pricing.total_exclusive_tax),
      total_exclusive_tourist_tax: roundCurrency(
        pricing.total_exclusive_tourist_tax,
      ),
      stay_dates: pricing.stay_dates.map((date) => ({
        date: date.date,
        rate_amount: roundCurrency(date.rate_amount),
        addon_amount: roundCurrency(date.addon_amount),
        exclusive_tax: roundCurrency(date.exclusive_tax),
        exclusive_tourist_tax: roundCurrency(date.exclusive_tourist_tax),
        inclusive_tax: roundCurrency(date.inclusive_tax),
        total_amount: roundCurrency(date.total_amount),
      })),
    };
  }

  /**
   * Looks up StayNTouch reservations by confirmation / external id when no local row exists.
   */
  async lookupReservationsById(
    hotel: Hotel,
    bookingId: string,
  ): Promise<ReservationDTO[]> {
    const attempts = await Promise.all([
      this.lookupReservationsFromPms(hotel, {
        alt_confirmation_number: bookingId,
      }),
      this.lookupReservationsFromPms(hotel, { confirmation_number: bookingId }),
      this.lookupReservationsFromPms(hotel, { reservation_id: bookingId }),
    ]);

    return attempts.find((results) => results.length > 0) ?? [];
  }

  /**
   * Looks up StayNTouch reservations by mobile number and home phone number.
   */
  async lookupReservationsByPhone(
    hotel: Hotel,
    phoneNumber: string,
    maxResults?: number,
  ): Promise<ReservationDTO[]> {
    const mobileResults = await this.lookupReservationsFromPms(hotel, {
      mobile_number: phoneNumber,
    });

    const pmsResults = [...mobileResults];
    if (maxResults && pmsResults.length >= maxResults) {
      return pmsResults.slice(0, maxResults);
    }

    const homeResults = await this.lookupReservationsFromPms(hotel, {
      home_phone: phoneNumber,
    });

    pmsResults.push(...homeResults);

    return maxResults !== undefined
      ? pmsResults.slice(0, maxResults)
      : pmsResults;
  }

  /**
   * Looks up StayNTouch reservations by guest name query when no local row exists.
   * Caller is responsible for pg_trgm similarity filtering on results.
   */
  async lookupReservationsByGuestQueryFromPms(
    hotel: Hotel,
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
          `lookupReservationsByGuestQueryFromPms timed out after ${timeoutMs}ms.  ${JSON.stringify({ guestName: trimmedGuestName })}`,
        );
      },
    );
  }

  async getExternalModificationInfo(
    reservationDetails: ReservationDTO,
    newCheckIn: string,
    newCheckOut: string,
    prefetchedReservation?: GetReservationResponse,
    newRoomTypeId?: number,
    newRateId?: number,
  ): Promise<ExternalModificationInfo> {
    const externalId = reservationDetails.external_id;
    if (!externalId) {
      throw new BadRequestError(
        'getExternalModificationInfo: external_id is required',
      );
    }
    const roomChanged = !!newRoomTypeId;

    const currentReservation =
      prefetchedReservation ?? (await this.client.getReservation(externalId));
    const existingStayDates = currentReservation.stay_dates ?? [];
    const existingCheckIn = currentReservation.arrival_date;
    const existingCheckOut = currentReservation.departure_date;

    if (!existingCheckIn || !existingCheckOut) {
      throw new BadRequestError(
        'getExternalModificationInfo: Cannot determine existing dates from Stayntouch reservation',
      );
    }

    const firstStayDate = existingStayDates[0];
    if (!firstStayDate) {
      throw new BadRequestError(
        'getExternalModificationInfo: Reservation has no stay_dates',
      );
    }

    const rateId = newRateId || firstStayDate.rate_id;
    const roomTypeId = newRoomTypeId || firstStayDate.room_type_id;
    const adults = firstStayDate.adults;
    const children = firstStayDate.children ?? 0;
    const currency = currentReservation.currency_code ?? '';
    const businessId = reservationDetails.business_id?.toString() ?? '';

    const scenario = determineDateModificationScenario(
      existingCheckIn,
      existingCheckOut,
      newCheckIn,
      newCheckOut,
    );
    let roomType: string = '';
    try {
      const roomTypeMap = await this.getRoomTypeMap(businessId, [roomTypeId]);
      roomType = roomTypeMap.get(String(roomTypeId)) ?? '';
    } catch {
      roomType = '';
    }

    // When the room changes, always fetch the rate code for the new rate_id.
    let rateCode = !roomChanged ? (reservationDetails.rate_code ?? '') : '';
    if (roomChanged && rateId) {
      try {
        const rateDetails = await this.client.getRate(rateId);
        rateCode = rateDetails.code || rateCode;
      } catch {
        // non-fatal
      }
    }

    if (scenario === 'same_dates' && !roomChanged) {
      return {
        scenario,
        pricingDelta: 0,
        available: true,
        rate_id: rateId,
        rate_code: rateCode,
        room_type_id: roomTypeId,
        adults,
        children,
        currency,
        newDateBreakdown: [],
      };
    }

    if (scenario === 'stay_reduction' && !roomChanged) {
      return {
        scenario,
        pricingDelta: 0,
        available: true,
        rate_id: rateId,
        rate_code: rateCode,
        room_type_id: roomTypeId,
        adults,
        children,
        currency,
        newDateBreakdown: [],
      };
    }

    // For date extensions/non-overlapping, fetch pricing for new dates.
    // When the room changes, all dates need fresh pricing since they're for a different room.
    const existingDateSet = new Set(existingStayDates.map((sd) => sd.date));
    const newDates: string[] = [];
    let cursor = dayjs(newCheckIn);
    while (cursor.isBefore(dayjs(newCheckOut))) {
      const dateStr = cursor.format('YYYY-MM-DD');
      if (roomChanged || !existingDateSet.has(dateStr)) {
        newDates.push(dateStr);
      }
      cursor = cursor.add(1, 'day');
    }

    if (newDates.length === 0) {
      return {
        scenario,
        pricingDelta: 0,
        available: true,
        rate_id: rateId,
        rate_code: rateCode,
        room_type_id: roomTypeId,
        adults,
        children,
        currency,
        newDateBreakdown: [],
      };
    }

    try {
      const contiguousRanges = groupContiguousDates(newDates);
      const rangeResults = await Promise.all(
        contiguousRanges.map(async (range) => {
          const fromDate = range[0];
          const toDate = dayjs(range[range.length - 1])
            .add(1, 'day')
            .format('YYYY-MM-DD');
          const pricing = await this.client.getRoomRates(businessId, {
            rate_id: rateId,
            room_type_id: roomTypeId,
            from_date: fromDate,
            to_date: toDate,
            adults,
            children,
          });
          return this.formatMonetaryValues(pricing);
        }),
      );

      const allStayDates = rangeResults.flatMap((r) => r.stay_dates);
      if (allStayDates.length < newDates.length) {
        return {
          scenario,
          pricingDelta: 0,
          available: false,
          rate_id: rateId,
          rate_code: rateCode,
          room_type_id: roomTypeId,
          adults,
          children,
          currency,
          newDateBreakdown: [],
        };
      }

      const additionalAmount = roundCurrency(
        allStayDates.reduce((sum, sd) => sum + sd.total_amount, 0),
      );
      const newDateBreakdown: ExternalModificationDateEntry[] =
        allStayDates.map((sd) => ({
          date: sd.date,
          room_type: roomType,
          rate_code: rateCode,
          amount: sd.total_amount,
          currency,
        }));
      return {
        scenario,
        pricingDelta: additionalAmount,
        available: true,
        rate_id: rateId,
        rate_code: rateCode,
        room_type_id: roomTypeId,
        adults,
        children,
        currency,
        newDateBreakdown,
      };
    } catch (error) {
      logger.error(
        'getExternalModificationInfo: Error fetching rates for new dates',
        { error },
      );
      return {
        scenario,
        pricingDelta: 0,
        available: false,
        rate_id: rateId,
        rate_code: rateCode,
        room_type_id: roomTypeId,
        adults,
        children,
        currency,
        newDateBreakdown: [],
      };
    }
  }

  async modifyExternalDirectReservation(
    reservationDetails: ReservationDTO,
    newCheckIn: string,
    newCheckOut: string,
    newRoomTypeId?: number,
    newRateId?: number,
  ): Promise<ExternalModificationInfo> {
    const externalId = reservationDetails.external_id;
    if (!externalId) {
      throw new BadRequestError(
        'modifyExternalDirectReservation: external_id is required',
      );
    }

    if (newRateId && !newRoomTypeId) {
      throw new BadRequestError(
        'modifyExternalDirectReservation: newRateId can only be specified when newRoomTypeId is also provided',
      );
    }

    const currentReservation = await this.client.getReservation(externalId);

    if (
      hasBlockingAddons(
        currentReservation.addons,
        reservationDetails.hotel_configuration?.addon_modification_allowlist,
      )
    ) {
      throw new BadRequestError(ADDON_MODIFICATION_BLOCKED_NOTE);
    }

    const roomChanged = !!newRoomTypeId;
    const info = await this.getExternalModificationInfo(
      reservationDetails,
      newCheckIn,
      newCheckOut,
      currentReservation,
      newRoomTypeId,
      newRateId,
    );

    if ((info.scenario === 'same_dates' && !roomChanged) || !info.available) {
      return info;
    }

    const existingDateSet = new Set(
      (currentReservation.stay_dates ?? []).map((sd) => sd.date),
    );

    const stayDates: ReservationStayDate[] = [];
    let cursor = dayjs(newCheckIn);
    while (cursor.isBefore(dayjs(newCheckOut))) {
      const dateStr = cursor.format('YYYY-MM-DD');
      if (roomChanged || !existingDateSet.has(dateStr)) {
        stayDates.push({
          date: dateStr,
          rate_id: info.rate_id.toString(),
          room_type_id: info.room_type_id.toString(),
          adults: info.adults,
          children: info.children,
        });
      }
      cursor = cursor.add(1, 'day');
    }

    const updatePayload: UpdateReservationRequest = {
      arrival_date: dayjs(newCheckIn).format('YYYY-MM-DD'),
      departure_date: dayjs(newCheckOut).format('YYYY-MM-DD'),
      stay_dates: stayDates,
      notes: [{ description: 'Updated via Dextr' }],
    };

    const response = await this.client.updateReservation(
      externalId,
      updatePayload,
    );
    logger.info(
      'modifyExternalDirectReservation: Reservation modified successfully',
      {
        reservation_id: response.id,
        warnings: response.warnings,
        scenario: info.scenario,
      },
    );

    return info;
  }

  async cancelExternalDirectReservation(
    reservationDetails: ReservationDTO,
    reason?: string,
  ): Promise<{ status: boolean; errors?: string[] }> {
    try {
      const externalId = reservationDetails.external_id;
      if (!externalId) {
        throw new BadRequestError(
          'cancelExternalDirectReservation: external_id is required',
        );
      }

      logger.info(
        'StayntouchReservationService.cancelExternalDirectReservation: Cancelling website reservation',
        {
          external_id: externalId,
          booking_id: reservationDetails.booking_id,
        },
      );

      const cancelResponse = await this.cancelReservation({
        business_id: reservationDetails.business_id.toString(),
        external_id: externalId,
        internal_id: reservationDetails.booking_id,
        reason,
      });
      return cancelResponse;
    } catch (error) {
      logger.error(
        'StayntouchReservationService.cancelExternalDirectReservation: Error cancelling website reservation',
        { error },
      );
      throw error;
    }
  }

  async getRateIdByCode(
    hotelId: number,
    rateCode: string,
  ): Promise<number | undefined> {
    try {
      const rates = await this.getHotelRatesWithCache(hotelId);
      return rates.find((r) => r.code.toUpperCase() === rateCode.toUpperCase())
        ?.id;
    } catch (error) {
      logger.error(
        'StayntouchReservationService.getRateIdByCode: Failed to fetch hotel rates',
        { error, hotelId, rateCode },
      );
      return undefined;
    }
  }

  private async lookupReservationsByGuestQueryFromPmsUncapped(
    hotel: Hotel,
    trimmedGuestName: string,
  ): Promise<ReservationDTO[]> {
    // Check if the name contains spaces
    const nameParts = trimmedGuestName
      .split(/\s+/)
      .filter((part) => part.length > 0);

    if (nameParts.length === 1) {
      // No spaces - try last_name first, then fallback to query
      try {
        const lastNameResults = await this.lookupReservationsFromPms(hotel, {
          last_name: trimmedGuestName,
        });

        if (lastNameResults.length > 0) {
          logger.info(
            `lookupReservationsByGuestQueryFromPms: Found ${lastNameResults.length} results using last_name search`,
            {
              guestName: trimmedGuestName,
            },
          );
          return lastNameResults;
        }
        logger.warn(
          `lookupReservationsByGuestQueryFromPms: No results with last_name: ${trimmedGuestName}`,
        );
        return [];
      } catch (error) {
        logger.error(
          'lookupReservationsByGuestQueryFromPms: Error in single name search',
          {
            error,
            guestName: trimmedGuestName,
          },
        );
        return [];
      }
    }

    // Name has spaces - search by last name and then filter using first name
    const lastName = nameParts[nameParts.length - 1];
    const firstName = nameParts.slice(0, -1).join(' ');

    try {
      // First, search by last name
      const lastNameResults = await this.lookupReservationsFromPms(hotel, {
        last_name: lastName,
      });

      if (lastNameResults.length === 0) {
        return [];
      }

      // Filter results by checking if the first name matches
      const matchingResults = lastNameResults.filter((reservation) => {
        // Get the customer's first name from the reservation
        const customerFirstName =
          reservation.customer?.first_name?.trim().toLowerCase() || '';
        const searchFirstName = firstName.toLowerCase();

        // Check if the first name matches (case-insensitive)
        return (
          customerFirstName.includes(searchFirstName) ||
          searchFirstName.includes(customerFirstName)
        );
      });

      logger.info(
        `lookupReservationsByGuestQueryFromPms: Filtered ${matchingResults.length} results from ${lastNameResults.length} last name matches`,
        {
          guestName: trimmedGuestName,
          lastName,
          firstName,
          matchingIds: matchingResults.map((res) => res.id),
        },
      );

      return matchingResults;
    } catch (error) {
      logger.error(
        'StayntouchReservationService.lookupReservationsByGuestQueryFromPms: Error searching by name parts. Using fallback query search.',
        {
          error,
          guestName: trimmedGuestName,
          lastName,
          firstName,
        },
      );
      throw error;
    }
  }

  private async lookupReservationsFromPms(
    hotel: Hotel,
    searchParams: SearchReservationsParams,
  ): Promise<ReservationDTO[]> {
    try {
      const stayntouchHotelId = parseInt(String(hotel.business_id), 10);
      if (Number.isNaN(stayntouchHotelId)) {
        return [];
      }

      const perPage = searchParams.per_page || 50;
      const initialPage = searchParams.page || 1;
      const shouldFetchAllPages = !searchParams.page && !searchParams.per_page;

      const isIdBasedSearch =
        'confirmation_number' in searchParams ||
        'alt_confirmation_number' in searchParams ||
        'reservation_id' in searchParams;

      // Restrict to the last 7 days for non-ID searches to reduce load
      const dateRestriction = isIdBasedSearch
        ? {}
        : {
            date:
              searchParams.date ??
              dayjs()
                .tz(hotel.timezone)
                .subtract(7, 'day')
                .format('YYYY-MM-DD'),
            date_filter: searchParams.date_filter ?? ('arrival' as const),
            date_operator: searchParams.date_operator ?? ('gte' as const),
          };

      const firstResponse = await this.client.searchReservations(
        stayntouchHotelId,
        {
          ...searchParams,
          ...dateRestriction,
          page: initialPage,
          per_page: perPage,
        },
      );

      let allResults: GetReservationResponse[] = [
        ...(firstResponse.results ?? []),
      ];

      if (shouldFetchAllPages) {
        const totalCount = firstResponse.total_count || 0;
        const firstPageCount = firstResponse.results?.length ?? 0;
        const fetchedSoFar = (initialPage - 1) * perPage + firstPageCount;
        const hasMorePages =
          fetchedSoFar < totalCount && firstPageCount === perPage;

        if (hasMorePages) {
          const totalPages = Math.ceil(totalCount / perPage);
          const remainingPages = Array.from(
            { length: totalPages - 1 },
            (_, i) => i + 2,
          );

          const pageResponses = await Promise.allSettled(
            remainingPages.map((page) =>
              this.client.searchReservations(stayntouchHotelId, {
                ...searchParams,
                ...dateRestriction,
                page,
                per_page: perPage,
              }),
            ),
          );

          for (const result of pageResponses) {
            if (result.status === 'fulfilled' && result.value.results?.length) {
              allResults.push(...result.value.results);
            } else if (result.status === 'rejected') {
              logger.error(
                `Failed to fetch page of reservations:`,
                result.reason,
              );
            }
          }
        }
      }

      logKpi({
        stat: KpiStat.StayntouchExternalIdLookup,
        value: 1,
        contextName: 'StayntouchReservationService.lookupReservationsFromPms',
        clientId: hotel.assistant_phone_number ?? hotel.id,
      });

      if (!allResults.length) {
        return [];
      }

      logKpi({
        stat: KpiStat.StayntouchExternalIdSuccess,
        value: 1,
        contextName: 'StayntouchReservationService.lookupReservationsFromPms',
        clientId: hotel.assistant_phone_number ?? hotel.id,
      });

      const { configuration } =
        await this.hotelService.getHotelWithConfigurationsAndChannels(hotel.id);

      const rateCodeMap = new Map<number, string>();
      try {
        const hotelRates = await this.getHotelRatesWithCache(stayntouchHotelId);
        for (const rate of hotelRates) {
          rateCodeMap.set(rate.id, rate.code);
        }
      } catch (rateError) {
        logger.error(
          'lookupReservationsFromPms: Failed to fetch hotel rates, rate_code will be null',
          { error: rateError },
        );
      }

      return mapStayntouchSearchResultsToReservationDTOs(
        allResults,
        hotel,
        configuration,
        rateCodeMap,
      );
    } catch (error) {
      logger.error(
        `StayntouchReservationService.lookupReservationsFromPms exception: ${error}`,
      );
      return [];
    }
  }

  async validateMultiRoomOccupancy(
    peoplePerRoom: PeoplePerRoom,
    roomsInfo: { rooms: StayntouchRoomInfo[]; note: string },
    _hotelId: string,
  ): Promise<void> {
    const roomMap = new Map(roomsInfo.rooms.map((r) => [r.room_id, r]));
    // Deduplicate keys so the same room type is validated once; multiple bookings
    // of the same room are represented by multiple entries in peoplePerRoom[roomId].
    const inputRoomIds = Array.from(new Set(Object.keys(peoplePerRoom)));

    for (const roomId of inputRoomIds) {
      const room = roomMap.get(Number(roomId));
      if (!room) {
        throw new BadRequestError(`Invalid room type id: ${roomId}`);
      }

      const roomName = room.room_name;
      const maxOccupancy = room.max_occupancy;

      for (const occupantGroup of peoplePerRoom[roomId]) {
        if (occupantGroup.num_adults < 1) {
          throw new BadRequestError(
            `${roomName}: At least one adult is required per room`,
          );
        }

        // Skip when unset (null) or non-positive (0 = not configured in StayNTouch)
        if (maxOccupancy != null && maxOccupancy > 0) {
          const totalGuests =
            occupantGroup.num_adults + occupantGroup.num_children;
          if (totalGuests > maxOccupancy) {
            throw new BadRequestError(
              `${roomName}: Total guests (${totalGuests}) exceeds maximum occupancy (${maxOccupancy})`,
            );
          }
        }
      }
    }
  }

  // TODO: Implement discount support for StayNTouch when required.
  shouldFetchDiscount(): boolean {
    return false;
  }

  // StayNTouch handles pets natively via addons; text-based partner notes are not used.
  buildPartnerNotes(_context: ReservationNotesContext): string | null {
    return null;
  }
}
