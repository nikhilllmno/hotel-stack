import dayjs from 'dayjs';
import config from '../../config';
import { Reservation } from '../../dtos/Reservation';
import { ReservationLookupSource } from '../../dtos/enum/ReservationLookupSource';
import { ReservationSource } from '../../dtos/enum/ReservationSource';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { SessionType } from '../../dtos/enum/SessionType';
import { BadRequestError } from '../../errors/BadRequestError';
import { NoDataError } from '../../errors/NoDataError';
import { Discount } from '../../models/Discount';
import { Hotel } from '../../models/Hotel';
import { HotelConfiguration } from '../../models/HotelConfiguration';
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
import { hotelConfigurationService } from '../../services/hotelConfiguration/hotelConfigurationService';
import { validateAndCorrectDates } from '../../services/roomReservation/helper';
import {
  getPetFeeStrategy,
  PetFeeStrategy,
} from '../../services/roomReservation/petFeeStrategies';
import {
  DateModificationScenario,
  ExternalModificationDateEntry,
  ExternalModificationInfo,
} from '../../stayntouch/services/reservationService';
import { PaymentProvider, PmsProvider } from '../../types/enums';
import {
  DepositType,
  InitialDepositPolicy,
  isFullPaymentPolicy,
} from '../../types/hotelConfiguration';
import { withTimeoutWithFallback } from '../../utils/async';
import {
  groupContiguousDates,
  numberToWords,
  roundCurrency,
  toHotelLocalTimeUtc,
  toHotelMidnightUtc,
} from '../../utils/helper';
import { KpiStat, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import { validateReservationForCreation } from '../../validators/reservationCreationSchema';
import { mewsClient } from '../client/MewsClient';
import {
  MewsConfigurationError,
  MewsPastStartUtcError,
  MewsRestrictedError,
  MewsRoomUnavailableError,
} from '../errors';
import { mewsTokenService } from '../services/tokenService';
import {
  MewsAddReservationItem,
  MewsAgeCategory,
  MewsAgeCategoryAdjustment,
  MewsAmountPrice,
  MewsCredentials,
  MewsCustomer,
  MewsGetRatePricingResponse,
  MewsProduct,
  MewsRate,
  MewsReservation,
  MewsReservationOrigin,
  MewsResourceCategory,
  MewsRestriction,
  MewsRoomAvailability,
  MewsService,
  MewsUpdateReservationItem,
} from '../types';
import { getMewsRequestId } from '../utils/mewsErrorUtils';
import { computeMewsPetProductFee } from '../utils/petFeeCalculator';
import {
  findBlockingRestriction,
  MewsRestrictionNight,
} from '../utils/restrictions';
import {
  getMewsServiceTimeOffsets,
  isUnusableStartOffset,
} from '../utils/serviceTimeOffsets';

//a service is a broader term - to specify like a stay/accomodation/wedding venue etc
//a resource is a queen room, king room etc.
//a resource has a rate.

export class MewsReservationService implements IPMSReservationService {
  private hotelService: HotelService;

  constructor(hotelSvc: HotelService = hotelService) {
    this.hotelService = hotelSvc;
  }

  private async resolveCredentials(hotelId: string): Promise<MewsCredentials> {
    const clientToken = config.MEWS_CLIENT_TOKEN;
    const client = config.MEWS_CLIENT;
    if (!clientToken || !client) {
      throw new MewsConfigurationError(
        'MewsReservationService: MEWS_CLIENT_TOKEN and MEWS_CLIENT must be set in environment',
      );
    }
    const accessToken = await mewsTokenService.getActiveToken(hotelId);
    const baseCredentials = { clientToken, accessToken, client };
    // business_id holds the hotel's Mews enterprise id, but EnterpriseIds
    // must only be sent when the access token is actually Portfolio-scoped.
    const hotel = await this.hotelService.getHotelById(hotelId);
    const enterpriseId = await mewsTokenService.resolveEnterpriseId(
      baseCredentials,
      hotel?.business_id,
    );
    return {
      ...baseCredentials,
      enterpriseId,
    };
  }

  private async _getBookableServices(
    credentials: MewsCredentials,
  ): Promise<MewsService[]> {
    const all = await mewsClient.getAllServices(credentials);
    return all.filter(
      (s) => s.IsActive && s.Data?.Discriminator === 'Bookable',
    );
  }

  // Resolves the Mews pet Product by its configured ID. When no
  // mews_pet_product_id is configured, returns undefined so the caller falls
  // back to the DB pet_fee_configuration strategy.
  private async _getPetProduct(
    bookableServices: MewsService[],
    credentials: MewsCredentials,
    productId?: string,
  ): Promise<MewsProduct | undefined> {
    if (!productId || !bookableServices.length) return undefined;
    const products = await mewsClient.getProducts(
      bookableServices.map((s) => s.Id),
      credentials,
    );
    return products.find((p) => p.IsActive && p.Id === productId);
  }

  // Resolves the once-per-call, potentially-expensive pieces of pet fee pricing:
  // the Mews pet Product (one getProducts call) and the DB-config strategy
  // fallback (sync). Only call when numPets > 0 — the Mews Product branch is
  // hotel-wide/flat so it's safe to reuse across every room in a listing, but
  // the strategy fallback can vary per room (see LosRiosPetFeeStrategy, which
  // keys off unit_group_id) — that variance is applied per-room in _calcPetFee.
  private async _resolvePetFeeSource(
    bookableServices: MewsService[],
    credentials: MewsCredentials,
    hotel: Hotel,
    hotelConfig: HotelConfiguration | null,
    numPets: number,
  ): Promise<{ petProduct?: MewsProduct; petStrategy?: PetFeeStrategy }> {
    const petProduct = await this._getPetProduct(
      bookableServices,
      credentials,
      hotelConfig?.pet_fee_configuration?.mews_pet_product_id,
    );
    if (petProduct) {
      this._validateMaxPets(
        numPets,
        hotelConfig?.pet_fee_configuration?.max_pets_per_room,
      );
      return { petProduct };
    }
    const petStrategy = getPetFeeStrategy(
      hotel.id,
      hotelConfig?.pet_fee_configuration,
    );
    if (petStrategy) petStrategy.validatePetCount(numPets);
    return { petStrategy };
  }

  // Enforces the per-room pet cap on the Mews-product path (the strategy path
  // enforces it via PetFeeStrategy.validatePetCount). No-op when no cap is set.
  private _validateMaxPets(numPets: number, maxPetsPerRoom?: number): void {
    if (maxPetsPerRoom && numPets > maxPetsPerRoom) {
      throw new BadRequestError(
        `Maximum pet capacity of each room is ${maxPetsPerRoom}`,
      );
    }
  }

  private _calcPetFee(
    source: { petProduct?: MewsProduct; petStrategy?: PetFeeStrategy },
    numPets: number,
    checkIn: string,
    checkOut: string,
    roomId: string | number,
    baseRate: number,
    taxes: number,
  ): { fees: number; petProductId?: string; petProductCount?: number } {
    if (numPets <= 0) return { fees: 0 };
    if (source.petProduct) {
      const nights = this._numNights(checkIn, checkOut);
      const { fees, count } = computeMewsPetProductFee(
        source.petProduct.ChargingMode,
        source.petProduct.Price.GrossValue,
        numPets,
        nights,
      );
      return {
        fees,
        petProductId: source.petProduct.Id,
        petProductCount: count,
      };
    }
    if (source.petStrategy) {
      const quoteAdapter = {
        check_in: checkIn,
        check_out: checkOut,
        unit_group_id: Number(roomId) || 0,
        base_rate: baseRate,
        taxes,
        fees: 0,
        total_amount: baseRate + taxes,
        amountCharged: baseRate + taxes,
      };
      return {
        fees: roundCurrency(
          source.petStrategy.calculatePetFee(quoteAdapter, numPets) || 0,
        ),
      };
    }
    return { fees: 0 };
  }

  private _buildUtcRange(
    checkIn: string,
    checkOut: string,
    hotelTimezone?: string,
  ) {
    if (hotelTimezone) {
      const firstNightStart = toHotelMidnightUtc(
        String(checkIn),
        hotelTimezone,
      );
      const lastNightStart = toHotelMidnightUtc(
        dayjs(checkOut).subtract(1, 'day').format('YYYY-MM-DD'),
        hotelTimezone,
      );

      return {
        firstTimeUnitStartUtc: firstNightStart,
        lastTimeUnitStartUtc: lastNightStart,
      };
    }

    const firstNightStart = new Date(checkIn).toISOString();
    const lastNightStart = dayjs(checkOut).subtract(1, 'day').toISOString();

    return {
      firstTimeUnitStartUtc: firstNightStart,
      lastTimeUnitStartUtc: lastNightStart,
    };
  }

  private async _buildAvailabilityMap(
    services: MewsService[],
    firstTimeUnitStartUtc: string,
    lastTimeUnitStartUtc: string,
    credentials: MewsCredentials,
  ): Promise<Map<string, number[]>> {
    const map = new Map<string, number[]>();
    const availabilities = await Promise.all(
      services.map((service) =>
        mewsClient.getAvailability(
          {
            serviceId: service.Id,
            firstTimeUnitStartUtc,
            lastTimeUnitStartUtc,
            metrics: [
              'Occupied',
              'UsableResources',
              'AllocatedBlockAvailability',
              'PublicAvailabilityAdjustment',
              'OtherServiceReservationCount',
              'HouseUse',
            ],
          },
          credentials,
        ),
      ),
    );
    for (const availability of availabilities) {
      for (const cat of availability.ResourceCategoryAvailabilities) {
        const {
          UsableResources,
          Occupied,
          AllocatedBlockAvailability,
          PublicAvailabilityAdjustment,
          OtherServiceReservationCount,
          HouseUse,
        } = cat.Metrics;
        if (!UsableResources?.length || !Occupied?.length) continue;
        // Sellable availability per Mews docs: UsableResources + PublicAvailabilityAdjustment
        // - Occupied - OtherServiceReservationCount - AllocatedBlockAvailability - HouseUse
        map.set(
          cat.ResourceCategoryId,
          UsableResources.map(
            (u, i) =>
              u +
              (PublicAvailabilityAdjustment?.[i] ?? 0) -
              (Occupied[i] ?? 0) -
              (OtherServiceReservationCount?.[i] ?? 0) -
              (AllocatedBlockAvailability?.[i] ?? 0) -
              (HouseUse?.[i] ?? 0),
          ),
        );
      }
    }
    return map;
  }

  // One entry per night plus the check-out day, in the two forms restriction
  // conditions are keyed by: the UTC time unit start (interval conditions) and
  // the hotel-local date (day-of-week conditions).
  private _buildRestrictionDays(
    checkIn: string,
    checkOut: string,
    hotelTimezone?: string,
  ): { nights: MewsRestrictionNight[]; checkOut: MewsRestrictionNight } {
    const toUnitStart = (localDate: string) =>
      hotelTimezone
        ? toHotelMidnightUtc(localDate, hotelTimezone)
        : new Date(`${localDate}T00:00:00Z`).toISOString();
    const toDay = (localDate: string): MewsRestrictionNight => ({
      localDate,
      timeUnitStartUtc: toUnitStart(localDate),
    });

    const checkOutDate = dayjs(checkOut).format('YYYY-MM-DD');
    const nights: MewsRestrictionNight[] = [];
    let cursor = dayjs(dayjs(checkIn).format('YYYY-MM-DD'));
    // Bounded so a corrupt date range can't spin here; no real stay is a year.
    for (
      let i = 0;
      i < 366 && cursor.format('YYYY-MM-DD') < checkOutDate;
      i++
    ) {
      nights.push(toDay(cursor.format('YYYY-MM-DD')));
      cursor = cursor.add(1, 'day');
    }

    return { nights, checkOut: toDay(checkOutDate) };
  }

  /**
   * Builds a `(categoryId, rateId, pricePerTimeUnit) => blocking restriction`
   * predicate for the stay. Availability metrics don't reflect restrictions, so
   * without this a closed rate or a MinAdvance window still reads as bookable.
   *
   * Fails open: if restrictions/getAll errors the predicate returns null for
   * everything, leaving today's behaviour rather than hiding every room.
   */
  private async _buildRestrictionChecker(
    services: MewsService[],
    categories: MewsResourceCategory[],
    rates: MewsRate[],
    checkIn: string,
    checkOut: string,
    hotelTimezone: string | undefined,
    credentials: MewsCredentials,
    contextLabel: string,
  ): Promise<
    (
      categoryId: string,
      rateId?: string | null,
      pricePerTimeUnit?: number,
    ) => MewsRestriction | null
  > {
    const { nights, checkOut: checkOutDay } = this._buildRestrictionDays(
      checkIn,
      checkOut,
      hotelTimezone,
    );
    if (!nights.length) return () => null;

    let restrictions: MewsRestriction[];
    try {
      restrictions = await mewsClient.getRestrictions(
        {
          serviceIds: services.map((s) => s.Id),
          collidingStartUtc: nights[0].timeUnitStartUtc,
          collidingEndUtc: checkOutDay.timeUnitStartUtc,
        },
        credentials,
      );
    } catch (error) {
      logger.warn(
        `${contextLabel}: restrictions/getAll failed, continuing without restriction filtering`,
        {
          error: error instanceof Error ? error.message : String(error),
          mewsRequestId: getMewsRequestId(error),
        },
      );
      return () => null;
    }
    if (!restrictions.length) return () => null;

    const categoryById = new Map(categories.map((c) => [c.Id, c]));
    const rateById = new Map(rates.map((r) => [r.Id, r]));

    return (categoryId, rateId, pricePerTimeUnit) => {
      const category = categoryById.get(categoryId);
      if (!category) return null;
      const rate = rateId ? rateById.get(rateId) : undefined;
      return findBlockingRestriction(restrictions, {
        nights,
        checkOut: checkOutDay,
        serviceId: category.ServiceId,
        resourceCategoryId: categoryId,
        resourceCategoryType: category.Type,
        rateId: rateId ?? null,
        baseRateId: rate?.BaseRateId ?? null,
        rateGroupId: rate?.GroupId ?? null,
        pricePerTimeUnit,
      });
    };
  }

  // Fetches getRatePricing for every rate in parallel. Shared by the
  // single- and multi-room quote builders.
  private async _fetchRatePricingsInParallel(
    enabledRates: MewsRate[],
    firstTimeUnitStartUtc: string,
    lastTimeUnitStartUtc: string,
    credentials: MewsCredentials,
    contextLabel: string,
  ): Promise<Array<{ rate: MewsRate; pricing: MewsGetRatePricingResponse }>> {
    const results = await Promise.all(
      enabledRates.map(async (rate) => {
        try {
          const pricing = await mewsClient.getRatePricing(
            { rateId: rate.Id, firstTimeUnitStartUtc, lastTimeUnitStartUtc },
            credentials,
          );
          return { rate, pricing };
        } catch (error) {
          logger.warn(
            `${contextLabel}: getRatePricing failed for rate, skipping`,
            {
              rateId: rate.Id,
              error: error instanceof Error ? error.message : String(error),
              mewsRequestId: getMewsRequestId(error),
            },
          );
          return null;
        }
      }),
    );
    return results.filter(
      (r): r is { rate: MewsRate; pricing: MewsGetRatePricingResponse } =>
        r !== null,
    );
  }

  private _getRateName(rate: MewsRate): string {
    return (
      rate.Names?.['en-US'] ?? Object.values(rate.Names ?? {})[0] ?? rate.Id
    );
  }

  private _numNights(checkIn: string, checkOut: string): number {
    return Math.max(
      1,
      Math.round(
        (new Date(checkOut).getTime() - new Date(checkIn).getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    );
  }

  private _guestText(numAdults: number, numChildren: number) {
    return {
      adultsText: numAdults === 1 ? '1 adult' : `${numAdults} adults`,
      childrenText:
        numChildren === 0
          ? '0 children'
          : numChildren === 1
            ? '1 child'
            : `${numChildren} children`,
    };
  }

  private _buildAmountPrice(
    rateId: string,
    rateName: string,
    currency: string,
    amountPrices: MewsAmountPrice[],
    ageAdjustmentPerNight = 0,
    shortName?: string,
  ) {
    const pricesPerNight = amountPrices.map(
      (p) => p.GrossValue + ageAdjustmentPerNight,
    );
    // Mews GrossValue is tax-inclusive (GrossValue = NetValue + TaxValues);
    // capture the tax portion so callers can split net vs tax. Age adjustments
    // are untaxed, so they fall into the net (base_rate) side.
    const taxes = roundCurrency(
      amountPrices.reduce(
        (s, p) => s + p.TaxValues.reduce((ts, tv) => ts + tv.Value, 0),
        0,
      ),
    );
    const firstNightTax = amountPrices[0]
      ? roundCurrency(
          amountPrices[0].TaxValues.reduce((s, tv) => s + tv.Value, 0),
        )
      : 0;
    return {
      rateId,
      rateName,
      shortName,
      currency,
      pricesPerNight,
      totalPrice: pricesPerNight.reduce((s, p) => s + p, 0),
      taxes,
      firstNightTax,
    };
  }

  // Adults are matched against capacity first. Each guest occupying a
  // within-capacity slot takes the Standard adjustment; guests above capacity
  // take Extra; empty capacity slots take Negative. Adults have no Standard
  // entry (base price already prices standard adults), so their lookup is a
  // no-op and only child Standard adjustments actually apply.
  private _computeAgeCategoryAdjustmentPerNight(
    ageCategoryAdjustments: MewsAgeCategoryAdjustment[] | undefined,
    capacity: number,
    numAdults: number,
    numChildren: number,
    adultCategoryId?: string,
    childCategoryId?: string,
  ): number {
    if (!ageCategoryAdjustments?.length || capacity <= 0) return 0;

    const findAdj = (categoryId: string | undefined, type: string) =>
      categoryId
        ? ageCategoryAdjustments.find(
            (a) => a.AgeCategoryId === categoryId && a.Type === type,
          )
        : undefined;

    const adultWithinCapacity = Math.min(numAdults, capacity);
    const extraAdults = numAdults - adultWithinCapacity;
    const remainingCapacity = capacity - adultWithinCapacity;

    const childWithinCapacity = Math.min(numChildren, remainingCapacity);
    const extraChildren = numChildren - childWithinCapacity;
    const deficit = remainingCapacity - childWithinCapacity;

    let adjustment = 0;
    if (adultWithinCapacity > 0) {
      adjustment +=
        adultWithinCapacity *
        (findAdj(adultCategoryId, 'StandardOccupancyAdjustment')
          ?.AbsoluteValue ?? 0);
    }
    if (childWithinCapacity > 0) {
      adjustment +=
        childWithinCapacity *
        (findAdj(childCategoryId, 'StandardOccupancyAdjustment')
          ?.AbsoluteValue ?? 0);
    }
    if (extraAdults > 0) {
      adjustment +=
        extraAdults *
        (findAdj(adultCategoryId, 'ExtraOccupancyAdjustment')?.AbsoluteValue ??
          0);
    }
    if (extraChildren > 0) {
      adjustment +=
        extraChildren *
        (findAdj(childCategoryId, 'ExtraOccupancyAdjustment')?.AbsoluteValue ??
          0);
    }
    if (deficit > 0) {
      adjustment +=
        deficit *
        (findAdj(adultCategoryId, 'NegativeOccupancyAdjustment')
          ?.AbsoluteValue ?? 0);
    }
    logger.debug('_computeAgeCategoryAdjustmentPerNight debug', {
      capacity,
      numAdults,
      numChildren,
      adultCategoryId,
      childCategoryId,
      adultWithinCapacity,
      childWithinCapacity,
      extraAdults,
      extraChildren,
      deficit,
      ageCategoryAdjustments,
      adjustment,
    });
    return adjustment;
  }

  async validateRoomAvailability(
    reservations: Reservation[] | null,
    credentials?: MewsCredentials,
    bookableServices?: MewsService[],
    options?: { skipRestrictions?: boolean },
  ): Promise<void> {
    if (!reservations?.length) {
      throw new NoDataError(
        'MewsReservationService.validateRoomAvailability: No reservations provided',
      );
    }

    const first = reservations[0];
    if (!first.hotel) {
      throw new NoDataError(
        'MewsReservationService.validateRoomAvailability: reservation missing hotel context',
      );
    }

    const resolvedCredentials =
      credentials ?? (await this.resolveCredentials(first.hotel.id));

    const resolvedBookableServices =
      bookableServices ??
      (await this._getBookableServices(resolvedCredentials));
    if (!resolvedBookableServices.length) {
      throw new NoDataError(
        'MewsReservationService.validateRoomAvailability: No bookable services found for hotel',
      );
    }

    const requiredPerCategory = new Map<string, number>();
    for (const r of reservations) {
      const categoryId = String(r.room_id);
      requiredPerCategory.set(
        categoryId,
        (requiredPerCategory.get(categoryId) ?? 0) + 1,
      );
    }

    const { firstTimeUnitStartUtc, lastTimeUnitStartUtc } = this._buildUtcRange(
      new Date(first.check_in).toISOString(),
      new Date(first.check_out).toISOString(),
      first.hotel?.timezone,
    );
    const dailyMap = await this._buildAvailabilityMap(
      resolvedBookableServices,
      firstTimeUnitStartUtc,
      lastTimeUnitStartUtc,
      resolvedCredentials,
    );

    for (const [categoryId, requiredCount] of requiredPerCategory.entries()) {
      const daily = dailyMap.get(categoryId) ?? [];
      const minAvailable = daily.length ? Math.min(...daily) : 0;
      if (minAvailable < requiredCount) {
        const roomType = reservations.find(
          (r) => String(r.room_id) === categoryId,
        )?.room_type;
        throw new MewsRoomUnavailableError(
          `Room ${roomType || categoryId} is no longer available for the requested dates`,
        );
      }
    }

    // Callers that validate a partial date range (modification deltas) opt out
    // here and run the restriction check once over the whole stay instead —
    // length-based exceptions are meaningless against a fragment of it.
    if (options?.skipRestrictions) return;

    await this._validateRestrictions(
      {
        checkIn: new Date(first.check_in).toISOString(),
        checkOut: new Date(first.check_out).toISOString(),
        timezone: first.hotel?.timezone,
        clientId: first.hotel?.assistant_phone_number,
      },
      reservations.map((r) => ({
        bookingId: r.booking_id,
        categoryId: String(r.room_id),
        roomType: r.room_type,
        // Same precedence as createReservations: the quote's rate is the one
        // the reservation will actually be created with.
        rateId: r.quote?.quote_object?.rate_id ?? r.rate_id,
      })),
      resolvedBookableServices,
      resolvedCredentials,
      'validateRoomAvailability',
    );
  }

  /**
   * Rejects a stay that free resources say is fine but the property's
   * restrictions close — a rate shut for the arrival date, or an advance-booking
   * window the caller falls outside of. Restrictions are invisible to
   * services/getAvailability, so this is the last gate before Mews is written to.
   *
   * Takes the stay explicitly rather than a Reservation so modification paths
   * can pass the full new stay and the rate the reservation is moving *to*.
   */
  private async _validateRestrictions(
    stay: {
      checkIn: string;
      checkOut: string;
      timezone?: string;
      clientId?: string;
    },
    rooms: Array<{
      bookingId?: string;
      categoryId: string;
      roomType?: string | null;
      rateId?: number | string | null;
    }>,
    bookableServices: MewsService[],
    credentials: MewsCredentials,
    contextLabel: string,
    // Callers that already hold these pass them through — the quote paths do,
    // and re-fetching costs two round trips on a latency-sensitive call.
    preloaded?: {
      categories?: MewsResourceCategory[];
      rates?: MewsRate[];
    },
  ): Promise<void> {
    const serviceIds = bookableServices.map((s) => s.Id);
    const [categories, rates] = await Promise.all([
      preloaded?.categories ??
        mewsClient.getResourceCategories(serviceIds, credentials),
      preloaded?.rates ?? mewsClient.getRates(serviceIds, credentials),
    ]);

    const findRestriction = await this._buildRestrictionChecker(
      bookableServices,
      categories,
      rates,
      stay.checkIn,
      stay.checkOut,
      stay.timezone,
      credentials,
      contextLabel,
    );

    for (const room of rooms) {
      const blocking = findRestriction(
        room.categoryId,
        room.rateId != null ? String(room.rateId) : undefined,
      );
      if (!blocking) continue;

      logKpi({
        stat: KpiStat.PmsBookingRestrictionRejected,
        value: 1,
        contextName: `MewsReservationService.${contextLabel}`,
        clientId: stay.clientId,
        contextId: room.bookingId,
      });
      logger.warn(`${contextLabel}: blocked by Mews restriction`, {
        bookingId: room.bookingId,
        resourceCategoryId: room.categoryId,
        rateId: room.rateId,
        restrictionId: blocking.Id,
        restrictionType: blocking.Conditions.Type,
      });
      throw new MewsRestrictedError(
        `Room ${room.roomType || room.categoryId} cannot be booked for the requested dates`,
      );
    }
  }

  async getRoomAvailabilityWithQuote(
    availabilityParams: GetSingleRoomAvailabilityRequestParams & {
      external_identifier?: string;
    },
    _phoneNumber: string,
    hotelPhoneNumber: string,
  ): Promise<MewsRoomAvailability[]> {
    let { start_date: checkIn, end_date: checkOut } = availabilityParams;
    const {
      external_identifier: externalIdentifier,
      num_adults: numAdults,
      num_children: numChildren,
      num_pets: numPets = 0,
    } = availabilityParams;
    const hotel =
      await this.hotelService.getHotelByAssistantPhoneNumber(hotelPhoneNumber);
    if (!hotel) {
      throw new NoDataError(
        `MewsReservationService: Hotel not found for phone ${hotelPhoneNumber}`,
      );
    }
    const hotelConfig =
      await hotelConfigurationService.getHotelConfigurationByHotelId(hotel.id);
    ({ start_date: checkIn, end_date: checkOut } = validateAndCorrectDates(
      checkIn,
      checkOut,
      hotel.timezone,
      hotelConfig,
    ));
    const credentials = await this.resolveCredentials(hotel.id);

    // 1. Get all bookable services
    const bookableServices = await this._getBookableServices(credentials);
    if (!bookableServices.length) {
      throw new NoDataError(
        'MewsReservationService.getRoomAvailabilityWithQuote: No bookable services found for hotel',
      );
    }

    const serviceIds = bookableServices.map((s) => s.Id);

    // 2. Get all resource categories for bookable services
    const resourceCategories = await mewsClient.getResourceCategories(
      serviceIds,
      credentials,
    );
    const activeCategories = resourceCategories.filter((rc) => rc.IsActive);

    // 3. Build availability map categoryId → daily available counts
    const { firstTimeUnitStartUtc, lastTimeUnitStartUtc } = this._buildUtcRange(
      checkIn,
      checkOut,
      hotel.timezone,
    );
    const availabilityMap = await this._buildAvailabilityMap(
      bookableServices,
      firstTimeUnitStartUtc,
      lastTimeUnitStartUtc,
      credentials,
    );

    // 4. Build result: active categories with at least 1 room available on all days
    const results: MewsRoomAvailability[] = [];
    for (const category of activeCategories) {
      const dailyAvailable = availabilityMap.get(category.Id);
      if (!dailyAvailable?.length) continue;

      const minAvailable = Math.min(...dailyAvailable);
      if (minAvailable <= 0) continue;

      const name =
        category.Names['en-US'] ??
        Object.values(category.Names)[0] ??
        category.Id;
      results.push({
        resourceCategoryId: category.Id,
        serviceId: category.ServiceId,
        name,
        capacity: category.Capacity,
        extraCapacity: category.ExtraCapacity,
        availablePerDay: dailyAvailable,
        minAvailable,
        rates: [],
      });
    }

    // 5. Get rates — public rate only, or specific rate by ExternalIdentifier
    const allRates = await mewsClient.getRates(serviceIds, credentials);
    const enabledRates = allRates.filter((r) => {
      if (!r.IsActive || !r.IsEnabled) return false;
      if (externalIdentifier)
        return r.ExternalIdentifier === externalIdentifier;
      return r.IsPublic;
    });

    // 6. Fetch pricing per rate and build categoryId → MewsRatePrice[] map
    const ratePricingMap = new Map<
      string,
      ReturnType<typeof this._buildAmountPrice>[]
    >();

    const categoryById = new Map(activeCategories.map((c) => [c.Id, c]));
    const ageCategories = await mewsClient.getAgeCategories(
      serviceIds,
      credentials,
    );
    // Age categories belong to a service; availability spans multiple
    // services, so index the adult/child category per service and look up by
    // each room's ServiceId when computing its age adjustment.
    const adultCatByService = new Map<string, string>();
    const childCatByService = new Map<string, string>();
    for (const c of ageCategories) {
      if (!c.IsActive) continue;
      if (c.Classification === 'Adult' && !adultCatByService.has(c.ServiceId)) {
        adultCatByService.set(c.ServiceId, c.Id);
      }
      if (c.Classification === 'Child' && !childCatByService.has(c.ServiceId)) {
        childCatByService.set(c.ServiceId, c.Id);
      }
    }
    const guestAdults = numAdults ?? 1;
    const guestChildren = numChildren ?? 0;

    const ratePricings = await this._fetchRatePricingsInParallel(
      enabledRates,
      firstTimeUnitStartUtc,
      lastTimeUnitStartUtc,
      credentials,
      'getRoomAvailabilityWithQuote',
    );

    for (const { rate, pricing } of ratePricings) {
      const rateName = this._getRateName(rate);
      const categoriesWithPricing = new Set(
        pricing.CategoryPrices.map((cp) => cp.CategoryId),
      );

      for (const cp of pricing.CategoryPrices) {
        const category = categoryById.get(cp.CategoryId);
        const ageAdjustmentPerNight =
          this._computeAgeCategoryAdjustmentPerNight(
            pricing.AgeCategoryAdjustments,
            category?.Capacity ?? 0,
            guestAdults,
            guestChildren,
            category ? adultCatByService.get(category.ServiceId) : undefined,
            category ? childCatByService.get(category.ServiceId) : undefined,
          );
        const existing = ratePricingMap.get(cp.CategoryId) ?? [];
        existing.push(
          this._buildAmountPrice(
            rate.Id,
            rateName,
            pricing.Currency,
            cp.AmountPrices,
            ageAdjustmentPerNight,
            rate.ShortName ?? undefined,
          ),
        );
        ratePricingMap.set(cp.CategoryId, existing);
      }

      if (pricing.BaseAmountPrices.length > 0) {
        for (const category of activeCategories) {
          // Only fall back to a rate's base price for categories of that rate's
          // own service — otherwise every service's public rate leaks onto
          // every other service's room types.
          if (category.ServiceId !== rate.ServiceId) continue;
          if (!categoriesWithPricing.has(category.Id)) {
            const ageAdjustmentPerNight =
              this._computeAgeCategoryAdjustmentPerNight(
                pricing.AgeCategoryAdjustments,
                category.Capacity,
                guestAdults,
                guestChildren,
                adultCatByService.get(category.ServiceId),
                childCatByService.get(category.ServiceId),
              );
            const existing = ratePricingMap.get(category.Id) ?? [];
            existing.push(
              this._buildAmountPrice(
                rate.Id,
                rateName,
                pricing.Currency,
                pricing.BaseAmountPrices,
                ageAdjustmentPerNight,
                rate.ShortName ?? undefined,
              ),
            );
            ratePricingMap.set(category.Id, existing);
          }
        }
      }
    }

    // 7. Attach rates to results, applying the pet fee (if any) to each rate
    const petFeeSource =
      numPets > 0
        ? await this._resolvePetFeeSource(
            bookableServices,
            credentials,
            hotel,
            hotelConfig,
            numPets,
          )
        : {};
    const findRestriction = await this._buildRestrictionChecker(
      bookableServices,
      activeCategories,
      enabledRates,
      checkIn,
      checkOut,
      hotel.timezone,
      credentials,
      'getRoomAvailabilityWithQuote',
    );
    const nights = this._numNights(checkIn, checkOut);
    for (const result of results) {
      const rates = ratePricingMap.get(result.resourceCategoryId) ?? [];
      result.rates = rates.map((r) => {
        const taxes = r.taxes;
        // r.totalPrice sums Mews's tax-inclusive GrossValue; subtract taxes back
        // out so base_rate + taxes doesn't double-count tax.
        const base_rate = roundCurrency(r.totalPrice - taxes);
        const { fees } = this._calcPetFee(
          petFeeSource,
          numPets,
          checkIn,
          checkOut,
          result.resourceCategoryId,
          base_rate,
          taxes,
        );
        const total_amount = roundCurrency(base_rate + taxes + fees);
        const rate = {
          ...r,
          base_rate,
          taxes,
          totalPrice: total_amount,
          ...(fees > 0 ? { fees } : {}),
        };

        const quote: PMSQuote = {
          base_rate,
          taxes,
          fees,
          total_amount,
          amountCharged: total_amount,
        };
        this._applyInitialDepositPolicy(
          quote,
          checkIn,
          checkOut,
          hotelConfig?.initial_deposit_policy,
          rate.pricesPerNight[0] !== undefined
            ? {
                baseRate: roundCurrency(
                  rate.pricesPerNight[0] - r.firstNightTax,
                ),
                tax: r.firstNightTax,
              }
            : undefined,
        );
        return { ...rate, amountCharged: quote.amountCharged };
      });
    }

    // 8. Drop restricted rates, and the rooms left with none. A room that had
    // no rates to begin with is untouched — that is existing behaviour.
    const unrestricted = results.filter((result) => {
      if (!result.rates.length) return true;
      result.rates = result.rates.filter((rate) => {
        const blocking = findRestriction(
          result.resourceCategoryId,
          rate.rateId,
          roundCurrency(rate.totalPrice / nights),
        );
        if (blocking) {
          logger.info(
            'getRoomAvailabilityWithQuote: rate hidden by Mews restriction',
            {
              hotelId: hotel.id,
              resourceCategoryId: result.resourceCategoryId,
              rateId: rate.rateId,
              restrictionId: blocking.Id,
              restrictionType: blocking.Conditions.Type,
            },
          );
        }
        return !blocking;
      });
      return result.rates.length > 0;
    });

    // 9. Filter out rooms whose capacity cannot accommodate the requested guest count
    const totalGuests = (numAdults ?? 0) + (numChildren ?? 0);
    if (totalGuests > 0) {
      return unrestricted.filter((r) => {
        const maxCapacity = r.capacity + r.extraCapacity;
        return maxCapacity === 0 || maxCapacity >= totalGuests;
      });
    }

    return unrestricted;
  }

  async getRoomAvailabilityWithQuoteLite(
    availabilityParams: GetSingleRoomAvailabilityRequestParams & {
      external_identifier?: string;
    },
    _phoneNumber: string,
    hotelPhoneNumber: string,
  ): Promise<{ groups: { [roomName: string]: string }[] }> {
    const {
      start_date: checkIn,
      end_date: checkOut,
      num_adults: numAdults = 1,
      num_children: numChildren = 0,
      external_identifier: externalIdentifier,
      num_pets: numPets = 0,
    } = availabilityParams;
    const rooms = await this.getRoomAvailabilityWithQuote(
      availabilityParams,
      _phoneNumber,
      hotelPhoneNumber,
    );

    if (!rooms.length) {
      return { groups: [] };
    }

    const hotel =
      await this.hotelService.getHotelByAssistantPhoneNumber(hotelPhoneNumber);
    const isNoPayment =
      hotel?.payment_provider === PaymentProvider.NOT_APPLICABLE;

    const { adultsText, childrenText } = this._guestText(
      numAdults,
      numChildren,
    );
    const checkInDate = checkIn.split('T')[0];
    const checkOutDate = checkOut.split('T')[0];
    const numNights = this._numNights(checkIn, checkOut);

    const groups = rooms
      .map((room) => {
        if (!room.rates.length) return null;

        const rateDescriptions = room.rates.map((rate) => {
          const baseRate = rate.base_rate ?? rate.totalPrice;
          const taxes = rate.taxes ?? 0;
          const fees = rate.fees ?? 0;
          const averageNightlyRate = roundCurrency(baseRate / numNights);
          const averageNightlyRateText = numberToWords(
            averageNightlyRate,
            rate.currency,
          );
          const baseRateText = numberToWords(baseRate, rate.currency);
          const taxesText = numberToWords(taxes, rate.currency);
          const feesText = numberToWords(fees, rate.currency);
          const totalText = numberToWords(rate.totalPrice, rate.currency);
          let desc = `Rate ${rate.rateName}${rate.shortName ? ` (${rate.shortName})` : ''}: average nightly rate ${averageNightlyRateText}, base rate ${baseRateText} for ${numNights} night${numNights > 1 ? 's' : ''}, taxes ${taxesText}, fees ${feesText}, total ${totalText}.`;
          if (!isNoPayment) {
            const effectiveDeposit = rate.amountCharged ?? rate.totalPrice;
            desc += ` Deposit ${numberToWords(effectiveDeposit, rate.currency)}.`;
          } else {
            desc += ` No payment is required to secure this reservation.`;
          }
          return desc;
        });

        let description = `For ${adultsText} and ${childrenText}, with check-in on ${checkInDate} and check-out on ${checkOutDate}, room ${room.name} (room_id: ${room.resourceCategoryId}) has the following available rates: ${rateDescriptions.join(' ')}`;
        if (numPets > 0) {
          description += ` All amounts have the pet fees pre-applied.`;
        }

        return { [room.name]: description };
      })
      .filter((g): g is { [roomName: string]: string } => g !== null);

    return { groups };
  }

  async getRoomAvailabilityWithQuoteLiteV2(..._args: any[]): Promise<any> {
    throw new Error(
      'MewsReservationService: getRoomAvailabilityWithQuoteLiteV2 not supported',
    );
  }

  async getMultiRoomAvailabilityWithQuoteLiteV2(..._args: any[]): Promise<any> {
    throw new Error(
      'MewsReservationService: getMultiRoomAvailabilityWithQuoteLiteV2 not supported',
    );
  }

  private async _buildMultiRoomGroups(
    credentials: MewsCredentials,
    hotel: Hotel,
    hotelConfig: HotelConfiguration | null,
    checkIn: string,
    checkOut: string,
    numPets = 0,
  ): Promise<
    Array<{
      categoryId: string;
      name: string;
      capacity: number;
      extraCapacity: number;
      minAvailable: number;
      rates: Array<{
        rate_code: string;
        rate_id: string;
        rate_name: string;
        short_name?: string;
        currency: string;
        base_rate: number;
        taxes: number;
        fees: number;
        total_amount: number;
        amount_charged: number;
      }>;
    }>
  > {
    const bookableServices = await this._getBookableServices(credentials);
    if (!bookableServices.length) return [];

    const serviceIds = bookableServices.map((s) => s.Id);
    const resourceCategories = await mewsClient.getResourceCategories(
      serviceIds,
      credentials,
    );
    const activeCategories = resourceCategories.filter((rc) => rc.IsActive);

    const { firstTimeUnitStartUtc, lastTimeUnitStartUtc } = this._buildUtcRange(
      checkIn,
      checkOut,
      hotel.timezone,
    );
    const availabilityMap = await this._buildAvailabilityMap(
      bookableServices,
      firstTimeUnitStartUtc,
      lastTimeUnitStartUtc,
      credentials,
    );

    const availableCategories = activeCategories
      .map((cat) => {
        const daily = availabilityMap.get(cat.Id);
        if (!daily?.length) return null;
        const minAvailable = Math.min(...daily);
        if (minAvailable <= 0) return null;
        const name =
          cat.Names['en-US'] ?? Object.values(cat.Names)[0] ?? cat.Id;
        return { cat, name, minAvailable };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (!availableCategories.length) return [];

    const allRates = await mewsClient.getRates(serviceIds, credentials);
    const enabledRates = allRates.filter(
      (r) => r.IsActive && r.IsEnabled && r.IsPublic,
    );

    // Inner map is keyed by rate.Id — unique per rate — so rates that share a
    // blank ShortName don't overwrite each other.
    const ratePricingMap = new Map<
      string,
      Map<
        string,
        {
          base_rate: number;
          taxes: number;
          fees: number;
          total_amount: number;
          amount_charged: number;
          currency: string;
          rate_code: string;
          rate_id: string;
          rate_name: string;
          short_name?: string;
        }
      >
    >();

    const isNoPayment =
      hotel.payment_provider === PaymentProvider.NOT_APPLICABLE;

    const petFeeSource =
      numPets > 0
        ? await this._resolvePetFeeSource(
            bookableServices,
            credentials,
            hotel,
            hotelConfig,
            numPets,
          )
        : {};

    const ratePricings = await this._fetchRatePricingsInParallel(
      enabledRates,
      firstTimeUnitStartUtc,
      lastTimeUnitStartUtc,
      credentials,
      '_buildMultiRoomGroups',
    );

    for (const { rate, pricing } of ratePricings) {
      const rateName = this._getRateName(rate);
      const currency = pricing.Currency;
      // Prefer ShortName: it is what getQuote matches a caller-supplied
      // rate_code against, and what the voice agent reads out. Blank is not
      // nullish — fall through it, or the rate becomes unselectable.
      const shortName = rate.ShortName?.trim() || undefined;
      const rateCode = shortName || rate.ExternalIdentifier?.trim() || rate.Id;
      const categoriesWithPricing = new Set(
        pricing.CategoryPrices.map((cp) => cp.CategoryId),
      );

      const computeForAmountPrices = (
        amountPrices: MewsAmountPrice[],
        categoryId: string,
      ) => {
        const priceData = this._buildAmountPrice(
          rate.Id,
          rateName,
          currency,
          amountPrices,
        );
        const taxes = roundCurrency(
          amountPrices.reduce(
            (s, p) => s + p.TaxValues.reduce((ts, tv) => ts + tv.Value, 0),
            0,
          ),
        );
        // priceData.totalPrice sums Mews's GrossValue, which is already tax-inclusive
        // (GrossValue = NetValue + TaxValues) — subtract taxes back out so
        // base_rate + taxes doesn't double-count tax.
        const base_rate = roundCurrency(priceData.totalPrice - taxes);
        const { fees } = this._calcPetFee(
          petFeeSource,
          numPets,
          checkIn,
          checkOut,
          categoryId,
          base_rate,
          taxes,
        );
        const total_amount = roundCurrency(base_rate + taxes + fees);
        const quote = {
          base_rate,
          taxes,
          fees,
          total_amount,
          amountCharged: total_amount,
        };
        const firstNight = amountPrices[0]
          ? {
              baseRate: roundCurrency(
                amountPrices[0].GrossValue -
                  amountPrices[0].TaxValues.reduce((s, t) => s + t.Value, 0),
              ),
              tax: roundCurrency(
                amountPrices[0].TaxValues.reduce((s, t) => s + t.Value, 0),
              ),
            }
          : undefined;
        this._applyInitialDepositPolicy(
          quote,
          checkIn,
          checkOut,
          hotelConfig?.initial_deposit_policy,
          firstNight,
        );
        const amount_charged = isNoPayment ? 0 : quote.amountCharged;
        return {
          base_rate,
          taxes,
          fees,
          total_amount,
          amount_charged,
          currency,
          rate_code: rateCode,
          rate_id: rate.Id,
          rate_name: rateName,
          short_name: shortName,
        };
      };

      for (const cp of pricing.CategoryPrices) {
        if (!ratePricingMap.has(cp.CategoryId))
          ratePricingMap.set(cp.CategoryId, new Map());
        ratePricingMap
          .get(cp.CategoryId)!
          .set(rate.Id, computeForAmountPrices(cp.AmountPrices, cp.CategoryId));
      }

      if (pricing.BaseAmountPrices.length > 0) {
        for (const { cat } of availableCategories) {
          // Scope base-price fallback to the rate's own service (see
          // getRoomAvailabilityWithQuote) to stop cross-service rate leakage.
          if (cat.ServiceId !== rate.ServiceId) continue;
          if (!categoriesWithPricing.has(cat.Id)) {
            if (!ratePricingMap.has(cat.Id))
              ratePricingMap.set(cat.Id, new Map());
            ratePricingMap
              .get(cat.Id)!
              .set(
                rate.Id,
                computeForAmountPrices(pricing.BaseAmountPrices, cat.Id),
              );
          }
        }
      }
    }

    const findRestriction = await this._buildRestrictionChecker(
      bookableServices,
      activeCategories,
      enabledRates,
      checkIn,
      checkOut,
      hotel.timezone,
      credentials,
      '_buildMultiRoomGroups',
    );
    const nights = this._numNights(checkIn, checkOut);

    return availableCategories
      .map(({ cat, name, minAvailable }) => {
        const rateMap = ratePricingMap.get(cat.Id);
        if (!rateMap?.size) return null;
        const rates = Array.from(rateMap.values())
          .filter((p) => {
            const blocking = findRestriction(
              cat.Id,
              p.rate_id,
              roundCurrency(p.total_amount / nights),
            );
            if (blocking) {
              logger.info(
                '_buildMultiRoomGroups: rate hidden by Mews restriction',
                {
                  hotelId: hotel.id,
                  resourceCategoryId: cat.Id,
                  rateId: p.rate_id,
                  restrictionId: blocking.Id,
                  restrictionType: blocking.Conditions.Type,
                },
              );
            }
            return !blocking;
          })
          .map((p) => ({
            rate_code: p.rate_code,
            rate_id: p.rate_id,
            rate_name: p.rate_name,
            short_name: p.short_name,
            currency: p.currency,
            base_rate: p.base_rate,
            taxes: p.taxes,
            fees: p.fees,
            total_amount: p.total_amount,
            amount_charged: p.amount_charged,
          }));
        if (!rates.length) return null;
        return {
          categoryId: cat.Id,
          name,
          capacity: cat.Capacity,
          extraCapacity: cat.ExtraCapacity,
          minAvailable,
          rates,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  async getMultiRoomAvailabilityWithQuote(
    availabilityParams: GetAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionType: SessionType,
  ): Promise<any> {
    let { start_date, end_date } = availabilityParams;
    const { num_pets: numPets = 0 } = availabilityParams;

    const hotel =
      await this.hotelService.getHotelByAssistantPhoneNumber(hotelPhoneNumber);
    if (!hotel) {
      throw new NoDataError(
        `MewsReservationService.getMultiRoomAvailabilityWithQuote: Hotel not found for phone ${hotelPhoneNumber}`,
      );
    }

    const credentials = await this.resolveCredentials(hotel.id);
    const hotelConfig =
      await hotelConfigurationService.getHotelConfigurationByHotelId(hotel.id);
    ({ start_date, end_date } = validateAndCorrectDates(
      start_date,
      end_date,
      hotel.timezone,
      hotelConfig,
    ));

    const groups = await this._buildMultiRoomGroups(
      credentials,
      hotel,
      hotelConfig,
      start_date,
      end_date,
      numPets,
    );

    logger.info(
      'MewsReservationService.getMultiRoomAvailabilityWithQuote: fetched',
      { roomTypeCount: groups.length },
    );

    return {
      groups: groups.map((g) => ({
        room_id: g.categoryId,
        room_name: g.name,
        max_occupancy: g.capacity + g.extraCapacity || null,
        available_units: g.minAvailable,
        rates: g.rates,
      })),
      discount: null,
    };
  }

  async getMultiRoomAvailabilityWithQuoteLite(
    availabilityParams: GetAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionType: SessionType,
  ): Promise<any> {
    let { start_date, end_date } = availabilityParams;
    const { num_pets: numPets = 0 } = availabilityParams;

    const hotel =
      await this.hotelService.getHotelByAssistantPhoneNumber(hotelPhoneNumber);
    if (!hotel) {
      throw new NoDataError(
        `MewsReservationService.getMultiRoomAvailabilityWithQuoteLite: Hotel not found for phone ${hotelPhoneNumber}`,
      );
    }

    const credentials = await this.resolveCredentials(hotel.id);
    const hotelConfig =
      await hotelConfigurationService.getHotelConfigurationByHotelId(hotel.id);
    ({ start_date, end_date } = validateAndCorrectDates(
      start_date,
      end_date,
      hotel.timezone,
      hotelConfig,
    ));

    const groups = await this._buildMultiRoomGroups(
      credentials,
      hotel,
      hotelConfig,
      start_date,
      end_date,
      numPets,
    );

    if (!groups.length) return { groups: [], discount: null };

    const isNoPayment =
      hotel.payment_provider === PaymentProvider.NOT_APPLICABLE;
    const checkInDate = start_date.split('T')[0];
    const checkOutDate = end_date.split('T')[0];
    const numNights = this._numNights(start_date, end_date);

    const liteGroups = groups.map((g) => {
      const rateDescriptions = g.rates.map((rate) => {
        const cur = rate.currency;
        const avgNightly = roundCurrency(rate.base_rate / numNights);
        const avgNightlyText = numberToWords(avgNightly, cur);
        const baseRateText = numberToWords(rate.base_rate, cur);
        const taxesText = numberToWords(rate.taxes, cur);
        const totalText = numberToWords(rate.total_amount, cur);
        const petFeeText =
          rate.fees > 0 ? ` pet fee ${numberToWords(rate.fees, cur)},` : '';

        let desc = `Rate ${rate.rate_name}${rate.short_name ? ` (${rate.short_name})` : ''}: average nightly rate ${avgNightlyText}, base rate ${baseRateText} for ${numNights} night${numNights > 1 ? 's' : ''}, taxes ${taxesText},${petFeeText} total ${totalText}.`;
        if (!isNoPayment) {
          desc += ` Deposit ${numberToWords(rate.amount_charged, cur)}.`;
        } else {
          desc += ` No payment is required to secure this reservation.`;
        }
        return desc;
      });

      const maxOccupancyText = g.capacity
        ? ` The maximum occupancy of the room is ${g.capacity === 1 ? '1 person' : `${g.capacity} people`}.`
        : '';
      const availText =
        g.minAvailable === 1
          ? '1 unit is available'
          : `${g.minAvailable} units are available`;
      const limitText =
        g.minAvailable === 1
          ? 'You cannot book beyond the 1 available unit.'
          : `You cannot book beyond the ${g.minAvailable} available units.`;

      let description = `For room ${g.name} (room_id: ${g.categoryId}), ${availText}, with check-in on ${checkInDate} and check-out on ${checkOutDate}, the following rates are available (prices shown are for one adult): ${rateDescriptions.join(' ')}${maxOccupancyText} ${limitText}`;
      if (numPets > 0) {
        description += ` All amounts have the pet fees pre-applied.`;
      }

      return { [g.name]: description };
    });

    logger.info(
      'MewsReservationService.getMultiRoomAvailabilityWithQuoteLite: fetched',
      { roomTypeCount: liteGroups.length },
    );

    return { groups: liteGroups, discount: null };
  }

  async getAllRatesForRoomType(
    availabilityParams: {
      start_date: string;
      end_date: string;
      num_adults?: number;
      num_children?: number;
      num_pets?: number;
    },
    roomId: string | number,
    _phoneNumber: string,
    hotelPhoneNumber: string,
  ): Promise<{ groups: { [roomName: string]: string }[] }> {
    let { start_date: checkIn, end_date: checkOut } = availabilityParams;
    const {
      num_adults: numAdults = 1,
      num_children: numChildren = 0,
      num_pets: numPets = 0,
    } = availabilityParams;
    const resourceCategoryId = String(roomId);
    const hotel =
      await this.hotelService.getHotelByAssistantPhoneNumber(hotelPhoneNumber);
    if (!hotel) {
      throw new NoDataError(
        `MewsReservationService: Hotel not found for phone ${hotelPhoneNumber}`,
      );
    }
    const credentials = await this.resolveCredentials(hotel.id);

    const bookableServices = await this._getBookableServices(credentials);
    if (!bookableServices.length) {
      return { groups: [] };
    }

    const serviceIds = bookableServices.map((s) => s.Id);

    const [resourceCategories, hotelConfig] = await Promise.all([
      mewsClient.getResourceCategories(serviceIds, credentials),
      hotelConfigurationService.getHotelConfigurationByHotelId(hotel.id),
    ]);
    ({ start_date: checkIn, end_date: checkOut } = validateAndCorrectDates(
      checkIn,
      checkOut,
      hotel.timezone,
      hotelConfig,
    ));
    const isNoPayment =
      hotel.payment_provider === PaymentProvider.NOT_APPLICABLE;
    const category = resourceCategoryId
      ? resourceCategories.find(
          (rc) => rc.IsActive && rc.Id === resourceCategoryId,
        )
      : undefined;
    if (!category) {
      return { groups: [] };
    }

    const { firstTimeUnitStartUtc, lastTimeUnitStartUtc } = this._buildUtcRange(
      checkIn,
      checkOut,
      hotel.timezone,
    );
    const availabilityMap = await this._buildAvailabilityMap(
      bookableServices,
      firstTimeUnitStartUtc,
      lastTimeUnitStartUtc,
      credentials,
    );
    const daily = resourceCategoryId
      ? (availabilityMap.get(resourceCategoryId) ?? [])
      : [];
    if (!daily.length || Math.min(...daily) <= 0) {
      return { groups: [] };
    }

    // Get ALL public rates for this room's service (no code filter). Rate +
    // age category must belong to the category's own service.
    const roomServiceId = category.ServiceId;
    const allRates = await mewsClient.getRates([roomServiceId], credentials);
    const enabledRates = allRates.filter(
      (r) =>
        r.IsActive &&
        r.IsEnabled &&
        r.IsPublic &&
        r.ServiceId === roomServiceId,
    );

    const ageCategories = await mewsClient.getAgeCategories(
      serviceIds,
      credentials,
    );
    const serviceAgeCategories = ageCategories.filter(
      (c) => c.ServiceId === roomServiceId,
    );
    const adultCat = serviceAgeCategories.find(
      (c) => c.IsActive && c.Classification === 'Adult',
    );
    const childCat = serviceAgeCategories.find(
      (c) => c.IsActive && c.Classification === 'Child',
    );

    const numNights = this._numNights(checkIn, checkOut);
    const petFeeSource =
      numPets > 0
        ? await this._resolvePetFeeSource(
            bookableServices,
            credentials,
            hotel,
            hotelConfig,
            numPets,
          )
        : {};
    const rateDescriptions: string[] = [];

    // Without this the agent reads out rates that getRoomAvailabilityWithQuote
    // hides, so the two answers contradict each other for the same dates.
    const findRestriction = await this._buildRestrictionChecker(
      bookableServices,
      resourceCategories,
      enabledRates,
      checkIn,
      checkOut,
      hotel.timezone,
      credentials,
      'getAllRatesForRoomType',
    );

    for (const rate of enabledRates) {
      let pricing: MewsGetRatePricingResponse;
      try {
        pricing = await mewsClient.getRatePricing(
          { rateId: rate.Id, firstTimeUnitStartUtc, lastTimeUnitStartUtc },
          credentials,
        );
      } catch (error) {
        logger.warn(
          'getAllRatesForRoomType: getRatePricing failed for rate, skipping',
          {
            rateId: rate.Id,
            error: error instanceof Error ? error.message : String(error),
            mewsRequestId: getMewsRequestId(error),
          },
        );
        continue;
      }

      const categoryPricing = pricing.CategoryPrices.find(
        (cp) => cp.CategoryId === resourceCategoryId,
      );
      const amountPrices =
        categoryPricing?.AmountPrices ?? pricing.BaseAmountPrices;
      if (!amountPrices.length) continue;

      const ageAdjustmentPerNight = this._computeAgeCategoryAdjustmentPerNight(
        pricing.AgeCategoryAdjustments,
        category.Capacity,
        numAdults,
        numChildren,
        adultCat?.Id,
        childCat?.Id,
      );
      const { currency, totalPrice, taxes, firstNightTax, pricesPerNight } =
        this._buildAmountPrice(
          rate.Id,
          this._getRateName(rate),
          pricing.Currency,
          amountPrices,
          ageAdjustmentPerNight,
        );
      const base_rate = roundCurrency(totalPrice - taxes);
      const { fees } = this._calcPetFee(
        petFeeSource,
        numPets,
        checkIn,
        checkOut,
        resourceCategoryId,
        base_rate,
        taxes,
      );
      const totalWithFees = roundCurrency(base_rate + taxes + fees);
      const blocking = findRestriction(
        resourceCategoryId,
        rate.Id,
        roundCurrency(totalWithFees / numNights),
      );
      if (blocking) {
        logger.info('getAllRatesForRoomType: rate hidden by Mews restriction', {
          hotelId: hotel.id,
          resourceCategoryId,
          rateId: rate.Id,
          restrictionId: blocking.Id,
          restrictionType: blocking.Conditions.Type,
        });
        continue;
      }
      const quote = {
        base_rate,
        taxes,
        fees,
        total_amount: totalWithFees,
        amountCharged: totalWithFees,
      };
      const firstNight = pricesPerNight[0]
        ? {
            baseRate: roundCurrency(pricesPerNight[0] - firstNightTax),
            tax: firstNightTax,
          }
        : undefined;
      this._applyInitialDepositPolicy(
        quote,
        checkIn,
        checkOut,
        hotelConfig?.initial_deposit_policy,
        firstNight,
      );
      const deposit = isNoPayment ? 0 : quote.amountCharged;

      const avgText = numberToWords(totalPrice / numNights, currency);
      const baseRateText = numberToWords(base_rate, currency);
      const taxesText = numberToWords(taxes, currency);
      const totalText = numberToWords(totalWithFees, currency);
      const rateName = this._getRateName(rate);

      const petFeeText =
        fees > 0 ? ` pet fee ${numberToWords(fees, currency)},` : '';
      let rateDesc = `Rate ${rateName}${rate.ShortName ? ` (${rate.ShortName})` : ''}: average nightly rate ${avgText}, base rate ${baseRateText} for ${numNights} night${numNights > 1 ? 's' : ''}, taxes ${taxesText},${petFeeText} total ${totalText}.`;
      rateDesc += isNoPayment
        ? ' No payment is required to secure this reservation.'
        : ` Deposit ${numberToWords(deposit, currency)}.`;
      rateDescriptions.push(rateDesc);
    }

    if (!rateDescriptions.length) {
      return { groups: [] };
    }

    const { adultsText, childrenText } = this._guestText(
      numAdults,
      numChildren,
    );
    const checkInDate = checkIn.split('T')[0];
    const checkOutDate = checkOut.split('T')[0];
    const categoryName =
      category.Names['en-US'] ??
      Object.values(category.Names)[0] ??
      resourceCategoryId;

    const description = `For ${adultsText} and ${childrenText}, with check-in on ${checkInDate} and check-out on ${checkOutDate}, room ${categoryName} (room_id: ${resourceCategoryId}) has the following available rates: ${rateDescriptions.join(' ')}`;

    return { groups: [{ [categoryName]: description }] };
  }

  async getWebRoomAvailabilityV2(): Promise<never> {
    throw new Error('Not implemented');
  }

  // Validates + batches a multi-room booking in one reservations/add call (one group, atomic).
  // Not on IPMSReservationService; called directly by finalizePmsReservations for Mews multi-room.
  async createReservationsForBooking(reservations: Reservation[]): Promise<
    Array<{
      booking_id: string;
      reservation_id: string;
      external_public_id: string;
    }>
  > {
    for (const reservation of reservations) {
      validateReservationForCreation(reservation);
    }

    return this.createReservations(
      reservations.map((r) => ({
        reservation: r,
        customer: r.customer,
        quote: r.quote!,
        discount: r.discount,
        notes_from_partner: r.notes_from_partner,
      })),
    );
  }

  /**
   * Throws if any reservation's Mews StartUtc has already passed.
   *
   * Called before the card is captured. The hotel-level same-day cutoff already
   * covers this for configured hotels, but hotels with no
   * same_day_booking_configuration have no such guard, and for them a late
   * booking would otherwise capture the card and only then hit the Mews
   * rejection.
   */
  async assertReservationStartsInFuture(
    reservations: Reservation[],
    credentials?: MewsCredentials,
    bookableServices?: MewsService[],
  ): Promise<void> {
    const first = reservations[0];
    if (!first) return;

    const hotelId = first.hotel_id ?? first.hotel?.id;
    if (!hotelId) return;
    const hotel = await this.hotelService.getHotelById(hotelId);
    if (!hotel?.timezone) return;

    const resolvedCredentials =
      credentials ?? (await this.resolveCredentials(hotelId));
    const services =
      bookableServices ??
      (await this._getBookableServices(resolvedCredentials));
    if (!services.length) return;

    const resourceCategories = await mewsClient.getResourceCategories(
      services.map((s) => s.Id),
      resolvedCredentials,
    );
    const categoryServiceById = new Map(
      resourceCategories.map((rc) => [rc.Id, rc.ServiceId]),
    );
    const serviceById = new Map(services.map((s) => [s.Id, s]));
    const now = dayjs();

    for (const reservation of reservations) {
      const serviceId = categoryServiceById.get(String(reservation.room_id));
      const { startOffsetMinutes } = getMewsServiceTimeOffsets(
        serviceById.get(serviceId ?? ''),
      );
      const startUtc = toHotelLocalTimeUtc(
        dayjs(reservation.check_in).format('YYYY-MM-DD'),
        hotel.timezone,
        startOffsetMinutes ?? 0,
      );
      if (!dayjs(startUtc).isAfter(now)) {
        logKpi({
          stat: KpiStat.PmsBookingPastStartRejected,
          value: 1,
          contextName: 'MewsReservationService.assertReservationStartsInFuture',
          clientId: hotel.assistant_phone_number ?? hotel.id,
          contextId: reservation.booking_id,
        });
        throw new MewsPastStartUtcError(
          `MewsReservationService.assertReservationStartsInFuture: check-in for booking ${reservation.booking_id} starts at ${startUtc}, which has already passed; this stay can no longer be booked`,
        );
      }
    }
  }

  // Batched variant — sends all reservations in one reservations/add call (one group, atomic).
  // Not on IPMSReservationService; called directly by createReservationsForBooking for Mews multi-room.
  async createReservations(
    paramsList: CreateReservationParams[],
    credentials?: MewsCredentials,
    bookableServices?: MewsService[],
    skipAvailabilityValidation = false,
  ): Promise<
    Array<{
      booking_id: string;
      reservation_id: string;
      external_public_id: string;
    }>
  > {
    if (!paramsList.length) return [];

    const { reservation: firstReservation } = paramsList[0];

    const hotel = await this.hotelService.getHotelById(
      firstReservation.hotel_id,
    );
    if (!hotel) {
      throw new NoDataError(
        `MewsReservationService.createReservations: Hotel not found for id ${firstReservation.hotel_id}`,
      );
    }
    const resolvedCredentials =
      credentials ?? (await this.resolveCredentials(firstReservation.hotel_id));

    // 1. Get bookable services once
    const resolvedBookableServices =
      bookableServices ??
      (await this._getBookableServices(resolvedCredentials));
    if (!resolvedBookableServices.length) {
      throw new NoDataError(
        'MewsReservationService.createReservations: No bookable services found for hotel',
      );
    }

    // 2. Validate availability for all rooms (reusing resolved credentials/services),
    // unless the caller already validated (e.g. createReservation delegating here).
    if (!skipAvailabilityValidation) {
      await this.validateRoomAvailability(
        paramsList.map((p) => p.reservation),
        resolvedCredentials,
        resolvedBookableServices,
      );
    }

    const serviceIds = resolvedBookableServices.map((s) => s.Id);
    const primaryServiceId = resolvedBookableServices[0].Id;

    // 3. Get age categories once (scoped per room's service below — age
    // categories belong to a service, so a global pick can send another
    // service's category and Mews rejects it).
    const ageCategories = await mewsClient.getAgeCategories(
      serviceIds,
      resolvedCredentials,
    );

    // 4. Get all rates + resource categories once. Categories map each
    // room_id (resourceCategoryId) to its service so the public rate can be
    // scoped to that service — a global public rate would attach another
    // service's rate to the room (wrong price / wrong rate_code).
    const resourceCategories = await mewsClient.getResourceCategories(
      serviceIds,
      resolvedCredentials,
    );
    const categoryServiceById = new Map(
      resourceCategories.map((rc) => [rc.Id, rc.ServiceId]),
    );
    // Fetch rates only for the services the booked rooms actually belong to —
    // scopes rate selection and avoids the getAll Count cap dropping a
    // service's rates when many services exist.
    const bookedServiceIds = [
      ...new Set(
        paramsList
          .map((p) => categoryServiceById.get(String(p.reservation.room_id)))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const allRates = await mewsClient.getRates(
      bookedServiceIds.length ? bookedServiceIds : serviceIds,
      resolvedCredentials,
    );

    // 5. Build one reservation item per room
    const reservationItems: MewsAddReservationItem[] = [];
    const serviceById = new Map(resolvedBookableServices.map((s) => [s.Id, s]));
    const unusableOffsetServiceIds = new Set<string>();

    for (const { reservation, notes_from_partner } of paramsList) {
      const roomServiceId = categoryServiceById.get(
        String(reservation.room_id),
      );
      // Age categories and rate both belong to the room's own service — using
      // another service's would make Mews reject the reservation with a 400.
      const serviceAgeCategories = ageCategories.filter(
        (c) => c.ServiceId === roomServiceId,
      );
      const adultCat = serviceAgeCategories.find(
        (c) => c.IsActive && c.Classification === 'Adult',
      );
      const childCat = serviceAgeCategories.find(
        (c) => c.IsActive && c.Classification === 'Child',
      );

      const personCounts: { AgeCategoryId: string; Count: number }[] = [];
      if (adultCat) {
        const numChildren = reservation.num_children ?? 0;
        const foldChildrenIntoAdult = !childCat && numChildren > 0;
        personCounts.push({
          AgeCategoryId: adultCat.Id,
          Count: foldChildrenIntoAdult
            ? reservation.num_adults + numChildren
            : reservation.num_adults,
        });
        if (childCat && numChildren > 0) {
          personCounts.push({
            AgeCategoryId: childCat.Id,
            Count: numChildren,
          });
        }
      } else if (serviceAgeCategories.length > 0) {
        const firstActive =
          serviceAgeCategories.find((c) => c.IsActive) ??
          serviceAgeCategories[0];
        personCounts.push({
          AgeCategoryId: firstActive.Id,
          Count: reservation.num_adults + (reservation.num_children ?? 0),
        });
      }
      if (!personCounts.length) {
        throw new NoDataError(
          `MewsReservationService.createReservations: No age categories for booking ${reservation.booking_id}`,
        );
      }

      const defaultRate = allRates.find(
        (r) =>
          r.IsActive &&
          r.IsEnabled &&
          r.IsPublic &&
          r.ServiceId === roomServiceId,
      );
      const rateId =
        reservation.quote?.quote_object?.rate_id ?? defaultRate?.Id;
      if (!rateId) {
        throw new NoDataError(
          `MewsReservationService.createReservations: No rate found for booking ${reservation.booking_id}`,
        );
      }

      const mewsPayment = reservation.payments?.find(
        (p) => p.metadata?.mews_account_id,
      );
      const customerId = mewsPayment?.metadata?.mews_account_id;
      if (!customerId) {
        throw new NoDataError(
          `MewsReservationService.createReservations: mews_account_id missing for booking ${reservation.booking_id}`,
        );
      }
      const creditCardId = mewsPayment?.metadata?.mews_credit_card_id;

      // StartUtc must reach the service's own check-in time (time unit start +
      // StartOffset). Mews rejects anything earlier as unavailable, even with a
      // free room. EndUtc stays on the unit boundary — that is the shape the
      // property accepts today and it keeps the night count unchanged.
      const bookedService = serviceById.get(roomServiceId ?? '');
      const offsets = getMewsServiceTimeOffsets(bookedService);
      if (isUnusableStartOffset(offsets)) {
        unusableOffsetServiceIds.add(roomServiceId ?? 'unknown');
      }
      const startUtc = toHotelLocalTimeUtc(
        dayjs(reservation.check_in).format('YYYY-MM-DD'),
        hotel.timezone,
        offsets.startOffsetMinutes ?? 0,
      );
      const endUtc = toHotelMidnightUtc(
        dayjs(reservation.check_out).format('YYYY-MM-DD'),
        hotel.timezone,
      );
      const notes =
        [notes_from_partner, reservation.customer_special_request]
          .filter(Boolean)
          .join('\n') || undefined;

      reservationItems.push({
        Identifier: reservation.booking_id,
        StartUtc: startUtc,
        EndUtc: endUtc,
        CustomerId: customerId,
        RequestedCategoryId: String(reservation.room_id),
        RateId: String(rateId),
        PersonCounts: personCounts,
        ...(creditCardId && { CreditCardId: creditCardId }),
        ...(notes && { Notes: notes }),
        ...(reservation.quote?.quote_object?.pet_product_id && {
          ProductOrders: [
            {
              ProductId: reservation.quote.quote_object.pet_product_id,
              Count: reservation.quote.quote_object.pet_product_count ?? 1,
              StartUtc: startUtc,
              EndUtc: endUtc,
            },
          ],
        }),
      });
    }

    // 6. Single batched call — all rooms in one group. The group ServiceId
    // must be the service the booked rooms belong to (not just the first
    // bookable service) or Mews rejects the category/rate as out-of-service.
    if (bookedServiceIds.length > 1) {
      throw new BadRequestError(
        `MewsReservationService.createReservations: booking spans multiple services (${bookedServiceIds.join(', ')}); a single reservations/add group supports one service`,
      );
    }
    const groupServiceId = bookedServiceIds[0] ?? primaryServiceId;

    if (unusableOffsetServiceIds.size) {
      logger.warn(
        `MewsReservationService.createReservations: StartOffset present but unusable for service(s) ${[
          ...unusableOffsetServiceIds,
        ].join(', ')}; falling back to hotel midnight`,
      );
    }
    logger.info(
      `MewsReservationService.createReservations: reservation intervals ${JSON.stringify(
        reservationItems.map((i) => ({
          identifier: i.Identifier,
          startUtc: i.StartUtc,
          endUtc: i.EndUtc,
        })),
      )}`,
    );

    // Mews refuses a start that has already passed. Fail here with a readable
    // error rather than letting it surface as an opaque "no availability" 403
    // after the guest's card has been captured.
    const now = dayjs();
    const staleItem = reservationItems.find(
      (i) => !dayjs(i.StartUtc).isAfter(now),
    );
    if (staleItem) {
      logKpi({
        stat: KpiStat.PmsBookingPastStartRejected,
        value: 1,
        contextName: 'MewsReservationService.createReservations',
        clientId: hotel.assistant_phone_number ?? hotel.id,
        contextId: staleItem.Identifier,
      });
      throw new MewsPastStartUtcError(
        `MewsReservationService.createReservations: reservation ${staleItem.Identifier} starts at ${staleItem.StartUtc}, which is not in the future; Mews will reject it`,
      );
    }

    const addResponse = await mewsClient.addReservations(
      {
        ServiceId: groupServiceId,
        SendConfirmationEmail: false,
        Reservations: reservationItems,
      },
      resolvedCredentials,
    );

    const results: Array<{
      booking_id: string;
      reservation_id: string;
      external_public_id: string;
    }> = [];
    for (const added of addResponse.Reservations) {
      if (!added?.Reservation?.Id) {
        throw new NoDataError(
          'MewsReservationService.createReservations: Mews did not return a reservation ID for one or more items',
        );
      }
      results.push({
        booking_id: added.Identifier ?? '',
        reservation_id: added.Reservation.Id,
        external_public_id: added.Reservation.Number,
      });

      const { reservation } =
        paramsList.find((p) => p.reservation.booking_id === added.Identifier) ??
        {};
      if (reservation?.quote?.quote_object?.pet_product_id) {
        logKpi({
          stat: KpiStat.PmsProductAdded,
          value: 1,
          contextName: 'MewsReservationService.createReservations',
          clientId: hotel.assistant_phone_number ?? hotel.id,
          contextId: reservation.booking_id,
        });
      }
    }

    logger.info(
      'MewsReservationService.createReservations: All reservations created in one group',
      {
        count: results.length,
        reservation_ids: results.map((r) => r.reservation_id),
      },
    );

    logKpi({
      stat: 'mews_reservation_created',
      value: results.length,
      contextName: 'MewsReservationService.createReservations',
      clientId: hotel.assistant_phone_number ?? hotel.id,
    });

    return results;
  }

  // Single-room entry point on IPMSReservationService — delegates to the batched
  // createReservations (a single-item paramsList) so both paths build the exact
  // same Mews request instead of maintaining two divergent implementations.
  async createReservation(
    params: CreateReservationParams,
  ): Promise<CreateReservationResponse> {
    const { reservation } = params;

    const credentials = await this.resolveCredentials(reservation.hotel_id);
    const bookableServices = await this._getBookableServices(credentials);
    if (!bookableServices.length) {
      throw new NoDataError(
        'MewsReservationService.createReservation: No bookable services found for hotel',
      );
    }

    // Occupancy check is single-room-specific — createReservations has no equivalent
    // since multi-room occupancy is validated by the caller before batching.
    await this.validateSingleRoomOccupancy(
      String(reservation.room_id),
      reservation.num_adults,
      reservation.num_children ?? 0,
      reservation.business_id,
      credentials,
      bookableServices,
    );
    await this.validateRoomAvailability(
      [reservation],
      credentials,
      bookableServices,
    );

    const [result] = await this.createReservations(
      [params],
      credentials,
      bookableServices,
      /* skipAvailabilityValidation */ true,
    );
    if (!result) {
      throw new NoDataError(
        'MewsReservationService.createReservation: Mews did not return a reservation ID',
      );
    }

    return {
      reservation_id: result.reservation_id,
      external_public_id: result.external_public_id,
    };
  }

  async cancelReservation(params: {
    business_id: string;
    external_id: string;
    internal_id: string;
    reason?: string;
  }): Promise<{ status: boolean; reservation_id: string }> {
    const { external_id, business_id, reason } = params;

    if (!external_id) {
      throw new BadRequestError(
        'MewsReservationService.cancelReservation: external_id is required',
      );
    }

    const hotel = await this.hotelService.getHotelByBusinessId(business_id);
    if (!hotel) {
      throw new NoDataError(
        `MewsReservationService.cancelReservation: Hotel not found for business_id ${business_id}`,
      );
    }

    const credentials = await this.resolveCredentials(hotel.id);

    logger.info(
      'MewsReservationService.cancelReservation: Cancelling reservation',
      {
        external_id,
        internal_id: params.internal_id,
      },
    );

    await mewsClient.cancelReservations(
      {
        ReservationIds: [external_id],
        Notes: reason ?? 'Cancelled via Dextr',
        PostCancellationFee: false,
        SendEmail: false,
      },
      credentials,
    );

    logger.info(
      'MewsReservationService.cancelReservation: Reservation cancelled',
      {
        external_id,
        internal_id: params.internal_id,
      },
    );

    logKpi({
      stat: 'mews_reservation_cancelled',
      value: 1,
      contextName: 'MewsReservationService.cancelReservation',
      clientId: hotel.assistant_phone_number ?? hotel.id,
      contextId: external_id,
    });

    return { status: true, reservation_id: external_id };
  }

  async modifyReservation(
    reservationDetails: Reservation,
    newCheckIn: string,
    newCheckOut: string,
    discount: Discount | null,
    newRoomTypeId?: string | number,
    newRateId?: string,
    numPetsToAdd?: number,
  ): Promise<PMSQuote> {
    const externalId = reservationDetails.external_id;
    if (!externalId) {
      throw new BadRequestError(
        'MewsReservationService.modifyReservation: external_id is required',
      );
    }

    const hotelId = reservationDetails.hotel_id ?? reservationDetails.hotel?.id;
    if (!hotelId) {
      throw new BadRequestError(
        'MewsReservationService.modifyReservation: hotel_id is required',
      );
    }

    logger.info(
      'MewsReservationService.modifyReservation: Modifying reservation',
      {
        external_id: externalId,
        booking_id: reservationDetails.booking_id,
        newCheckIn,
        newCheckOut,
      },
    );

    const hotel = await this.hotelService.getHotelById(hotelId);
    if (!hotel) {
      throw new NoDataError(
        'MewsReservationService.modifyReservation: Hotel not found',
      );
    }
    const credentials = await this.resolveCredentials(hotel.id);

    // Fetched up front so the StartUtc below can read the room's service offsets;
    // the pet branch reuses both instead of fetching them again.
    const bookableServices = await this._getBookableServices(credentials);
    const modResourceCategories = await mewsClient.getResourceCategories(
      bookableServices.map((s) => s.Id),
      credentials,
    );
    // The product added must belong to the reservation's service, so scope
    // the pet-product lookup to the (possibly changed) room's service.
    const effectiveRoomId = String(newRoomTypeId ?? reservationDetails.room_id);
    const roomServiceId = modResourceCategories.find(
      (rc) => rc.Id === effectiveRoomId,
    )?.ServiceId;

    const newQuote = await this.getQuoteForModification(
      reservationDetails,
      newCheckIn,
      newCheckOut,
      discount,
      newRoomTypeId,
      newRateId,
      credentials,
      bookableServices,
    );

    // Same StartOffset rule as createReservations — Mews rejects a start earlier
    // than the service's check-in time.
    const modOffsets = getMewsServiceTimeOffsets(
      bookableServices.find((s) => s.Id === roomServiceId),
    );
    if (isUnusableStartOffset(modOffsets)) {
      logger.warn(
        `MewsReservationService.modifyReservation: StartOffset present but unusable for service ${roomServiceId}; falling back to hotel midnight`,
      );
    }
    const startUtc = toHotelLocalTimeUtc(
      dayjs(newCheckIn).format('YYYY-MM-DD'),
      hotel.timezone,
      modOffsets.startOffsetMinutes ?? 0,
    );
    const endUtc = toHotelMidnightUtc(
      dayjs(newCheckOut).format('YYYY-MM-DD'),
      hotel.timezone,
    );

    const updateItem: MewsUpdateReservationItem = {
      ReservationId: externalId,
      StartUtc: { Value: startUtc },
      EndUtc: { Value: endUtc },
      ...(newRoomTypeId && {
        RequestedCategoryId: { Value: String(newRoomTypeId) },
      }),
      ...(newRateId && { RateId: { Value: newRateId } }),
    };

    await mewsClient.updateReservations(
      {
        ReservationUpdates: [updateItem],
        Reprice: true,
        Reason: 'Modified via Dextr',
      },
      credentials,
    );

    logger.info(
      'MewsReservationService.modifyReservation: Reservation updated in Mews',
      {
        external_id: externalId,
        newCheckIn,
        newCheckOut,
      },
    );

    logKpi({
      stat: 'mews_reservation_modified',
      value: 1,
      contextName: 'MewsReservationService.modifyReservation',
      clientId: hotel.assistant_phone_number ?? hotel.id,
      contextId: externalId,
    });

    // Add-only for now: Mews has no in-place count decrement, and the only
    // removal path (orderItems/cancel) is still beta. To support an absolute
    // target (reduce as well as add), read current pet order items via
    // orderItems/getAll, then cancel down / addProduct up — once cancel is GA.
    if (numPetsToAdd && numPetsToAdd > 0) {
      const hotelConfig =
        await hotelConfigurationService.getHotelConfigurationByHotelId(
          hotel.id,
        );
      const petProduct = await this._getPetProduct(
        roomServiceId
          ? bookableServices.filter((s) => s.Id === roomServiceId)
          : bookableServices,
        credentials,
        hotelConfig?.pet_fee_configuration?.mews_pet_product_id,
      );
      const nights = this._numNights(newCheckIn, newCheckOut);
      // Cap is on the post-modification total, not just the delta being added.
      const totalPets = (reservationDetails.num_pets ?? 0) + numPetsToAdd;

      let addedFee: number;
      if (petProduct) {
        this._validateMaxPets(
          totalPets,
          hotelConfig?.pet_fee_configuration?.max_pets_per_room,
        );
        const { fees, count } = computeMewsPetProductFee(
          petProduct.ChargingMode,
          petProduct.Price.GrossValue,
          numPetsToAdd,
          nights,
        );
        addedFee = fees;
        await mewsClient.addProduct(
          {
            ReservationId: externalId,
            ProductId: petProduct.Id,
            Count: count,
            StartUtc: startUtc,
            EndUtc: endUtc,
          },
          credentials,
        );
        logKpi({
          stat: KpiStat.PmsProductAdded,
          value: 1,
          contextName: 'MewsReservationService.modifyReservation',
          clientId: hotel.assistant_phone_number ?? hotel.id,
          contextId: externalId,
        });
      } else {
        const petStrategy = getPetFeeStrategy(
          hotel.id,
          hotelConfig?.pet_fee_configuration,
        );
        if (!petStrategy) {
          throw new BadRequestError(
            'MewsReservationService.modifyReservation: No Mews pet product or pet fee configuration found for this hotel — cannot add pet',
          );
        }
        const quoteAdapter = {
          check_in: newCheckIn,
          check_out: newCheckOut,
          unit_group_id:
            Number(newRoomTypeId ?? reservationDetails.room_id) || 0,
          base_rate: newQuote.base_rate,
          taxes: newQuote.taxes,
          fees: newQuote.fees,
          total_amount: newQuote.base_rate + newQuote.taxes,
          amountCharged: newQuote.base_rate + newQuote.taxes,
        };
        petStrategy.validatePetCount(totalPets);
        addedFee = roundCurrency(
          petStrategy.calculatePetFee(quoteAdapter, numPetsToAdd) || 0,
        );
      }

      newQuote.fees = roundCurrency(newQuote.fees + addedFee);
      newQuote.total_amount = roundCurrency(
        newQuote.base_rate + newQuote.taxes + newQuote.fees,
      );
      newQuote.amountCharged = roundCurrency(newQuote.amountCharged + addedFee);

      logger.info(
        'MewsReservationService.modifyReservation: Pet(s) added to reservation',
        {
          external_id: externalId,
          numPetsToAdd,
          addedFee,
          usedMewsProduct: !!petProduct,
        },
      );
    }

    return newQuote;
  }

  async getExternalModificationInfo(
    reservationDetails: Reservation,
    newCheckIn: string,
    newCheckOut: string,
    newRoomTypeId?: string | number,
    newRateId?: string,
  ): Promise<ExternalModificationInfo> {
    const externalId = reservationDetails.external_id;
    if (!externalId) {
      throw new BadRequestError(
        'MewsReservationService.getExternalModificationInfo: external_id is required',
      );
    }

    const existingCheckIn = dayjs(reservationDetails.check_in).format(
      'YYYY-MM-DD',
    );
    const existingCheckOut = dayjs(reservationDetails.check_out).format(
      'YYYY-MM-DD',
    );

    const roomChanged =
      !!newRoomTypeId &&
      String(newRoomTypeId) !== String(reservationDetails.room_id);
    const targetRoomId = roomChanged
      ? newRoomTypeId
      : reservationDetails.room_id;

    const baseInfo = {
      rate_id: 0,
      rate_code: reservationDetails.rate_code ?? '',
      room_type_id: targetRoomId as number,
      adults: reservationDetails.num_adults ?? 1,
      children: reservationDetails.num_children ?? 0,
      currency: reservationDetails.quote?.quote_object?.currency ?? 'USD',
      newDateBreakdown: [] as ExternalModificationDateEntry[],
    };

    const existingStart = dayjs(existingCheckIn);
    const existingEnd = dayjs(existingCheckOut);
    const newStart = dayjs(newCheckIn);
    const newEnd = dayjs(newCheckOut);

    if (
      newStart.isSame(existingStart) &&
      newEnd.isSame(existingEnd) &&
      !roomChanged
    ) {
      return {
        ...baseInfo,
        scenario: 'same_dates',
        pricingDelta: 0,
        available: true,
      };
    }

    const hasOverlap =
      newStart.isBefore(existingEnd) && newEnd.isAfter(existingStart);
    let scenario: DateModificationScenario;
    if (!hasOverlap) {
      scenario = 'non_overlapping';
    } else if (
      !newStart.isBefore(existingStart) &&
      !newEnd.isAfter(existingEnd)
    ) {
      scenario = 'stay_reduction';
    } else {
      scenario = 'stay_extension';
    }

    // Dropping nights can't fail an availability check — mirrors StayNTouch's
    // short-circuit for pure reductions (no re-check/re-price needed).
    if (scenario === 'stay_reduction' && !roomChanged) {
      return { ...baseInfo, scenario, pricingDelta: 0, available: true };
    }

    const hotelId = reservationDetails.hotel_id ?? reservationDetails.hotel?.id;
    const credentials = hotelId
      ? await this.resolveCredentials(hotelId)
      : undefined;
    const bookableServices = credentials
      ? await this._getBookableServices(credentials)
      : undefined;

    // getQuoteForModification does its own delta-based availability check
    // (only the net-new nights, excluding this reservation's own occupied
    // nights) and throws MewsRoomUnavailableError if the delta isn't
    // available — reuse that single check rather than duplicating it here.
    let newQuote;
    try {
      newQuote = await this.getQuoteForModification(
        reservationDetails,
        newCheckIn,
        newCheckOut,
        null,
        newRoomTypeId,
        newRateId,
        credentials,
        bookableServices,
      );
    } catch (err) {
      if (err instanceof MewsRoomUnavailableError) {
        return { ...baseInfo, scenario, pricingDelta: 0, available: false };
      }
      throw err;
    }
    const oldTotal = reservationDetails.quote?.total_amount ?? 0;
    const pricingDelta = roundCurrency(newQuote.total_amount - oldTotal);

    const resolvedCurrency = newQuote.currency ?? baseInfo.currency;
    const newDateBreakdown: ExternalModificationDateEntry[] = [
      {
        date: newCheckIn,
        room_type: reservationDetails.room_type ?? '',
        rate_code: newQuote.rate_code ?? reservationDetails.rate_code ?? '',
        amount: newQuote.total_amount,
        currency: resolvedCurrency,
      },
    ];

    return {
      ...baseInfo,
      scenario,
      pricingDelta,
      available: true,
      currency: resolvedCurrency,
      newDateBreakdown,
    };
  }

  async modifyExternalDirectReservation(
    reservationDetails: Reservation,
    newCheckIn: string,
    newCheckOut: string,
    newRoomTypeId?: string | number,
    newRateId?: string,
  ): Promise<ExternalModificationInfo> {
    const externalId = reservationDetails.external_id;
    if (!externalId) {
      throw new BadRequestError(
        'MewsReservationService.modifyExternalDirectReservation: external_id is required',
      );
    }

    const info = await this.getExternalModificationInfo(
      reservationDetails,
      newCheckIn,
      newCheckOut,
      newRoomTypeId,
      newRateId,
    );

    if (info.scenario === 'same_dates' || !info.available) {
      return info;
    }

    await this.modifyReservation(
      reservationDetails,
      newCheckIn,
      newCheckOut,
      null,
      newRoomTypeId,
      newRateId,
    );

    return info;
  }

  async cancelExternalDirectReservation(
    reservationDetails: Reservation,
    reason?: string,
  ): Promise<{ status: boolean; reservation_id: string }> {
    const externalId = reservationDetails.external_id;
    if (!externalId) {
      throw new BadRequestError(
        'MewsReservationService.cancelExternalDirectReservation: external_id is required',
      );
    }

    const hotelId = reservationDetails.hotel_id ?? reservationDetails.hotel?.id;
    if (!hotelId) {
      throw new BadRequestError(
        'MewsReservationService.cancelExternalDirectReservation: hotel_id is required',
      );
    }

    logger.info(
      'MewsReservationService.cancelExternalDirectReservation: Cancelling reservation',
      {
        external_id: externalId,
        booking_id: reservationDetails.booking_id,
      },
    );

    const credentials = await this.resolveCredentials(hotelId);
    await mewsClient.cancelReservations(
      {
        ReservationIds: [externalId],
        Notes: reason ?? 'Cancelled via Dextr',
        PostCancellationFee: false,
        SendEmail: false,
      },
      credentials,
    );

    return { status: true, reservation_id: externalId };
  }

  async getRateIdByCode(
    hotelId: number | string,
    rateCode: string,
  ): Promise<string | undefined> {
    const credentials = await this.resolveCredentials(String(hotelId));
    const bookableServices = await this._getBookableServices(credentials);
    if (!bookableServices.length) return undefined;
    const serviceIds = bookableServices.map((s) => s.Id);
    const rates = await mewsClient.getRates(serviceIds, credentials);
    const normalizedCode = rateCode.toUpperCase();
    // No IsPublic/IsEnabled filter: callers resolve a rate an existing
    // reservation already sits on, which may be private or since-disabled.
    // Match every identifier we hand out — quotes persist rate_code as
    // ExternalIdentifier ?? Id, while availability reports ShortName.
    return rates.find(
      (r) =>
        r.ShortName?.toUpperCase() === normalizedCode ||
        r.ExternalIdentifier?.toUpperCase() === normalizedCode ||
        r.Id.toUpperCase() === normalizedCode,
    )?.Id;
  }

  async lookupReservationsById(
    hotel: Hotel,
    bookingId: string,
  ): Promise<Reservation[]> {
    const credentials = await this.resolveCredentials(hotel.id);
    const bookableServices = await this._getBookableServices(credentials);
    if (!bookableServices.length) return [];
    const serviceIds = bookableServices.map((s) => s.Id);

    // Try UUID lookup first, then confirmation number, then OTA/channel number
    // (e.g. Booking.com confirmation number for reservations made outside Mews)
    const [byId, byNumber, byChannelNumber] = await Promise.allSettled([
      mewsClient.getReservations(
        { ServiceIds: serviceIds, ReservationIds: [bookingId] },
        credentials,
      ),
      mewsClient.getReservations(
        { ServiceIds: serviceIds, Numbers: [bookingId] },
        credentials,
      ),
      mewsClient.getReservations(
        { ServiceIds: serviceIds, ChannelNumbers: [bookingId] },
        credentials,
      ),
    ]);

    logKpi({
      stat: 'mews_externalId_lookup',
      value: 1,
      contextName: 'MewsReservationService.lookupReservationsById',
      clientId: hotel.assistant_phone_number ?? hotel.id,
    });

    const results: MewsReservation[] = [];
    if (byId.status === 'fulfilled') results.push(...byId.value);
    if (byNumber.status === 'fulfilled') results.push(...byNumber.value);
    if (byChannelNumber.status === 'fulfilled')
      results.push(...byChannelNumber.value);

    const seen = new Set<string>();
    const unique = results.filter((r) => {
      if (seen.has(r.Id)) return false;
      seen.add(r.Id);
      return true;
    });

    if (unique.length) {
      logKpi({
        stat: 'mews_externalId_success',
        value: 1,
        contextName: 'MewsReservationService.lookupReservationsById',
        clientId: hotel.assistant_phone_number ?? hotel.id,
      });
    }

    const [ageCategories, customersById] = await Promise.all([
      mewsClient.getAgeCategories(serviceIds, credentials),
      this.fetchCustomersById(
        unique.map((r) => r.AccountId),
        credentials,
      ),
    ]);
    return unique.map((r) =>
      this._mapMewsReservationToDTO(
        r,
        hotel,
        ageCategories,
        customersById.get(r.AccountId),
      ),
    );
  }

  /**
   * A Mews reservation references its guest only by `AccountId`, so the account
   * has to be read separately whenever the guest's own details matter. Failing
   * soft: a reservation without the name is still worth returning.
   */
  private async fetchCustomersById(
    accountIds: string[],
    credentials: MewsCredentials,
  ): Promise<Map<string, MewsCustomer>> {
    const ids = Array.from(new Set(accountIds.filter(Boolean)));
    if (!ids.length) {
      return new Map();
    }

    try {
      const customers = await mewsClient.searchCustomers(
        { customerIds: ids },
        credentials,
      );
      return new Map(customers.map((customer) => [customer.Id, customer]));
    } catch (error) {
      logger.error('MewsReservationService.fetchCustomersById failed', {
        error,
        accountIds: ids,
      });
      return new Map();
    }
  }

  async lookupReservationsByPhone(
    hotel: Hotel,
    phoneNumber: string,
    _maxResults?: number,
  ): Promise<Reservation[]> {
    logger.warn(
      'MewsReservationService.lookupReservationsByPhone: Mews does not support phone-based reservation lookup',
      {
        hotel_id: hotel.id,
        phone: phoneNumber,
      },
    );
    return [];
  }

  /**
   * Looks up Mews reservations by guest name when no local row exists.
   */
  async lookupReservationsByGuestQueryFromPms(
    hotel: Hotel,
    guestName: string,
    timeoutMs: number = 12 * 1000,
    source?: ReservationLookupSource,
  ): Promise<Reservation[]> {
    const trimmedGuestName = guestName.trim();
    if (trimmedGuestName.length < 2) {
      return [];
    }

    return withTimeoutWithFallback(
      () =>
        this.lookupReservationsByGuestQueryFromPmsUncapped(
          hotel,
          trimmedGuestName,
          source,
        ),
      timeoutMs,
      [],
      () => {
        logger.error(
          `MewsReservationService.lookupReservationsByGuestQueryFromPms timed out after ${timeoutMs}ms. ${JSON.stringify({ guestName: trimmedGuestName })}`,
        );
      },
    );
  }

  private async lookupReservationsByGuestQueryFromPmsUncapped(
    hotel: Hotel,
    trimmedGuestName: string,
    source?: ReservationLookupSource,
  ): Promise<Reservation[]> {
    try {
      const credentials = await this.resolveCredentials(hotel.id);
      const nameParts = trimmedGuestName
        .split(/\s+/)
        .filter((part) => part.length > 0);
      const lastName = nameParts[nameParts.length - 1];
      const firstName =
        nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : undefined;

      // Mews ANDs FirstNames and LastNames, so a single token has to be
      // committed to one field, and the right field depends on the caller.
      const nameFilter =
        nameParts.length === 1 && source === ReservationLookupSource.DOOR_CODE
          ? { firstNames: [nameParts[0]] }
          : {
              lastNames: [lastName],
              ...(firstName && { firstNames: [firstName] }),
            };

      const customers = await mewsClient.searchCustomers(
        nameFilter,
        credentials,
      );

      if (!customers.length) {
        return [];
      }

      const bookableServices = await this._getBookableServices(credentials);
      if (!bookableServices.length) return [];
      const serviceIds = bookableServices.map((s) => s.Id);

      const reservations = await mewsClient.getReservations(
        {
          ServiceIds: serviceIds,
          AccountIds: customers.map((c) => c.Id),
        },
        credentials,
      );

      if (!reservations.length) {
        return [];
      }

      const ageCategories = await mewsClient.getAgeCategories(
        serviceIds,
        credentials,
      );

      const customersById = new Map(
        customers.map((customer) => [customer.Id, customer]),
      );

      return reservations.map((r) =>
        this._mapMewsReservationToDTO(
          r,
          hotel,
          ageCategories,
          customersById.get(r.AccountId),
        ),
      );
    } catch (error) {
      logger.error(
        'MewsReservationService.lookupReservationsByGuestQueryFromPms failed',
        {
          error,
          hotelId: hotel.id,
          guestName: trimmedGuestName,
        },
      );
      return [];
    }
  }

  async getRoomsInfo(
    businessId: string,
    credentials?: MewsCredentials,
    bookableServices?: MewsService[],
  ): Promise<MewsResourceCategory[]> {
    const hotel = await this.hotelService.getHotelByBusinessId(businessId);
    if (!hotel) {
      throw new NoDataError(
        `MewsReservationService.getRoomsInfo: Hotel not found for business_id ${businessId}`,
      );
    }
    const resolvedCredentials =
      credentials ?? (await this.resolveCredentials(hotel.id));
    const resolvedBookableServices =
      bookableServices ??
      (await this._getBookableServices(resolvedCredentials));
    if (!resolvedBookableServices.length) return [];
    const serviceIds = resolvedBookableServices.map((s) => s.Id);
    return mewsClient.getResourceCategories(serviceIds, resolvedCredentials);
  }

  async getRoomTypeMap(
    businessId: string,
    roomIds?: (string | number)[],
    roomsInfo?: MewsResourceCategory[],
  ): Promise<Map<string, string>> {
    const categories = roomsInfo ?? (await this.getRoomsInfo(businessId));
    const filtered = roomIds?.length
      ? categories.filter((c) => roomIds.map(String).includes(c.Id))
      : categories;
    const map = new Map<string, string>();
    for (const cat of filtered) {
      const name =
        cat.Names['en-US'] ??
        cat.Names[Object.keys(cat.Names)[0]] ??
        cat.ExternalIdentifier ??
        cat.Id;
      map.set(cat.Id, name);
    }
    return map;
  }

  // Only OTA/channel-manager (and unknown) reservations are third-party; every
  // hotel-controlled origin — front desk (Commander), Connector (incl. Daisy's
  // own bookings), Booking Engine (Distributor), Guest Services (Navigator) — is
  // direct. Third-party reservations block modification/cancellation downstream.
  private _mapMewsOriginToReservationSource(
    origin: MewsReservationOrigin | undefined,
  ): ReservationSource {
    switch (origin) {
      case 'Commander':
      case 'Connector':
      case 'Distributor':
      case 'Navigator':
        return ReservationSource.DIRECT_HOTEL_RESERVATION;
      case 'ChannelManager':
      case 'Import':
      default:
        return ReservationSource.THIRD_PARTY_RESERVATION;
    }
  }

  private _mapMewsReservationToDTO(
    r: MewsReservation,
    hotel: Hotel,
    ageCategories: MewsAgeCategory[],
    customer?: MewsCustomer,
  ): Reservation {
    const childCategoryIds = new Set(
      ageCategories
        .filter((c) => c.Classification === 'Child')
        .map((c) => c.Id),
    );
    let adultCount = 0;
    let childCount = 0;
    for (const pc of r.PersonCounts) {
      if (childCategoryIds.has(pc.AgeCategoryId)) {
        childCount += pc.Count;
      } else {
        adultCount += pc.Count;
      }
    }
    return {
      id: r.Id,
      booking_id: r.Number,
      external_id: r.Id,
      external_public_id: r.Number,
      phone_number: '',
      type: SessionType.EXTERNAL,
      reservation_source: this._mapMewsOriginToReservationSource(r.Origin),
      room_id: r.RequestedResourceCategoryId,
      room_type: '',
      business_id: String(hotel.business_id),
      hotel_id: hotel.id,
      pms_provider: PmsProvider.MEWS,
      status: this._mapMewsState(r.State),
      check_in: new Date(r.ScheduledStartUtc),
      check_out: new Date(r.ScheduledEndUtc),
      num_adults: adultCount,
      num_children: childCount,
      rate_code: null,
      rate_id: r.RateId ?? null,
      customer: {
        id: r.AccountId,
        hotel_id: hotel.id,
        first_name: customer?.FirstName ?? undefined,
        last_name: customer?.LastName ?? undefined,
        email: customer?.Email ?? undefined,
        phone_number: customer?.Phone ?? '',
      },
      hotel: null,
      hotel_configuration: null,
      channel: null,
      payments: null,
      quote: null,
      discount: null,
    };
  }

  private _mapMewsState(state: string): ReservationStatus {
    switch (state) {
      case 'Confirmed':
      case 'Started':
        return ReservationStatus.ACTIVE;
      case 'Canceled':
        return ReservationStatus.CANCELLED;
      case 'Processed':
        return ReservationStatus.INACTIVE;
      default:
        return ReservationStatus.ACTIVE;
    }
  }

  async validateMultiRoomOccupancy(
    peoplePerRoom: PeoplePerRoom,
    roomsInfo: MewsResourceCategory[],
    _hotelId: string,
  ): Promise<void> {
    const categoryMap = new Map(roomsInfo.map((rc) => [rc.Id, rc]));
    const roomIds = Array.from(new Set(Object.keys(peoplePerRoom)));

    for (const roomId of roomIds) {
      const category = categoryMap.get(roomId);
      if (!category) {
        throw new BadRequestError(`Invalid room category id: ${roomId}`);
      }
      const roomName =
        category.Names['en-US'] ?? Object.values(category.Names)[0] ?? roomId;
      const maxCapacity = category.Capacity + category.ExtraCapacity;

      for (const occupantGroup of peoplePerRoom[roomId]) {
        if (occupantGroup.num_adults < 1) {
          throw new BadRequestError(
            `${roomName}: At least one adult is required per room`,
          );
        }
        if (maxCapacity > 0) {
          const totalGuests =
            occupantGroup.num_adults + occupantGroup.num_children;
          if (totalGuests > maxCapacity) {
            throw new BadRequestError(
              `${roomName}: Total guests (${totalGuests}) exceeds maximum capacity (${maxCapacity})`,
            );
          }
        }
      }
    }
  }

  async validateSingleRoomOccupancy(
    roomId: string,
    numAdults: number,
    numChildren: number,
    businessId: string,
    credentials?: MewsCredentials,
    bookableServices?: MewsService[],
  ): Promise<void> {
    const roomsInfo = await this.getRoomsInfo(
      businessId,
      credentials,
      bookableServices,
    );
    const category = roomsInfo.find((rc) => rc.Id === roomId);
    if (!category) {
      throw new BadRequestError(`Invalid room category id: ${roomId}`);
    }
    const roomName =
      category.Names['en-US'] ?? Object.values(category.Names)[0] ?? roomId;
    const maxCapacity = category.Capacity + category.ExtraCapacity;

    if (numAdults < 1) {
      throw new BadRequestError(`${roomName}: At least one adult is required`);
    }
    if (maxCapacity > 0) {
      const totalGuests = numAdults + numChildren;
      if (totalGuests > maxCapacity) {
        throw new BadRequestError(
          `${roomName}: Total guests (${totalGuests}) exceeds maximum capacity (${maxCapacity})`,
        );
      }
    }
  }

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
      rate_code: requestedRateCode,
    } = params;

    const hotel = await this.hotelService.getHotelById(hotel_id);
    if (!hotel) {
      throw new NoDataError(
        `MewsReservationService.getQuote: Hotel not found for hotel_id ${hotel_id}`,
      );
    }

    const credentials = await this.resolveCredentials(hotel.id);

    const bookableServices = await this._getBookableServices(credentials);
    if (!bookableServices.length) {
      throw new NoDataError(
        'MewsReservationService.getQuote: No bookable services found for hotel',
      );
    }
    const serviceIds = bookableServices.map((s) => s.Id);

    const [hotelConfig, resourceCategories, ageCategories] = await Promise.all([
      hotelConfigurationService.getHotelConfigurationByHotelId(hotel_id),
      mewsClient.getResourceCategories(serviceIds, credentials),
      mewsClient.getAgeCategories(serviceIds, credentials),
    ]);

    const roomIdStr = String(room_id);
    const category = resourceCategories.find((rc) => rc.Id === roomIdStr);
    const roomServiceId = category?.ServiceId;
    // Age categories belong to a service — scope to the room's service so the
    // age adjustment is computed from the correct categories.
    const serviceAgeCategories = roomServiceId
      ? ageCategories.filter((c) => c.ServiceId === roomServiceId)
      : ageCategories;
    const adultCat = serviceAgeCategories.find(
      (c) => c.IsActive && c.Classification === 'Adult',
    );
    const childCat = serviceAgeCategories.find(
      (c) => c.IsActive && c.Classification === 'Child',
    );
    // Fetch only the room's own service's rates — a global rate would price
    // the room off another service's rate (wrong price + rate_code). Scoping
    // the getAll call also avoids the Count cap dropping this service's rates.
    const rates = await mewsClient.getRates(
      roomServiceId ? [roomServiceId] : serviceIds,
      credentials,
    );
    const activeRates = rates.filter(
      (r) =>
        r.IsActive &&
        r.IsEnabled &&
        (!roomServiceId || r.ServiceId === roomServiceId),
    );
    let rate: MewsRate | undefined;
    if (requestedRateCode) {
      const normalizedCode = requestedRateCode.toUpperCase();
      rate = activeRates.find(
        (r) => r.ShortName?.toUpperCase() === normalizedCode,
      );
    }
    if (!rate) {
      rate = activeRates.find((r) => r.IsPublic) ?? activeRates[0];
    }

    if (!rate) {
      throw new NoDataError(
        `MewsReservationService.getQuote: No rate found for hotel ${hotel_id}` +
          (requestedRateCode ? ` with rate_code "${requestedRateCode}"` : ''),
      );
    }

    // Before pricing, not after: the booking guard would catch this too, but
    // only once the guest has been quoted and, on the quote-then-pay path,
    // already charged.
    await this._validateRestrictions(
      {
        checkIn: check_in,
        checkOut: check_out,
        timezone: hotel.timezone,
        clientId: hotel.assistant_phone_number,
      },
      [{ categoryId: roomIdStr, rateId: rate.Id }],
      bookableServices,
      credentials,
      'getQuote',
      { categories: resourceCategories, rates },
    );

    const { firstTimeUnitStartUtc, lastTimeUnitStartUtc } = this._buildUtcRange(
      check_in,
      check_out,
      hotel.timezone,
    );

    const pricingResponse = await mewsClient.getRatePricing(
      { rateId: rate.Id, firstTimeUnitStartUtc, lastTimeUnitStartUtc },
      credentials,
    );

    const categoryPricing = pricingResponse.CategoryPrices?.find(
      (cp) => cp.CategoryId === roomIdStr,
    );
    const amountPrices = categoryPricing?.AmountPrices?.length
      ? categoryPricing.AmountPrices
      : pricingResponse.BaseAmountPrices;

    if (!amountPrices?.length) {
      throw new NoDataError(
        `MewsReservationService.getQuote: No pricing data for room ${room_id}`,
      );
    }

    const rateName = this._getRateName(rate);
    const currency = pricingResponse.Currency;
    const ageAdjustmentPerNight = this._computeAgeCategoryAdjustmentPerNight(
      pricingResponse.AgeCategoryAdjustments,
      category?.Capacity ?? 0,
      num_adults,
      num_children,
      adultCat?.Id,
      childCat?.Id,
    );
    const priceData = this._buildAmountPrice(
      rate.Id,
      rateName,
      currency,
      amountPrices,
      ageAdjustmentPerNight,
    );

    const taxes = roundCurrency(
      amountPrices.reduce(
        (sum, p) => sum + p.TaxValues.reduce((ts, tv) => ts + tv.Value, 0),
        0,
      ),
    );
    // priceData.totalPrice sums Mews's GrossValue, which is already tax-inclusive
    // (GrossValue = NetValue + TaxValues) — subtract taxes back out so
    // base_rate + taxes doesn't double-count tax.
    const base_rate = roundCurrency(priceData.totalPrice - taxes);

    // Apply pet fee: prefer a Mews "pet" Product for the hotel, else fall back
    // to the Daisy DB pet_fee_configuration strategy. Scope the product lookup
    // to the room's service — a product from another service can't be attached
    // to this reservation (Mews rejects the ProductOrder).
    const petBookableServices = roomServiceId
      ? bookableServices.filter((s) => s.Id === roomServiceId)
      : bookableServices;
    const petFeeSource =
      num_pets > 0
        ? await this._resolvePetFeeSource(
            petBookableServices,
            credentials,
            hotel,
            hotelConfig,
            num_pets,
          )
        : {};
    const {
      fees,
      petProductId: pet_product_id,
      petProductCount: pet_product_count,
    } = this._calcPetFee(
      petFeeSource,
      num_pets,
      check_in,
      check_out,
      room_id,
      base_rate,
      taxes,
    );

    const total_amount = roundCurrency(base_rate + taxes + fees);

    const quote: PMSQuote = {
      base_rate,
      taxes,
      fees,
      total_amount,
      amountCharged: total_amount,
      currency,
      raw_response: pricingResponse,
      rate_code: rate.ExternalIdentifier ?? rate.Id,
      rate_id: rate.Id,
      ...(pet_product_id && { pet_product_id, pet_product_count }),
    };

    // Apply initial deposit policy
    const firstNight = amountPrices[0]
      ? {
          baseRate: roundCurrency(
            amountPrices[0].GrossValue -
              amountPrices[0].TaxValues.reduce((s, t) => s + t.Value, 0) +
              ageAdjustmentPerNight,
          ),
          tax: roundCurrency(
            amountPrices[0].TaxValues.reduce((s, t) => s + t.Value, 0),
          ),
        }
      : undefined;
    this._applyInitialDepositPolicy(
      quote,
      check_in,
      check_out,
      hotelConfig?.initial_deposit_policy,
      firstNight,
    );

    if (hotel.payment_provider === PaymentProvider.NOT_APPLICABLE) {
      quote.amountCharged = 0;
    }

    logger.info('MewsReservationService.getQuote: quote built', {
      hotel_id,
      room_id,
      rate_id: rate.Id,
      rate_code: quote.rate_code,
      base_rate,
      taxes,
      fees,
      total_amount,
      amountCharged: quote.amountCharged,
    });

    return quote;
  }

  private _applyInitialDepositPolicy(
    quote: PMSQuote,
    checkIn: string,
    checkOut: string,
    policy: InitialDepositPolicy | null | undefined,
    firstNight?: { baseRate: number; tax: number },
  ): void {
    if (!policy?.enabled || !policy.tiers?.length) return;

    const nights = Math.round(
      (new Date(checkOut).getTime() - new Date(checkIn).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    const matchedTier = policy.tiers.find((tier) => {
      const meetsMin = nights >= tier.min_nights;
      const meetsMax = tier.max_nights == null || nights <= tier.max_nights;
      return meetsMin && meetsMax;
    });

    if (!matchedTier) return;

    let depositAmount: number | undefined;

    switch (matchedTier.deposit_type) {
      case DepositType.PERCENTAGE: {
        const pct = matchedTier.value;
        if (pct == null) return;
        depositAmount = roundCurrency((quote.total_amount * pct) / 100);
        break;
      }
      case DepositType.FLAT: {
        const flat = matchedTier.value;
        if (flat == null) return;
        depositAmount = roundCurrency(flat);
        break;
      }
      case DepositType.FIRST_NIGHT_PLUS_TAX: {
        if (!firstNight) return;
        depositAmount = roundCurrency(firstNight.baseRate + firstNight.tax);
        break;
      }
      case DepositType.FIRST_NIGHT_PLUS_TAX_PLUS_FEE: {
        if (!firstNight) return;
        depositAmount = roundCurrency(
          firstNight.baseRate + firstNight.tax + quote.fees,
        );
        break;
      }
      default:
        return;
    }

    if (depositAmount !== undefined) {
      quote.amountCharged = roundCurrency(
        Math.min(depositAmount, quote.total_amount),
      );
    }
  }

  async getQuoteForModification(
    reservationDetails: Reservation,
    newCheckIn: string,
    newCheckOut: string,
    discount: Discount | null,
    newRoomTypeId?: string | number,
    newRateId?: string,
    credentials?: MewsCredentials,
    bookableServices?: MewsService[],
  ): Promise<PMSQuote> {
    const hotelId = reservationDetails.hotel_id ?? reservationDetails.hotel?.id;
    if (!hotelId) {
      throw new BadRequestError(
        'MewsReservationService.getQuoteForModification: hotel_id is required',
      );
    }

    const hotel = await this.hotelService.getHotelById(hotelId);
    if (!hotel) {
      throw new NoDataError(
        `MewsReservationService.getQuoteForModification: Hotel not found for hotel_id ${hotelId}`,
      );
    }

    const resolvedCredentials =
      credentials ?? (await this.resolveCredentials(hotel.id));
    const resolvedBookableServices =
      bookableServices ??
      (await this._getBookableServices(resolvedCredentials));
    if (!resolvedBookableServices.length) {
      throw new NoDataError(
        'MewsReservationService.getQuoteForModification: No bookable services found',
      );
    }
    const serviceIds = resolvedBookableServices.map((s) => s.Id);

    const roomChanged =
      !!newRoomTypeId &&
      String(newRoomTypeId) !== String(reservationDetails.room_id);
    const categoryId = roomChanged
      ? String(newRoomTypeId)
      : String(reservationDetails.room_id);

    const existingCheckIn = dayjs(reservationDetails.check_in).format(
      'YYYY-MM-DD',
    );
    const existingCheckOut = dayjs(reservationDetails.check_out).format(
      'YYYY-MM-DD',
    );
    const existingDateSet = new Set<string>();
    for (
      let cursor = dayjs(existingCheckIn);
      cursor.isBefore(existingCheckOut);
      cursor = cursor.add(1, 'day')
    ) {
      existingDateSet.add(cursor.format('YYYY-MM-DD'));
    }
    const deltaDates: string[] = [];
    for (
      let cursor = dayjs(newCheckIn);
      cursor.isBefore(newCheckOut);
      cursor = cursor.add(1, 'day')
    ) {
      const dateStr = cursor.format('YYYY-MM-DD');
      if (roomChanged || !existingDateSet.has(dateStr)) {
        deltaDates.push(dateStr);
      }
    }

    if (deltaDates.length) {
      const contiguousRanges = groupContiguousDates(deltaDates);
      for (const range of contiguousRanges) {
        const rangeCheckIn = range[0];
        const rangeCheckOut = dayjs(range[range.length - 1])
          .add(1, 'day')
          .format('YYYY-MM-DD');
        await this.validateRoomAvailability(
          [
            {
              ...reservationDetails,
              room_id: categoryId,
              check_in: new Date(rangeCheckIn),
              check_out: new Date(rangeCheckOut),
            },
          ],
          resolvedCredentials,
          resolvedBookableServices,
          // Only free-resource capacity is a per-delta-range question. The
          // restriction check runs once below over the whole new stay, with
          // the rate the reservation is actually moving to.
          { skipRestrictions: true },
        );
      }
    }

    const [ageCategories, resourceCategories] = await Promise.all([
      mewsClient.getAgeCategories(serviceIds, resolvedCredentials),
      mewsClient.getResourceCategories(serviceIds, resolvedCredentials),
    ]);
    const category = resourceCategories.find((rc) => rc.Id === categoryId);
    const roomServiceId = category?.ServiceId;

    // Resolve full Rate object (need it for rateName, not just the Id): prefer
    // explicit newRateId, then stored rate_code, then public rate. Scope to
    // the room's service — rate + age category sent to Mews must belong to it.
    const allRates = await mewsClient.getRates(
      roomServiceId ? [roomServiceId] : serviceIds,
      resolvedCredentials,
    );
    const activeRates = allRates.filter(
      (r) =>
        r.IsActive &&
        r.IsEnabled &&
        (!roomServiceId || r.ServiceId === roomServiceId),
    );
    const serviceRates = allRates.filter(
      (r) => !roomServiceId || r.ServiceId === roomServiceId,
    );
    // Externally created reservations carry rate_id (the Mews rate GUID) with
    // rate_code null, so fall back through both before defaulting.
    const rateCandidates = [
      newRateId,
      reservationDetails.rate_id != null
        ? String(reservationDetails.rate_id)
        : null,
      reservationDetails.rate_code,
    ].filter((c): c is string => !!c && c.trim() !== '');
    const requestedRateId = rateCandidates[0];
    let rate: MewsRate | undefined;
    for (const candidate of rateCandidates) {
      const normalizedCode = candidate.toUpperCase();
      // Search unfiltered rates: the reservation may sit on a rate that is
      // private or has since been disabled, and repricing it on a different
      // rate would not match what Mews charges. Match every identifier we
      // hand out (see getRateIdByCode).
      rate = serviceRates.find(
        (r) =>
          r.Id.toUpperCase() === normalizedCode ||
          r.ExternalIdentifier?.toUpperCase() === normalizedCode ||
          r.ShortName?.toUpperCase() === normalizedCode,
      );
      if (rate) break;
    }
    if (!rate) {
      rate = activeRates.find((r) => r.IsPublic) ?? activeRates[0];
    }
    if (!rate) {
      throw new NoDataError(
        'MewsReservationService.getQuoteForModification: No rate found' +
          (requestedRateId ? ` for rate "${requestedRateId}"` : ''),
      );
    }
    const rateId = rate.Id;

    // Unconditional, and over the whole new stay — not the delta ranges above.
    // A shrink produces no delta dates at all yet is exactly what violates a
    // MinLength restriction, and length exceptions evaluated against a
    // one-night delta of a six-night stay would block valid extensions.
    // Runs here rather than beside the availability check because the rate the
    // reservation is moving to is only resolved at this point.
    await this._validateRestrictions(
      {
        checkIn: newCheckIn,
        checkOut: newCheckOut,
        timezone: hotel.timezone,
        clientId: hotel.assistant_phone_number,
      },
      [
        {
          bookingId: reservationDetails.booking_id,
          categoryId,
          roomType: reservationDetails.room_type,
          rateId,
        },
      ],
      resolvedBookableServices,
      resolvedCredentials,
      'getQuoteForModification',
      { categories: resourceCategories, rates: allRates },
    );

    const serviceAgeCategories = roomServiceId
      ? ageCategories.filter((c) => c.ServiceId === roomServiceId)
      : ageCategories;
    const adultCat = serviceAgeCategories.find(
      (c) => c.IsActive && c.Classification === 'Adult',
    );
    const childCat = serviceAgeCategories.find(
      (c) => c.IsActive && c.Classification === 'Child',
    );
    const numAdults = reservationDetails.num_adults ?? 1;
    const numChildren = reservationDetails.num_children ?? 0;

    const { firstTimeUnitStartUtc, lastTimeUnitStartUtc } = this._buildUtcRange(
      newCheckIn,
      newCheckOut,
      hotel.timezone,
    );

    const pricingResponse = await mewsClient.getRatePricing(
      { rateId, firstTimeUnitStartUtc, lastTimeUnitStartUtc },
      resolvedCredentials,
    );

    const categoryPricing = pricingResponse.CategoryPrices?.find(
      (cp) => cp.CategoryId === categoryId,
    );
    if (!categoryPricing?.AmountPrices?.length) {
      logger.warn(
        'MewsReservationService.getQuoteForModification: No category-specific pricing found for rate; falling back to base rate pricing',
        { rate_id: rateId, category_id: categoryId },
      );
    }
    const amountPrices = categoryPricing?.AmountPrices?.length
      ? categoryPricing.AmountPrices
      : pricingResponse.BaseAmountPrices;

    if (!amountPrices?.length) {
      throw new NoDataError(
        `MewsReservationService.getQuoteForModification: No pricing data for room ${categoryId}`,
      );
    }

    const rateName = this._getRateName(rate);
    const currency = pricingResponse.Currency;
    const ageAdjustmentPerNight = this._computeAgeCategoryAdjustmentPerNight(
      pricingResponse.AgeCategoryAdjustments,
      category?.Capacity ?? 0,
      numAdults,
      numChildren,
      adultCat?.Id,
      childCat?.Id,
    );
    const priceData = this._buildAmountPrice(
      rateId,
      rateName,
      currency,
      amountPrices,
      ageAdjustmentPerNight,
    );

    const taxes = roundCurrency(
      amountPrices.reduce(
        (sum, p) => sum + p.TaxValues.reduce((ts, tv) => ts + tv.Value, 0),
        0,
      ),
    );
    // priceData.totalPrice sums Mews's GrossValue, which is already tax-inclusive
    // (GrossValue = NetValue + TaxValues) — subtract taxes back out so
    // base_rate + taxes doesn't double-count tax.
    const base_rate = roundCurrency(priceData.totalPrice - taxes);
    const total_amount = roundCurrency(base_rate + taxes);

    const hotelConfig =
      await hotelConfigurationService.getHotelConfigurationByHotelId(hotelId);

    // Re-derive the existing pet fee (if any) so it isn't silently dropped when
    // only dates/room change — mirrors StayNTouch, which preserves pet fees
    // across a modification that doesn't touch num_pets.
    const existingNumPets = reservationDetails.num_pets ?? 0;
    const petBookableServices = roomServiceId
      ? resolvedBookableServices.filter((s) => s.Id === roomServiceId)
      : resolvedBookableServices;
    const petFeeSource =
      existingNumPets > 0
        ? await this._resolvePetFeeSource(
            petBookableServices,
            resolvedCredentials,
            hotel,
            hotelConfig,
            existingNumPets,
          )
        : {};
    const { fees } = this._calcPetFee(
      petFeeSource,
      existingNumPets,
      newCheckIn,
      newCheckOut,
      categoryId,
      base_rate,
      taxes,
    );

    const quote: PMSQuote = {
      base_rate,
      taxes,
      fees,
      total_amount: roundCurrency(total_amount + fees),
      amountCharged: roundCurrency(total_amount + fees),
      currency,
      rate_code: rate.ExternalIdentifier ?? rate.Id,
      rate_id: rate.Id,
    };

    const firstNight = amountPrices[0]
      ? {
          baseRate: roundCurrency(
            amountPrices[0].GrossValue -
              amountPrices[0].TaxValues.reduce((s, t) => s + t.Value, 0) +
              ageAdjustmentPerNight,
          ),
          tax: roundCurrency(
            amountPrices[0].TaxValues.reduce((s, t) => s + t.Value, 0),
          ),
        }
      : undefined;

    this._applyInitialDepositPolicy(
      quote,
      newCheckIn,
      newCheckOut,
      hotelConfig?.initial_deposit_policy,
      firstNight,
    );

    // If an initial amount was already collected, and the full amount needn't be collected for any more modifications,
    // preserve it in the quote. The modification flow in RoomReservationService handles charging/refunding the delta.
    // Original reservation dates determine the deposit tier that applied at booking time.
    const originalNights = dayjs(reservationDetails.check_out)
      .startOf('day')
      .diff(dayjs(reservationDetails.check_in).startOf('day'), 'day');
    const isFullPayment = isFullPaymentPolicy(
      hotelConfig?.initial_deposit_policy,
      originalNights,
    );
    if (
      reservationDetails.quote &&
      reservationDetails.quote.amount_charged > 0 &&
      !isFullPayment
    ) {
      quote.amountCharged = reservationDetails.quote.amount_charged;
    }

    if (hotel.payment_provider === PaymentProvider.NOT_APPLICABLE) {
      quote.amountCharged = 0;
    }

    logger.info('MewsReservationService.getQuoteForModification: quote built', {
      hotel_id: hotelId,
      category_id: categoryId,
      rate_id: rateId,
      base_rate,
      taxes,
      total_amount,
      amountCharged: quote.amountCharged,
    });

    return quote;
  }

  shouldFetchDiscount(): boolean {
    return false;
  }

  buildPartnerNotes({ numPets }: ReservationNotesContext = {}): string | null {
    if (numPets && numPets > 0) {
      return `Number of Pets = ${numPets};`;
    }

    return null;
  }
}

const mewsReservationService = new MewsReservationService();
export default mewsReservationService;
