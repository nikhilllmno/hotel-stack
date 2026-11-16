import {
  HotelRefreshResult,
  PmsTokenService,
} from '../../pms/services/PmsTokenService';
import { HotelConfigurationRepository } from '../../repositories/HotelConfigurationRepository';
import { mewsClient } from '../client/MewsClient';
import { MewsCredentials } from '../types';

// Portfolio Access Token -> (enterprise id -> chain id). Chain ids are needed
// only by customer operations and never change for a given portfolio, so they
// are resolved once per access token via enterprises/getAll and cached.
// Caches the in-flight promise (not the resolved map) so concurrent callers
// share one request instead of firing duplicates; failed lookups are evicted
// so a later call can retry.
const chainCache = new Map<string, Promise<Map<string, string>>>();

// Access token -> whether its enterprise is a Portfolio enterprise.
// EnterpriseIds/portfolio-only operations must never be used for
// single-property (non-portfolio) tokens, even though the hotel's
// business_id is otherwise the correct Mews enterprise id for that property.
// Caches the in-flight promise for the same reason as chainCache above.
const isPortfolioCache = new Map<string, Promise<boolean>>();

export class MewsTokenService extends PmsTokenService {
  constructor(hotelConfigurationRepository: HotelConfigurationRepository) {
    super('mews', hotelConfigurationRepository);
  }

  async refreshToken(): Promise<HotelRefreshResult[]> {
    throw new Error(
      'MewsTokenService: Mews access tokens are static per-property credentials — set via api_token in hotel_configurations directly',
    );
  }

  /**
   * Resolves the hotel's business_id to a usable Mews EnterpriseId, or
   * undefined if the access token's enterprise is not a Portfolio enterprise
   * (in which case EnterpriseIds must be omitted entirely — Mews scopes the
   * request to the token's single property automatically). Calling
   * configuration/get without EnterpriseId returns the enterprise associated
   * with the access token itself, so this only checks IsPortfolio; it never
   * overrides business_id. Result is cached per access token.
   */
  async resolveEnterpriseId(
    baseCredentials: Omit<MewsCredentials, 'enterpriseId'>,
    hotelBusinessId: string | undefined,
  ): Promise<string | undefined> {
    if (!hotelBusinessId) return undefined;

    let promise = isPortfolioCache.get(baseCredentials.accessToken);
    if (!promise) {
      promise = mewsClient
        .getConfiguration(baseCredentials)
        .then((configuration) => configuration.Enterprise.IsPortfolio)
        .catch((err) => {
          isPortfolioCache.delete(baseCredentials.accessToken);
          throw err;
        });
      isPortfolioCache.set(baseCredentials.accessToken, promise);
    }

    const isPortfolio = await promise;
    return isPortfolio ? hotelBusinessId : undefined;
  }

  /**
   * Resolves the Mews chain id for the enterprise scoped by `credentials`.
   * Returns undefined for single-property tokens (no enterpriseId) — customer
   * operations then omit ChainId, as before. Result is cached per access token.
   */
  async resolveChainId(
    credentials: MewsCredentials,
  ): Promise<string | undefined> {
    if (!credentials.enterpriseId) return undefined;

    let promise = chainCache.get(credentials.accessToken);
    if (!promise) {
      promise = mewsClient
        .getEnterprises(credentials)
        .then(
          (enterprises) => new Map(enterprises.map((e) => [e.Id, e.ChainId])),
        )
        .catch((err) => {
          chainCache.delete(credentials.accessToken);
          throw err;
        });
      chainCache.set(credentials.accessToken, promise);
    }
    const map = await promise;
    return map.get(credentials.enterpriseId);
  }
}

export const mewsTokenService = new MewsTokenService(
  new HotelConfigurationRepository(),
);
