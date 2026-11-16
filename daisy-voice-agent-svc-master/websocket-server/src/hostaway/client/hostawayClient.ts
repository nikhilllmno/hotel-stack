import {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import config from '../../config';
import { BadRequestError } from '../../errors/BadRequestError';
import { createHttpClient } from '../../utils/httpClient';
import logger from '../../utils/logger';
import { HostawayApiError } from '../errors/HostawayApiError';
import { HostawayAuthenticationError } from '../errors/HostawayAuthenticationError';
import { HostawayRateLimitError } from '../errors/HostawayRateLimitError';
import { HostawayErrorResponse } from '../types/HostawayError';
import {
  HostawayOfflineChargeRequest,
  HostawayOfflineChargeResponse,
} from '../types/OfflineCharge';

export class HostawayClient {
  private axiosInstance: AxiosInstance;
  private accessToken: string;
  private maxRetries: number = 3;
  private retryDelay: number = 1000;

  constructor() {
    if (!config.HOSTAWAY_ACCESS_TOKEN) {
      throw new BadRequestError(
        'HOSTAWAY_ACCESS_TOKEN environment variable is required',
      );
    }

    if (!config.HOSTAWAY_PROVIDER_ID) {
      throw new BadRequestError(
        'HOSTAWAY_PROVIDER_ID environment variable is required',
      );
    }

    this.accessToken = config.HOSTAWAY_ACCESS_TOKEN;

    this.axiosInstance = createHttpClient('hostaway', {
      baseURL: config.HOSTAWAY_API_BASE_URL,
      timeout: config.API_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    this.axiosInstance.interceptors.request.use(
      (reqConfig: InternalAxiosRequestConfig) => {
        reqConfig.headers.Authorization = `Bearer ${this.accessToken}`;
        reqConfig.headers['Cache-control'] = 'no-cache';
        return reqConfig;
      },
      (error) => {
        return Promise.reject(error);
      },
    );

    this.axiosInstance.interceptors.response.use(
      (response: AxiosResponse) => {
        // Check if Hostaway API returned a 'fail' status in the response body
        if (response.data && response.data.status === 'fail') {
          const errorMsg =
            response.data.message || 'Unknown error from Hostaway API';
          logger.error(`Hostaway API returned fail status: ${errorMsg}`);
          throw new HostawayApiError(
            `Hostaway API error: ${errorMsg}`,
            response.status || 400,
            errorMsg,
          );
        }

        return response;
      },
      async (error: AxiosError) => {
        return this.handleError(error);
      },
    );
  }

  private async handleError(error: AxiosError): Promise<any> {
    const response = error.response;
    const config = error.config;

    if (!response) {
      logger.error('Hostaway API network error:', error.message);
      throw new HostawayApiError(
        'Network error connecting to Hostaway API',
        500,
      );
    }

    const errorData = response.data as HostawayErrorResponse;
    const errorMessage = errorData?.message || error.message;
    const statusCode = response.status;

    logger.error(`Hostaway API Error: ${statusCode} - ${errorMessage}`, {
      url: config?.url,
      method: config?.method,
      status: statusCode,
      data: errorData,
    });

    if (statusCode === 401) {
      throw new HostawayAuthenticationError(errorMessage);
    }

    if (statusCode === 404) {
      throw new HostawayApiError(
        `Resource not found: ${errorMessage}`,
        404,
        errorMessage,
      );
    }

    if (statusCode === 429) {
      const retryAfter = response.headers['retry-after'];
      const retryAfterSeconds = retryAfter
        ? parseInt(retryAfter, 10)
        : undefined;

      if (config && !config.headers['X-Retry-Count']) {
        return this.retryWithBackoff(config, 0);
      }

      throw new HostawayRateLimitError(errorMessage, retryAfterSeconds);
    }

    if (statusCode >= 500) {
      throw new HostawayApiError(
        `Hostaway server error: ${errorMessage}`,
        statusCode,
        errorMessage,
      );
    }

    throw new HostawayApiError(errorMessage, statusCode, errorMessage);
  }

  private async retryWithBackoff(
    config: InternalAxiosRequestConfig,
    retryCount: number,
  ): Promise<any> {
    if (retryCount >= this.maxRetries) {
      throw new HostawayRateLimitError(
        'Max retry attempts reached for rate limit',
      );
    }

    const delay = this.retryDelay * Math.pow(2, retryCount);
    logger.info(
      `Retrying Hostaway request after ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`,
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    config.headers['X-Retry-Count'] = (retryCount + 1).toString();

    try {
      const response = await this.axiosInstance.request(config);
      return response.data;
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 429) {
        return this.retryWithBackoff(config, retryCount + 1);
      }
      throw error;
    }
  }

  public getAxiosInstance(): AxiosInstance {
    return this.axiosInstance;
  }

  public async get<T>(url: string, params?: Record<string, any>): Promise<T> {
    const response = await this.axiosInstance.get<T>(url, { params });
    return response.data;
  }

  public async post<T>(
    url: string,
    data?: any,
    params?: Record<string, any>,
  ): Promise<T> {
    const response = await this.axiosInstance.post<T>(url, data, { params });
    return response.data;
  }

  public async put<T>(url: string, data?: any): Promise<T> {
    const response = await this.axiosInstance.put<T>(url, data);
    return response.data;
  }

  public async delete<T>(url: string): Promise<T> {
    const response = await this.axiosInstance.delete<T>(url);
    return response.data;
  }

  /**
   * Create an offline charge in Hostaway for a reservation
   * @param reservationId - Hostaway reservation ID
   * @param chargeData - Offline charge details
   * @returns Created offline charge
   */
  public async createOfflineCharge(
    reservationId: number,
    chargeData: HostawayOfflineChargeRequest,
  ): Promise<HostawayOfflineChargeResponse> {
    const url = `/guestPayments/charges/${reservationId}?provider=${config.HOSTAWAY_PROVIDER_ID}`;
    return this.post<HostawayOfflineChargeResponse>(url, chargeData);
  }
}

const hostawayClient = new HostawayClient();
export default hostawayClient;
