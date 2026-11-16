/**
 * Stayntouch API Client
 *
 * Low-level HTTP client for Stayntouch PMS API.
 * Handles authentication, request/response interceptors, and error handling.
 *
 * API Requirements:
 * - API-Version: 2.0 header must be included in all requests
 * - Authorization: Bearer token authentication
 * - Base URL: Configured via STAYNTOUCH_BASE_URL environment variable
 *
 * Error Handling:
 * - 401: Authentication errors
 * - 404: Resource not found
 * - 429: Rate limit exceeded
 * - Network errors: Wrapped in StayntouchAPIError
 */

import {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import config from '../../config';
import { createHttpClient } from '../../utils/httpClient';
import logger from '../../utils/logger';
import { StayntouchAPIError, StayntouchConfigurationError } from '../errors';
import { stayntouchTokenService } from '../services/tokenService';
import {
  AddReservationNotesRequest,
  AddonsResponse,
  AvailabilityRequest,
  AvailabilityResponse,
  CancelReservationRequest,
  CancelReservationResponse,
  CreateGuestRequest,
  CreateGuestResponse,
  CreateReservationResponse,
  GetRateResponse,
  GetReservationResponse,
  GetRestrictionsParams,
  RecordCCPaymentRequest,
  RestrictionsResponse,
  RoomRatesRequest,
  RoomRatesResponse,
  RoomTypesResponse,
  SearchReservationsParams,
  SearchReservationsResponse,
  UpdateGuestRequest,
  UpdateGuestResponse,
} from '../types';
import {
  CreateReservationRequest,
  UpdateReservationRequest,
} from '../types/ReservationRequest';
import { UpdateReservationResponse } from '../types/ReservationResponse';
import { mapStayntouchSourceCodeToReservationSource } from '../utils/helper';
import { normalizeGetReservationStayDates } from '../utils/stayDates';

export class StayntouchClient {
  private axiosInstance: AxiosInstance;
  private baseUrl: string;

  /**
   * @param hotelId - Internal hotel UUID used to scope the bearer token to this
   *   specific hotel's credentials stored in hotel_configurations.external_auth_config.
   */
  constructor(private readonly hotelId: string) {
    this.validateConfiguration();

    this.baseUrl = config.STAYNTOUCH_BASE_URL;

    this.axiosInstance = createHttpClient('stayntouch', {
      baseURL: this.baseUrl,
      timeout: config.API_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'API-Version': '2.0',
      },
    });

    this.setupInterceptors();
  }

  private validateConfiguration(): void {
    if (!config.STAYNTOUCH_BASE_URL || !config.STAYNTOUCH_BASE_URL.trim()) {
      throw new StayntouchConfigurationError(
        'STAYNTOUCH_BASE_URL is not configured',
      );
    }
  }

  private setupInterceptors(): void {
    this.axiosInstance.interceptors.request.use(
      async (reqConfig: InternalAxiosRequestConfig) => {
        const token = await stayntouchTokenService.getActiveToken(this.hotelId);
        reqConfig.headers.Authorization = `Bearer ${token}`;
        return reqConfig;
      },
      (error) => {
        return Promise.reject(error);
      },
    );

    this.axiosInstance.interceptors.response.use(
      (response: AxiosResponse) => response,
      async (error: AxiosError) => {
        return this.handleError(error);
      },
    );
  }

  private async handleError(error: AxiosError): Promise<any> {
    const response = error.response;
    const requestConfig = error.config;

    if (!response) {
      logger.error('Stayntouch API network error:', error.message);
      throw new StayntouchAPIError(
        'Network error connecting to Stayntouch API',
        500,
      );
    }

    const errorMessage = (response.data as any)?.message || error.message;
    const statusCode = response.status;

    logger.error(`Stayntouch API Error: ${statusCode} - ${errorMessage}`, {
      url: requestConfig?.url,
      method: requestConfig?.method,
      status: statusCode,
      data: response.data,
    });

    if (statusCode === 401) {
      throw new StayntouchAPIError(
        'Authentication failed with Stayntouch API',
        401,
      );
    }

    if (statusCode === 404) {
      throw new StayntouchAPIError(`Resource not found: ${errorMessage}`, 404);
    }

    if (statusCode === 429) {
      throw new StayntouchAPIError(
        'Rate limit exceeded for Stayntouch API',
        429,
      );
    }

    throw new StayntouchAPIError(
      `Stayntouch API error: ${errorMessage}`,
      statusCode,
    );
  }

  async getAvailability(
    businessId: string,
    params: Omit<AvailabilityRequest, 'is_channel_manager'>,
  ): Promise<AvailabilityResponse> {
    try {
      logger.info('Fetching availability from Stayntouch', {
        businessId,
        from_date: params.from_date,
        to_date: params.to_date,
        adults: params.adults,
        children: params.children,
      });

      const response = await this.axiosInstance.get<AvailabilityResponse>(
        `/hotels/${businessId}/availability`,
        {
          params: {
            ...params,
            is_channel_manager: true,
          },
        },
      );

      logger.info('Successfully fetched availability from Stayntouch', {
        response: response.data,
      });

      return response.data;
    } catch (error) {
      logger.error('Error fetching availability from Stayntouch', { error });
      throw error;
    }
  }

  async getRoomRates(
    businessId: string,
    params: RoomRatesRequest,
  ): Promise<RoomRatesResponse> {
    try {
      logger.info('Fetching room rates from Stayntouch', {
        businessId,
        rate_id: params.rate_id,
        room_type_id: params.room_type_id,
      });

      const response = await this.axiosInstance.get<RoomRatesResponse>(
        `/hotels/${businessId}/availability/room_rates`,
        { params },
      );

      logger.info('Successfully fetched room rates from Stayntouch', {
        total_stay_cost: response.data.total_stay_cost,
      });

      return response.data;
    } catch (error) {
      logger.error('Error fetching room rates from Stayntouch', { error });
      throw error;
    }
  }

  /**
   * Fetches room-type-level restrictions (min_length_of_stay, min_stay_through)
   * for the given date range.
   * http://api-specs.stayntouch.com/v2/index.html#restrictions_room_type_get
   */
  async getRoomTypeRestrictions(
    params: GetRestrictionsParams,
  ): Promise<RestrictionsResponse> {
    try {
      logger.info('Fetching room type restrictions from Stayntouch', {
        hotel_id: params.hotel_id,
        from_date: params.from_date,
        to_date: params.to_date,
      });

      const response = await this.axiosInstance.get<RestrictionsResponse>(
        '/restrictions/room_type',
        { params },
      );

      logger.info(
        'Successfully fetched room type restrictions from Stayntouch',
        {
          restriction_count: response.data.restrictions?.length ?? 0,
        },
      );

      return response.data;
    } catch (error) {
      logger.error('Error fetching room type restrictions from Stayntouch', {
        error,
      });
      throw error;
    }
  }

  async createGuest(
    guestData: CreateGuestRequest,
  ): Promise<CreateGuestResponse> {
    try {
      logger.info('Creating guest in Stayntouch', {
        email_domain: guestData.email?.split('@')[1],
        has_mobile_phone: !!guestData.mobile_phone,
      });

      const response = await this.axiosInstance.post<CreateGuestResponse>(
        '/guests',
        guestData,
      );

      logger.info('Successfully created guest in Stayntouch', {
        guest_id: response.data.id,
      });

      return response.data;
    } catch (error) {
      logger.error('Error creating guest in Stayntouch', { error });
      throw error;
    }
  }

  async updateGuest(
    guestId: number,
    guestData: UpdateGuestRequest,
  ): Promise<UpdateGuestResponse> {
    try {
      logger.info('Updating guest in Stayntouch', {
        guest_id: guestId,
        updates: Object.keys(guestData),
      });

      const response = await this.axiosInstance.put<UpdateGuestResponse>(
        `/guests/${guestId}`,
        guestData,
      );

      logger.info('Successfully updated guest in Stayntouch', {
        guest_id: response.data.id,
        warnings: response.data.warnings,
      });

      return response.data;
    } catch (error) {
      logger.error('Error updating guest in Stayntouch', {
        error,
        guest_id: guestId,
      });
      throw error;
    }
  }

  async createReservation(
    reservationData: CreateReservationRequest,
  ): Promise<CreateReservationResponse> {
    try {
      logger.info('Creating reservation in Stayntouch', {
        hotel_id: reservationData.hotel_id,
        arrival_date: reservationData.arrival_date,
        departure_date: reservationData.departure_date,
        guests: reservationData.guests,
        stay_dates: reservationData.stay_dates,
        ...(reservationData.notes && { notes: reservationData.notes }),
        ...(reservationData.addons && { addons: reservationData.addons }),
      });

      const response = await this.axiosInstance.post<CreateReservationResponse>(
        '/reservations',
        reservationData,
      );

      logger.info('Successfully created reservation in Stayntouch', {
        reservation_id: response.data.id,
      });

      return response.data;
    } catch (error) {
      logger.error('Error creating reservation in Stayntouch', { error });
      throw error;
    }
  }

  async getReservation(reservationId: string): Promise<GetReservationResponse> {
    try {
      logger.info('Fetching reservation from Stayntouch', {
        reservation_id: reservationId,
      });

      const response = await this.axiosInstance.get<GetReservationResponse>(
        `/reservations/${reservationId}`,
      );

      const reservation = normalizeGetReservationStayDates(response.data);
      reservation.reservation_source =
        mapStayntouchSourceCodeToReservationSource(reservation.source_code);

      logger.info('Successfully fetched reservation from Stayntouch', {
        reservation_id: reservation.id,
        confirmation_number: reservation.confirmation_number,
        stay_dates_count: reservation.stay_dates?.length ?? 0,
      });

      return reservation;
    } catch (error) {
      logger.error('Error fetching reservation from Stayntouch', {
        error,
        reservation_id: reservationId,
      });
      throw error;
    }
  }

  /**
   * Search reservations by hotel and confirmation number, phone digits, or guest query.
   * Searches using one parameter at a time.
   * http://api-specs.stayntouch.com/v2/index.html#reservations_get
   */
  async searchReservations(
    hotelId: number,
    params: SearchReservationsParams,
  ): Promise<SearchReservationsResponse> {
    try {
      let searchDigits: string | null = null;
      let originalSearchPhone: string = '';
      if ('mobile_number' in params) {
        searchDigits = normalizeStayntouchPhoneSearchDigits(
          params.mobile_number,
        );
        if (!searchDigits) {
          logger.info(
            'Skipping Stayntouch reservation search: insufficient mobile digits',
            {
              hotel_id: hotelId,
            },
          );
          return { results: [], total_count: 0 };
        }
        originalSearchPhone = params.mobile_number;
        params = { ...params, mobile_number: searchDigits };
      } else if ('home_phone' in params) {
        searchDigits = normalizeStayntouchPhoneSearchDigits(params.home_phone);
        if (!searchDigits) {
          logger.info(
            'Skipping Stayntouch reservation search: insufficient home phone digits',
            {
              hotel_id: hotelId,
            },
          );
          return { results: [], total_count: 0 };
        }
        originalSearchPhone = params.home_phone;
        params = { ...params, home_phone: searchDigits };
      }

      logger.info('Searching reservations in Stayntouch', {
        hotel_id: hotelId,
        search_key: JSON.stringify(params),
      });

      const response = await this.axiosInstance.get<SearchReservationsResponse>(
        '/reservations',
        {
          params: {
            hotel_id: hotelId,
            ...params,
          },
        },
      );

      let results = (response.data.results ?? []).map((res) => {
        const normalized = normalizeGetReservationStayDates(res);
        normalized.reservation_source =
          mapStayntouchSourceCodeToReservationSource(normalized.source_code);
        return normalized;
      });

      if (
        ('mobile_number' in params || 'home_phone' in params) &&
        searchDigits
      ) {
        // Get the full search phone number (not just last 4 digits) for better filtering
        const fullSearchPhone = originalSearchPhone.replace(/\D/g, '');

        logger.info('Filtering phone search results', {
          search_phone_suffix: originalSearchPhone.slice(-4),
          full_search_digits_length: fullSearchPhone.length,
          searchDigits,
          resultsBeforeFilter: results.length,
        });

        results = results.filter((res) => {
          const guest =
            res.guests?.find((g) => g.is_primary) || res.guests?.[0];
          const guestPhone = (
            'mobile_number' in params ? guest?.mobile_phone : guest?.home_phone
          )?.replace(/\D/g, '');

          if (!guestPhone) return false;

          // If we have enough digits in the search phone, do a more precise match
          if (fullSearchPhone.length > 4) {
            // Check if the guest phone ends with the full search phone number
            const matches = guestPhone.endsWith(fullSearchPhone);
            if (!matches && guestPhone.endsWith(searchDigits)) {
              logger.info('Filtered out partial match', {
                search_phone_suffix: originalSearchPhone.slice(-4),
                guest_phone_suffix: ('mobile_number' in params
                  ? guest?.mobile_phone
                  : guest?.home_phone
                )
                  ?.replace(/\D/g, '')
                  .slice(-4),
                searchDigits,
                reservationId: res.id,
              });
            }
            return matches;
          } else {
            // Fall back to last 4 digits match for short search inputs
            return guestPhone.endsWith(searchDigits);
          }
        });

        logger.info('Phone search results after filtering', {
          resultsAfterFilter: results.length,
        });
      }

      logger.info('Successfully searched reservations in Stayntouch', {
        hotel_id: hotelId,
        search_key: JSON.stringify(params),
        total_count: response.data.total_count,
        results_count: results.length,
      });

      return {
        ...response.data,
        results,
        total_count: response.data.total_count,
      };
    } catch (error) {
      logger.error('Error searching reservations in Stayntouch', {
        error,
        hotel_id: hotelId,
        params,
      });
      throw error;
    }
  }

  async updateReservation(
    reservationId: string,
    data: UpdateReservationRequest,
  ): Promise<UpdateReservationResponse> {
    try {
      logger.info('Updating reservation in Stayntouch', {
        reservation_id: reservationId,
        arrival_date: data.arrival_date,
        departure_date: data.departure_date,
        has_stay_dates: Boolean(data.stay_dates?.length),
        has_guests: Boolean(data.guests?.length),
        has_addons: Boolean(data.addons?.length),
      });

      const response = await this.axiosInstance.put<UpdateReservationResponse>(
        `/reservations/${reservationId}`,
        data,
      );

      logger.info('Successfully updated reservation in Stayntouch', {
        reservation_id: response.data.id,
        warnings: response.data.warnings,
      });

      return response.data;
    } catch (error) {
      logger.error('Error updating reservation in Stayntouch', {
        error,
        reservation_id: reservationId,
      });
      throw error;
    }
  }

  async getRoomTypes(
    businessId: string,
    perPage: number = 50,
  ): Promise<RoomTypesResponse> {
    try {
      logger.info('Fetching room types from Stayntouch', {
        businessId,
        perPage,
      });

      const response = await this.axiosInstance.get<RoomTypesResponse>(
        `/hotels/${businessId}/room_types`,
        {
          params: {
            per_page: perPage,
          },
        },
      );

      logger.info('Successfully fetched room types from Stayntouch', {
        totalCount: response.data.total_count,
      });

      return response.data;
    } catch (error) {
      logger.error('Error fetching room types from Stayntouch', { error });
      throw error;
    }
  }

  async cancelReservation(
    reservationId: string,
    cancelData: CancelReservationRequest = {},
  ): Promise<CancelReservationResponse> {
    try {
      logger.info('Cancelling reservation in Stayntouch', {
        reservation_id: reservationId,
        reason: cancelData.reason,
        send_cancellation_email: cancelData.send_cancellation_email,
        refund_deposit: cancelData.refund_deposit,
        charge_penalty: cancelData.charge_penalty,
      });

      const response = await this.axiosInstance.post<CancelReservationResponse>(
        `/reservations/${reservationId}/cancel`,
        cancelData,
      );

      logger.info('Successfully cancelled reservation in Stayntouch', {
        reservation_id: reservationId,
        status: response.data.status,
      });

      return response.data;
    } catch (error) {
      logger.error('Error cancelling reservation in Stayntouch', {
        error,
        reservation_id: reservationId,
      });
      throw error;
    }
  }

  async addReservationNotes(
    reservationId: string,
    noteData: AddReservationNotesRequest,
  ): Promise<void> {
    try {
      logger.info('Adding notes to reservation in Stayntouch', {
        reservation_id: reservationId,
        note_count: noteData.notes.length,
      });

      await this.axiosInstance.post(
        `/reservations/${reservationId}/notes`,
        noteData,
      );

      logger.info('Successfully added notes to reservation in Stayntouch', {
        reservation_id: reservationId,
      });
    } catch (error) {
      logger.error('Error adding notes to reservation in Stayntouch', {
        error,
        reservation_id: reservationId,
      });
      throw error;
    }
  }

  /**
   * Fetches the addons for a given hotel.
   * http://api-specs.stayntouch.com/v2/index.html#addons_get
   * @param hotelId - The ID of the hotel to fetch addons for.
   * @param params - Optional parameters to filter the addons.
   * @returns The addons for the given hotel.
   */
  async getAddons(
    hotelId: number,
    params?: { online?: boolean; page?: number; per_page?: number },
  ): Promise<AddonsResponse> {
    try {
      logger.info('Fetching addons from Stayntouch', { hotelId });

      const response = await this.axiosInstance.get<AddonsResponse>('/addons', {
        params: { hotel_id: hotelId, ...params },
      });

      logger.info('Successfully fetched addons from Stayntouch', {
        total_count: response.data.total_count,
      });

      return response.data;
    } catch (error) {
      logger.error('Error fetching addons from Stayntouch', { error, hotelId });
      throw error;
    }
  }

  /**
   * Fetches rate details by ID, including the human-readable rate code (e.g. "RACK").
   * http://api-specs.stayntouch.com/v2/index.html#rates__id__get
   */
  async getRate(rateId: number): Promise<GetRateResponse> {
    try {
      const response = await this.axiosInstance.get<GetRateResponse>(
        `/rates/${rateId}`,
      );
      return response.data;
    } catch (error) {
      logger.error('Error fetching rate from Stayntouch', { error, rateId });
      throw error;
    }
  }

  /**
   * Fetches all rates for a hotel in a single request.
   * http://api-specs.stayntouch.com/v2/index.html#hotels__id__rates_get
   */
  async getHotelRates(hotelId: number): Promise<GetRateResponse[]> {
    try {
      const response = await this.axiosInstance.get<{
        results: GetRateResponse[];
      }>(`/hotels/${hotelId}/rates`);
      return response.data?.results ?? [];
    } catch (error) {
      logger.error('Error fetching hotel rates from Stayntouch', {
        error,
        hotelId,
      });
      throw error;
    }
  }

  async recordCCPayment(
    reservationId: string,
    paymentData: RecordCCPaymentRequest,
  ) {
    try {
      logger.info('Recording CC payment in Stayntouch', {
        reservation_id: reservationId,
        amount: paymentData.amount,
        authorization_code: paymentData.authorization_code,
        transaction_id: paymentData.transaction_id,
      });

      const response = await this.axiosInstance.post(
        `/reservations/${reservationId}/record_cc_payment`,
        paymentData,
      );

      logger.info('Successfully recorded CC payment in Stayntouch', {
        reservation_id: reservationId,
        status: response.data.status,
      });

      return response.data;
    } catch (error) {
      logger.error('Error recording CC payment in Stayntouch', {
        error,
        reservation_id: reservationId,
      });
      throw error;
    }
  }
}

/** Stayntouch requires at least 4 consecutive digits; use the last 4 from the input. */
function normalizeStayntouchPhoneSearchDigits(
  phoneNumber: string,
): string | null {
  const digits = phoneNumber.replace(/\D/g, '');
  if (digits.length < 4) {
    return null;
  }

  return digits.slice(-4);
}
