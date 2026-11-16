import { createPrivateKey, createPublicKey, KeyObject } from 'crypto';
import jwt from 'jsonwebtoken';
import config from '../config';
import logger from './logger';

export type LoginJwtPayload = {
  id: string;
  username: string;
  role: string;
  hotel_id?: string;
};

let cachedPrivateKey: KeyObject | null = null;
let cachedPublicKey: KeyObject | null = null;
/** Set when PEM parsing fails so we log once and avoid repeated throws during requests */
let privateKeyLoadFailed = false;

/**
 * Validates RSA PEM when set and populates the key cache. Call from startup validation.
 * Throws if DAISY_JWT_PRIVATE_KEY_PEM is non-empty but not parseable as an RSA private key.
 * (Config accepts raw PEM or base64-encoded PEM.)
 */
export function validateDaisyJwtPemAndWarmCache(): void {
  const pem = config.DAISY_JWT_PRIVATE_KEY_PEM;
  if (!pem?.trim()) return;
  try {
    cachedPrivateKey = createPrivateKey(pem);
    cachedPublicKey = createPublicKey(cachedPrivateKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `DAISY_JWT_PRIVATE_KEY_PEM is invalid or malformed: ${msg}`,
    );
  }
}

export function getPrivateKey(): KeyObject | null {
  const pem = config.DAISY_JWT_PRIVATE_KEY_PEM;
  if (!pem) return null;
  if (privateKeyLoadFailed) return null;
  if (cachedPrivateKey) return cachedPrivateKey;
  try {
    cachedPrivateKey = createPrivateKey(pem);
  } catch (err) {
    privateKeyLoadFailed = true;
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      `Failed to parse DAISY_JWT_PRIVATE_KEY_PEM: ${msg}. RS256 signing and verification are disabled until the key is fixed and the process restarted.`,
    );
    return null;
  }
  return cachedPrivateKey;
}

export function getPublicKey(): KeyObject | null {
  if (!cachedPublicKey) {
    const privateKey = getPrivateKey();
    if (!privateKey) return null;
    cachedPublicKey = createPublicKey(privateKey);
  }
  return cachedPublicKey;
}

export function signLoginJwt(payload: LoginJwtPayload): string {
  const rsaPem = config.DAISY_JWT_PRIVATE_KEY_PEM;
  if (rsaPem) {
    const privateKey = getPrivateKey();
    if (!privateKey) {
      throw new Error(
        'DAISY_JWT_PRIVATE_KEY_PEM is set but the key could not be loaded. Ensure it is a valid RSA private key PEM.',
      );
    }
    return jwt.sign(payload, privateKey, {
      algorithm: 'RS256',
      expiresIn: '30d',
      issuer: config.JWT_ISS,
      audience: config.JWT_AUDIENCE,
      keyid: config.DAISY_JWT_KID,
    });
  }
  if (!config.JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined');
  }
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: '30d',
  });
}

/**
 * JWKS document for RS256 verification. Uses Node `KeyObject.export({ format: 'jwk' })`
 * so we do not depend on `jose` (ESM-only — breaks ts-node / CommonJS).
 */
export function buildJwksJson(): { keys: Record<string, unknown>[] } {
  const publicKey = getPublicKey();
  if (!publicKey) {
    return { keys: [] };
  }
  const exported = publicKey.export({ format: 'jwk' });
  if (
    exported === undefined ||
    typeof exported === 'string' ||
    typeof exported !== 'object'
  ) {
    throw new Error('Failed to export RSA public key as JWK');
  }
  const jwk = exported as Record<string, unknown>;
  return {
    keys: [
      {
        ...jwk,
        kid: config.DAISY_JWT_KID,
        alg: 'RS256',
        use: 'sig',
      },
    ],
  };
}
