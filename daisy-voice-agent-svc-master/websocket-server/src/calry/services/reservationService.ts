/**
 * Calry Reservation Service
 *
 * Implements the PMS-agnostic `IPMSReservationService` against Calry's
 * unified API (`/api/v2/vrs/*`). Calry is a gateway rather than a PMS: the
 * upstream system (Oracle Opera for our hotels) is bound to an integration
 * account in the Calry dashboard, so nothing in here branches on it.
 *
 * Credential model:
 * - `hotels.business_id` carries the Calry `propertyId`.
 * - Bearer token and `integrationAccountId` come from
 *   `hotel_configurations.external_auth_config` via `resolveCalryCredentials`.
 * - `workspaceId` is global, from `config.CALRY_WORKSPACE_ID`.
 *
 * Three Calry limitations shape this file:
 * 1. `POST /reservations` cannot select a rate plan. The hotel's configured
 *    rate code picks one out of `GET /quote`'s `ratePlans[]` and the same
 *    total is asserted back on create; a post-create check emits
 *    `PmsQuotedPriceMismatch` if the PMS priced it differently.
 * 2. `PUT /reservations` cannot change property, room type or price, so on the
 *    unified path room moves are refused and modification means dates and
 *    guest counts. Opera-backed hotels go through the passthrough instead,
 *    where room type and rate plan can both change.
 * 3. Calry has no payment API of its own. Money moves on a Dextr rail
 *    (Stripe or Shift4) and the collected amount is recorded on the Opera
 *    folio afterwards, through the passthrough — see
 *    `calry/services/operaPaymentRecorder.ts`. A hotel still configured with
 *    `payment_provider = NOT_APPLICABLE` collects nothing and keeps
 *    `amountCharged = 0`.
 *
 * Unsupported operations throw `BadRequestError` so the voice agent reads
 * the reason back as a 400 rather than surfacing a swallowed 500.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { Hotel } from '../../dtos/Hotel';
import { Reservation as ReservationDTO } from '../../dtos/Reservation';
import { BadRequestError } from '../../errors/BadRequestError';
import { NoDataError } from '../../errors/NoDataError';
import { Hotel as HotelModel } from '../../models/Hotel';
import { HotelConfiguration } from '../../models/HotelConfiguration';
import {
  GetAvailabilityRequestParams,
  GetSingleRoomAvailabilityRequestParams,
} from '../../models/request/availability';
import { PeoplePerRoom } from '../../models/request/roomReservation';
import { ExternalModificationInfo } from '../../pms/types/ExternalModification';
import {
  CreateReservationParams,
  CreateReservationResponse,
  IPMSReservationService,
  ReservationNotesContext,
} from '../../pms/types/IPMSReservationService';
import { PMSQuote } from '../../pms/types/Quote';
import { PMSQuoteRequest } from '../../pms/types/QuoteRequest';
import { determineDateModificationScenario } from '../../pms/utils/dateModification';
import { hotelService } from '../../services/hotel/hotelService';
import { hotelConfigurationService } from '../../services/hotelConfiguration/hotelConfigurationService';
import { validateAndCorrectDates } from '../../services/roomReservation/helper';
import { PaymentProvider } from '../../types/enums';
import { formatCurrencyAmount, roundCurrency } from '../../utils/helper';
import { KpiStat, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import calryClient, { CalryClient } from '../client/CalryClient';
import operaClient, { extractOperaReservationIds } from '../client/OperaClient';
import { CalryAPIError, CalryRoomUnavailableError } from '../errors';
import {
  CALRY_STATUS_CANCELLED,
  CALRY_STATUS_CONFIRMED,
  CalryAvailabilityResponse,
  CalryCredentials,
  CalryGuestWrite,
  CalryQuote,
  CalryReservation,
  CalryRoomGroup,
  CalryRoomInfo,
  CalryRoomsInfo,
  CalryRoomType,
  OperaRoomTypeLov,
  OperaTarget,
} from '../types';
import { mapCalryRatePlanToPMSQuote } from '../utils/calryQuoteMapper';
import { mapCalryReservationToDTO } from '../utils/mapCalryReservationToDTO';
import { mapOperaRateInfoToPMSQuote } from '../utils/operaQuoteMapper';
import { describeRatePlans, selectRatePlan } from '../utils/ratePlanSelection';
import { resolveCalryCredentials } from './calryCredentials';
import {
  candidateRatePlans,
  findOperaOffer,
  isOperaRangeAvailable,
  resolveOperaRoomTypeCode,
  resolveOperaTarget,
} from './operaAvailability';

dayjs.extend(utc);

/** Tolerance when comparing the quoted total against what the PMS booked. */
const PRICE_MISMATCH_TOLERANCE = 0.01;

/**
 * One bookable room type on an Opera property: the Calry room id a booking is
 * placed against, and the Opera room type code every Opera call is keyed by.
 */
interface OperaBookableRoomType {
  /** Calry room id — what `POST /reservations` accepts as `roomTypeId`. */
  calryRoomTypeId: string;
  /** Opera room type code, e.g. `ECO`. */
  operaRoomType: string;
  name: string;
}

export class CalryReservationService implements IPMSReservationService {
  constructor(private client: CalryClient = calryClient) {}

  /**
   * Where to address Opera for this hotel, or null when the hotel is a Calry
   * hotel on some other PMS. Everything Opera-specific hangs off this: a null
   * target means the unified Calry endpoints are used instead.
   */
  private async resolveOperaTargetFor(
    hotelId: string,
    credentials: CalryCredentials,
  ): Promise<OperaTarget | null> {
    const authConfig =
      await hotelConfigurationService.getExternalAuthConfigByHotelId(hotelId);
    return resolveOperaTarget(credentials, authConfig);
  }

  /**
   * Collapses Calry's room list onto the Opera room types behind it.
   *
   * Calry reports Opera *rooms* as room types, so a property returns hundreds
   * of entries that resolve to a handful of Opera codes. Every Opera
   * availability and rate call is keyed by the code, so the list is deduped
   * here and one Calry room id is kept per code as the thing to book. Rooms
   * whose code cannot be resolved are dropped rather than guessed at.
   */
  private async resolveOperaBookableRoomTypes(
    calryRoomTypes: CalryRoomType[],
    operaRoomTypes: OperaRoomTypeLov[],
    roomTypeMap: Record<string, string> | undefined,
  ): Promise<OperaBookableRoomType[]> {
    const byCode = new Map<string, OperaBookableRoomType>();

    for (const roomType of calryRoomTypes) {
      const operaRoomType = resolveOperaRoomTypeCode({
        calryRoomTypeId: roomType.id,
        description: roomType.description,
        name: roomType.name,
        operaRoomTypes,
        roomTypeMap,
      });
      if (!operaRoomType || byCode.has(operaRoomType)) continue;

      const lov = operaRoomTypes.find((rt) => rt.code === operaRoomType);
      byCode.set(operaRoomType, {
        calryRoomTypeId: roomType.id,
        operaRoomType,
        name: lov?.description ?? lov?.name ?? roomType.name ?? operaRoomType,
      });
    }

    return Array.from(byCode.values());
  }

  /**
   * Availability and pricing read straight off Opera. Calry's unified
   * `/availability` answers 400 and `/quote` 500s for Opera/OHIP, so the two
   * Opera endpoints stand in for them — see `services/operaAvailability.ts`.
   *
   * Opera reports availability as a per-date status with no unit counts, so
   * `available_units` degrades to 1: a room type is open or it is not.
   */
  private async buildOperaRoomGroups({
    target,
    credentials,
    calryRoomTypes,
    startDate,
    endDate,
    numAdults,
    numChildren,
    numPets,
    hotelId,
    hotelConfig,
  }: {
    target: OperaTarget;
    credentials: CalryCredentials;
    calryRoomTypes: CalryRoomType[];
    startDate: string;
    endDate: string;
    numAdults: number;
    numChildren: number;
    numPets: number;
    hotelId: string;
    hotelConfig: HotelConfiguration | null;
  }): Promise<CalryRoomGroup[]> {
    const authConfig =
      await hotelConfigurationService.getExternalAuthConfigByHotelId(hotelId);
    const [operaRoomTypes, ratePlans] = await Promise.all([
      operaClient.listRoomTypes(target, credentials),
      operaClient.listRatePlans(target, credentials),
    ]);

    const bookable = await this.resolveOperaBookableRoomTypes(
      calryRoomTypes,
      operaRoomTypes,
      authConfig?.operaRoomTypeMap,
    );

    const groups = await Promise.all(
      bookable.map(async (roomType) => {
        try {
          const offer = await findOperaOffer({
            target,
            credentials,
            ratePlans,
            roomType: roomType.operaRoomType,
            startDate,
            endDate,
            adults: numAdults + numChildren,
            rateCodeConfig: hotelConfig?.rate_code_config,
          });
          if (!offer) return null;

          const pricing = mapOperaRateInfoToPMSQuote({
            rateInfo: offer.rateInfo,
            ratePlanCode: offer.ratePlanCode,
            checkIn: startDate,
            checkOut: endDate,
            roomTypeId: roomType.calryRoomTypeId,
            numPets,
            hotelId,
            hotelConfig,
          });

          return {
            room_id: roomType.calryRoomTypeId,
            room_name: roomType.name,
            available_units: 1,
            deposit_rule_info: {},
            cancel_rule_info: {},
            pricing,
            raw_response: offer.rateInfo,
          } as CalryRoomGroup;
        } catch (error) {
          logger.error(
            'CalryReservationService.buildOperaRoomGroups: skipping room type',
            {
              operaRoomType: roomType.operaRoomType,
              error: (error as Error).message,
            },
          );
          return null;
        }
      }),
    );

    return groups.filter((group): group is CalryRoomGroup => group !== null);
  }

  /**
   * Prices one room type on Opera. Used by the booking path, where the room
   * has already been chosen, so a room type that cannot be priced is an error
   * rather than something to skip.
   */
  private async operaQuoteFor({
    target,
    credentials,
    calryRoomTypeId,
    startDate,
    endDate,
    numAdults,
    numChildren,
    numPets,
    hotelId,
    hotelConfig,
    rateCodeOverride,
  }: {
    target: OperaTarget;
    credentials: CalryCredentials;
    calryRoomTypeId: string;
    startDate: string;
    endDate: string;
    numAdults: number;
    numChildren: number;
    numPets: number;
    hotelId: string;
    hotelConfig: HotelConfiguration | null;
    rateCodeOverride?: string;
  }): Promise<PMSQuote> {
    const operaRoomType = await this.resolveOperaRoomTypeForBooking(
      target,
      credentials,
      calryRoomTypeId,
      hotelId,
    );

    const ratePlans = await operaClient.listRatePlans(target, credentials);
    const offer = await findOperaOffer({
      target,
      credentials,
      ratePlans,
      roomType: operaRoomType,
      startDate,
      endDate,
      adults: numAdults + numChildren,
      rateCodeConfig: rateCodeOverride
        ? { allowed: [rateCodeOverride] }
        : hotelConfig?.rate_code_config,
    });

    if (!offer) {
      throw new CalryRoomUnavailableError(
        `CalryReservationService: no Opera rate plan sells room type ${operaRoomType} between ${startDate} and ${endDate}`,
      );
    }

    return mapOperaRateInfoToPMSQuote({
      rateInfo: offer.rateInfo,
      ratePlanCode: offer.ratePlanCode,
      checkIn: startDate,
      checkOut: endDate,
      roomTypeId: calryRoomTypeId,
      numPets,
      hotelId,
      hotelConfig,
    });
  }

  /**
   * Re-checks each room type against Opera before a booking is placed.
   *
   * Opera's availability endpoint reports an open/closed status per date and
   * carries no unit counts, so a multi-unit request cannot be validated
   * against inventory the way the unified path does — it is logged rather
   * than silently treated as satisfied.
   */
  private async validateOperaAvailability({
    target,
    credentials,
    reservations,
    requiredByRoomType,
    hotelId,
  }: {
    target: OperaTarget;
    credentials: CalryCredentials;
    reservations: ReservationDTO[];
    requiredByRoomType: Map<string, number>;
    hotelId: string;
  }): Promise<void> {
    const hotelConfig =
      await hotelConfigurationService.getHotelConfigurationByHotelId(hotelId);
    const ratePlans = await operaClient.listRatePlans(target, credentials);

    for (const [calryRoomTypeId, requiredUnits] of requiredByRoomType) {
      const reservation = reservations.find(
        (r) => String(r.room_id) === calryRoomTypeId,
      )!;
      const checkIn = dayjs.utc(reservation.check_in).format('YYYY-MM-DD');
      const checkOut = dayjs.utc(reservation.check_out).format('YYYY-MM-DD');

      const operaRoomType = await this.resolveOperaRoomTypeForBooking(
        target,
        credentials,
        calryRoomTypeId,
        hotelId,
      );

      if (requiredUnits > 1) {
        logger.warn(
          'CalryReservationService.validateOperaAvailability: Opera reports no unit counts; multi-unit request validated as open/closed only',
          { operaRoomType, requiredUnits },
        );
      }

      const available = await isOperaRangeAvailable({
        target,
        credentials,
        ratePlans,
        roomType: operaRoomType,
        startDate: checkIn,
        endDate: checkOut,
        rateCodeConfig: hotelConfig?.rate_code_config,
      });

      if (!available) {
        throw new CalryRoomUnavailableError(
          `Room type ${operaRoomType} is no longer available for ${checkIn} to ${checkOut}`,
        );
      }
    }
  }

  /**
   * Every rate plan Opera will sell for one room type, priced.
   *
   * The unified `/quote` returns all plans in one call, but Opera prices one
   * plan at a time, so each candidate costs two calls. `rate_code_config`
   * therefore matters much more here than on the unified path — an
   * unconfigured hotel is capped at `OPERA_MAX_RATE_PLAN_CANDIDATES`.
   */
  private async operaRatesForRoomType({
    target,
    credentials,
    hotel,
    calryRoomTypeId,
    startDate,
    endDate,
    adults,
  }: {
    target: OperaTarget;
    credentials: CalryCredentials;
    hotel: HotelModel;
    calryRoomTypeId: string;
    startDate: string;
    endDate: string;
    adults: number;
  }): Promise<{ [roomName: string]: string }[]> {
    const hotelConfig =
      await hotelConfigurationService.getHotelConfigurationByHotelId(hotel.id);
    const operaRoomType = await this.resolveOperaRoomTypeForBooking(
      target,
      credentials,
      calryRoomTypeId,
      hotel.id,
    );

    const ratePlans = await operaClient.listRatePlans(target, credentials);
    const candidates = candidateRatePlans({
      ratePlans,
      roomType: operaRoomType,
      rateCodeConfig: hotelConfig?.rate_code_config,
    });

    const groups: { [roomName: string]: string }[] = [];

    for (const ratePlanCode of candidates) {
      const offer = await findOperaOffer({
        target,
        credentials,
        ratePlans,
        roomType: operaRoomType,
        startDate,
        endDate,
        adults,
        rateCodeConfig: { allowed: [ratePlanCode] },
      }).catch(() => null);
      if (!offer) continue;

      const total =
        offer.rateInfo.summary?.net ?? offer.rateInfo.summary?.gross;
      if (!total) continue;

      groups.push({
        [ratePlanCode]: `${ratePlanCode}: total of ${formatCurrencyAmount(
          offer.rateInfo.summary?.currencyCode ?? hotel.currency ?? 'USD',
          total,
        )} for the stay.`,
      });
    }

    return groups;
  }

  /** The Opera room type code behind a Calry room id, or throws. */
  private async resolveOperaRoomTypeForBooking(
    target: OperaTarget,
    credentials: CalryCredentials,
    calryRoomTypeId: string,
    hotelId: string,
  ): Promise<string> {
    const authConfig =
      await hotelConfigurationService.getExternalAuthConfigByHotelId(hotelId);

    const mapped = authConfig?.operaRoomTypeMap?.[calryRoomTypeId];
    if (mapped) return mapped;

    const [operaRoomTypes, calryRoomTypes] = await Promise.all([
      operaClient.listRoomTypes(target, credentials),
      this.client.getRoomTypes(credentials.propertyId, credentials),
    ]);
    const calryRoomType = calryRoomTypes.find(
      (rt) => rt.id === calryRoomTypeId,
    );

    const operaRoomType = resolveOperaRoomTypeCode({
      calryRoomTypeId,
      description: calryRoomType?.description,
      name: calryRoomType?.name,
      operaRoomTypes,
      roomTypeMap: authConfig?.operaRoomTypeMap,
    });

    if (!operaRoomType) {
      throw new CalryRoomUnavailableError(
        `CalryReservationService: cannot resolve an Opera room type for ${calryRoomTypeId}; configure operaRoomTypeMap`,
      );
    }
    return operaRoomType;
  }

  // ========== ROOM INFO ==========

  async getRoomsInfo(businessId: string): Promise<CalryRoomsInfo> {
    const hotel = await hotelService.getHotelByBusinessId(businessId);
    if (!hotel) {
      throw new NoDataError(
        `CalryReservationService.getRoomsInfo: Hotel not found for business_id ${businessId}`,
      );
    }

    const credentials = await resolveCalryCredentials(hotel);
    const roomTypes = await this.client.getRoomTypes(
      credentials.propertyId,
      credentials,
    );

    return {
      rooms: roomTypes.map(toRoomInfo),
      note: 'This is static room type information only. To check if rooms are available for specific dates, you must call the availability tool.',
    };
  }

  async getRoomTypeMap(businessId: string): Promise<Map<string, string>> {
    const { rooms } = await this.getRoomsInfo(businessId);
    return new Map(rooms.map((room) => [String(room.room_id), room.room_name]));
  }

  async validateMultiRoomOccupancy(
    peoplePerRoom: PeoplePerRoom,
    roomsInfo: CalryRoomsInfo,
    _hotelId: string,
  ): Promise<void> {
    if (!roomsInfo || !Array.isArray(roomsInfo.rooms)) {
      throw new BadRequestError('Invalid rooms information provided');
    }

    const roomMap = new Map(
      roomsInfo.rooms.map((room) => [String(room.room_id), room]),
    );

    for (const roomId of Object.keys(peoplePerRoom)) {
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

      for (const group of occupantGroups) {
        if (group.num_adults < 1) {
          throw new BadRequestError(
            `${room.room_name}: At least one adult is required per room`,
          );
        }

        const totalGuests = group.num_adults + group.num_children;
        if (room.max_occupancy != null && totalGuests > room.max_occupancy) {
          throw new BadRequestError(
            `${room.room_name}: Total guests (${totalGuests}) exceeds maximum occupancy (${room.max_occupancy})`,
          );
        }
      }
    }
  }

  // ========== AVAILABILITY ==========

  async validateRoomAvailability(
    reservations: ReservationDTO[] | null,
  ): Promise<void> {
    if (!reservations?.length) {
      throw new NoDataError(
        'CalryReservationService.validateRoomAvailability: No reservations provided',
      );
    }

    const first = reservations[0];
    if (!first.hotel) {
      throw new NoDataError(
        'CalryReservationService.validateRoomAvailability: reservation missing hotel context',
      );
    }

    const credentials = await resolveCalryCredentials(first.hotel as Hotel);

    // Count how many units of each room type this booking needs, so a
    // multi-room booking of the same type is validated against inventory
    // rather than passing on a single free unit.
    const requiredByRoomType = new Map<string, number>();
    for (const reservation of reservations) {
      const roomId = String(reservation.room_id);
      requiredByRoomType.set(roomId, (requiredByRoomType.get(roomId) ?? 0) + 1);
    }

    const operaTarget = await this.resolveOperaTargetFor(
      first.hotel.id,
      credentials,
    );
    if (operaTarget) {
      await this.validateOperaAvailability({
        target: operaTarget,
        credentials,
        reservations,
        requiredByRoomType,
        hotelId: first.hotel.id,
      });
      return;
    }

    await Promise.all(
      Array.from(requiredByRoomType.entries()).map(
        async ([roomTypeId, requiredUnits]) => {
          const reservation = reservations.find(
            (r) => String(r.room_id) === roomTypeId,
          )!;
          const checkIn = dayjs.utc(reservation.check_in).format('YYYY-MM-DD');
          const checkOut = dayjs
            .utc(reservation.check_out)
            .format('YYYY-MM-DD');

          const availability = await this.client.getAvailability(
            credentials.propertyId,
            {
              startDate: checkIn,
              endDate: checkOut,
              roomTypeId,
              rates: false,
            },
            credentials,
          );

          const unavailable = nightsInStay(
            availability.dateWiseAvailability,
            checkIn,
            checkOut,
          ).filter(
            (night) =>
              night.status !== 'AVAILABLE' ||
              (night.unitsAvailable ?? 0) < requiredUnits,
          );

          if (unavailable.length) {
            throw new CalryRoomUnavailableError(
              `Room type ${roomTypeId} is no longer available for ${checkIn} to ${checkOut}`,
            );
          }
        },
      ),
    );
  }

  /**
   * Availability and pricing for a date range. Calry splits these across two
   * endpoints — `GET /availability` says which room types are open and
   * `GET /quote` prices them — so each open room type costs one extra call.
   */
  async getRoomAvailabilityWithQuote(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    _phoneNumber: string,
    hotelPhoneNumber: string,
  ): Promise<CalryAvailabilityResponse> {
    const hotel =
      await hotelService.getHotelByAssistantPhoneNumber(hotelPhoneNumber);
    if (!hotel) {
      throw new NoDataError(
        `CalryReservationService.getRoomAvailabilityWithQuote: Hotel not found for phone ${hotelPhoneNumber}`,
      );
    }

    const credentials = await resolveCalryCredentials(hotel);
    const hotelConfig =
      await hotelConfigurationService.getHotelConfigurationByHotelId(hotel.id);

    const dateResult = validateAndCorrectDates(
      availabilityParams.start_date,
      availabilityParams.end_date,
      hotel.timezone,
      hotelConfig,
    );
    const startDate = dateResult.start_date;
    const endDate = dateResult.end_date;
    const dateCorrectionDetails = dateResult.dateCorrectionDetails;

    const numAdults = availabilityParams.num_adults;
    const numChildren = availabilityParams.num_children ?? 0;
    const numPets = availabilityParams.num_pets ?? 0;

    const roomTypes = await this.client.getRoomTypes(
      credentials.propertyId,
      credentials,
    );

    const operaTarget = await this.resolveOperaTargetFor(hotel.id, credentials);

    const groups = operaTarget
      ? await this.buildOperaRoomGroups({
          target: operaTarget,
          credentials,
          calryRoomTypes: roomTypes,
          startDate,
          endDate,
          numAdults,
          numChildren,
          numPets,
          hotelId: hotel.id,
          hotelConfig,
        })
      : (
          await Promise.all(
            roomTypes.map((roomType) =>
              this.buildRoomGroup({
                roomType,
                credentials,
                startDate,
                endDate,
                numAdults,
                numChildren,
                numPets,
                hotelId: hotel.id,
                hotelConfig,
              }),
            ),
          )
        ).filter((group): group is CalryRoomGroup => group !== null);

    if (hotel.payment_provider === PaymentProvider.NOT_APPLICABLE) {
      for (const group of groups) {
        group.pricing.amountCharged = 0;
      }
    }

    logKpi({
      stat: KpiStat.PmsAvailabilityRequested,
      value: 1,
      contextName: 'CalryReservationService.getRoomAvailabilityWithQuote',
      clientId: hotel.assistant_phone_number,
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
   * Checks one room type for availability and, if open for the whole stay,
   * prices it. Returns null when the room type is unavailable or its quote
   * cannot be fetched, so one bad room type never fails the whole search.
   */
  private async buildRoomGroup({
    roomType,
    credentials,
    startDate,
    endDate,
    numAdults,
    numChildren,
    numPets,
    hotelId,
    hotelConfig,
  }: {
    roomType: CalryRoomType;
    credentials: CalryCredentials;
    startDate: string;
    endDate: string;
    numAdults: number;
    numChildren: number;
    numPets: number;
    hotelId: string;
    hotelConfig: HotelConfiguration | null;
  }): Promise<CalryRoomGroup | null> {
    try {
      const availability = await this.client.getAvailability(
        credentials.propertyId,
        {
          startDate,
          endDate,
          roomTypeId: roomType.id,
          rates: true,
        },
        credentials,
      );

      const nights = nightsInStay(
        availability.dateWiseAvailability,
        startDate,
        endDate,
      );
      if (!nights.length) return null;

      const unitsAvailable = Math.min(
        ...nights.map((night) => night.unitsAvailable ?? 0),
      );
      const allOpen = nights.every((night) => night.status === 'AVAILABLE');
      if (!allOpen || unitsAvailable <= 0) return null;

      const quote = await this.fetchQuote({
        credentials,
        roomTypeId: roomType.id,
        startDate,
        endDate,
        guests: numAdults + numChildren,
      });

      const pricing = this.toPMSQuote({
        quote,
        roomTypeId: roomType.id,
        startDate,
        endDate,
        numPets,
        hotelId,
        hotelConfig,
      });

      return {
        room_id: roomType.id,
        room_name: roomType.name ?? roomType.id,
        available_units: unitsAvailable,
        deposit_rule_info: {},
        cancel_rule_info: {},
        pricing,
        raw_response: quote,
      };
    } catch (error) {
      logger.error(
        'CalryReservationService.buildRoomGroup: skipping room type',
        {
          roomTypeId: roomType.id,
          error: (error as Error).message,
        },
      );
      return null;
    }
  }

  async getRoomAvailabilityWithQuoteLite(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
  ): Promise<{
    groups: Array<Record<string, string>>;
    discount: null;
    date_correction_details?: string;
  }> {
    const hotel =
      await hotelService.getHotelByAssistantPhoneNumber(hotelPhoneNumber);
    if (!hotel) {
      throw new NoDataError(
        `CalryReservationService.getRoomAvailabilityWithQuoteLite: Hotel not found for phone ${hotelPhoneNumber}`,
      );
    }

    const availability = await this.getRoomAvailabilityWithQuote(
      availabilityParams,
      phoneNumber,
      hotelPhoneNumber,
    );

    const { start_date, end_date, num_adults } = availabilityParams;
    const numChildren = availabilityParams.num_children ?? 0;
    const nights = Math.max(1, dayjs(end_date).diff(dayjs(start_date), 'day'));
    const adultsText = num_adults === 1 ? '1 adult' : `${num_adults} adults`;
    const childrenText =
      numChildren === 1 ? '1 child' : `${numChildren} children`;

    const groups = availability.groups.map((group) => {
      const { base_rate, taxes, fees, total_amount } = group.pricing;
      const currency = group.pricing.currency ?? hotel.currency ?? 'USD';
      const description =
        `For ${adultsText} and ${childrenText}, with check-in on ${start_date} and check-out on ${end_date}, ` +
        `the ${group.room_name} (room_id: ${group.room_id}) has a base rate of ${formatCurrencyAmount(currency, base_rate)} ` +
        `for ${nights} night${nights > 1 ? 's' : ''}, taxes of ${formatCurrencyAmount(currency, taxes)}, ` +
        `fees of ${formatCurrencyAmount(currency, fees)}, and a total of ${formatCurrencyAmount(currency, total_amount)}. ` +
        `No payment is required to secure this reservation.`;
      return { [group.room_name]: description };
    });

    return {
      groups,
      discount: null,
      ...(availability.date_correction_details && {
        date_correction_details: availability.date_correction_details,
      }),
    };
  }

  /**
   * Multi-room availability. Occupancy is not known per room at this stage,
   * so it defaults to one adult — matching how Cloudbeds handles the same
   * gap.
   */
  async getMultiRoomAvailabilityWithQuote(
    availabilityParams: GetAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
  ): Promise<CalryAvailabilityResponse> {
    return this.getRoomAvailabilityWithQuote(
      { ...availabilityParams, num_adults: 1, num_children: 0 },
      phoneNumber,
      hotelPhoneNumber,
    );
  }

  async getMultiRoomAvailabilityWithQuoteLite(
    availabilityParams: GetAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
  ): Promise<{
    groups: Array<Record<string, string>>;
    discount: null;
    date_correction_details?: string;
  }> {
    return this.getRoomAvailabilityWithQuoteLite(
      { ...availabilityParams, num_adults: 1, num_children: 0 },
      phoneNumber,
      hotelPhoneNumber,
    );
  }

  async getRoomAvailabilityWithQuoteLiteV2(..._args: any[]): Promise<any> {
    throw new Error(
      'CalryReservationService: getRoomAvailabilityWithQuoteLiteV2 not supported',
    );
  }

  async getMultiRoomAvailabilityWithQuoteLiteV2(..._args: any[]): Promise<any> {
    throw new Error(
      'CalryReservationService: getMultiRoomAvailabilityWithQuoteLiteV2 not supported',
    );
  }

  /**
   * Every rate plan Calry returns for a room type, ignoring the hotel's
   * `rate_code_config` allow-list — the contract for this method is
   * explicitly to bypass it.
   */
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
    const hotel =
      await hotelService.getHotelByAssistantPhoneNumber(hotelPhoneNumber);
    if (!hotel) {
      throw new NoDataError(
        `CalryReservationService.getAllRatesForRoomType: Hotel not found for phone ${hotelPhoneNumber}`,
      );
    }

    const credentials = await resolveCalryCredentials(hotel);
    const guests =
      (availabilityParams.num_adults ?? 1) +
      (availabilityParams.num_children ?? 0);

    const operaTarget = await this.resolveOperaTargetFor(hotel.id, credentials);
    if (operaTarget) {
      return {
        groups: await this.operaRatesForRoomType({
          target: operaTarget,
          credentials,
          hotel,
          calryRoomTypeId: String(roomId),
          startDate: availabilityParams.start_date,
          endDate: availabilityParams.end_date,
          adults: guests,
        }),
      };
    }

    const quote = await this.fetchQuote({
      credentials,
      roomTypeId: String(roomId),
      startDate: availabilityParams.start_date,
      endDate: availabilityParams.end_date,
      guests,
    });

    const groups = describeRatePlans(quote.ratePlans).map((plan) => ({
      [plan.name]: `${plan.name}: total of ${formatCurrencyAmount(
        quote.currency ?? hotel.currency ?? 'USD',
        plan.totalPrice,
      )} for the stay.`,
    }));

    return { groups };
  }

  async getWebRoomAvailabilityV2(): Promise<never> {
    throw new BadRequestError(
      'CalryReservationService: web V2 availability is not supported for Calry',
    );
  }

  // ========== QUOTE ==========

  async getQuote(params: PMSQuoteRequest): Promise<PMSQuote> {
    const {
      room_id,
      check_in,
      check_out,
      num_adults,
      num_children = 0,
      num_pets = 0,
      hotel_id,
      rate_code,
    } = params;

    const hotel = await hotelService.getHotelById(hotel_id);
    if (!hotel) {
      throw new NoDataError(
        `CalryReservationService.getQuote: Hotel not found for hotel_id ${hotel_id}`,
      );
    }

    const credentials = await resolveCalryCredentials(hotel);
    const hotelConfig =
      await hotelConfigurationService.getHotelConfigurationByHotelId(hotel_id);

    const operaTarget = await this.resolveOperaTargetFor(hotel_id, credentials);
    if (operaTarget) {
      logKpi({
        stat: KpiStat.PmsQuoteRequested,
        value: 1,
        contextName: 'CalryReservationService.getQuote',
        clientId: hotel.assistant_phone_number,
      });
      return this.operaQuoteFor({
        target: operaTarget,
        credentials,
        calryRoomTypeId: String(room_id),
        startDate: check_in,
        endDate: check_out,
        numAdults: num_adults,
        numChildren: num_children,
        numPets: num_pets,
        hotelId: hotel_id,
        hotelConfig,
        rateCodeOverride: rate_code,
      });
    }

    const quote = await this.fetchQuote({
      credentials,
      roomTypeId: String(room_id),
      startDate: check_in,
      endDate: check_out,
      guests: num_adults + num_children,
    });

    logKpi({
      stat: KpiStat.PmsQuoteRequested,
      value: 1,
      contextName: 'CalryReservationService.getQuote',
      clientId: hotel.assistant_phone_number,
    });

    return this.toPMSQuote({
      quote,
      roomTypeId: String(room_id),
      startDate: check_in,
      endDate: check_out,
      numPets: num_pets,
      hotelId: hotel_id,
      hotelConfig,
      // An explicit rate code from the caller takes priority over the
      // hotel's configured allow-list.
      rateCodeOverride: rate_code,
    });
  }

  /**
   * Re-quotes the new date range outright. Calry only ever returns a
   * whole-stay price with no per-night breakdown, so there is nothing from
   * the stored quote worth reusing.
   */
  async getQuoteForModification(
    existingReservation: ReservationDTO,
    newCheckIn: string,
    newCheckOut: string,
    _discount: unknown,
    newRoomTypeId?: string | number,
  ): Promise<PMSQuote> {
    const hotelId =
      existingReservation.hotel?.id ?? existingReservation.hotel_id;
    if (!hotelId) {
      throw new NoDataError(
        'CalryReservationService.getQuoteForModification: hotel_id is required',
      );
    }

    return this.getQuote({
      business_id: existingReservation.business_id,
      room_id: newRoomTypeId ?? existingReservation.room_id,
      check_in: newCheckIn,
      check_out: newCheckOut,
      num_adults: existingReservation.num_adults,
      num_children: existingReservation.num_children ?? 0,
      num_pets: existingReservation.num_pets ?? 0,
      hotel_id: hotelId,
      caller_phone_num: existingReservation.phone_number,
      rate_code: existingReservation.rate_code ?? undefined,
    });
  }

  // ========== RESERVATION CRUD ==========

  async createReservation(
    params: CreateReservationParams,
  ): Promise<CreateReservationResponse> {
    const { reservation, customer, quote, notes_from_partner } = params;

    const credentials = await resolveCalryCredentials(reservation.hotel_id);
    const arrivalDate = dayjs.utc(reservation.check_in).format('YYYY-MM-DD');
    const departureDate = dayjs.utc(reservation.check_out).format('YYYY-MM-DD');

    const numAdults = reservation.num_adults;
    const numChildren = reservation.num_children ?? 0;

    const operaTarget = await this.resolveOperaTargetFor(
      reservation.hotel_id,
      credentials,
    );
    if (operaTarget) {
      return this.createOperaReservation({
        target: operaTarget,
        credentials,
        params,
        arrivalDate,
        departureDate,
        numAdults,
        numChildren,
      });
    }

    const created = await this.client.createReservation(
      {
        propertyId: credentials.propertyId,
        roomTypeId: String(reservation.room_id),
        arrivalDate,
        departureDate,
        guest: toCalryGuest(customer),
        status: CALRY_STATUS_CONFIRMED,
        numberOfGuests: numAdults + numChildren,
        numberOfAdults: numAdults,
        numberOfChildren: numChildren,
        numberOfPets: reservation.num_pets ?? 0,
        totalPrice: quote?.total_amount,
        currency: quote?.quote_object?.currency ?? reservation.hotel?.currency,
        ...(notes_from_partner && { notes: notes_from_partner }),
        ...(reservation.customer_special_request && {
          comments: reservation.customer_special_request,
        }),
      },
      credentials,
    );

    logKpi({
      stat: KpiStat.PmsBookingCreated,
      value: 1,
      contextName: 'CalryReservationService.createReservation',
      clientId: reservation.hotel?.assistant_phone_number,
      contextId: created.id,
    });

    this.verifyQuotedPrice(created, quote?.total_amount, reservation);

    return {
      reservation_id: created.id,
      external_public_id: created.id,
      ...(notes_from_partner && { notes_from_partner }),
    };
  }

  /**
   * Books on Opera through the passthrough.
   *
   * Calry's unified `POST /reservations` answers `500 This Integration
   * doesn't support this path/model` for Opera, so the reservation is built
   * against Opera's own contract instead. Unlike the unified path this *can*
   * bind the booking to a rate plan, so the quoted rate is what gets sold and
   * the post-create price check is not needed.
   */
  private async createOperaReservation({
    target,
    credentials,
    params,
    arrivalDate,
    departureDate,
    numAdults,
    numChildren,
  }: {
    target: OperaTarget;
    credentials: CalryCredentials;
    params: CreateReservationParams;
    arrivalDate: string;
    departureDate: string;
    numAdults: number;
    numChildren: number;
  }): Promise<CreateReservationResponse> {
    const { reservation, customer, quote, notes_from_partner } = params;
    const hotelId = reservation.hotel_id;

    const authConfig =
      await hotelConfigurationService.getExternalAuthConfigByHotelId(hotelId);
    const operaRoomType = await this.resolveOperaRoomTypeForBooking(
      target,
      credentials,
      String(reservation.room_id),
      hotelId,
    );

    const ratePlanCode =
      quote?.quote_object?.rate_code ?? reservation.rate_code;
    if (!ratePlanCode) {
      throw new BadRequestError(
        'CalryReservationService.createOperaReservation: a rate plan code is required to book on Opera',
      );
    }

    const nights = Math.max(1, dayjs(departureDate).diff(arrivalDate, 'day'));
    const total = quote?.total_amount ?? 0;
    const perNight = roundCurrency(total / nights);
    const currency =
      quote?.quote_object?.currency ?? reservation.hotel?.currency;

    const response = await operaClient.createReservation(
      target,
      {
        reservations: {
          reservation: [
            {
              sourceOfSale: {
                sourceType: 'PMS',
                sourceCode: target.propertyCode,
              },
              roomStay: {
                roomRates: [
                  {
                    total: { amountBeforeTax: String(total) },
                    rates: {
                      rate: [
                        {
                          base: {
                            amountBeforeTax: String(perNight),
                            ...(currency && { currencyCode: currency }),
                          },
                          start: arrivalDate,
                          end: departureDate,
                        },
                      ],
                    },
                    guestCounts: {
                      adults: String(numAdults),
                      children: String(numChildren),
                    },
                    roomType: operaRoomType,
                    ratePlanCode,
                    start: arrivalDate,
                    end: departureDate,
                    ...(authConfig?.operaMarketCode && {
                      marketCode: authConfig.operaMarketCode,
                    }),
                    ...(authConfig?.operaSourceCode && {
                      sourceCode: authConfig.operaSourceCode,
                    }),
                    numberOfUnits: '1',
                    roomTypeCharged: operaRoomType,
                    pseudoRoom: false,
                    houseUseOnly: false,
                    complimentary: false,
                    fixedRate: false,
                    discountAllowed: false,
                    bogoDiscount: false,
                  },
                ],
                guestCounts: {
                  adults: String(numAdults),
                  children: String(numChildren),
                },
                arrivalDate,
                departureDate,
                ...(authConfig?.operaGuaranteeCode && {
                  guarantee: { guaranteeCode: authConfig.operaGuaranteeCode },
                }),
                roomNumberLocked: false,
                printRate: false,
              },
              reservationGuests: [toOperaGuest(customer)],
              // No card at create: a card is attached afterwards, once it has
              // been tokenized. Cash keeps the reservation valid until then.
              reservationPaymentMethods: [
                { paymentMethod: 'CA', folioView: '1' },
              ],
              ...(toOperaComments(notes_from_partner) && {
                comments: toOperaComments(notes_from_partner),
              }),
              hotelId: target.propertyCode,
              roomStayReservation: true,
              reservationStatus: 'Reserved',
              computedReservationStatus: 'DueIn',
              walkIn: false,
              printRate: false,
              preRegistered: false,
              upgradeEligible: false,
              allowAutoCheckin: false,
              hasOpenFolio: false,
              allowMobileCheckout: false,
              allowMobileViewFolio: false,
              allowPreRegistration: false,
              optedForCommunication: false,
            },
          ],
        },
      },
      credentials,
    );

    const { reservationId, confirmationNumber } =
      extractOperaReservationIds(response);
    if (!reservationId) {
      throw new CalryAPIError(
        'Opera reservation create returned no reservation id',
        502,
      );
    }

    logKpi({
      stat: KpiStat.PmsBookingCreated,
      value: 1,
      contextName: 'CalryReservationService.createOperaReservation',
      clientId: reservation.hotel?.assistant_phone_number,
      contextId: reservationId,
    });

    return {
      reservation_id: reservationId,
      // The confirmation number is what a guest is read back; the numeric
      // reservation id is what every other Opera call is keyed by.
      external_public_id: confirmationNumber ?? reservationId,
      ...(notes_from_partner && { notes_from_partner }),
    };
  }

  /**
   * Calry cannot bind a reservation to a rate plan, so the PMS is free to
   * apply a rate other than the one quoted. Comparing what came back is the
   * only way to notice — it never fails the booking, since the guest has
   * already been told it is confirmed.
   */
  private verifyQuotedPrice(
    created: CalryReservation,
    quotedTotal: number | undefined,
    reservation: CreateReservationParams['reservation'],
  ): void {
    const bookedTotal = created.finances?.totalPrice ?? created.totalPrice;
    if (quotedTotal === undefined || bookedTotal === undefined) return;
    if (Math.abs(bookedTotal - quotedTotal) <= PRICE_MISMATCH_TOLERANCE) return;

    logger.warn(
      'CalryReservationService.createReservation: booked total differs from the quoted total',
      {
        booking_id: reservation.booking_id,
        calry_reservation_id: created.id,
        quotedTotal,
        bookedTotal,
      },
    );

    logKpi({
      stat: KpiStat.PmsQuotedPriceMismatch,
      value: 1,
      contextName: 'CalryReservationService.createReservation',
      clientId: reservation.hotel?.assistant_phone_number,
      contextId: created.id,
    });
  }

  async cancelReservation(params: {
    business_id: string;
    external_id: string;
    internal_id: string;
    reason?: string;
  }): Promise<{ status: boolean; reservation_id: string }> {
    if (!params.external_id) {
      throw new BadRequestError(
        'CalryReservationService.cancelReservation: external_id is required',
      );
    }

    const hotel = await hotelService.getHotelByBusinessId(params.business_id);
    if (!hotel) {
      throw new NoDataError(
        `CalryReservationService.cancelReservation: Hotel not found for business_id ${params.business_id}`,
      );
    }

    const credentials = await resolveCalryCredentials(hotel);

    const operaTarget = await this.resolveOperaTargetFor(hotel.id, credentials);
    if (operaTarget) {
      // Calry's unified update answers 500 for Opera, so the cancellation goes
      // to Opera's own endpoint.
      const authConfig =
        await hotelConfigurationService.getExternalAuthConfigByHotelId(
          hotel.id,
        );
      await operaClient.cancelReservation(
        operaTarget,
        params.external_id,
        params.reason ?? 'Cancelled by guest',
        authConfig?.operaCancellationReasonCode ?? 'CXL',
        credentials,
      );
    } else {
      // Calry has no cancel endpoint and no penalty or refund flags — a
      // cancellation is an update that sets the status.
      await this.client.updateReservation(
        {
          reservationId: params.external_id,
          status: CALRY_STATUS_CANCELLED,
        },
        credentials,
      );
    }

    logKpi({
      stat: KpiStat.PmsBookingCancelled,
      value: 1,
      contextName: 'CalryReservationService.cancelReservation',
      clientId: hotel.assistant_phone_number,
      contextId: params.external_id,
    });

    return { status: true, reservation_id: params.external_id };
  }

  async modifyReservation(
    existingReservation: ReservationDTO,
    newCheckIn: string,
    newCheckOut: string,
    _discount: unknown,
    newRoomTypeId?: string | number,
    newRateId?: string,
  ): Promise<PMSQuote> {
    const externalId = requireExternalId(
      existingReservation,
      'modifyReservation',
    );

    const hotelId =
      existingReservation.hotel?.id ?? existingReservation.hotel_id;
    if (!hotelId) {
      throw new NoDataError(
        'CalryReservationService.modifyReservation: hotel_id is required',
      );
    }

    const credentials = await resolveCalryCredentials(hotelId);

    const operaTarget = await this.resolveOperaTargetFor(hotelId, credentials);
    if (operaTarget) {
      // Calry's unified update answers 500 for Opera, so the new stay is sent
      // to Opera's own reservation endpoint. Opera *can* change dates, room
      // type and rate plan — it is only the unified path that cannot.
      await this.applyOperaModification({
        target: operaTarget,
        credentials,
        externalId,
        existingReservation,
        hotelId,
        newCheckIn,
        newCheckOut,
        newRoomTypeId,
        newRateId,
      });
    } else {
      assertNoRoomChange(
        existingReservation,
        newRoomTypeId,
        'modifyReservation',
      );
      await this.client.updateReservation(
        {
          reservationId: externalId,
          arrivalDate: newCheckIn,
          departureDate: newCheckOut,
          numberOfAdults: existingReservation.num_adults,
          numberOfChildren: existingReservation.num_children ?? 0,
          numberOfGuests:
            existingReservation.num_adults +
            (existingReservation.num_children ?? 0),
          numberOfPets: existingReservation.num_pets ?? 0,
        },
        credentials,
      );
    }

    logKpi({
      stat: KpiStat.PmsBookingModified,
      value: 1,
      contextName: 'CalryReservationService.modifyReservation',
      clientId: existingReservation.hotel?.assistant_phone_number,
      contextId: externalId,
    });

    return this.getQuoteForModification(
      existingReservation,
      newCheckIn,
      newCheckOut,
      null,
    );
  }

  async getExternalModificationInfo(
    reservationDetails: ReservationDTO,
    newCheckIn: string,
    newCheckOut: string,
    newRoomTypeId?: string | number,
  ): Promise<ExternalModificationInfo> {
    assertNoRoomChange(
      reservationDetails,
      newRoomTypeId,
      'getExternalModificationInfo',
    );

    const existingCheckIn = dayjs
      .utc(reservationDetails.check_in)
      .format('YYYY-MM-DD');
    const existingCheckOut = dayjs
      .utc(reservationDetails.check_out)
      .format('YYYY-MM-DD');

    const scenario = determineDateModificationScenario(
      existingCheckIn,
      existingCheckOut,
      newCheckIn,
      newCheckOut,
    );

    const currency = reservationDetails.hotel?.currency ?? 'USD';
    const base: ExternalModificationInfo = {
      scenario,
      pricingDelta: 0,
      available: true,
      rate_id: 0,
      rate_code: '',
      room_type_id: reservationDetails.room_id,
      adults: reservationDetails.num_adults,
      children: reservationDetails.num_children ?? 0,
      currency,
      newDateBreakdown: [],
    };

    if (scenario === 'same_dates') return base;

    const hotelId = reservationDetails.hotel?.id ?? reservationDetails.hotel_id;
    if (!hotelId) {
      throw new NoDataError(
        'CalryReservationService.getExternalModificationInfo: hotel_id is required',
      );
    }

    const hotel = await hotelService.getHotelById(hotelId);
    if (!hotel) {
      throw new NoDataError(
        `CalryReservationService.getExternalModificationInfo: Hotel not found for hotel_id ${hotelId}`,
      );
    }

    const credentials = await resolveCalryCredentials(hotel);
    const roomTypeId = String(reservationDetails.room_id);

    const available = await this.isRangeAvailable({
      credentials,
      roomTypeId,
      startDate: newCheckIn,
      endDate: newCheckOut,
      // The nights the guest already holds stay booked to them during a
      // modification, so they must not be counted against inventory.
      heldRange: { start: existingCheckIn, end: existingCheckOut },
    });

    if (!available) {
      return { ...base, available: false };
    }

    const hotelConfig =
      await hotelConfigurationService.getHotelConfigurationByHotelId(hotelId);

    const newQuote = await this.fetchQuote({
      credentials,
      roomTypeId,
      startDate: newCheckIn,
      endDate: newCheckOut,
      guests:
        reservationDetails.num_adults + (reservationDetails.num_children ?? 0),
    });

    const newPricing = this.toPMSQuote({
      quote: newQuote,
      roomTypeId,
      startDate: newCheckIn,
      endDate: newCheckOut,
      numPets: reservationDetails.num_pets ?? 0,
      hotelId,
      hotelConfig,
      rateCodeOverride: reservationDetails.rate_code ?? undefined,
    });

    const existingTotal =
      reservationDetails.quote?.quote_object?.total_amount ?? 0;

    return {
      ...base,
      currency: newPricing.currency ?? currency,
      pricingDelta: roundCurrency(newPricing.total_amount - existingTotal),
    };
  }

  async modifyExternalDirectReservation(
    reservationDetails: ReservationDTO,
    newCheckIn: string,
    newCheckOut: string,
    newRoomTypeId?: string | number,
  ): Promise<ExternalModificationInfo> {
    const externalId = requireExternalId(
      reservationDetails,
      'modifyExternalDirectReservation',
    );
    assertNoRoomChange(
      reservationDetails,
      newRoomTypeId,
      'modifyExternalDirectReservation',
    );

    const info = await this.getExternalModificationInfo(
      reservationDetails,
      newCheckIn,
      newCheckOut,
    );

    if (info.scenario === 'same_dates' || !info.available) {
      return info;
    }

    const hotelId = reservationDetails.hotel?.id ?? reservationDetails.hotel_id;
    if (!hotelId) {
      throw new NoDataError(
        'CalryReservationService.modifyExternalDirectReservation: hotel_id is required',
      );
    }

    const credentials = await resolveCalryCredentials(hotelId);

    await this.client.updateReservation(
      {
        reservationId: externalId,
        arrivalDate: newCheckIn,
        departureDate: newCheckOut,
      },
      credentials,
    );

    logKpi({
      stat: KpiStat.PmsBookingModified,
      value: 1,
      contextName: 'CalryReservationService.modifyExternalDirectReservation',
      clientId: reservationDetails.hotel?.assistant_phone_number,
      contextId: externalId,
    });

    return info;
  }

  async cancelExternalDirectReservation(
    reservationDetails: ReservationDTO,
    reason?: string,
  ): Promise<{ status: boolean; reservation_id: string }> {
    const externalId = requireExternalId(
      reservationDetails,
      'cancelExternalDirectReservation',
    );

    return this.cancelReservation({
      business_id: String(reservationDetails.business_id),
      external_id: externalId,
      internal_id: reservationDetails.id,
      reason,
    });
  }

  // ========== LOOKUP ==========

  async lookupReservationsById(
    hotel: HotelModel,
    bookingId: string,
  ): Promise<ReservationDTO[]> {
    try {
      const credentials = await resolveCalryCredentials(hotel as Hotel);

      const reservation = await this.getReservationByIdOrConfirmation(
        hotel,
        bookingId,
        credentials,
      );

      const { configuration } =
        await hotelService.getHotelWithConfigurationsAndChannels(hotel.id);

      return [mapCalryReservationToDTO(reservation, hotel, configuration)];
    } catch (error) {
      logger.error('CalryReservationService.lookupReservationsById failed', {
        error,
        hotelId: hotel.id,
        bookingId,
      });
      return [];
    }
  }

  /**
   * Applies a modification to an Opera reservation: dates, and optionally a
   * new room type or rate plan.
   *
   * A room or rate change has to restate the whole `roomRates` entry — Opera
   * rejects a partial one with `RSV01414 Source code is required` — so the
   * market and source codes come from config alongside the new values. A
   * dates-only change sends just `roomStay`, which Opera reprices against the
   * reservation's existing plan.
   */
  private async applyOperaModification({
    target,
    credentials,
    externalId,
    existingReservation,
    hotelId,
    newCheckIn,
    newCheckOut,
    newRoomTypeId,
    newRateId,
  }: {
    target: OperaTarget;
    credentials: CalryCredentials;
    externalId: string;
    existingReservation: ReservationDTO;
    hotelId: string;
    newCheckIn: string;
    newCheckOut: string;
    newRoomTypeId?: string | number;
    newRateId?: string;
  }): Promise<void> {
    const adults = existingReservation.num_adults;
    const children = existingReservation.num_children ?? 0;

    const roomChanged =
      newRoomTypeId !== undefined &&
      String(newRoomTypeId) !== String(existingReservation.room_id);
    const rateChanged =
      newRateId !== undefined && newRateId !== existingReservation.rate_code;

    if (!roomChanged && !rateChanged) {
      await operaClient.updateReservationStay(
        target,
        externalId,
        {
          arrivalDate: newCheckIn,
          departureDate: newCheckOut,
          adults,
          children,
        },
        credentials,
      );
      return;
    }

    const authConfig =
      await hotelConfigurationService.getExternalAuthConfigByHotelId(hotelId);
    const operaRoomType = await this.resolveOperaRoomTypeForBooking(
      target,
      credentials,
      String(newRoomTypeId ?? existingReservation.room_id),
      hotelId,
    );
    const ratePlanCode = newRateId ?? existingReservation.rate_code;
    if (!ratePlanCode) {
      throw new BadRequestError(
        'CalryReservationService.applyOperaModification: a rate plan code is required to change the room or rate',
      );
    }

    await operaClient.updateReservationRoomRate(
      target,
      externalId,
      {
        arrivalDate: newCheckIn,
        departureDate: newCheckOut,
        adults,
        children,
        roomType: operaRoomType,
        ratePlanCode,
        marketCode: authConfig?.operaMarketCode,
        sourceCode: authConfig?.operaSourceCode,
      },
      credentials,
    );
  }

  /**
   * Fetches a reservation by whichever identifier the caller has.
   *
   * A Daisy `BK…` booking id never reaches here — it is answered from our own
   * database — so the input is either a PMS reservation id or the confirmation
   * number a guest reads off their email. The two are indistinguishable by
   * shape, so the reservation id is tried first (the cheap path, one call) and
   * a confirmation number is only resolved once that fails.
   */
  private async getReservationByIdOrConfirmation(
    hotel: HotelModel,
    identifier: string,
    credentials: CalryCredentials,
  ): Promise<CalryReservation> {
    try {
      return await this.client.getReservation(identifier, credentials);
    } catch (error) {
      const operaTarget = await this.resolveOperaTargetFor(
        hotel.id,
        credentials,
      );
      if (!operaTarget) throw error;

      const reservationId = await operaClient.findReservationIdByConfirmation(
        operaTarget,
        identifier,
        credentials,
      );
      if (!reservationId) throw error;

      return this.client.getReservation(reservationId, credentials);
    }
  }

  /**
   * Not implemented, on Opera as well as the unified path.
   *
   * Calry exposes no phone filter on any reservation endpoint, and scanning a
   * date-windowed list to match on `primaryGuest.mobileNumbers` would be both
   * slow and incomplete. Opera has no phone filter either: `phoneNumber` on
   * `/crm/v1/profiles` is rejected outright, so finding a booking would mean
   * searching profiles some other way and then joining to reservations.
   *
   * Guests are asked for their confirmation number instead — see
   * `lookupReservationsById`, which resolves one to a reservation id. Throwing
   * keeps this distinguishable from a genuine "no bookings found".
   */
  async lookupReservationsByPhone(): Promise<ReservationDTO[]> {
    throw new BadRequestError(
      'CalryReservationService: looking up reservations by phone number is not supported for Calry. Please ask the guest for their confirmation number.',
    );
  }

  // ========== RATES ==========

  /**
   * Resolves a rate code against the hotel's configured allow-list. Calry
   * exposes no separate numeric rate id, so the code is its own id.
   */
  async getRateIdByCode(
    hotelId: number | string,
    rateCode: string,
  ): Promise<number | string | undefined> {
    if (!rateCode) return undefined;

    const hotelConfig =
      await hotelConfigurationService.getHotelConfigurationByHotelId(
        String(hotelId),
      );
    const allowed = hotelConfig?.rate_code_config?.allowed ?? [];
    const match = allowed.find(
      (code) => code.toUpperCase() === rateCode.toUpperCase(),
    );
    return match ? match.toUpperCase() : undefined;
  }

  // ========== RESERVATION ENRICHMENT ==========

  /**
   * Calry has no discount or promotion support for our hotels —
   * `promotionCode` on `GET /quote` is limited to a handful of vacation
   * rental integrations that do not include ours.
   */
  shouldFetchDiscount(): boolean {
    return false;
  }

  /**
   * Calry has no addon or product concept, so pets are recorded twice: as
   * the native `numberOfPets` field on the reservation, and as text here so
   * the count is visible to staff in the PMS.
   */
  buildPartnerNotes({ numPets }: ReservationNotesContext): string | null {
    if (!numPets || numPets <= 0) return null;
    return `Number of Pets = ${numPets};`;
  }

  // ========== INTERNAL HELPERS ==========

  private async fetchQuote({
    credentials,
    roomTypeId,
    startDate,
    endDate,
    guests,
  }: {
    credentials: CalryCredentials;
    roomTypeId: string;
    startDate: string;
    endDate: string;
    guests: number;
  }): Promise<CalryQuote> {
    return this.client.getQuote(
      credentials.propertyId,
      {
        startDate,
        endDate,
        guests: Math.max(1, guests),
        roomTypeId,
      },
      credentials,
    );
  }

  private toPMSQuote({
    quote,
    roomTypeId,
    startDate,
    endDate,
    numPets,
    hotelId,
    hotelConfig,
    rateCodeOverride,
  }: {
    quote: CalryQuote;
    roomTypeId: string;
    startDate: string;
    endDate: string;
    numPets: number;
    hotelId: string;
    hotelConfig: HotelConfiguration | null;
    rateCodeOverride?: string;
  }): PMSQuote {
    const rateCodeConfig = rateCodeOverride
      ? { allowed: [rateCodeOverride] }
      : hotelConfig?.rate_code_config;

    const selected = selectRatePlan(quote.ratePlans, rateCodeConfig, {
      hotelId,
      roomTypeId,
    });

    if (!selected) {
      throw new CalryRoomUnavailableError(
        `CalryReservationService: no rate plan returned for room type ${roomTypeId} between ${startDate} and ${endDate}`,
      );
    }

    return mapCalryRatePlanToPMSQuote({
      quote,
      plan: selected.plan,
      rateCode: selected.rateCode,
      checkIn: startDate,
      checkOut: endDate,
      roomTypeId,
      numPets,
      hotelId,
      hotelConfig,
    });
  }

  private async isRangeAvailable({
    credentials,
    roomTypeId,
    startDate,
    endDate,
    heldRange,
  }: {
    credentials: CalryCredentials;
    roomTypeId: string;
    startDate: string;
    endDate: string;
    heldRange?: { start: string; end: string };
  }): Promise<boolean> {
    const availability = await this.client.getAvailability(
      credentials.propertyId,
      { startDate, endDate, roomTypeId, rates: false },
      credentials,
    );

    const nights = nightsInStay(
      availability.dateWiseAvailability,
      startDate,
      endDate,
    );
    if (!nights.length) return false;

    return nights.every((night) => {
      if (
        heldRange &&
        isWithinStay(night.date, heldRange.start, heldRange.end)
      ) {
        return true;
      }
      return night.status === 'AVAILABLE' && (night.unitsAvailable ?? 0) > 0;
    });
  }
}

// ========== MODULE HELPERS ==========

/**
 * Calry's availability range is inclusive of `endDate`, but the checkout
 * night is never occupied — so the last entry is dropped.
 */
function nightsInStay<T extends { date: string }>(
  dateWiseAvailability: T[] | undefined,
  checkIn: string,
  checkOut: string,
): T[] {
  return (dateWiseAvailability ?? []).filter((entry) =>
    isWithinStay(entry.date, checkIn, checkOut),
  );
}

function isWithinStay(
  date: string,
  checkIn: string,
  checkOut: string,
): boolean {
  return date >= checkIn && date < checkOut;
}

function toRoomInfo(roomType: CalryRoomType): CalryRoomInfo {
  return {
    room_id: roomType.id,
    room_name: roomType.name ?? roomType.id,
    description: roomType.description,
    max_occupancy: roomType.maxOccupancy,
  };
}

/**
 * The guest profile Opera stores against a reservation.
 *
 * Phone and address are sent because a nameless profile is not something a
 * hotel can act on, and the unified Calry path and every other PMS
 * integration send them. Email is deliberately omitted: Opera mails the guest
 * off the profile, and confirmation email is Dextr's to send, not the
 * property's.
 */
function toOperaGuest(
  customer: CreateReservationParams['customer'],
): Record<string, unknown> {
  const address = customer.address;

  return {
    profileInfo: {
      profile: {
        customer: {
          personName: [
            {
              givenName: customer.first_name,
              surname: customer.last_name,
              nameType: 'Primary',
            },
          ],
          language: 'E',
        },
        ...(customer.phone_number && {
          telephones: {
            telephoneInfo: [
              {
                telephone: {
                  phoneTechType: 'PHONE',
                  phoneUseType: 'MOBILE',
                  phoneNumber: customer.phone_number,
                  orderSequence: '1',
                  primaryInd: true,
                },
              },
            ],
          },
        }),
        ...(address && {
          addresses: {
            addressInfo: [
              {
                address: {
                  addressLine: [address.address_first_line].filter(Boolean),
                  cityName: address.city,
                  postalCode: address.postal_code,
                  state: address.state_or_province,
                  ...(address.country && {
                    country: { value: address.country },
                  }),
                  primaryInd: true,
                },
              },
            ],
          },
        }),
        profileType: 'Guest',
      },
    },
    primary: true,
  };
}

/**
 * Reservation comments Opera shows the front desk. This is how the hotel
 * learns about pets and special requests — `buildPartnerNotes` writes them,
 * so dropping them means the property never sees them.
 */
function toOperaComments(text: string | undefined): unknown[] | undefined {
  if (!text?.trim()) return undefined;

  return [
    {
      comment: {
        text: { value: text },
        commentTitle: 'General Notes',
        notificationLocation: 'RESERVATION',
        type: 'GEN',
        internal: false,
      },
    },
  ];
}

function toCalryGuest(
  customer: CreateReservationParams['customer'],
): CalryGuestWrite {
  const address = customer.address;
  return {
    firstName: customer.first_name,
    lastName: customer.last_name,
    email: customer.email,
    phone: customer.phone_number,
    ...(address && {
      address: {
        line1: address.address_first_line,
        city: address.city,
        state: address.state_or_province,
        postalCode: address.postal_code,
        country: address.country,
      },
    }),
  };
}

function requireExternalId(
  reservation: ReservationDTO,
  method: string,
): string {
  if (!reservation.external_id) {
    throw new BadRequestError(
      `CalryReservationService.${method}: external_id is required`,
    );
  }
  return reservation.external_id;
}

/**
 * Calry's update endpoint accepts neither `propertyId` nor `roomTypeId`, so
 * a room move is impossible. Refusing loudly beats silently changing only
 * the dates and leaving the guest in the wrong room type.
 */
function assertNoRoomChange(
  reservation: ReservationDTO,
  newRoomTypeId: string | number | undefined,
  method: string,
): void {
  if (
    newRoomTypeId !== undefined &&
    String(newRoomTypeId) !== String(reservation.room_id)
  ) {
    throw new BadRequestError(
      `CalryReservationService.${method}: changing the room type of an existing reservation is not supported for Calry. Please cancel and rebook, or contact the hotel directly.`,
    );
  }
}

const calryReservationService = new CalryReservationService();
export default calryReservationService;
