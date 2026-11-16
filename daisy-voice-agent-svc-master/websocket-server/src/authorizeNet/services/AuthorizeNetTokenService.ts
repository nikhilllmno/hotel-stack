/* global URLSearchParams */
import axios from 'axios';
import config from '../../config';
import { AuthorizeNetError } from '../../errors/AuthorizeNetError';
import { HotelConfigurationRepository } from '../../repositories/HotelConfigurationRepository';
import logger from '../../utils/logger';
import { AUTHNET_URLS, AuthorizeNetTokenResponse } from '../types';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * Manages OAuth tokens for Authorize.net API access.
 *
 * Refresh tokens are read from
 * `hotel_configurations.external_auth_config.authorizeNet` (per-hotel,
 * AES-256-GCM encrypted). Access tokens are cached in memory and proactively
 * refreshed before expiry.
 *
 * Auth.net **always** rotates the refresh token — the old one is invalidated the
 * moment an exchange succeeds. We persist the rotated refresh token immediately
 * after the exchange and before returning the access token. This narrows, but
 * cannot fully close, the failure window: if the process dies or the DB write
 * fails between a successful exchange and a committed persist, the DB is left
 * holding the now-invalid old token and the hotel must reconnect via OAuth. That
 * case is logged at CRITICAL for manual follow-up.
 */
export class AuthorizeNetTokenService {
  private tokenCache: Map<string, CachedToken> = new Map();
  private refreshPromises: Map<
    string,
    Promise<{
      accessToken: string;
      newRefreshToken?: string;
      expiresAt?: number;
    }>
  > = new Map();

  constructor(
    private readonly hotelConfigurationRepository: HotelConfigurationRepository = new HotelConfigurationRepository(),
  ) {}

  /**
   * Returns a valid bearer access token for a hotel.
   * Loads refresh token from DB, refreshes when cache expires,
   * and persists the rotated refresh token.
   */
  async getAccessTokenForHotel(hotelId: string): Promise<string> {
    const refreshToken = await this.resolveRefreshToken(hotelId);
    const { accessToken, newRefreshToken, expiresAt } =
      await this.refreshAccessToken(hotelId, refreshToken);

    // Persist the rotated token set before returning: the old refresh token is
    // already invalid, so the DB must hold the new one for the next call.
    if (newRefreshToken) {
      await this.persistRotatedTokens(
        hotelId,
        accessToken,
        newRefreshToken,
        expiresAt,
      );
    }

    return accessToken;
  }

  /**
   * Exchanges a refresh token for an access token.
   *
   * Uses in-flight promise caching so concurrent callers share one token
   * exchange instead of firing duplicate requests that race on the rotating
   * refresh token.
   */
  async refreshAccessToken(
    hotelId: string,
    refreshToken: string,
  ): Promise<{
    accessToken: string;
    newRefreshToken?: string;
    expiresAt?: number;
  }> {
    const cacheKey = `hotel:${hotelId}`;
    const cached = this.tokenCache.get(cacheKey);

    if (cached && Date.now() < cached.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return { accessToken: cached.accessToken };
    }

    const existing = this.refreshPromises.get(cacheKey);
    if (existing) {
      return existing;
    }

    const promise = this.executeTokenExchange(hotelId, refreshToken).finally(
      () => this.refreshPromises.delete(cacheKey),
    );
    this.refreshPromises.set(cacheKey, promise);
    return promise;
  }

  private async executeTokenExchange(
    hotelId: string,
    refreshToken: string,
  ): Promise<{
    accessToken: string;
    newRefreshToken: string;
    expiresAt: number;
  }> {
    const cacheKey = `hotel:${hotelId}`;

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.AUTHORIZE_NET_CLIENT_ID,
      client_secret: config.AUTHORIZE_NET_CLIENT_SECRET,
    });

    try {
      const response = await axios.post<AuthorizeNetTokenResponse>(
        AUTHNET_URLS[config.AUTHORIZE_NET_ENVIRONMENT].token,
        body.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: config.API_TIMEOUT,
        },
      );

      const {
        access_token,
        expires_in,
        refresh_token: newRefresh,
      } = response.data;

      if (!access_token || !newRefresh) {
        throw new Error(
          'Authorize.net refresh response did not contain both access_token and refresh_token',
        );
      }

      const expiresAt = Date.now() + expires_in * 1000;
      this.tokenCache.set(cacheKey, { accessToken: access_token, expiresAt });

      logger.debug(
        `AuthorizeNetTokenService: Token acquired for hotel ${hotelId}`,
      );

      return {
        accessToken: access_token,
        newRefreshToken: newRefresh,
        expiresAt,
      };
    } catch (error: unknown) {
      this.tokenCache.delete(cacheKey);
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        `AuthorizeNetTokenService: Token exchange failed for hotel ${hotelId}: ${message}`,
      );
      throw new AuthorizeNetError(
        `Failed to get Authorize.net token for hotel ${hotelId}: ${message}`,
        502,
      );
    }
  }

  /**
   * Remove cached token for a hotel (e.g., on disconnect/offboarding).
   */
  invalidate(hotelId: string): void {
    this.tokenCache.delete(`hotel:${hotelId}`);
  }

  /**
   * Seeds the in-memory access token cache after OAuth connect (before first refresh).
   */
  seedAccessToken(
    hotelId: string,
    accessToken: string,
    expiresInSeconds: number,
  ): void {
    this.tokenCache.set(`hotel:${hotelId}`, {
      accessToken,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    });
  }

  /**
   * Reads the per-hotel refresh token from external_auth_config.authorizeNet.
   */
  async getStoredRefreshTokenForHotel(hotelId: string): Promise<string | null> {
    try {
      const authnetConfig =
        await this.hotelConfigurationRepository.findAuthorizenetConfigByHotelId(
          hotelId,
        );
      return authnetConfig?.refreshToken ?? null;
    } catch (error: unknown) {
      logger.warn(
        'AuthorizeNetTokenService: Failed to read stored refresh token',
        {
          hotelId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return null;
    }
  }

  private async resolveRefreshToken(hotelId: string): Promise<string> {
    const authnetConfig =
      await this.hotelConfigurationRepository.findAuthorizenetConfigByHotelId(
        hotelId,
      );

    if (authnetConfig?.refreshToken) {
      return authnetConfig.refreshToken;
    }

    throw new AuthorizeNetError(
      `No Authorize.net refresh token found for hotel ${hotelId} — connect via OAuth first`,
      400,
    );
  }

  private async persistRotatedTokens(
    hotelId: string,
    accessToken: string,
    refreshToken: string,
    expiresAt?: number,
  ): Promise<void> {
    const existing =
      await this.hotelConfigurationRepository.findAuthorizenetConfigByHotelId(
        hotelId,
      );

    if (!existing) {
      // The exchange already invalidated the old refresh token; without a row
      // to write the new one to, the hotel is orphaned until it reconnects.
      logger.error(
        `AuthorizeNetTokenService: CRITICAL - rotated tokens for hotel ${hotelId} cannot be persisted (no existing config). ` +
          `The previous refresh token is now invalid; the hotel must reconnect via OAuth.`,
      );
      return;
    }

    const updated =
      await this.hotelConfigurationRepository.updateAuthorizenetConfigByHotelId(
        hotelId,
        {
          ...existing,
          accessToken,
          refreshToken,
          ...(expiresAt != null && {
            tokenExpiresAt: new Date(expiresAt).toISOString(),
          }),
        },
      );

    if (updated === 0) {
      logger.error(
        `AuthorizeNetTokenService: CRITICAL - rotated refresh token for hotel ${hotelId} was not persisted (0 rows updated). ` +
          `The previous refresh token is now invalid; the hotel may need to reconnect via OAuth.`,
      );
      return;
    }

    logger.debug(
      `AuthorizeNetTokenService: Persisted rotated tokens for hotel ${hotelId}`,
    );
  }
}

export const authorizeNetTokenService = new AuthorizeNetTokenService(
  new HotelConfigurationRepository(),
);
export default authorizeNetTokenService;
