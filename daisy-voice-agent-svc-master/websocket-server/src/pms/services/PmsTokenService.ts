import { TokenError } from '../../errors/TokenError';
import { HotelConfigurationRepository } from '../../repositories/HotelConfigurationRepository';
import { decrypt } from '../../utils/encryption';
import logger from '../../utils/logger';

/** Outcome of refreshing a single hotel's token, for reporting partial failures. */
export interface HotelRefreshResult {
  hotelId: string;
  success: boolean;
  error?: string;
}

/**
 * Abstract base class for PMS OAuth token management.
 *
 * Subclasses implement {@link refreshToken} with their PMS-specific OAuth call
 * and per-hotel credential iteration, then store the result via
 * {@link hotelConfigurationRepository}.
 */
export abstract class PmsTokenService {
  constructor(
    protected readonly pmsProvider: string,
    protected readonly hotelConfigurationRepository: HotelConfigurationRepository,
  ) {}

  abstract refreshToken(): Promise<HotelRefreshResult[]>;

  /**
   * Iterates `hotelEntries`, retrying each hotel up to `maxAttempts` times via
   * `refreshOne`. A single hotel's failure never aborts the rest — every
   * hotel gets its own result so callers (and monitoring) can see partial
   * failures instead of a single boolean "it worked" for the whole batch.
   */
  protected async refreshHotelsWithRetry<TCredentials>(
    hotelEntries: [string, TCredentials][],
    refreshOne: (hotelId: string, credentials: TCredentials) => Promise<void>,
    maxAttempts = 3,
  ): Promise<HotelRefreshResult[]> {
    const results: HotelRefreshResult[] = [];

    for (const [hotelId, credentials] of hotelEntries) {
      let lastError: unknown;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await refreshOne(hotelId, credentials);
          logger.info(
            `${this.constructor.name}::refreshToken - Token stored for hotel`,
            { hotelId, attempt },
          );
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          logger.warn(
            `${this.constructor.name}::refreshToken - Attempt failed for hotel`,
            {
              hotelId,
              attempt,
              remaining: maxAttempts - attempt,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }

      if (lastError) {
        const errorMessage =
          lastError instanceof Error ? lastError.message : String(lastError);
        logger.error(
          `${this.constructor.name}::refreshToken - All attempts failed for hotel`,
          { hotelId, error: errorMessage },
        );
        results.push({ hotelId, success: false, error: errorMessage });
      } else {
        results.push({ hotelId, success: true });
      }
    }

    return results;
  }

  /**
   * Returns the active bearer token for a specific hotel.
   *
   * @param hotelId - Internal hotel UUID.
   * @throws {@link TokenError}
   */
  async getActiveToken(hotelId: string): Promise<string> {
    try {
      const authConfig =
        await this.hotelConfigurationRepository.findExternalAuthConfigByHotelId(
          hotelId,
        );

      if (authConfig?.apiToken) {
        return decrypt(authConfig.apiToken);
      }

      throw new TokenError(
        `No token available for PMS provider "${this.pmsProvider}" — set external_auth_config on hotel_configurations for this hotel`,
      );
    } catch (error) {
      if (error instanceof TokenError) throw error;
      throw new TokenError(
        `Failed to retrieve token for PMS provider "${this.pmsProvider}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
