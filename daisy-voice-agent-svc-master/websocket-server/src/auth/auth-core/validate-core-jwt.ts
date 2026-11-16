import config from '../../config';
import logger from '../../utils/logger';
import type { JsonObject } from './internal/json-object';
import {
  validateJwtWithCachedJwks,
  type ValidateJwtWithCachedJwksResult,
} from './internal/validate-jwt-with-cached-jwks';

export const CORE_JWKS_URL = config.CORE_JWKS_URL;

export type ValidateCoreJwtResult =
  | { ok: true; email: string; claims: JsonObject }
  | { ok: false; error: string };

/**
 * Validate a Bearer token as a Core-signed JWT and require a non-empty email claim.
 * @example
 * await validateCoreJwt(token) => { ok: true, email: 'a@b.com', claims: { ... } }
 * await validateCoreJwt(tokenWithoutEmail) => { ok: false, error: 'Missing email claim' }
 */
export async function validateCoreJwt(
  token: string,
): Promise<ValidateCoreJwtResult> {
  logger.warn('auth-core validateCoreJwt: start', {
    jwksUrl: CORE_JWKS_URL,
    token,
  });

  const verified: ValidateJwtWithCachedJwksResult =
    await validateJwtWithCachedJwks({
      token,
      jwksUrl: CORE_JWKS_URL,
    });
  if (!verified.ok) {
    logger.warn('auth-core validateCoreJwt: JWKS validation failed', {
      error: verified.error,
      jwksUrl: CORE_JWKS_URL,
      token,
    });
    const result: ValidateCoreJwtResult = { ok: false, error: verified.error };
    return result;
  }

  const emailRaw = verified.claims.email;
  if (typeof emailRaw !== 'string' || emailRaw.trim() === '') {
    logger.warn('auth-core validateCoreJwt: missing email claim', {
      claimKeys: Object.keys(verified.claims),
      claims: verified.claims,
      token,
    });
    const result: ValidateCoreJwtResult = {
      ok: false,
      error: 'Missing email claim',
    };
    return result;
  }

  const email = emailRaw.trim();
  logger.warn('auth-core validateCoreJwt: success', {
    email,
    claimKeys: Object.keys(verified.claims),
    businessEnts: verified.claims.businessEnts,
  });
  const result: ValidateCoreJwtResult = {
    ok: true,
    email,
    claims: verified.claims,
  };
  return result;
}
