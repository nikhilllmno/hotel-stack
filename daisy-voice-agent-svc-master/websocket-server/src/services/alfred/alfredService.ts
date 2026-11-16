import axios, { AxiosInstance } from 'axios';
import defaultCloudbedsReservationService, {
  CloudbedsReservationService,
} from '../../cloudbeds/services/reservationService';
import { CloudbedsGetReservationResponseData } from '../../cloudbeds/types';
import { mapCloudbedsStatus } from '../../cloudbeds/utils/mapGetReservationToReservationDTO';
import config from '../../config';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { Hotel } from '../../dtos/Hotel';
import { Reservation as ReservationDTO } from '../../dtos/Reservation';
import { AlfredError } from '../../errors/AlfredError';
import { DoorCodeRestrictedError } from '../../errors/DoorCodeRestrictedError';
import { NoDataError } from '../../errors/NoDataError';
import { PmsProvider } from '../../types/enums';
import { DoorLockSourceOfTruth } from '../../types/hotelConfiguration';
import { digitsToSpoken } from '../../utils/helper';
import { KpiStat, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import { hotelService, HotelService } from '../hotel/hotelService';
import {
  hotelConfigurationService,
  HotelConfigurationService,
} from '../hotelConfiguration/hotelConfigurationService';
import roomReservationService, {
  RoomReservationService,
} from '../roomReservation/roomReservationService';
import alfredInstance from './alfredClient';

export interface GetByExternalPartnerParams {
  externalPartnerId: string;
  tenantId: string;
}

export interface GetByLastNameAndCheckoutParams {
  lastName: string;
  checkoutDate: string;
  tenantId: string;
}

export type CustomerLookupParams =
  | GetByExternalPartnerParams
  | GetByLastNameAndCheckoutParams;

export interface AlfredCustomer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  country_code: string;
  phone_number: string;
  tenant_id: string;
  room_number: string | null;
  room_type: string | null;
  checkin_time: string | null;
  checkout_time: string | null;
  expected_checkout_time: string | null;
  expected_checkin_time: string | null;
  created_at: string;
  updated_at: string;
  products: Record<string, unknown>;
  escalation_counts: number | null;
  escalation_count: number | null;
  chat_call_type: string | null;
  message_channel: string | null;
  cleaning_preference: string | null;
  metadata: Record<string, unknown> | null;
  external_partner_id: string;
  external_partner_channel: string | null;
  external_partner_doorcode: string | null;
}

export type GetDoorCodeParams = CustomerLookupParams;

export interface GetDoorCodeResult {
  doorCode: string;
  doorCodeSpoken: string;
}

export interface DoorCodeGuardContext {
  assistantPhoneNumber: string;
  customerPhoneNumber: string;
}

export type GetReservationDetailsParams = CustomerLookupParams;

export interface ReservationDetailsResult {
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phoneNumber: string;
    countryCode: string;
  };
  room: {
    roomNumber: string | null;
    roomType: string | null;
    doorCode: string | null;
  };
  dates: {
    checkinTime: string | null;
    checkoutTime: string | null;
    expectedCheckinTime: string | null;
    expectedCheckoutTime: string | null;
  };
}

function isExternalPartnerLookup(
  params: CustomerLookupParams,
): params is GetByExternalPartnerParams {
  return 'externalPartnerId' in params;
}

const DOOR_CODE_NO_RESERVATION_MESSAGE =
  'Door code unavailable — no matching reservation found';
const DOOR_CODE_UNPAID_MESSAGE =
  'Door code unavailable until the reservation is fully paid';

/** Whether a matching reservation was found, and if so whether it's paid. */
interface ReservationEligibility {
  exists: boolean;
  paid: boolean;
}

/**
 * A reservation resolved from one of the lookup sources, normalized so results
 * from our DB and from the PMS can be merged and de-duplicated. `ids` holds
 * every identifier the same booking might be known by across sources.
 */
interface ReservationCandidate {
  ids: string[];
  paid: boolean;
}

export interface UpdateCustomerPhoneNumberParams {
  customerId: string;
  phoneNumber: string;
}

export class AlfredService {
  private client: AxiosInstance;

  constructor(
    client: AxiosInstance = alfredInstance,
    private hotelServiceInstance: HotelService = hotelService,
    private roomReservationServiceInstance: RoomReservationService = roomReservationService,
    private cloudbedsReservationServiceInstance: CloudbedsReservationService = defaultCloudbedsReservationService,
    private hotelConfigurationServiceInstance: HotelConfigurationService = hotelConfigurationService,
  ) {
    this.client = client;
  }

  /**
   * Resolves a customer using either external partner ID or last name + checkout date.
   * Last-name lookup returns an array since multiple guests can share the same name/checkout.
   */
  async resolveCustomer(
    params: CustomerLookupParams,
  ): Promise<AlfredCustomer | AlfredCustomer[]> {
    if (isExternalPartnerLookup(params)) {
      return this.getByExternalPartner(params);
    }
    return this.getByLastNameAndCheckout(params);
  }

  async getByExternalPartner(
    params: GetByExternalPartnerParams,
  ): Promise<AlfredCustomer> {
    const { externalPartnerId, tenantId } = params;

    try {
      logger.info(
        `AlfredService: Fetching customer for externalPartnerId=${externalPartnerId}, tenantId=${tenantId}`,
      );

      const response = await this.client.get<AlfredCustomer>(
        `/api/v1/customers/external-partner/${externalPartnerId}`,
        { params: { tenant_id: tenantId } },
      );

      return response.data;
    } catch (error) {
      this.handleAlfredError(error, `externalPartnerId=${externalPartnerId}`);
    }
  }

  async getByLastNameAndCheckout(
    params: GetByLastNameAndCheckoutParams,
  ): Promise<AlfredCustomer[]> {
    const { lastName, checkoutDate, tenantId } = params;

    try {
      logger.info(
        `AlfredService: Fetching customers for lastName=${lastName}, checkoutDate=${checkoutDate}, tenantId=${tenantId}`,
      );

      const response = await this.client.get<AlfredCustomer[]>(
        `/api/v1/customers/lookup/last-name`,
        {
          params: {
            last_name: lastName,
            checkout_date: checkoutDate,
            tenant_id: tenantId,
          },
        },
      );

      return response.data;
    } catch (error) {
      this.handleAlfredError(
        error,
        `lastName=${lastName}, checkoutDate=${checkoutDate}`,
      );
    }
  }

  async updateCustomerPhoneNumber(
    params: UpdateCustomerPhoneNumberParams,
  ): Promise<AlfredCustomer> {
    const { customerId, phoneNumber } = params;

    try {
      logger.info(
        `AlfredService: Updating phone number for customerId=${customerId}`,
      );

      const response = await this.client.patch<AlfredCustomer>(
        `/api/v1/customers/${customerId}/number`,
        null,
        { params: { phone_number: phoneNumber } },
      );

      return response.data;
    } catch (error) {
      this.handleAlfredError(error, `customerId=${customerId}`);
    }
  }

  private handleAlfredError(error: unknown, context: string): never {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;

      switch (status) {
        case 404:
          logger.warn(
            `AlfredService: Customer not found in Alfred for ${context}`,
          );
          throw new AlfredError('Customer not found', 404);
        case 401:
        case 403:
          logger.error(
            `AlfredService: Auth failure from Alfred, status=${status}`,
          );
          throw new AlfredError('Alfred authentication failed', status);
        case 500:
          logger.error(`AlfredService: Alfred internal error for ${context}`);
          throw new AlfredError('Alfred internal error', 500);
        default:
          logger.error(
            `AlfredService: Unexpected Alfred error, status=${status}, message=${error.message}`,
          );
          throw new AlfredError(
            `Alfred error: ${error.message}`,
            status || 502,
          );
      }
    }

    logger.error(`AlfredService: Unexpected error: ${error}`);
    throw new AlfredError('Unexpected error calling Alfred', 500);
  }

  async getDoorCodeByExternalPartner(
    params: GetDoorCodeParams,
    guardContext: DoorCodeGuardContext,
  ): Promise<GetDoorCodeResult> {
    const lookupParams = this.buildLookupParams(params);

    logger.info(
      `AlfredService: Fetching door code, lookup=${JSON.stringify(lookupParams)}`,
    );

    const hotel =
      await this.hotelServiceInstance.getHotelByAssistantPhoneNumber(
        guardContext.assistantPhoneNumber,
      );

    if (!hotel) {
      throw new AlfredError(
        'Hotel not found for the given assistant phone number',
        404,
      );
    }

    const hotelConfig =
      await this.hotelConfigurationServiceInstance.getHotelConfigurationByHotelId(
        hotel.id,
      );
    const doorLockConfig = hotelConfig?.door_lock_config;
    const sourceOfTruth = doorLockConfig?.source_of_truth;

    if (sourceOfTruth === DoorLockSourceOfTruth.DAISY) {
      return this.resolveDoorCodeViaDaisy(
        hotel,
        lookupParams,
        guardContext,
        doorLockConfig?.door_lock_custom_field,
      );
    }

    return this.resolveDoorCodeViaAlfred(lookupParams, guardContext);
  }

  /**
   * Daisy-native door code resolution. Routes to PMS-specific resolvers
   * based on the hotel's pms_provider.
   */
  private async resolveDoorCodeViaDaisy(
    hotel: Hotel,
    params: GetDoorCodeParams,
    guardContext: DoorCodeGuardContext,
    doorLockCustomFieldShortcode?: string,
  ): Promise<GetDoorCodeResult> {
    logger.info(
      `AlfredService: Resolving door code via Daisy for hotel=${hotel.id}, pms=${hotel.pms_provider}`,
    );

    if (hotel.pms_provider === PmsProvider.CLOUDBEDS) {
      await this.enforceProspectorInnPaymentGuard(params, guardContext);
      return this.cloudbedsDoorCodeResolver(
        hotel,
        params,
        doorLockCustomFieldShortcode,
      );
    }

    throw new AlfredError(
      `Door code resolution via Daisy is not supported for PMS provider: ${hotel.pms_provider}`,
      400,
    );
  }

  /**
   * Cloudbeds-specific door code resolver. Resolves the reservation ID from
   * either an external partner ID or a last-name + checkout-date lookup,
   * then delegates to CloudbedsReservationService.resolveDoorCode.
   */
  private async cloudbedsDoorCodeResolver(
    hotel: Hotel,
    params: GetDoorCodeParams,
    doorLockCustomFieldShortcode?: string,
  ): Promise<GetDoorCodeResult> {
    try {
      const reservationId = await this.resolveCloudbedsReservationId(
        hotel,
        params,
      );

      if (!reservationId) {
        throw new AlfredError(
          'No matching Cloudbeds reservation found for door code lookup',
          404,
        );
      }

      const doorCode =
        await this.cloudbedsReservationServiceInstance.resolveDoorCode(
          hotel,
          reservationId,
          doorLockCustomFieldShortcode,
        );

      if (!doorCode) {
        throw new AlfredError('Door code not found for this reservation', 404);
      }

      return {
        doorCode,
        doorCodeSpoken: digitsToSpoken(doorCode),
      };
    } catch (error) {
      if (error instanceof AlfredError) {
        throw error;
      }
      logger.error(
        `AlfredService: cloudbedsDoorCodeResolver failed for hotel=${hotel.id}: ${error}`,
      );
      throw new AlfredError('Failed to resolve Cloudbeds door code', 500);
    }
  }

  /**
   * Resolves a Cloudbeds reservation ID from the lookup params. When the
   * caller provides an external partner ID it's used directly; when they
   * provide last-name + checkout-date we query Cloudbeds for matching
   * reservations and pick the first active one.
   */
  private async resolveCloudbedsReservationId(
    hotel: Hotel,
    params: GetDoorCodeParams,
  ): Promise<string | null> {
    try {
      if (isExternalPartnerLookup(params)) {
        return params.externalPartnerId;
      }

      const reservations =
        await this.cloudbedsReservationServiceInstance.getReservationsByExactLastNameFromCloudbeds(
          hotel,
          params.lastName,
        );

      const matchingReservation = reservations.find(
        (r) =>
          r.endDate === params.checkoutDate &&
          this.isCloudbedsReservationActive(r),
      );

      return matchingReservation?.reservationID ?? null;
    } catch (error) {
      logger.error(
        `AlfredService: resolveCloudbedsReservationId failed for hotel=${hotel.id}: ${error}`,
      );
      return null;
    }
  }

  /**
   * Existing Alfred-based door code resolution path.
   */
  private async resolveDoorCodeViaAlfred(
    params: GetDoorCodeParams,
    guardContext: DoorCodeGuardContext,
  ): Promise<GetDoorCodeResult> {
    await this.enforceProspectorInnPaymentGuard(params, guardContext);

    const result = await this.resolveCustomer(params);

    if (!result) {
      throw new AlfredError('Customer not found', 404);
    }

    const customer = this.pickSingleCustomer(result);

    const doorCode = customer.external_partner_doorcode;

    if (doorCode === undefined || doorCode === null) {
      logger.warn(`AlfredService: No door code found in Alfred response`);
      throw new AlfredError('Door code not found in Alfred response', 404);
    }

    const doorCodeStr = String(doorCode);
    const doorCodeSpoken = digitsToSpoken(doorCodeStr);

    return {
      doorCode: doorCodeStr,
      doorCodeSpoken,
    };
  }

  async getReservationDetailsByExternalPartner(
    params: GetReservationDetailsParams,
  ): Promise<ReservationDetailsResult | ReservationDetailsResult[]> {
    const lookupParams = this.buildLookupParams(params);

    logger.info(
      `AlfredService: Fetching reservation details, lookup=${JSON.stringify(lookupParams)}`,
    );

    const result = await this.resolveCustomer(lookupParams);

    if (!result) {
      throw new AlfredError('Customer not found', 404);
    }

    if (Array.isArray(result)) {
      if (result.length === 0) {
        throw new AlfredError('Customer not found', 404);
      }
      return result.map((c) => this.toReservationDetails(c));
    }

    return this.toReservationDetails(result);
  }

  private toReservationDetails(
    customer: AlfredCustomer,
  ): ReservationDetailsResult {
    return {
      customer: {
        id: customer.id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
        phoneNumber: customer.phone_number,
        countryCode: customer.country_code,
      },
      room: {
        roomNumber: customer.room_number,
        roomType: customer.room_type,
        doorCode: customer.external_partner_doorcode,
      },
      dates: {
        checkinTime: customer.checkin_time,
        checkoutTime: customer.checkout_time,
        expectedCheckinTime: customer.expected_checkin_time,
        expectedCheckoutTime: customer.expected_checkout_time,
      },
    };
  }

  private pickSingleCustomer(
    result: AlfredCustomer | AlfredCustomer[],
  ): AlfredCustomer {
    if (!Array.isArray(result)) {
      return result;
    }

    if (result.length === 0) {
      throw new AlfredError('Customer not found', 404);
    }

    if (result.length > 1) {
      logger.warn(
        `AlfredService: Multiple customers found (${result.length}), using first match`,
      );
    }

    return result[0];
  }

  /**
   * Prospector Inn withholds the door code from external partners until a
   * matching reservation exists in our records AND has been paid in full. The
   * reservation is resolved by querying our DB and the PMS (Cloudbeds) together
   * — neither is a fallback for the other — merging the results and dropping
   * duplicates; only when a reservation exists and is fully paid does the caller
   * go on to fetch the door code from Alfred. Exactly one of two lookup modes
   * always applies:
   *  - an external partner ID, matched exactly against the reservation's
   *    external_id/external_public_id/booking_id;
   *  - a checkout date + last name, matched with an exact (non-fuzzy) query.
   * A reservation found in our DB has its balance computed the same way as
   * everywhere else; one that exists only in Cloudbeds has its balance read
   * directly from the Cloudbeds API. A failure of one source is ignored as long
   * as the other returned a result.
   */
  private async enforceProspectorInnPaymentGuard(
    params: GetDoorCodeParams,
    guardContext: DoorCodeGuardContext,
  ): Promise<void> {
    const hotel =
      await this.hotelServiceInstance.getHotelByAssistantPhoneNumber(
        guardContext.assistantPhoneNumber,
      );

    if (!hotel || hotel.id !== config.PROSPECTOR_INN_ID) {
      return;
    }

    const eligibility = isExternalPartnerLookup(params)
      ? await this.resolveExternalPartnerReservation(
          hotel,
          guardContext,
          params.externalPartnerId,
        )
      : await this.resolveLastNameReservation(
          hotel,
          params.lastName,
          params.checkoutDate,
        );

    if (!eligibility.exists) {
      this.rejectDoorCode(
        hotel,
        DOOR_CODE_NO_RESERVATION_MESSAGE,
        'no matching reservation found',
      );
    }

    if (!eligibility.paid) {
      this.rejectDoorCode(
        hotel,
        DOOR_CODE_UNPAID_MESSAGE,
        'matching reservation is not fully paid',
      );
    }
  }

  private rejectDoorCode(hotel: Hotel, message: string, reason: string): never {
    logger.warn(
      `AlfredService: Door code withheld for Prospector Inn (hotelId=${hotel.id}) — ${reason}`,
    );
    logKpi({
      stat: KpiStat.AlfredDoorCodeRestricted,
      value: 1,
      contextName: 'AlfredService.enforceProspectorInnPaymentGuard',
      clientId: hotel.assistant_phone_number,
    });
    throw new DoorCodeRestrictedError(message);
  }

  /**
   * Resolves the reservation identified by an external partner ID by querying
   * our DB and Cloudbeds together. Only ACTIVE DB rows are eligible, but every
   * DB row (any status) suppresses the Cloudbeds copy of the same booking so a
   * cancelled booking can't be re-admitted via the PMS.
   */
  private async resolveExternalPartnerReservation(
    hotel: Hotel,
    guardContext: DoorCodeGuardContext,
    externalPartnerId: string,
  ): Promise<ReservationEligibility> {
    const settled = await Promise.allSettled([
      this.fetchDbReservationsByExternalPartner(
        guardContext,
        externalPartnerId,
      ),
      this.fetchCloudbedsReservationById(hotel, externalPartnerId),
    ]);
    const dbReservations = this.settledValueOr(
      settled[0],
      [],
      'DB reservation-by-external-id',
    );
    const cloudbedsReservation = this.settledValueOr(
      settled[1],
      null,
      'Cloudbeds reservation-by-id',
    );

    const seenIds = new Set(
      dbReservations.flatMap((reservation) =>
        this.reservationIdentifiers(reservation),
      ),
    );

    const candidates: ReservationCandidate[] = [];
    for (const reservation of dbReservations) {
      if (reservation.status !== ReservationStatus.ACTIVE) {
        continue;
      }
      candidates.push({
        ids: this.reservationIdentifiers(reservation),
        paid: await this.isReservationFullyPaid(
          reservation.booking_id,
          hotel.id,
        ),
      });
    }

    if (
      cloudbedsReservation &&
      this.isCloudbedsReservationActive(cloudbedsReservation)
    ) {
      const ids = this.cloudbedsIdentifiers(cloudbedsReservation);
      if (!ids.some((id) => seenIds.has(id))) {
        candidates.push({
          ids,
          paid: this.isCloudbedsBalancePaid(cloudbedsReservation.balance),
        });
      }
    }

    return this.evaluateEligibility(candidates, settled);
  }

  /**
   * Resolves the reservation identified by an exact last name + checkout date by
   * querying our DB and Cloudbeds together, merging the ACTIVE matches for that
   * checkout date and dropping duplicates. Only ACTIVE rows are eligible, but
   * every DB row (any status) suppresses the Cloudbeds copy of the same booking
   * so a cancelled booking can't be re-admitted via the PMS. When more than one
   * distinct reservation matches, the stay counts as paid if any one of them is
   * paid in full.
   */
  private async resolveLastNameReservation(
    hotel: Hotel,
    lastName: string,
    checkoutDate: string,
  ): Promise<ReservationEligibility> {
    const settled = await Promise.allSettled([
      this.roomReservationServiceInstance.getReservationsByExactLastNameAndCheckout(
        hotel.id,
        lastName,
        checkoutDate,
      ),
      this.fetchCloudbedsReservationsByLastName(hotel, lastName),
    ]);
    const dbReservations = this.settledValueOr(
      settled[0],
      [],
      'DB reservation-by-last-name',
    );
    const cloudbedsReservations = this.settledValueOr(
      settled[1],
      [],
      'Cloudbeds reservation-by-last-name',
    );

    const seenIds = new Set(
      dbReservations.flatMap((reservation) =>
        this.reservationIdentifiers(reservation),
      ),
    );

    const candidates: ReservationCandidate[] = [];
    for (const reservation of dbReservations) {
      if (reservation.status !== ReservationStatus.ACTIVE) {
        continue;
      }
      candidates.push({
        ids: this.reservationIdentifiers(reservation),
        paid: await this.isReservationFullyPaid(
          reservation.booking_id,
          hotel.id,
        ),
      });
    }

    for (const reservation of cloudbedsReservations) {
      if (
        reservation.endDate !== checkoutDate ||
        !this.isCloudbedsReservationActive(reservation)
      ) {
        continue;
      }
      const ids = this.cloudbedsIdentifiers(reservation);
      if (ids.some((id) => seenIds.has(id))) {
        continue;
      }
      ids.forEach((id) => seenIds.add(id));
      candidates.push({
        ids,
        paid: this.isCloudbedsBalancePaid(reservation.balance),
      });
    }

    return this.evaluateEligibility(candidates, settled);
  }

  /**
   * Turns the merged candidate set into an eligibility verdict. A source that
   * threw is ignored as long as the other returned a result; only when both
   * sources failed do we surface the error rather than silently deny access.
   */
  private evaluateEligibility(
    candidates: ReservationCandidate[],
    settled: PromiseSettledResult<unknown>[],
  ): ReservationEligibility {
    if (candidates.length > 0) {
      return {
        exists: true,
        paid: candidates.some((candidate) => candidate.paid),
      };
    }

    // No candidates. If a source failed we can't state as fact that no
    // reservation exists — surface the failure rather than deny.
    const failure = settled.find((result) => result.status === 'rejected');
    if (failure && failure.status === 'rejected') {
      throw failure.reason;
    }

    return { exists: false, paid: false };
  }

  /**
   * A Cloudbeds reservation is paid when its balance is known and zero or below
   * (a credit balance still counts as paid); an absent balance is treated as
   * unpaid. Mirrors the DB path's `remainingAmount <= 0` check.
   */
  private isCloudbedsBalancePaid(balance: number | undefined): boolean {
    return balance !== undefined && balance <= 0;
  }

  /**
   * A Cloudbeds reservation is eligible only when its status maps to ACTIVE;
   * cancelled/no-show/not-confirmed bookings never qualify for a door code.
   */
  private isCloudbedsReservationActive(
    reservation: CloudbedsGetReservationResponseData,
  ): boolean {
    return mapCloudbedsStatus(reservation.status) === ReservationStatus.ACTIVE;
  }

  private async fetchDbReservationsByExternalPartner(
    guardContext: DoorCodeGuardContext,
    externalPartnerId: string,
  ): Promise<ReservationDTO[]> {
    try {
      return await this.roomReservationServiceInstance.getReservationDetails(
        guardContext.customerPhoneNumber,
        guardContext.assistantPhoneNumber,
        externalPartnerId,
      );
    } catch (error) {
      if (error instanceof NoDataError) {
        return [];
      }
      throw error;
    }
  }

  private settledValueOr<T>(
    result: PromiseSettledResult<T>,
    fallback: T,
    label: string,
  ): T {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    logger.warn(`AlfredService: ${label} lookup failed: ${result.reason}`);
    return fallback;
  }

  private reservationIdentifiers(reservation: ReservationDTO): string[] {
    return [
      reservation.external_public_id,
      reservation.external_id,
      reservation.id,
      reservation.booking_id,
    ]
      .filter((id): id is string => !!id)
      .map((id) => id.toLowerCase());
  }

  private cloudbedsIdentifiers(
    reservation: CloudbedsGetReservationResponseData,
  ): string[] {
    // thirdPartyIdentifier carries our booking_id when Cloudbeds knows the
    // reservation by source, so include it — otherwise a cancelled DB row whose
    // booking_id differs from Cloudbeds' reservationID wouldn't be suppressed.
    return [reservation.reservationID, reservation.thirdPartyIdentifier]
      .filter((id): id is string => !!id)
      .map((id) => id.toLowerCase());
  }

  /**
   * Errors are allowed to propagate so the caller can decide whether to ignore
   * them (the DB lookup succeeded) or surface them (both sources failed). A
   * non-Cloudbeds hotel is not an error — it simply has no PMS record here.
   */
  private async fetchCloudbedsReservationById(
    hotel: Hotel,
    reservationId: string,
  ): Promise<CloudbedsGetReservationResponseData | null> {
    if (hotel.pms_provider !== PmsProvider.CLOUDBEDS) {
      return null;
    }

    return await this.cloudbedsReservationServiceInstance.getReservationByIdFromCloudbeds(
      hotel,
      reservationId,
    );
  }

  /**
   * Errors are allowed to propagate so the caller can decide whether to ignore
   * them (the DB lookup succeeded) or surface them (both sources failed). A
   * non-Cloudbeds hotel is not an error — it simply has no PMS record here.
   */
  private async fetchCloudbedsReservationsByLastName(
    hotel: Hotel,
    lastName: string,
  ): Promise<CloudbedsGetReservationResponseData[]> {
    if (hotel.pms_provider !== PmsProvider.CLOUDBEDS) {
      return [];
    }

    return await this.cloudbedsReservationServiceInstance.getReservationsByExactLastNameFromCloudbeds(
      hotel,
      lastName,
    );
  }

  private async isReservationFullyPaid(
    bookingId: string,
    hotelId: string,
  ): Promise<boolean> {
    try {
      const paymentSummary =
        await this.roomReservationServiceInstance.calculateBookingPaymentSummary(
          bookingId,
          hotelId,
        );
      return paymentSummary.remainingAmount <= 0;
    } catch (error) {
      logger.warn(
        `AlfredService: Unable to compute payment summary for booking ${bookingId}: ${error}`,
      );
      return false;
    }
  }

  private buildLookupParams(
    params: CustomerLookupParams,
  ): CustomerLookupParams {
    if (isExternalPartnerLookup(params)) {
      const externalPartnerId = params.externalPartnerId.trim();
      if (!externalPartnerId) {
        logger.warn(
          `AlfredService: Invalid externalPartnerId provided (empty): ${params.externalPartnerId}`,
        );
        throw new AlfredError('Invalid external partner ID', 400);
      }
      return { externalPartnerId, tenantId: params.tenantId };
    }
    return params;
  }
}

export default new AlfredService();
