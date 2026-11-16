/**
 * Calry API Client
 *
 * Low-level HTTP client for the Calry unified API (`/api/v2/vrs/*`).
 *
 * Design notes:
 * - Every unified call carries three headers: `Authorization: Bearer`,
 *   `workspaceId` and `integrationAccountId`. The last one is what routes
 *   the call to a specific hotel's upstream PMS connection, so credentials
 *   are injected per request and the client itself stays a singleton.
 * - Reads pass `realtime=true` so they hit the PMS rather than Calry's
 *   cached database, which lags by up to `syncPeriod`.
 * - The response envelope is inconsistent across endpoints — some return
 *   `{ success, data }`, others a bare `{ data }`. `unwrap` treats a
 *   missing `success` as fine and only rejects an explicit `false`.
 * - All upstream failures are mapped to `CalryAPIError`.
 */

import { AxiosError, AxiosInstance } from 'axios';
import config from '../../config';
import { createHttpClient } from '../../utils/httpClient';
import logger from '../../utils/logger';
import { CalryAPIError } from '../errors';
import {
  CalryAvailability,
  CalryCreateReservationRequest,
  CalryCredentials,
  CalryEnvelope,
  CalryGetAvailabilityQuery,
  CalryGetQuoteQuery,
  CalryListReservationsQuery,
  CalryPassthroughRequest,
  CalryProperty,
  CalryQuote,
  CalryReservation,
  CalryRoomType,
  CalryUpdateReservationRequest,
} from '../types';

export class CalryClient {
  private axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = createHttpClient('calry', {
      baseURL: config.CALRY_BASE_URL,
      timeout: config.API_TIMEOUT,
    });
  }

  private headers(credentials: CalryCredentials): Record<string, string> {
    return {
      Authorization: `Bearer ${credentials.apiToken}`,
      workspaceId: credentials.workspaceId,
      integrationAccountId: credentials.integrationAccountId,
    };
  }

  /**
   * Extracts the payload from a Calry envelope. `success` is optional
   * upstream, so only an explicit `false` is treated as a failure.
   */
  private unwrap<T>(
    envelope: CalryEnvelope<T> | undefined,
    endpoint: string,
    status: number,
  ): T {
    if (!envelope) {
      throw new CalryAPIError(
        `Calry ${endpoint} returned an empty response`,
        status,
      );
    }
    if (envelope.success === false) {
      throw new CalryAPIError(
        envelope.message || `Calry ${endpoint} reported failure`,
        status,
      );
    }
    if (envelope.data === undefined) {
      throw new CalryAPIError(`Calry ${endpoint} returned no data`, status);
    }
    return envelope.data;
  }

  private wrapAxiosError(error: unknown, endpoint: string): never {
    const axiosErr = error as AxiosError<CalryEnvelope<unknown>>;
    const response = axiosErr.response;

    if (!response) {
      logger.error('Calry network error', {
        endpoint,
        message: (error as Error).message,
      });
      throw new CalryAPIError(
        `Network error connecting to Calry ${endpoint}: ${(error as Error).message}`,
        500,
      );
    }

    const upstreamMessage = response.data?.message || axiosErr.message;

    logger.error('Calry API error response', {
      endpoint,
      status: response.status,
      message: upstreamMessage,
    });

    throw new CalryAPIError(
      `Calry ${endpoint} failed: ${upstreamMessage}`,
      response.status,
    );
  }

  private async get<T>(
    path: string,
    endpoint: string,
    params: object,
    credentials: CalryCredentials,
  ): Promise<T> {
    try {
      const response = await this.axiosInstance.get<CalryEnvelope<T>>(path, {
        params,
        headers: this.headers(credentials),
      });
      return this.unwrap<T>(response.data, endpoint, response.status);
    } catch (error) {
      if (error instanceof CalryAPIError) throw error;
      this.wrapAxiosError(error, endpoint);
    }
  }

  async getProperties(credentials: CalryCredentials): Promise<CalryProperty[]> {
    return this.get<CalryProperty[]>(
      '/api/v2/vrs/properties',
      'getProperties',
      { realtime: true },
      credentials,
    );
  }

  async getRoomTypes(
    propertyId: string,
    credentials: CalryCredentials,
  ): Promise<CalryRoomType[]> {
    return this.get<CalryRoomType[]>(
      `/api/v2/vrs/room-types/${encodeURIComponent(propertyId)}`,
      'getRoomTypes',
      { realtime: true },
      credentials,
    );
  }

  async getAvailability(
    propertyId: string,
    query: CalryGetAvailabilityQuery,
    credentials: CalryCredentials,
  ): Promise<CalryAvailability> {
    return this.get<CalryAvailability>(
      `/api/v2/vrs/availability/${encodeURIComponent(propertyId)}`,
      'getAvailability',
      { realtime: true, ...query },
      credentials,
    );
  }

  async getQuote(
    propertyId: string,
    query: CalryGetQuoteQuery,
    credentials: CalryCredentials,
  ): Promise<CalryQuote> {
    return this.get<CalryQuote>(
      `/api/v2/vrs/quote/${encodeURIComponent(propertyId)}`,
      'getQuote',
      query,
      credentials,
    );
  }

  async getReservation(
    reservationId: string,
    credentials: CalryCredentials,
  ): Promise<CalryReservation> {
    return this.get<CalryReservation>(
      `/api/v2/vrs/reservations/${encodeURIComponent(reservationId)}`,
      'getReservation',
      { realtime: true },
      credentials,
    );
  }

  async listReservations(
    query: CalryListReservationsQuery,
    credentials: CalryCredentials,
  ): Promise<CalryReservation[]> {
    return this.get<CalryReservation[]>(
      '/api/v2/vrs/reservations',
      'listReservations',
      { realtime: true, ...query },
      credentials,
    );
  }

  async createReservation(
    body: CalryCreateReservationRequest,
    credentials: CalryCredentials,
  ): Promise<CalryReservation> {
    try {
      const response = await this.axiosInstance.post<
        CalryEnvelope<CalryReservation>
      >('/api/v2/vrs/reservations', body, {
        headers: {
          ...this.headers(credentials),
          'Content-Type': 'application/json',
        },
      });
      return this.unwrap(response.data, 'createReservation', response.status);
    } catch (error) {
      if (error instanceof CalryAPIError) throw error;
      this.wrapAxiosError(error, 'createReservation');
    }
  }

  /**
   * Raw call to the upstream PMS through Calry's authenticated passthrough.
   * Used for endpoints Calry has not unified — Opera availability is not
   * exposed on `/availability`, so it is reached this way.
   *
   * The upstream response is returned as-is: the passthrough envelope is
   * unwrapped, but Calry applies no mapping to the payload inside it.
   */
  async passthrough<T>(
    request: CalryPassthroughRequest,
    credentials: CalryCredentials,
  ): Promise<T> {
    try {
      const response = await this.axiosInstance.post<CalryEnvelope<T>>(
        '/api/v2/vrs/passthrough',
        request,
        {
          headers: {
            ...this.headers(credentials),
            'Content-Type': 'application/json',
          },
        },
      );
      return this.unwrap<T>(response.data, 'passthrough', response.status);
    } catch (error) {
      if (error instanceof CalryAPIError) throw error;
      this.wrapAxiosError(error, 'passthrough');
    }
  }

  /**
   * Also the cancellation path — pass `status: 'CANCELLED'`. The response
   * body is only `{ success: true }`, never the updated reservation, so
   * callers that need the new state must re-read it.
   */
  async updateReservation(
    body: CalryUpdateReservationRequest,
    credentials: CalryCredentials,
  ): Promise<void> {
    try {
      const response = await this.axiosInstance.put<
        CalryEnvelope<{ success?: boolean }>
      >('/api/v2/vrs/reservations', body, {
        headers: {
          ...this.headers(credentials),
          'Content-Type': 'application/json',
        },
      });
      this.unwrap(response.data, 'updateReservation', response.status);
    } catch (error) {
      if (error instanceof CalryAPIError) throw error;
      this.wrapAxiosError(error, 'updateReservation');
    }
  }
}

const calryClient = new CalryClient();
export default calryClient;
