import { createPublicKey, createVerify, type KeyObject } from 'node:crypto';
import logger from '../../../utils/logger';
import { createKeyedSingleFlightRunner } from '../../../utils/single-flight';
import { isJsonObject, type JsonObject } from './json-object';

export type JwtJwks = {
  keys: JsonObject[];
};

export type ValidateJwtWithCachedJwksResult =
  | { ok: true; claims: JsonObject }
  | { ok: false; error: string };

const jwksCacheByUrl = new Map<string, JwtJwks>();
const jwksFetchFlight = createKeyedSingleFlightRunner();

/**
 * Validate JWT using a process-local JWKS cache keyed by jwksUrl.
 * On verify failure: refetch JWKS; if document changed, retry once; else return failure.
 * @example
 * await validateJwtWithCachedJwks({ token, jwksUrl: 'https://core.dextr.ai/api/auth/jwks' })
 *   => { ok: true, claims: { email: 'a@b.com', ... } }
 */
export async function validateJwtWithCachedJwks(args: {
  token: string;
  jwksUrl: string;
}): Promise<ValidateJwtWithCachedJwksResult> {
  logger.warn('auth-core JWKS: validateJwtWithCachedJwks start', {
    jwksUrl: args.jwksUrl,
    token: args.token,
    cacheHit: jwksCacheByUrl.has(args.jwksUrl),
  });

  let cached = jwksCacheByUrl.get(args.jwksUrl);
  if (cached == null) {
    try {
      cached = await fetchJwksFromCore(args.jwksUrl);
      jwksCacheByUrl.set(args.jwksUrl, cached);
      logger.warn('auth-core JWKS: fetched and cached JWKS', {
        jwksUrl: args.jwksUrl,
        keyCount: cached.keys.length,
        keys: cached.keys,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('auth-core JWKS: initial fetch failed', {
        jwksUrl: args.jwksUrl,
        error: message,
        token: args.token,
      });
      const result: ValidateJwtWithCachedJwksResult = {
        ok: false,
        error: `Failed to fetch JWKS: ${message}`,
      };
      return result;
    }
  } else {
    logger.warn('auth-core JWKS: using cached JWKS', {
      jwksUrl: args.jwksUrl,
      keyCount: cached.keys.length,
      keys: cached.keys,
    });
  }

  const firstAttempt = verifyRs256JwtWithJwks({
    token: args.token,
    jwks: cached,
  });
  if (firstAttempt.ok) {
    logger.warn('auth-core JWKS: first verify attempt succeeded');
    return firstAttempt;
  }

  logger.warn('auth-core JWKS: first verify attempt failed, refreshing JWKS', {
    error: firstAttempt.error,
    jwksUrl: args.jwksUrl,
    token: args.token,
  });

  let refreshed: JwtJwks;
  try {
    refreshed = await fetchJwksFromCore(args.jwksUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('auth-core JWKS: refresh fetch failed', {
      jwksUrl: args.jwksUrl,
      error: message,
      firstAttemptError: firstAttempt.error,
      token: args.token,
    });
    const result: ValidateJwtWithCachedJwksResult = {
      ok: false,
      error: `Failed to refresh JWKS: ${message}`,
    };
    return result;
  }

  if (jwksDocumentsEqual(cached, refreshed)) {
    logger.warn(
      'auth-core JWKS: refreshed JWKS unchanged; returning first failure',
      {
        jwksUrl: args.jwksUrl,
        error: firstAttempt.error,
        keys: refreshed.keys,
        token: args.token,
      },
    );
    return firstAttempt;
  }

  logger.warn('auth-core JWKS: JWKS changed after refresh; retrying verify', {
    jwksUrl: args.jwksUrl,
    previousKeys: cached.keys,
    refreshedKeys: refreshed.keys,
    token: args.token,
  });

  jwksCacheByUrl.set(args.jwksUrl, refreshed);
  const secondAttempt = verifyRs256JwtWithJwks({
    token: args.token,
    jwks: refreshed,
  });
  if (!secondAttempt.ok) {
    logger.warn('auth-core JWKS: second verify attempt failed', {
      error: secondAttempt.error,
      jwksUrl: args.jwksUrl,
      keys: refreshed.keys,
      token: args.token,
    });
  } else {
    logger.warn('auth-core JWKS: second verify attempt succeeded');
  }
  return secondAttempt;
}

/**
 * Verify RS256 JWT against a JWKS document (signature + exp).
 * @example
 * verifyRs256JwtWithJwks({ token, jwks: { keys: [{ kty: 'RSA', n: '...', e: 'AQAB' }] } })
 *   => { ok: true, claims: { sub: '...', email: 'a@b.com', ... } }
 */
function verifyRs256JwtWithJwks(args: {
  token: string;
  jwks: JwtJwks;
}): ValidateJwtWithCachedJwksResult {
  const token = args.token.trim();
  // Never log the full bearer token — only a short prefix for correlation.
  const tokenPreview =
    token.substring(0, 20) + (token.length > 20 ? '...[redacted]' : '');
  if (token === '') {
    logger.warn('auth-core JWKS verify: token is empty');
    const result: ValidateJwtWithCachedJwksResult = {
      ok: false,
      error: 'Token is required',
    };
    return result;
  }
  if (!Array.isArray(args.jwks.keys) || args.jwks.keys.length === 0) {
    logger.warn('auth-core JWKS verify: JWKS has no keys', {
      token_prefix: tokenPreview,
    });
    const result: ValidateJwtWithCachedJwksResult = {
      ok: false,
      error: 'JWKS has no keys',
    };
    return result;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    logger.warn('auth-core JWKS verify: token is malformed (part count)', {
      partCount: parts.length,
      token_prefix: tokenPreview,
      availableKeys: args.jwks.keys,
    });
    const result: ValidateJwtWithCachedJwksResult = {
      ok: false,
      error: 'Token is malformed',
    };
    return result;
  }
  const headerPart = parts[0];
  const payloadPart = parts[1];
  const signaturePart = parts[2];
  if (headerPart == null || payloadPart == null || signaturePart == null) {
    logger.warn('auth-core JWKS verify: token is malformed (missing part)', {
      token_prefix: tokenPreview,
    });
    const result: ValidateJwtWithCachedJwksResult = {
      ok: false,
      error: 'Token is malformed',
    };
    return result;
  }

  const header = decodeJwtJsonPart(headerPart);
  if (header == null) {
    logger.warn('auth-core JWKS verify: invalid token header', {
      token_prefix: tokenPreview,
    });
    const result: ValidateJwtWithCachedJwksResult = {
      ok: false,
      error: 'Invalid token header',
    };
    return result;
  }
  if (header.alg !== 'RS256') {
    logger.warn('auth-core JWKS verify: unsupported alg', {
      alg: header.alg,
      header,
      token_prefix: tokenPreview,
      availableKeys: args.jwks.keys,
    });
    const result: ValidateJwtWithCachedJwksResult = {
      ok: false,
      error: 'Unsupported JWT alg',
    };
    return result;
  }

  const kid = typeof header.kid === 'string' ? header.kid : undefined;
  const jwk = findJwkForHeader({ jwks: args.jwks, kid });
  logger.warn('auth-core JWKS verify: selected key for decode/verify', {
    tokenHeader: header,
    tokenKid: kid,
    selectedJwk: jwk,
    availableKeyKids: args.jwks.keys.map((key) => key.kid),
    availableKeys: args.jwks.keys,
    token_prefix: tokenPreview,
  });
  if (jwk == null) {
    logger.warn('auth-core JWKS verify: no matching JWK', {
      tokenKid: kid,
      availableKeys: args.jwks.keys,
      token_prefix: tokenPreview,
    });
    const result: ValidateJwtWithCachedJwksResult = {
      ok: false,
      error: 'No matching JWK',
    };
    return result;
  }

  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey({ key: jwk, format: 'jwk' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      'auth-core JWKS verify: failed to create public key from JWK',
      {
        error: message,
        jwk,
        token_prefix: tokenPreview,
      },
    );
    const result: ValidateJwtWithCachedJwksResult = {
      ok: false,
      error: `Invalid JWK: ${message}`,
    };
    return result;
  }

  let signature: Buffer;
  try {
    signature = base64UrlToBuffer(signaturePart);
  } catch {
    logger.warn('auth-core JWKS verify: invalid signature encoding', {
      signaturePart,
      token_prefix: tokenPreview,
      jwk,
    });
    const result: ValidateJwtWithCachedJwksResult = {
      ok: false,
      error: 'Invalid token signature encoding',
    };
    return result;
  }

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerPart}.${payloadPart}`);
  verifier.end();
  const valid = verifier.verify(publicKey, signature);
  if (!valid) {
    logger.warn('auth-core JWKS verify: signature invalid', {
      tokenHeader: header,
      jwk,
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
      token_prefix: tokenPreview,
    });
    const result: ValidateJwtWithCachedJwksResult = {
      ok: false,
      error: 'Invalid token signature',
    };
    return result;
  }

  const claims = decodeJwtJsonPart(payloadPart);
  if (claims == null) {
    logger.warn('auth-core JWKS verify: invalid token payload', {
      token_prefix: tokenPreview,
      jwk,
    });
    const result: ValidateJwtWithCachedJwksResult = {
      ok: false,
      error: 'Invalid token payload',
    };
    return result;
  }

  const exp = claims.exp;
  if (typeof exp === 'number') {
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (exp < nowSeconds) {
      logger.warn('auth-core JWKS verify: token expired', {
        exp,
        nowSeconds,
        claims,
        token_prefix: tokenPreview,
        jwk,
      });
      const result: ValidateJwtWithCachedJwksResult = {
        ok: false,
        error: 'Token expired',
      };
      return result;
    }
  }

  logger.warn('auth-core JWKS verify: success', {
    tokenHeader: header,
    claimKeys: Object.keys(claims),
    email: claims.email,
    exp: claims.exp,
    iss: claims.iss,
    aud: claims.aud,
    jwk,
  });
  const result: ValidateJwtWithCachedJwksResult = { ok: true, claims };
  return result;
}

async function fetchJwksFromCore(jwksUrl: string): Promise<JwtJwks> {
  return jwksFetchFlight.run(jwksUrl, () => doFetchJwksFromCore(jwksUrl));
}

/**
 * Thin HTTP GET for JWKS. Spy via `__for_testing.jwksHttp` instead of global `fetch`.
 */
async function fetchJwksHttp(jwksUrl: string): Promise<Response> {
  return fetch(jwksUrl);
}

/** Call-site holder so Jest can spy without mocking global `fetch` (CJS-safe). */
const jwksHttp = {
  fetchJwksHttp,
};

async function doFetchJwksFromCore(jwksUrl: string): Promise<JwtJwks> {
  logger.warn('auth-core JWKS: HTTP fetch starting', { jwksUrl });
  const response = await jwksHttp.fetchJwksHttp(jwksUrl);
  if (!response.ok) {
    logger.error('auth-core JWKS: HTTP fetch non-OK', {
      jwksUrl,
      status: response.status,
    });
    throw new Error(`HTTP ${response.status}`);
  }
  const parsed: unknown = await response.json();
  if (!isJsonObject(parsed) || !Array.isArray(parsed.keys)) {
    logger.error('auth-core JWKS: unexpected response shape', {
      jwksUrl,
      parsed,
    });
    throw new Error('JWKS response is not { keys: [...] }');
  }
  const keys: JsonObject[] = [];
  for (const key of parsed.keys) {
    if (!isJsonObject(key)) {
      throw new Error('JWKS key entry is not an object');
    }
    keys.push(key);
  }
  logger.warn('auth-core JWKS: HTTP fetch success', {
    jwksUrl,
    keyCount: keys.length,
    keys,
  });
  const jwks: JwtJwks = { keys };
  return jwks;
}

function jwksDocumentsEqual(a: JwtJwks, b: JwtJwks): boolean {
  return JSON.stringify(a.keys) === JSON.stringify(b.keys);
}

function findJwkForHeader(args: {
  jwks: JwtJwks;
  kid: string | undefined;
}): JsonObject | null {
  if (args.jwks.keys.length === 0) {
    return null;
  }
  if (args.kid != null && args.kid !== '') {
    for (const key of args.jwks.keys) {
      if (key.kid === args.kid) {
        return key;
      }
    }
  }
  return args.jwks.keys[0] ?? null;
}

function decodeJwtJsonPart(part: string): JsonObject | null {
  try {
    const json = base64UrlToBuffer(part).toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (!isJsonObject(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function base64UrlToBuffer(value: string): Buffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  const withPad = padded + '='.repeat(padLength);
  return Buffer.from(withPad, 'base64');
}

export const __for_testing = {
  clearJwksCache(): void {
    jwksCacheByUrl.clear();
  },
  verifyRs256JwtWithJwks,
  jwksHttp,
};
