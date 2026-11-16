import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import type { JsonObject } from './internal/json-object';
import {
  __for_testing,
  type JwtJwks,
} from './internal/validate-jwt-with-cached-jwks';
import { CORE_JWKS_URL, validateCoreJwt } from './validate-core-jwt';

const { jwksHttp } = __for_testing;

function bufferToBase64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signRs256Jwt(args: {
  privateKey: KeyObject;
  header: JsonObject;
  claims: JsonObject;
}): string {
  const headerPart = bufferToBase64Url(
    Buffer.from(JSON.stringify(args.header), 'utf8'),
  );
  const payloadPart = bufferToBase64Url(
    Buffer.from(JSON.stringify(args.claims), 'utf8'),
  );
  const signingInput = `${headerPart}.${payloadPart}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(args.privateKey);
  const signaturePart = bufferToBase64Url(signature);
  return `${signingInput}.${signaturePart}`;
}

function publicKeyToJwk(publicKey: KeyObject, kid: string): JsonObject {
  const exported = publicKey.export({ format: 'jwk' });
  const result: JsonObject = {
    ...(exported as JsonObject),
    kid,
    alg: 'RS256',
    use: 'sig',
  };
  return result;
}

function mockFetchJson(body: unknown, status = 200): jest.SpyInstance {
  return jest.spyOn(jwksHttp, 'fetchJwksHttp').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

describe('validateCoreJwt', () => {
  beforeEach(() => {
    __for_testing.clearJwksCache();
    jest.restoreAllMocks();
  });

  test('returns email when JWT verifies and email claim is present', async () => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwks: JwtJwks = { keys: [publicKeyToJwk(pair.publicKey, 'kid-1')] };
    const now = Math.floor(Date.now() / 1000);
    const token = signRs256Jwt({
      privateKey: pair.privateKey,
      header: { alg: 'RS256', typ: 'JWT', kid: 'kid-1' },
      claims: { sub: 'u1', email: 'user@dextr.ai', exp: now + 3600 },
    });
    const fetchMock = mockFetchJson(jwks);

    const result = await validateCoreJwt(token);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.email).toBe('user@dextr.ai');
    expect(fetchMock).toHaveBeenCalledWith(CORE_JWKS_URL);
  });

  test('fails when email claim is missing so caller can fall back', async () => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwks: JwtJwks = { keys: [publicKeyToJwk(pair.publicKey, 'kid-1')] };
    const now = Math.floor(Date.now() / 1000);
    const token = signRs256Jwt({
      privateKey: pair.privateKey,
      header: { alg: 'RS256', typ: 'JWT', kid: 'kid-1' },
      claims: { sub: 'u1', exp: now + 3600 },
    });
    mockFetchJson(jwks);

    const result = await validateCoreJwt(token);
    expect(result).toEqual({ ok: false, error: 'Missing email claim' });
  });

  test('fails when email claim is empty', async () => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwks: JwtJwks = { keys: [publicKeyToJwk(pair.publicKey, 'kid-1')] };
    const now = Math.floor(Date.now() / 1000);
    const token = signRs256Jwt({
      privateKey: pair.privateKey,
      header: { alg: 'RS256', typ: 'JWT', kid: 'kid-1' },
      claims: { sub: 'u1', email: '   ', exp: now + 3600 },
    });
    mockFetchJson(jwks);

    const result = await validateCoreJwt(token);
    expect(result).toEqual({ ok: false, error: 'Missing email claim' });
  });
});
