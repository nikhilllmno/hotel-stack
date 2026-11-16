import axios from 'axios';
import config from '../../config';
import { TokenError } from '../../errors/TokenError';
import {
  HotelRefreshResult,
  PmsTokenService,
} from '../../pms/services/PmsTokenService';
import { HotelConfigurationRepository } from '../../repositories/HotelConfigurationRepository';
import { PmsProvider } from '../../types/enums';
import { decrypt, encrypt } from '../../utils/encryption';
import logger from '../../utils/logger';

interface StayntouchOAuthResponse {
  access_token: string;
  token_type: string;
  expires_in?: number; // seconds the token is valid for
  created_at?: number; // Unix timestamp (seconds) when the token was issued
}

export class StayntouchTokenService extends PmsTokenService {
  constructor(hotelConfigurationRepository: HotelConfigurationRepository) {
    super('stayntouch', hotelConfigurationRepository);
  }

  /**
   * Discovers every hotel with OAuth client credentials stored in
   * `external_auth_config` (filtered to Stayntouch via `hotels.pms_provider`),
   * fetches a fresh bearer token for each, and writes it into
   * `external_auth_config.apiToken`.
   *
   * A single hotel's failure never aborts the rest — the per-hotel outcome
   * is returned so callers can see (and alert on) partial failures instead
   * of the whole batch reporting a single "it worked".
   */
  async refreshToken(): Promise<HotelRefreshResult[]> {
    try {
      const hotelIds =
        await this.hotelConfigurationRepository.findHotelIdsWithOAuthClientCredentials(
          PmsProvider.STAYNTOUCH,
        );

      if (!hotelIds.length) {
        throw new TokenError(
          'No Stayntouch hotels have OAuth client credentials stored in external_auth_config',
        );
      }

      logger.info(
        'StayntouchTokenService::refreshToken - Starting per-hotel token refresh',
        {
          hotel_count: hotelIds.length,
        },
      );

      const results = await this.refreshHotelsWithRetry(
        hotelIds.map((id) => [id, undefined] as [string, undefined]),
        async (hotelId) => {
          const authConfig =
            await this.hotelConfigurationRepository.findExternalAuthConfigByHotelId(
              hotelId,
            );

          if (
            !authConfig?.oauth_client_id ||
            !authConfig?.oauth_client_secret
          ) {
            throw new TokenError(
              `Hotel ${hotelId} is missing OAuth client credentials in external_auth_config`,
            );
          }

          const clientId = decrypt(authConfig.oauth_client_id);
          const clientSecret = decrypt(authConfig.oauth_client_secret);

          const token = await this.fetchTokenWithCredentials(
            clientId,
            clientSecret,
          );
          await this.hotelConfigurationRepository.updateExternalAuthConfigApiTokenByHotelId(
            hotelId,
            encrypt(token),
          );
        },
      );

      if (results.every((result) => !result.success)) {
        throw new TokenError(
          'Token refresh failed for all Stayntouch hotels with stored OAuth credentials',
        );
      }

      return results;
    } catch (error) {
      if (error instanceof TokenError) throw error;
      throw new TokenError(
        `StayntouchTokenService::refreshToken failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Fetches a bearer token from the Stayntouch OAuth endpoint using the
   * supplied per-hotel credentials.
   */
  private async fetchTokenWithCredentials(
    clientId: string,
    clientSecret: string,
  ): Promise<string> {
    const response = await axios.post<StayntouchOAuthResponse>(
      config.STAYNTOUCH_AUTH_URL + '/oauth/token',
      {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: config.API_TIMEOUT,
      },
    );

    const { access_token, expires_in, created_at } = response.data;

    if (!access_token) {
      throw new TokenError(
        'Stayntouch OAuth response did not contain an access_token',
      );
    }

    if (created_at && expires_in) {
      const expiresAt = new Date((created_at + expires_in) * 1000);
      logger.info('StayntouchTokenService::fetchToken - Token obtained', {
        expires_at: expiresAt,
      });
    }

    return access_token;
  }
}

export const stayntouchTokenService = new StayntouchTokenService(
  new HotelConfigurationRepository(),
);
