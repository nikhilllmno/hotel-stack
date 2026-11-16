/**
 * Cloudbeds API Client
 *
 * Low-level HTTP client for Cloudbeds PMS v1.3 API.
 *
 * Design notes:
 * - Cloudbeds tokens are per-property (`cbat_*`), so the token is injected
 *   on every call rather than baked into a singleton. The client itself is
 *   a singleton; callers pass `{ apiToken, propertyID }` per request.
 * - Read endpoints use standard query strings.
 * - Write endpoints use `application/x-www-form-urlencoded` bodies with
 *   bracket-notation nesting via `encodeForm`.
 * - All upstream failures are mapped to `CloudbedsAPIError`.
 */

import { AxiosError, AxiosInstance } from 'axios';
import config from '../../config';
import { createHttpClient } from '../../utils/httpClient';
import { KpiStat, KpiStatValue, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import { CloudbedsAPIError } from '../errors';
import {
  CloudbedsApiEnvelope,
  CloudbedsAvailableRoomTypesRawResponseData,
  CloudbedsAvailableRoomTypesResponseData,
  CloudbedsDoorLockKey,
  CloudbedsDoorLockKeyQuery,
  CloudbedsDoorLockKeysResponse,
  CloudbedsGetItemsQuery,
  CloudbedsGetItemsResponseData,
  CloudbedsGetPaymentMethodsQuery,
  CloudbedsGetPaymentMethodsResponseData,
  CloudbedsGetRateQuery,
  CloudbedsGetRateResponseData,
  CloudbedsGetReservationQuery,
  CloudbedsGetReservationResponseData,
  CloudbedsGetReservationsByCheckInDateQuery,
  CloudbedsGetReservationsByGuestNameQuery,
  CloudbedsGetReservationsBySourceQuery,
  CloudbedsGetRoomsQuery,
  CloudbedsGetRoomTypesCatalogQuery,
  CloudbedsGetRoomTypesQuery,
  CloudbedsGetTaxesAndFeesQuery,
  CloudbedsGetTaxesAndFeesResponseData,
  CloudbedsPostChargeRawResponse,
  CloudbedsPostChargeRequest,
  CloudbedsPostChargeResponseData,
  CloudbedsPostCreditCardRawResponse,
  CloudbedsPostCreditCardRequest,
  CloudbedsPostCreditCardResponseData,
  CloudbedsPostItemRequest,
  CloudbedsPostItemResponseData,
  CloudbedsPostPaymentRawResponse,
  CloudbedsPostPaymentRequest,
  CloudbedsPostPaymentResponseData,
  CloudbedsPostReservationNoteRawResponse,
  CloudbedsPostReservationNoteRequest,
  CloudbedsPostReservationNoteResponseData,
  CloudbedsPostReservationRawResponse,
  CloudbedsPostReservationRequest,
  CloudbedsPostReservationResponseData,
  CloudbedsPutReservationRequest,
  CloudbedsPutReservationResponseData,
  CloudbedsReservationsPage,
  CloudbedsRoomsResponseData,
  CloudbedsRoomType,
  CloudbedsRoomTypesCatalogResponseData,
} from '../types';
import { encodeForm } from '../utils/formEncode';

interface CloudbedsCallContext {
  apiToken: string;
  /** Optional hotel id for logging, redacted from the token in httpClient. */
  hotelId?: string;
}

export class CloudbedsClient {
  private axiosInstance: AxiosInstance;
  private doorLockAxiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = createHttpClient('cloudbeds', {
      baseURL: config.CLOUDBEDS_BASE_URL,
      timeout: config.API_TIMEOUT,
    });
    this.doorLockAxiosInstance = createHttpClient('cloudbeds-doorlock', {
      baseURL: config.CLOUDBEDS_DOORLOCK_API_BASE_URL,
      timeout: config.API_TIMEOUT,
    });
  }

  private authHeaders(apiToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiToken}`,
    };
  }

  private formHeaders(apiToken: string): Record<string, string> {
    return {
      ...this.authHeaders(apiToken),
      'Content-Type': 'application/x-www-form-urlencoded',
    };
  }

  private emitKpi(
    stat: KpiStatValue,
    hotelId?: string,
    contextId?: string,
  ): void {
    logKpi({
      stat,
      value: 1,
      contextName: 'cloudbedsClient',
      clientId: hotelId,
      contextId,
    });
  }

  private emitKpiError(
    stat: KpiStatValue,
    hotelId?: string,
    contextId?: string,
  ): void {
    logKpi({
      stat,
      value: 1,
      contextName: 'cloudbedsClient',
      clientId: hotelId,
      contextId,
    });
  }

  /**
   * Extracts a typed payload from a Cloudbeds envelope, throwing
   * `CloudbedsAPIError` when `success !== true`.
   */
  private unwrap<T>(
    envelope: CloudbedsApiEnvelope<T> | undefined,
    endpoint: string,
    status: number,
  ): T {
    if (!envelope) {
      throw new CloudbedsAPIError(
        `Cloudbeds ${endpoint} returned an empty response`,
        status,
      );
    }
    if (envelope.success !== true) {
      const msg = envelope.message || `Cloudbeds ${endpoint} reported failure`;
      throw new CloudbedsAPIError(msg, status);
    }
    if (envelope.data === undefined) {
      throw new CloudbedsAPIError(
        `Cloudbeds ${endpoint} returned success with no data`,
        status,
      );
    }
    return envelope.data;
  }

  private wrapAxiosError(error: unknown, endpoint: string): never {
    const axiosErr = error as AxiosError<CloudbedsApiEnvelope<unknown>>;
    const response = axiosErr.response;

    if (!response) {
      logger.error('Cloudbeds network error', {
        endpoint,
        message: (error as Error).message,
      });
      throw new CloudbedsAPIError(
        `Network error connecting to Cloudbeds ${endpoint}: ${(error as Error).message}`,
        500,
      );
    }

    const data = response.data;
    const upstreamMessage = data?.message || axiosErr.message;

    logger.error('Cloudbeds API error response', {
      endpoint,
      status: response.status,
      message: upstreamMessage,
      errorCode: data?.errorCode,
    });

    throw new CloudbedsAPIError(
      `Cloudbeds ${endpoint} failed: ${upstreamMessage}`,
      response.status,
    );
  }

  async getRooms(
    query: CloudbedsGetRoomsQuery,
    ctx: CloudbedsCallContext,
  ): Promise<CloudbedsRoomsResponseData> {
    try {
      logger.info('Cloudbeds getRooms', {
        propertyIDs: query.propertyIDs,
        hotelId: ctx.hotelId,
      });
      const response = await this.axiosInstance.get<
        CloudbedsApiEnvelope<CloudbedsRoomsResponseData>
      >('/getRooms', {
        params: query,
        headers: this.authHeaders(ctx.apiToken),
      });
      const data = this.unwrap(response.data, 'getRooms', response.status);
      this.emitKpi(KpiStat.CloudbedsApiGetRooms, ctx.hotelId);
      return data;
    } catch (error) {
      this.emitKpiError(KpiStat.CloudbedsApiGetRoomsError, ctx.hotelId);
      if (error instanceof CloudbedsAPIError) throw error;
      this.wrapAxiosError(error, 'getRooms');
    }
  }

  /**
   * Returns all room type definitions for a property without availability
   * filtering — no dates or occupancy required.
   */
  async getRoomTypesCatalog(
    query: CloudbedsGetRoomTypesCatalogQuery,
    ctx: CloudbedsCallContext,
  ): Promise<CloudbedsRoomTypesCatalogResponseData> {
    try {
      logger.info('Cloudbeds getRoomTypes (catalog)', {
        propertyIDs: query.propertyIDs,
        hotelId: ctx.hotelId,
      });
      const response = await this.axiosInstance.get<
        CloudbedsApiEnvelope<CloudbedsRoomTypesCatalogResponseData>
      >('/getRoomTypes', {
        params: query,
        headers: this.authHeaders(ctx.apiToken),
      });
      const data = this.unwrap(response.data, 'getRoomTypes', response.status);
      this.emitKpi(KpiStat.CloudbedsApiGetRoomTypesCatalog, ctx.hotelId);
      return data;
    } catch (error) {
      this.emitKpiError(
        KpiStat.CloudbedsApiGetRoomTypesCatalogError,
        ctx.hotelId,
      );
      if (error instanceof CloudbedsAPIError) throw error;
      this.wrapAxiosError(error, 'getRoomTypes');
    }
  }

  async getRoomTypes(
    query: CloudbedsGetRoomTypesQuery,
    ctx: CloudbedsCallContext,
  ): Promise<CloudbedsRoomTypesCatalogResponseData> {
    try {
      logger.info('Cloudbeds getRoomTypes', {
        propertyIDs: query.propertyIDs,
        startDate: query.startDate,
        endDate: query.endDate,
        adults: query.adults,
        children: query.children,
        hotelId: ctx.hotelId,
      });
      const response = await this.axiosInstance.get<
        CloudbedsApiEnvelope<CloudbedsRoomTypesCatalogResponseData>
      >('/getRoomTypes', {
        params: query,
        headers: this.authHeaders(ctx.apiToken),
      });
      const data = this.unwrap(response.data, 'getRoomTypes', response.status);
      this.emitKpi(KpiStat.CloudbedsApiGetRoomTypes, ctx.hotelId);
      return data;
    } catch (error) {
      this.emitKpiError(KpiStat.CloudbedsApiGetRoomTypesError, ctx.hotelId);
      if (error instanceof CloudbedsAPIError) throw error;
      this.wrapAxiosError(error, 'getRoomTypes');
    }
  }

  /**
   * `GET /getAvailableRoomTypes` — same query params as `getRoomTypes`, but
   * Cloudbeds support recommends it as a workaround for a bug where
   * `getRoomTypes` intermittently errors for same-day check-ins.
   *
   * Unlike `getRoomTypes`, the wire payload is nested per property
   * (`propertyRooms`), with some numeric fields sent as strings, and lists
   * each room type once per rate plan (duplicating `roomTypeID`). `getRate`
   * takes no rate plan selector and always resolves to the plan named
   * `"default"`, so this keeps only that entry per room type — this
   * flattens and filters it into the same one-entry-per-room-type shape
   * `getRoomTypes`/the catalog endpoint return, so callers don't need to
   * care which endpoint served the data.
   */
  async getAvailableRoomTypes(
    query: CloudbedsGetRoomTypesQuery,
    ctx: CloudbedsCallContext,
  ): Promise<CloudbedsAvailableRoomTypesResponseData> {
    try {
      logger.info('Cloudbeds getAvailableRoomTypes', {
        propertyIDs: query.propertyIDs,
        startDate: query.startDate,
        endDate: query.endDate,
        adults: query.adults,
        children: query.children,
        hotelId: ctx.hotelId,
      });
      const response = await this.axiosInstance.get<
        CloudbedsApiEnvelope<
          CloudbedsAvailableRoomTypesRawResponseData | CloudbedsRoomType[]
        >
      >('/getAvailableRoomTypes', {
        params: query,
        headers: this.authHeaders(ctx.apiToken),
      });
      const data = this.unwrap(
        response.data,
        'getAvailableRoomTypes',
        response.status,
      );
      // Cloudbeds sends these as strings in the nested payload but the
      // CloudbedsRoomType contract (and downstream consumers) expect numbers.
      const toNumber = (value: number | string | undefined) =>
        value === undefined ? undefined : Number(value);
      const normalizeRoom = (
        room: CloudbedsAvailableRoomTypesRawResponseData[number]['propertyRooms'][number],
        propertyID: string,
      ): CloudbedsRoomType => ({
        ...room,
        propertyID,
        roomsAvailable: Number(room.roomsAvailable),
        maxGuests: toNumber(room.maxGuests),
        adultsIncluded: toNumber(room.adultsIncluded),
        childrenIncluded: toNumber(room.childrenIncluded),
        infantsIncluded: toNumber(room.infantsIncluded),
      });
      const flattened: CloudbedsAvailableRoomTypesResponseData = data.flatMap(
        (entry) => {
          if (!('propertyRooms' in entry)) {
            return [{ ...entry, roomsAvailable: Number(entry.roomsAvailable) }];
          }
          // getRate takes no rate plan selector, so it always resolves to
          // the plan named "default" — other rate plans' entries for the
          // same room type would carry pricing/availability getRate never
          // actually reflects. Fall back to the unfiltered list if a
          // property has no plan literally named "default", rather than
          // silently dropping every room for it.
          const defaultPlanRooms = entry.propertyRooms.filter(
            (room) => room.ratePlanNamePublic === 'default',
          );
          const rooms =
            defaultPlanRooms.length > 0
              ? defaultPlanRooms
              : entry.propertyRooms;
          return rooms.map((room) => normalizeRoom(room, entry.propertyID));
        },
      );
      // Defensive: dedupe any remaining same-room-type entries (e.g. more
      // than one plan happens to be named "default") — arbitrary pick,
      // since at that point they're indistinguishable from what getRate
      // would resolve to.
      const deduped = Array.from(
        new Map(
          flattened.map((room) => [
            `${room.propertyID}:${room.roomTypeID}`,
            room,
          ]),
        ).values(),
      );
      this.emitKpi(KpiStat.CloudbedsApiGetAvailableRoomTypes, ctx.hotelId);
      return deduped;
    } catch (error) {
      this.emitKpiError(
        KpiStat.CloudbedsApiGetAvailableRoomTypesError,
        ctx.hotelId,
      );
      if (error instanceof CloudbedsAPIError) throw error;
      this.wrapAxiosError(error, 'getAvailableRoomTypes');
    }
  }

  async getRate(
    query: CloudbedsGetRateQuery,
    ctx: CloudbedsCallContext,
  ): Promise<CloudbedsGetRateResponseData> {
    try {
      logger.info('Cloudbeds getRate', {
        propertyID: query.propertyID,
        roomTypeID: query.roomTypeID,
        startDate: query.startDate,
        endDate: query.endDate,
        adults: query.adults,
        children: query.children,
        hotelId: ctx.hotelId,
      });
      const response = await this.axiosInstance.get<
        CloudbedsApiEnvelope<CloudbedsGetRateResponseData>
      >('/getRate', {
        // `detailedRates` needs to go across as a string "true" to match
        // Cloudbeds' URL parser.
        params: {
          ...query,
          detailedRates: query.detailedRates ? 'true' : 'false',
        },
        headers: this.authHeaders(ctx.apiToken),
      });
      const data = this.unwrap(response.data, 'getRate', response.status);
      this.emitKpi(KpiStat.CloudbedsApiGetRate, ctx.hotelId);
      return data;
    } catch (error) {
      this.emitKpiError(KpiStat.CloudbedsApiGetRateError, ctx.hotelId);
      if (error instanceof CloudbedsAPIError) throw error;
      this.wrapAxiosError(error, 'getRate');
    }
  }

  async postReservation(
    payload: CloudbedsPostReservationRequest,
    ctx: CloudbedsCallContext,
  ): Promise<CloudbedsPostReservationResponseData> {
    try {
      logger.info('Cloudbeds postReservation', {
        propertyID: payload.propertyID,
        startDate: payload.startDate,
        endDate: payload.endDate,
        paymentMethod: payload.paymentMethod,
        hotelId: ctx.hotelId,
      });
      const body = encodeForm(payload as unknown as Record<string, unknown>);
      // postReservation returns a flat envelope — reservation fields sit
      // alongside `success`/`message` at the top level, not nested under `data`.
      const response =
        await this.axiosInstance.post<CloudbedsPostReservationRawResponse>(
          '/postReservation',
          body,
          { headers: this.formHeaders(ctx.apiToken) },
        );
      const raw = response.data;
      if (!raw || !raw.success) {
        throw new CloudbedsAPIError(
          (raw as { message?: string })?.message ||
            'Cloudbeds postReservation reported failure',
          response.status,
        );
      }
      // Strip the envelope fields before returning the typed payload.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const {
        success: _success,
        message: _message,
        ...data
      } = raw as CloudbedsPostReservationRawResponse & Record<string, unknown>;
      const responseData = data as CloudbedsPostReservationResponseData;
      this.emitKpi(
        KpiStat.CloudbedsApiPostReservation,
        ctx.hotelId,
        responseData.reservationID,
      );
      return responseData;
    } catch (error) {
      this.emitKpiError(KpiStat.CloudbedsApiPostReservationError, ctx.hotelId);
      if (error instanceof CloudbedsAPIError) throw error;
      this.wrapAxiosError(error, 'postReservation');
    }
  }

  async putReservation(
    payload: CloudbedsPutReservationRequest,
    ctx: CloudbedsCallContext,
  ): Promise<CloudbedsPutReservationResponseData> {
    try {
      logger.info('Cloudbeds putReservation', {
        propertyID: payload.propertyID,
        reservationID: payload.reservationID,
        status: payload.status,
        hotelId: ctx.hotelId,
      });
      const body = encodeForm(payload as unknown as Record<string, unknown>);
      const response = await this.axiosInstance.put<
        CloudbedsApiEnvelope<CloudbedsPutReservationResponseData>
      >('/putReservation', body, { headers: this.formHeaders(ctx.apiToken) });
      const data = this.unwrap(
        response.data,
        'putReservation',
        response.status,
      );
      this.emitKpi(
        KpiStat.CloudbedsApiPutReservation,
        ctx.hotelId,
        payload.reservationID,
      );
      return data;
    } catch (error) {
      this.emitKpiError(
        KpiStat.CloudbedsApiPutReservationError,
        ctx.hotelId,
        payload.reservationID,
      );
      if (error instanceof CloudbedsAPIError) throw error;
      this.wrapAxiosError(error, 'putReservation');
    }
  }

  /**
   * Gets all the taxes and fees the hotel has created
   * https://developers.cloudbeds.com/reference/get_gettaxesandfees-2
   * Even if no fees are returned, call the getItems endpoint to get other addons such as pet fees.
   */
  async getTaxesAndFees(
    query: CloudbedsGetTaxesAndFeesQuery,
    ctx: CloudbedsCallContext,
  ): Promise<CloudbedsGetTaxesAndFeesResponseData> {
    try {
      logger.info('Cloudbeds getTaxesAndFees', {
        propertyID: query.propertyID,
        availableFor: query.availableFor,
        hotelId: ctx.hotelId,
      });
      const response = await this.axiosInstance.get<
        CloudbedsApiEnvelope<CloudbedsGetTaxesAndFeesResponseData>
      >('/getTaxesAndFees', {
        params: query,
        headers: this.authHeaders(ctx.apiToken),
      });
      const data = this.unwrap(
        response.data,
        'getTaxesAndFees',
        response.status,
      );
      this.emitKpi(KpiStat.CloudbedsApiGetTaxesAndFees, ctx.hotelId);
      return data;
    } catch (error) {
      this.emitKpiError(KpiStat.CloudbedsApiGetTaxesAndFeesError, ctx.hotelId);
      if (error instanceof CloudbedsAPIError) throw error;
      this.wrapAxiosError(error, 'getTaxesAndFees');
    }
  }

  /**
   * Gets all the items (addons) and their prices the hotel has created
   * https://developers.cloudbeds.com/reference/get_getitems-2
   */
  async getItems(
    query: CloudbedsGetItemsQuery,
    ctx: CloudbedsCallContext,
  ): Promise<CloudbedsGetItemsResponseData> {
    try {
      logger.info('Cloudbeds getItems', {
        propertyID: query.propertyID,
        hotelId: ctx.hotelId,
      });
      const response = await this.axiosInstance.get<
        CloudbedsApiEnvelope<CloudbedsGetItemsResponseData>
      >('/getItems', {
        params: query,
        headers: this.authHeaders(ctx.apiToken),
      });
      const data = this.unwrap(response.data, 'getItems', response.status);
      this.emitKpi(KpiStat.CloudbedsApiGetItems, ctx.hotelId);
      return data;
    } catch (error) {
      this.emitKpiError(KpiStat.CloudbedsApiGetItemsError, ctx.hotelId);
      if (error instanceof CloudbedsAPIError) throw error;
      this.wrapAxiosError(error, 'getItems');
    }
  }

  /**
   * Links an item (product/service) to a reservation.
   * https://developers.cloudbeds.com/reference/post_postitem-2
   */
  async postItem(
    payload: CloudbedsPostItemRequest,
    ctx: CloudbedsCallContext,
  ): Promise<CloudbedsPostItemResponseData> {
    try {
      logger.info('Cloudbeds postItem', {
        propertyID: payload.propertyID,
        reservationID: payload.reservationID,
        itemID: payload.itemID,
        itemQuantity: payload.itemQuantity,
        hotelId: ctx.hotelId,
      });
      const body = encodeForm(payload as unknown as Record<string, unknown>);
      const response = await this.axiosInstance.post<
        CloudbedsApiEnvelope<CloudbedsPostItemResponseData>
      >('/postItem', body, { headers: this.formHeaders(ctx.apiToken) });
      const data = this.unwrap(response.data, 'postItem', response.status);
      this.emitKpi(
        KpiStat.CloudbedsApiPostItem,
        ctx.hotelId,
        payload.reservationID,
      );
      return data;
    } catch (error) {
      this.emitKpiError(
        KpiStat.CloudbedsApiPostItemError,
        ctx.hotelId,
        payload.reservationID,
      );
      if (error instanceof CloudbedsAPIError) throw error;
      this.wrapAxiosError(error, 'postItem');
    }
  }

  /**
   * Returns the payment methods and card types accepted by a property.
   * Used to map a Stripe card brand to the correct Cloudbeds `cardCode`
   * before calling `postPayment`.
   * https://developers.cloudbeds.com/reference/get_getpaymentmethods
   */
  async getPaymentMethods(
    query: CloudbedsGetPaymentMethodsQuery,
    ctx: CloudbedsCallContext,
  ): Promise<CloudbedsGetPaymentMethodsResponseData> {
    try {
      logger.info('Cloudbeds getPaymentMethods', {
        propertyID: query.propertyID,
        hotelId: ctx.hotelId,
      });
      const response = await this.axiosInstance.get<
        CloudbedsApiEnvelope<CloudbedsGetPaymentMethodsResponseData>
      >('/getPaymentMethods', {
        params: query,
        headers: this.authHeaders(ctx.apiToken),
      });
      const data = this.unwrap(
        response.data,
        'getPaymentMethods',
        response.status,
      );
      this.emitKpi(KpiStat.CloudbedsApiGetPaymentMethods, ctx.hotelId);
      return data;
    } catch (error) {
      this.emitKpiError(
        KpiStat.CloudbedsApiGetPaymentMethodsError,
        ctx.hotelId,
      );
      if (error instanceof CloudbedsAPIError) throw error;
      this.wrapAxiosError(error, 'getPaymentMethods');
    }
  }

  /**
   * Adds a note to a reservation.
   * https://developers.cloudbeds.com/reference/post_postreservationnote-2
   */
  async postReservationNote(
    payload: CloudbedsPostReservationNoteRequest,
    ctx: CloudbedsCallContext,
  ): Promise<CloudbedsPostReservationNoteResponseData> {
    try {
      logger.info('Cloudbeds postReservationNote', {
        propertyID: payload.propertyID,
        reservationID: payload.reservationID,
        hotelId: ctx.hotelId,
      });
      const body = encodeForm(payload as unknown as Record<string, unknown>);
      const response =
        await this.axiosInstance.post<CloudbedsPostReservationNoteRawResponse>(
          '/postReservationNote',
          body,
          { headers: this.formHeaders(ctx.apiToken) },
        );
      const raw = response.data;
      if (!raw || !raw.success) {
        throw new CloudbedsAPIError(
          (raw as { message?: string })?.message ||
            'Cloudbeds postReservationNote reported failure',
          response.status,
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const {
        success: _success,
        message: _message,
        ...data
      } = raw as CloudbedsPostReservationNoteRawResponse &
        Record<string, unknown>;
      this.emitKpi(
        KpiStat.CloudbedsApiPostReservationNote,
        ctx.hotelId,
        payload.reservationID,
      );
      return data as CloudbedsPostReservationNoteResponseData;
    } catch (error) {
      this.emitKpiError(
        KpiStat.CloudbedsApiPostReservationNoteError,
        ctx.hotelId,
        payload.reservationID,
      );
      if (error instanceof CloudbedsAPIError) throw error;
      this.wrapAxiosError(error, 'postReservationNote');
    }
  }

  /**
   * Returns reservation details for a Cloudbeds reservation id.
   * https://developers.cloudbeds.com/reference/get_getreservation-2
   */
  async getReservation(
    query: CloudbedsGetReservationQuery,
    ctx: CloudbedsCallContext,
  ): Promise<CloudbedsGetReservationResponseData> {
    try {
      logger.info('Cloudbeds getReservation', {
        propertyID: query.propertyID,
        reservationID: query.reservationID,
        hotelId: ctx.hotelId,
      });
      const response = await this.axiosInstance.get<
        CloudbedsApiEnvelope<CloudbedsGetReservationResponseData>
      >('/getReservation', {
        params: query,
        headers: this.authHeaders(ctx.apiToken),
      });
      const data = this.unwrap(
        response.data,
        'getReservation',
        response.status,
      );
      this.emitKpi(
        KpiStat.CloudbedsApiGetReservation,
        ctx.hotelId,
        query.reservationID,
      );
      return data;
    } catch (error) {
      this.emitKpiError(
        KpiStat.CloudbedsApiGetReservationError,
        ctx.hotelId,
        query.reservationID,
      );
      if (error instanceof CloudbedsAPIError) throw error;
      this.wrapAxiosError(error, 'getReservation');
    }
  }

  /**
   * Searches reservations by OTA/third-party source reservation ID.
   */
  async getReservationsBySource(
    query: CloudbedsGetReservationsBySourceQuery,
    ctx: CloudbedsCallContext,
  ): Promise<CloudbedsGetReservationResponseData[]> {
    try {
      logger.info('Cloudbeds getReservationsBySource', {
        propertyID: query.propertyID,
        sourceReservationId: query.sourceReservationId,
        hotelId: ctx.hotelId,
      });
      const response = await this.axiosInstance.get<
        CloudbedsApiEnvelope<CloudbedsGetReservationResponseData[]>
      >('/getReservations', {
        params: query,
        headers: this.authHeaders(ctx.apiToken),
      });
      const data = this.unwrap(
        response.data,
        'getReservationsBySource',
        response.status,
      );
      this.emitKpi(
        KpiStat.CloudbedsApiGetReservationsBySource,
        ctx.hotelId,
        query.sourceReservationId,
      );
      return data;
    } catch (error) {
      this.emitKpiError(
        KpiStat.CloudbedsApiGetReservationsBySourceError,
        ctx.hotelId,
        query.sourceReservationId,
      );
      if (error instanceof CloudbedsAPIError) throw error;
      this.wrapAxiosError(error, 'getReservationsBySource');
    }
  }

  /**
   * Searches reservations by primary guest first and/or last name.
   * https://developers.cloudbeds.com/reference/get_getreservations-2
   */
  async getReservationsByGuestName(
    query: CloudbedsGetReservationsByGuestNameQuery,
    ctx: CloudbedsCallContext,
  ): Promise<CloudbedsGetReservationResponseData[]> {
    if (!query.firstName && !query.lastName) {
      throw new Error(
        'getReservationsByGuestName: at least one of firstName or lastName is required',
      );
    }
    try {
      logger.info('Cloudbeds getReservationsByGuestName', {
        propertyID: query.propertyID,
        firstName: query.firstName,
        lastName: query.lastName,
        hotelId: ctx.hotelId,
      });
      const response = await this.axiosInstance.get<
        CloudbedsApiEnvelope<CloudbedsGetReservationResponseData[]>
      >('/getReservations', {
        params: query,
        headers: this.authHeaders(ctx.apiToken),
      });
      const data = this.unwrap(
        response.data,
        'getReservationsByGuestName',
        response.status,
      );
      this.emitKpi(KpiStat.CloudbedsApiGetReservationsByGuestName, ctx.hotelId);
      return data;
    } catch (error) {
      this.emitKpiError(
        KpiStat.CloudbedsApiGetReservationsByGuestNameError,
        ctx.hotelId,
      );
      if (error instanceof CloudbedsAPIError) throw error;
      this.wrapAxiosError(error, 'getReservationsByGuestName');
    }
  }

  /**
   * One page of the reservations checking in between two dates, whatever
   * their guest's name, with the total Cloudbeds counts across pages.
   * https://developers.cloudbeds.com/reference/get_getreservations-2
   */
  async getReservationsByCheckInDate(
    query: CloudbedsGetReservationsByCheckInDateQuery,
    ctx: CloudbedsCallContext,
  ): Promise<CloudbedsReservationsPage> {
    try {
      logger.info('Cloudbeds getReservationsByCheckInDate', {
        propertyID: query.propertyID,
        checkInFrom: query.checkInFrom,
        checkInTo: query.checkInTo,
        checkOutFrom: query.checkOutFrom,
        pageNumber: query.pageNumber,
        hotelId: ctx.hotelId,
      });
      const response = await this.axiosInstance.get<
        CloudbedsApiEnvelope<CloudbedsGetReservationResponseData[]>
      >('/getReservations', {
        params: query,
        headers: this.authHeaders(ctx.apiToken),
      });
      const reservations = this.unwrap(
        response.data,
        'getReservationsByCheckInDate',
        response.status,
      );
      if (!Array.isArray(reservations)) {
        throw new CloudbedsAPIError(
          'Cloudbeds getReservationsByCheckInDate returned no reservation list',
          response.status,
        );
      }
      this.emitKpi(
        KpiStat.CloudbedsApiGetReservationsByCheckInDate,
        ctx.hotelId,
      );
      const { total } = response.data;
      return {
        reservations,
        total:
          typeof total === 'number' && Number.isInteger(total) && total >= 0
            ? total
            : null,
      };
    } catch (error) {
      this.emitKpiError(
        KpiStat.CloudbedsApiGetReservationsByCheckInDateError,
        ctx.hotelId,
      );
      if (error instanceof CloudbedsAPIError) throw error;
      this.wrapAxiosError(error, 'getReservationsByCheckInDate');
    }
  }

  async postPayment(
    payload: CloudbedsPostPaymentRequest,
    ctx: CloudbedsCallContext,
  ): Promise<CloudbedsPostPaymentResponseData> {
    try {
      logger.info('Cloudbeds postPayment', {
        propertyID: payload.propertyID,
        reservationID: payload.reservationID,
        type: payload.type,
        amount: payload.amount,
        hotelId: ctx.hotelId,
      });
      const body = encodeForm(payload as unknown as Record<string, unknown>);
      // postPayment returns a flat envelope — payload fields sit alongside
      // `success`/`message` at the top level, not nested under `data`.
      const response =
        await this.axiosInstance.post<CloudbedsPostPaymentRawResponse>(
          '/postPayment',
          body,
          { headers: this.formHeaders(ctx.apiToken) },
        );
      const raw = response.data;
      if (!raw || !raw.success) {
        throw new CloudbedsAPIError(
          (raw as { message?: string })?.message ||
            'Cloudbeds postPayment reported failure',
          response.status,
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const {
        success: _success,
        message: _message,
        ...data
      } = raw as CloudbedsPostPaymentRawResponse & Record<string, unknown>;
      this.emitKpi(
        KpiStat.CloudbedsApiPostPayment,
        ctx.hotelId,
        payload.reservationID,
      );
      return data as CloudbedsPostPaymentResponseData;
    } catch (error) {
      this.emitKpiError(
        KpiStat.CloudbedsApiPostPaymentError,
        ctx.hotelId,
        payload.reservationID,
      );
      if (error instanceof CloudbedsAPIError) throw error;
      this.wrapAxiosError(error, 'postPayment');
    }
  }

  async postCreditCard(
    payload: CloudbedsPostCreditCardRequest,
    ctx: CloudbedsCallContext,
  ): Promise<CloudbedsPostCreditCardResponseData> {
    try {
      logger.info('Cloudbeds postCreditCard', {
        propertyID: payload.propertyID,
        reservationID: payload.reservationID,
        hotelId: ctx.hotelId,
      });
      const body = encodeForm(payload as unknown as Record<string, unknown>);
      const response =
        await this.axiosInstance.post<CloudbedsPostCreditCardRawResponse>(
          '/postCreditCard',
          body,
          { headers: this.formHeaders(ctx.apiToken) },
        );
      const data = this.unwrap(
        response.data,
        'postCreditCard',
        response.status,
      );
      this.emitKpi(
        KpiStat.CloudbedsApiPostCreditCard,
        ctx.hotelId,
        payload.reservationID,
      );
      return data as CloudbedsPostCreditCardResponseData;
    } catch (error) {
      this.emitKpiError(
        KpiStat.CloudbedsApiPostCreditCardError,
        ctx.hotelId,
        payload.reservationID,
      );
      if (error instanceof CloudbedsAPIError) throw error;
      this.wrapAxiosError(error, 'postCreditCard');
    }
  }

  /**
   * Charges a stored payment method on a Cloudbeds reservation. A card that
   * needs 3DS comes back `pending` with `nextAction.details.url`.
   * https://developers.cloudbeds.com/reference/post_postcharge
   */
  async postCharge(
    payload: CloudbedsPostChargeRequest,
    ctx: CloudbedsCallContext,
  ): Promise<CloudbedsPostChargeResponseData> {
    try {
      logger.info('Cloudbeds postCharge', {
        propertyID: payload.propertyID,
        reservationID: payload.reservationID,
        amount: payload.amount,
        currency: payload.currency,
        hotelId: ctx.hotelId,
      });
      const body = encodeForm(payload as unknown as Record<string, unknown>);
      const response =
        await this.axiosInstance.post<CloudbedsPostChargeRawResponse>(
          '/postCharge',
          body,
          { headers: this.formHeaders(ctx.apiToken) },
        );
      const data = this.unwrap(response.data, 'postCharge', response.status);
      this.emitKpi(
        KpiStat.CloudbedsApiPostCharge,
        ctx.hotelId,
        payload.reservationID,
      );
      return data as CloudbedsPostChargeResponseData;
    } catch (error) {
      this.emitKpiError(
        KpiStat.CloudbedsApiPostChargeError,
        ctx.hotelId,
        payload.reservationID,
      );
      if (error instanceof CloudbedsAPIError) throw error;
      this.wrapAxiosError(error, 'postCharge');
    }
  }

  /**
   * Returns door lock keys for a property, optionally filtered by reservation.
   * Uses the Cloudbeds Door Lock API v1 (v2 base URL).
   * https://developers.cloudbeds.com/reference/doorlockkeycontrollerindex-1
   */
  async getDoorLockKeys(
    query: CloudbedsDoorLockKeyQuery,
    ctx: CloudbedsCallContext,
  ): Promise<CloudbedsDoorLockKey[]> {
    try {
      logger.info('Cloudbeds getDoorLockKeys', {
        propertyId: query.propertyId,
        reservationId: query.reservationId,
        hotelId: ctx.hotelId,
      });
      const params: Record<string, string> = {};
      if (query.reservationId) {
        params.reservationId = query.reservationId;
      }
      if (query.subReservationId) {
        params.subReservationId = query.subReservationId;
      }
      const response =
        await this.doorLockAxiosInstance.get<CloudbedsDoorLockKeysResponse>(
          `/v1/keys/${query.propertyId}`,
          {
            params,
            headers: this.authHeaders(ctx.apiToken),
          },
        );
      return response.data?.data ?? [];
    } catch (error) {
      logger.warn('Cloudbeds getDoorLockKeys failed', {
        propertyId: query.propertyId,
        reservationId: query.reservationId,
        hotelId: ctx.hotelId,
        error: (error as Error).message,
      });
      return [];
    }
  }
}

const cloudbedsClient = new CloudbedsClient();
export default cloudbedsClient;
