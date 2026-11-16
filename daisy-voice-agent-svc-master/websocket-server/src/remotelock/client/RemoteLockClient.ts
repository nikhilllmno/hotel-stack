/**
 * RemoteLock Connect API v1 Client
 *
 * Low-level HTTP client for the RemoteLock Connect API.
 * Handles authentication, request/response interceptors, and error handling.
 *
 * API Requirements:
 * - Accept: application/vnd.remotelock.v1+json on all requests
 * - Authorization: Bearer token (OAuth Authorization Code grant)
 * - Base URL: config.REMOTELOCK_API_URL
 *
 * This client is read-only — it covers the endpoints needed to look up a
 * guest's door code (access guests). It is constructed per-hotel so the
 * bearer token is scoped to that hotel's RemoteLock account.
 *
 * Error Handling:
 * - 401/403: Authentication / expired token
 * - 404: Resource not found
 * - 429: Rate limit exceeded (RemoteLock allows 120 req/min per account)
 * - Network errors: Wrapped in RemoteLockAPIError
 */

import {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import config from '../../config';
import { createHttpClient } from '../../utils/httpClient';
import { KpiStat, KpiStatValue, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import { RemoteLockAPIError, RemoteLockConfigurationError } from '../errors';
import { remoteLockTokenService } from '../services/tokenService';
import {
  AccessGuest,
  GetAccessPersonsParams,
  RemoteLockCollectionEnvelope,
  RemoteLockResourceEnvelope,
  RemoteLockUser,
} from '../types';

/**
 * Stands in for the hotel id on a token-scoped client, whose whole purpose is
 * to identify an account that isn't linked to a hotel yet.
 */
const UNIDENTIFIED_HOTEL_ID = 'unidentified';

export class RemoteLockClient {
  private axiosInstance: AxiosInstance;

  /**
   * @param hotelId - Internal hotel UUID used to scope the bearer token to this
   *   specific hotel's RemoteLock credentials stored in
   *   `hotel_configurations.external_auth_config`.
   * @param accessToken - Explicit bearer token, bypassing the per-hotel lookup.
   *   Only for the OAuth callback, which holds a freshly issued token for a
   *   hotel it cannot yet identify. Prefer {@link forAccessToken}.
   */
  constructor(
    private readonly hotelId: string,
    private readonly accessToken?: string,
  ) {
    this.validateConfiguration();

    this.axiosInstance = createHttpClient('remotelock', {
      baseURL: config.REMOTELOCK_API_URL,
      timeout: config.API_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/vnd.remotelock.v1+json',
      },
    });

    this.setupInterceptors();
  }

  private validateConfiguration(): void {
    if (!config.REMOTELOCK_API_URL || !config.REMOTELOCK_API_URL.trim()) {
      throw new RemoteLockConfigurationError(
        'REMOTELOCK_API_URL is not configured',
      );
    }
  }

  private setupInterceptors(): void {
    this.axiosInstance.interceptors.request.use(
      async (reqConfig: InternalAxiosRequestConfig) => {
        const token =
          this.accessToken ??
          (await remoteLockTokenService.getActiveToken(this.hotelId));
        reqConfig.headers.Authorization = `Bearer ${token}`;
        return reqConfig;
      },
      (error) => Promise.reject(error),
    );

    this.axiosInstance.interceptors.response.use(
      (response: AxiosResponse) => response,
      async (error: AxiosError) => this.handleError(error),
    );
  }

  private async handleError(error: AxiosError): Promise<never> {
    const response = error.response;
    const requestConfig = error.config;

    if (!response) {
      logger.error('RemoteLock API network error:', error.message);
      throw new RemoteLockAPIError(
        'Network error connecting to RemoteLock API',
        500,
      );
    }

    const errorMessage =
      (response.data as any)?.message ||
      (response.data as any)?.errors?.[0]?.full_messages?.[0] ||
      error.message;
    const statusCode = response.status;

    logger.error(`RemoteLock API Error: ${statusCode} - ${errorMessage}`, {
      url: requestConfig?.url,
      method: requestConfig?.method,
      status: statusCode,
    });

    if (statusCode === 401 || statusCode === 403) {
      throw new RemoteLockAPIError(
        'Authentication failed with RemoteLock API',
        statusCode,
      );
    }

    if (statusCode === 404) {
      throw new RemoteLockAPIError(`Resource not found: ${errorMessage}`, 404);
    }

    if (statusCode === 429) {
      throw new RemoteLockAPIError(
        'Rate limit exceeded for RemoteLock API',
        429,
      );
    }

    throw new RemoteLockAPIError(
      `RemoteLock API error: ${errorMessage}`,
      statusCode,
    );
  }

  /**
   * Client bound to an explicit access token rather than a hotel.
   *
   * The OAuth callback holds a token for an account it can't yet map to a
   * hotel — identifying it is the whole point of the `GET /user` call it makes
   * — so there is no hotel id to scope by. `UNIDENTIFIED_HOTEL_ID` stands in
   * for KPI/log dimensions until someone links the authorization.
   */
  static forAccessToken(accessToken: string): RemoteLockClient {
    return new RemoteLockClient(UNIDENTIFIED_HOTEL_ID, accessToken);
  }

  private emitKpi(stat: KpiStatValue): void {
    logKpi({
      stat,
      value: 1,
      contextName: 'remoteLockClient',
      clientId: this.hotelId,
    });
  }

  /**
   * Fetches the RemoteLock user the current token authenticates as. Used by
   * the OAuth callback to identify who authorized Dextr, since the callback
   * itself carries nothing that names the hotel.
   */
  async getUser(): Promise<RemoteLockUser> {
    logger.info('Fetching signed-in user from RemoteLock', {
      hotelId: this.hotelId,
    });

    const response =
      await this.axiosInstance.get<RemoteLockResourceEnvelope<RemoteLockUser>>(
        '/user',
      );

    this.emitKpi(KpiStat.RemoteLockUserFetched);

    return response.data.data;
  }

  /**
   * Fetches one page of access persons. Defaults to `access_guest`, which is
   * what door-code lookups match against. RemoteLock returns only `current` +
   * `upcoming` guests unless a `status` filter is supplied.
   *
   * `status` is passed as `attributes[status][]`; axios serializes array params
   * with the `[]` suffix (paramsSerializer default), matching the API.
   */
  private async fetchAccessPersonsPage(
    params: GetAccessPersonsParams,
  ): Promise<RemoteLockCollectionEnvelope<AccessGuest>> {
    const { type = 'access_guest', status, sort, page, per_page } = params;

    logger.info('Fetching access persons from RemoteLock', {
      hotelId: this.hotelId,
      type,
      status,
      page,
    });

    const response = await this.axiosInstance.get<
      RemoteLockCollectionEnvelope<AccessGuest>
    >('/access_persons', {
      params: {
        type,
        ...(status ? { 'attributes[status]': status } : {}),
        ...(sort ? { sort } : {}),
        ...(page ? { page } : {}),
        ...(per_page ? { per_page } : {}),
      },
    });

    logger.info('Successfully fetched access persons from RemoteLock', {
      hotelId: this.hotelId,
      count: response.data.data.length,
      page: response.data.meta.page,
      total_pages: response.data.meta.total_pages,
    });

    return response.data;
  }

  /**
   * Fetches every page of access persons, ignoring any `page` in `params`.
   * RemoteLock caps `per_page` at 50 (docs 03-conventions), so this is used
   * by door-code lookups, which need the full current+upcoming guest list to
   * find a match regardless of how many pages it spans.
   */
  async getAllAccessPersons(
    params: GetAccessPersonsParams = {},
  ): Promise<AccessGuest[]> {
    try {
      const perPage = params.per_page ?? 50;
      const allGuests: AccessGuest[] = [];
      let page = 1;
      let totalPages = 1;

      do {
        const envelope = await this.fetchAccessPersonsPage({
          ...params,
          page,
          per_page: perPage,
        });
        allGuests.push(...envelope.data);
        totalPages = envelope.meta.total_pages;
        page += 1;
      } while (page <= totalPages);

      this.emitKpi(KpiStat.RemoteLockAccessPersonsFetched);
      return allGuests;
    } catch (error) {
      this.emitKpi(KpiStat.RemoteLockAccessPersonsError);
      logger.error('Error fetching all access persons from RemoteLock', {
        error: error instanceof Error ? error.message : String(error),
        hotelId: this.hotelId,
      });
      throw error;
    }
  }

  /** Fetches a single access person by id. */
  async getAccessPerson(id: string): Promise<AccessGuest> {
    try {
      logger.info('Fetching access person from RemoteLock', {
        hotelId: this.hotelId,
        id,
      });

      const response = await this.axiosInstance.get<
        RemoteLockResourceEnvelope<AccessGuest>
      >(`/access_persons/${id}`);

      this.emitKpi(KpiStat.RemoteLockAccessPersonsFetched);
      return response.data.data;
    } catch (error) {
      this.emitKpi(KpiStat.RemoteLockAccessPersonsError);
      logger.error('Error fetching access person from RemoteLock', {
        error: error instanceof Error ? error.message : String(error),
        hotelId: this.hotelId,
        id,
      });
      throw error;
    }
  }
}
