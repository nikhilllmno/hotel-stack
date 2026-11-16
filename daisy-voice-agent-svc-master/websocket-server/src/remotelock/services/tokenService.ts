import axios from 'axios';
import config from '../../config';
import { TokenError } from '../../errors/TokenError';
import {
  HotelRefreshResult,
  PmsTokenService,
} from '../../pms/services/PmsTokenService';
import { HotelConfigurationRepository } from '../../repositories/HotelConfigurationRepository';
import { decrypt, encrypt } from '../../utils/encryption';
import logger from '../../utils/logger';
import { getRemoteLockClientCredentials } from '../config';

interface RemoteLockOAuthResponse {
  access_token: string;
  token_type: string;
  expires_in?: number; // seconds the token is valid for (RemoteLock: 7200)
  refresh_token?: string; // rotated on every refresh
  created_at?: number; // Unix timestamp (seconds) when the token was issued
}

/**
 * RemoteLock uses the OAuth 2.0 Authorization Code grant. The initial
 * `code → token` exchange happens when a hotel authorizes Daisy from the
 * RemoteLock marketplace (see `RemoteLockOAuthService`); that callback can't
 * identify the hotel, so the resulting token pair is pasted into
 * `external_auth_config` by hand. This service only *refreshes* what is
 * already stored there:
 *
 * - Reads the stored (encrypted) `remotelock_refresh_token` for each hotel.
 * - Exchanges it via `grant_type=refresh_token` using Dextr's own Application
 *   credentials — one `client_id`/`client_secret` pair for every hotel.
 * - Stores the new `remotelock_access_token` and the rotated
 *   `remotelock_refresh_token` — the previous refresh token is now invalid.
 */
export class RemoteLockTokenService extends PmsTokenService {
  constructor(hotelConfigurationRepository: HotelConfigurationRepository) {
    super('remotelock', hotelConfigurationRepository);
  }

  /**
   * RemoteLock's access token is a separate credential from the PMS
   * `apiToken` that the base class reads — a hotel can run both — so this
   * overrides the base lookup to read RemoteLock's own key.
   */
  async getActiveToken(hotelId: string): Promise<string> {
    try {
      const externalAuthConfig =
        await this.hotelConfigurationRepository.findExternalAuthConfigByHotelId(
          hotelId,
        );

      const encryptedToken = externalAuthConfig?.remotelock_access_token;
      if (encryptedToken) {
        return decrypt(encryptedToken);
      }

      throw new TokenError(
        `No RemoteLock access token available for hotel ${hotelId} — the hotel must authorize Daisy from the RemoteLock marketplace, and the resulting token pair must be stored in external_auth_config`,
      );
    } catch (error) {
      if (error instanceof TokenError) throw error;
      throw new TokenError(
        `Failed to retrieve RemoteLock access token for hotel ${hotelId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Refreshes every hotel that has a stored RemoteLock refresh token. The
   * hotel list comes from the DB rather than an env var: a hotel becomes a
   * RemoteLock hotel only once its token pair is stored.
   *
   * A single hotel's failure never aborts the rest — the per-hotel outcome
   * is returned so callers can see (and alert on) partial failures instead
   * of the whole batch reporting a single "it worked".
   */
  async refreshToken(): Promise<HotelRefreshResult[]> {
    try {
      const { clientId, clientSecret } = getRemoteLockClientCredentials();

      const hotelIds =
        await this.hotelConfigurationRepository.findHotelIdsWithRemoteLockRefreshToken();

      if (!hotelIds.length) {
        throw new TokenError(
          'No hotels have a RemoteLock refresh token stored',
        );
      }

      logger.info(
        'RemoteLockTokenService::refreshToken - Starting per-hotel token refresh',
        {
          hotel_count: hotelIds.length,
        },
      );

      // maxAttempts=1: RemoteLock rotates (and invalidates) the refresh token
      // on every exchange, so retrying the whole operation would re-send an
      // already-spent token and fail. The one genuinely retryable step — the
      // idempotent DB write — retries internally in `refreshHotelToken`.
      const results = await this.refreshHotelsWithRetry(
        hotelIds.map((hotelId) => [hotelId, undefined] as [string, undefined]),
        async (hotelId) => {
          await this.refreshHotelToken(hotelId, clientId, clientSecret);
        },
        1,
      );

      if (results.every((result) => !result.success)) {
        throw new TokenError(
          'Token refresh failed for every hotel with a stored RemoteLock refresh token',
        );
      }

      return results;
    } catch (error) {
      if (error instanceof TokenError) throw error;
      throw new TokenError(
        `RemoteLockTokenService::refreshToken failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Refreshes a single hotel's token: reads the stored refresh token, exchanges
   * it, and persists the new access token + rotated refresh token in one write.
   *
   * The exchange is deliberately *not* retried — RemoteLock invalidates the
   * refresh token the moment it is used, so a second attempt would re-send a
   * spent token. Only the persist step retries (see `persistTokens`), and it
   * reuses the tokens already held in memory rather than re-reading the stale
   * ones from the DB.
   */
  private async refreshHotelToken(
    hotelId: string,
    clientId: string,
    clientSecret: string,
  ): Promise<void> {
    const externalAuthConfig =
      await this.hotelConfigurationRepository.findExternalAuthConfigByHotelId(
        hotelId,
      );

    const encryptedRefreshToken = externalAuthConfig?.remotelock_refresh_token;
    if (!encryptedRefreshToken) {
      throw new TokenError(
        `No RemoteLock refresh token stored for hotel ${hotelId} — the hotel must re-authorize Daisy from the RemoteLock marketplace`,
      );
    }

    const refreshToken = decrypt(encryptedRefreshToken);

    const { access_token, refresh_token } =
      await this.fetchTokenWithRefreshToken(
        clientId,
        clientSecret,
        refreshToken,
      );

    if (!refresh_token) {
      // The stored refresh token is already spent, so keep the access token
      // RemoteLock did return: the hotel stays usable until it expires, which
      // is the window an operator has to reseed the pair by hand. The refresh
      // token is rewritten unchanged — there is no new one to store.
      try {
        await this.persistTokens(hotelId, access_token, refreshToken);
      } catch (error) {
        logger.error(
          'RemoteLockTokenService::refreshHotelToken - Could not store the access token returned without a rotated refresh_token',
          {
            hotelId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
      throw new TokenError(
        `RemoteLock OAuth response for hotel ${hotelId} did not contain a rotated refresh_token`,
      );
    }

    await this.persistTokens(hotelId, access_token, refresh_token);
  }

  /**
   * Writes the freshly exchanged tokens, retrying the write itself.
   *
   * By this point RemoteLock has already rotated the refresh token, so losing
   * this write strands the hotel (the stored refresh token is spent and the
   * hotel has to re-authorize by hand). The write is idempotent — same row,
   * same values — so retrying it is safe, unlike retrying the exchange.
   */
  private async persistTokens(
    hotelId: string,
    accessToken: string,
    refreshToken: string,
    maxAttempts = 3,
  ): Promise<void> {
    const encryptedAccessToken = encrypt(accessToken);
    const encryptedRefreshToken = encrypt(refreshToken);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const updatedRows =
          await this.hotelConfigurationRepository.updateExternalAuthConfigRemoteLockTokensByHotelId(
            hotelId,
            encryptedAccessToken,
            encryptedRefreshToken,
          );

        // A soft delete between listing the hotels and this write leaves the
        // update matching nothing, which would otherwise read as success while
        // the rotated tokens went nowhere. Thrown inside the loop so it goes
        // through the same retry and final-failure handling.
        if (updatedRows !== 1) {
          throw new Error(
            `expected to update exactly 1 hotel_configurations row, updated ${updatedRows}`,
          );
        }
        return;
      } catch (error) {
        const isLastAttempt = attempt === maxAttempts;
        logger.warn(
          'RemoteLockTokenService::persistTokens - Token write failed',
          {
            hotelId,
            attempt,
            remaining: maxAttempts - attempt,
            error: error instanceof Error ? error.message : String(error),
          },
        );

        if (isLastAttempt) {
          throw new TokenError(
            `RemoteLock tokens for hotel ${hotelId} were rotated but could not be stored after ${maxAttempts} attempts — the stored refresh token is now spent, so the hotel must re-authorize Daisy from the RemoteLock marketplace: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  /**
   * Exchanges a refresh token for a new access + refresh token pair at the
   * RemoteLock OAuth endpoint. Body is `application/x-www-form-urlencoded` per
   * RemoteLock docs.
   */
  private async fetchTokenWithRefreshToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
  ): Promise<RemoteLockOAuthResponse> {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await axios.post<RemoteLockOAuthResponse>(
      `${config.REMOTELOCK_AUTH_URL.replace(/\/+$/, '')}/oauth/token`,
      body.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: config.API_TIMEOUT,
      },
    );

    const { access_token, expires_in, created_at } = response.data;

    if (!access_token) {
      throw new TokenError(
        'RemoteLock OAuth response did not contain an access_token',
      );
    }

    if (created_at && expires_in) {
      const expiresAt = new Date((created_at + expires_in) * 1000);
      logger.info('RemoteLockTokenService::fetchToken - Token obtained', {
        expires_at: expiresAt,
      });
    }

    return response.data;
  }
}

export const remoteLockTokenService = new RemoteLockTokenService(
  new HotelConfigurationRepository(),
);
