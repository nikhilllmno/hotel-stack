/**
 * Exchanges a PAN for an OPI card token, through Calry's passthrough.
 *
 * Unlike every other Calry call this client is built on bare axios rather than
 * `createHttpClient`, and it does NOT reuse `CalryClient`: both attach
 * interceptors that log outgoing request bodies, and the body here contains the
 * PAN. Nothing in this file may log the request payload, `error.config` or
 * `error.request`. The three Calry headers are rebuilt here rather than
 * imported so the no-logging path stays self-contained.
 *
 * `POST {CALRY_BASE_URL}/api/v2/vrs/passthrough` wrapping
 * `POST {tokenExchangeHost}/tokenExchange/v1/hotels/{hotelCode}/tokens`
 * - 422 from OPI: the payment service provider declined the card.
 */

import axios, { AxiosError, AxiosInstance } from 'axios';
import config from '../../config';
import logger from '../../utils/logger';
import { CalryAPIError, OperaCardDeclinedError } from '../errors';
import {
  CalryCredentials,
  CalryEnvelope,
  CalryPassthroughRequest,
  OperaProblemDetail,
  OperaTokenExchangeRequest,
  OperaTokenExchangeResponse,
} from '../types';

/** OPI answers a declined card with 422. */
const DECLINED_STATUS = 422;

export class CalryCardTokenClient {
  private readonly axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: config.CALRY_BASE_URL,
      timeout: config.API_TIMEOUT,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Exchanges a PAN for a card token. The PAN is passed straight through to
   * Calry and never logged, stored, or returned.
   *
   * @param tokenExchangeHost - OPI token-exchange host for this property.
   * @throws {@link OperaCardDeclinedError} when the provider declines the card.
   * @throws {@link CalryAPIError} on any other failure.
   */
  async exchangeCardToken(
    tokenExchangeHost: string,
    propertyCode: string,
    body: OperaTokenExchangeRequest,
    credentials: CalryCredentials,
  ): Promise<OperaTokenExchangeResponse> {
    const request: CalryPassthroughRequest = {
      method: 'POST',
      sourceUrl: `${tokenExchangeHost.replace(/\/+$/, '')}/tokenExchange/v1/hotels/{hotelId}/tokens`,
      data: {
        pathParams: { hotelId: propertyCode },
        headers: { 'x-hotelid': propertyCode },
        body,
      },
    };

    try {
      const response = await this.axiosInstance.post<
        CalryEnvelope<OperaTokenExchangeResponse>
      >('/api/v2/vrs/passthrough', request, {
        headers: {
          Authorization: `Bearer ${credentials.apiToken}`,
          workspaceId: credentials.workspaceId,
          integrationAccountId: credentials.integrationAccountId,
        },
      });

      const token = response.data?.data?.token;
      if (!token) {
        throw new CalryAPIError(
          'Opera token exchange returned no card token',
          502,
        );
      }

      return response.data.data as OperaTokenExchangeResponse;
    } catch (error) {
      if (error instanceof CalryAPIError) throw error;
      return this.handleError(error as AxiosError<OperaProblemDetail>);
    }
  }

  private handleError(error: AxiosError<OperaProblemDetail>): never {
    const response = error.response;

    if (!response) {
      // error.message only — anything wider risks echoing the request body.
      logger.error('Opera token exchange network error', {
        message: error.message,
      });
      throw new CalryAPIError(
        'Network error connecting to Opera token exchange',
        500,
      );
    }

    // Calry may answer 200 with the upstream failure inside the envelope, or
    // surface the upstream status directly — check both for the decline.
    const problem = response.data;
    const upstreamStatus = problem?.status ?? response.status;

    // Never log response.config or the body: the request body holds the PAN.
    logger.error('Opera token exchange failed', {
      status: response.status,
      upstreamStatus,
      correlationId: problem?.correlationId,
      errorCode: problem?.['o:errorCode'],
    });

    if (upstreamStatus === DECLINED_STATUS) {
      throw new OperaCardDeclinedError('Card was declined');
    }

    throw new CalryAPIError(
      `Opera token exchange failed with status ${upstreamStatus}`,
      response.status,
    );
  }
}

export const calryCardTokenClient = new CalryCardTokenClient();
export default calryCardTokenClient;
