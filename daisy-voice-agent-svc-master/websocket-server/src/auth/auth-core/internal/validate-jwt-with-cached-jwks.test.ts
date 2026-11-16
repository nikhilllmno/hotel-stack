import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import type { JsonObject } from './json-object';
import {
  __for_testing,
  validateJwtWithCachedJwks,
  type JwtJwks,
} from './validate-jwt-with-cached-jwks';

const { verifyRs256JwtWithJwks, jwksHttp } = __for_testing;

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

function generateRsaPair(): { privateKey: KeyObject; publicKey: KeyObject } {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
  };
}

function mockFetchJson(body: unknown, status = 200): jest.SpyInstance {
  return jest.spyOn(jwksHttp, 'fetchJwksHttp').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

describe('verifyRs256JwtWithJwks', () => {
  test('verifies a valid RS256 JWT and returns claims', () => {
    const { privateKey, publicKey } = generateRsaPair();
    const jwk = publicKeyToJwk(publicKey, 'test-kid-1');
    const jwks: JwtJwks = { keys: [jwk] };
    const now = Math.floor(Date.now() / 1000);
    const token = signRs256Jwt({
      privateKey,
      header: { alg: 'RS256', typ: 'JWT', kid: 'test-kid-1' },
      claims: { sub: 'u1', email: 'a@b.com', exp: now + 3600 },
    });

    const result = verifyRs256JwtWithJwks({ token, jwks });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.claims.email).toBe('a@b.com');
    expect(result.claims.sub).toBe('u1');
  });

  test('rejects invalid signature', () => {
    const pairA = generateRsaPair();
    const pairB = generateRsaPair();
    const jwks: JwtJwks = { keys: [publicKeyToJwk(pairB.publicKey, 'kid-b')] };
    const now = Math.floor(Date.now() / 1000);
    const token = signRs256Jwt({
      privateKey: pairA.privateKey,
      header: { alg: 'RS256', typ: 'JWT', kid: 'kid-b' },
      claims: { email: 'a@b.com', exp: now + 3600 },
    });

    const result = verifyRs256JwtWithJwks({ token, jwks });
    expect(result).toEqual({ ok: false, error: 'Invalid token signature' });
  });

  test('rejects expired token', () => {
    const { privateKey, publicKey } = generateRsaPair();
    const jwks: JwtJwks = { keys: [publicKeyToJwk(publicKey, 'kid-1')] };
    const now = Math.floor(Date.now() / 1000);
    const token = signRs256Jwt({
      privateKey,
      header: { alg: 'RS256', typ: 'JWT', kid: 'kid-1' },
      claims: { email: 'a@b.com', exp: now - 10 },
    });

    const result = verifyRs256JwtWithJwks({ token, jwks });
    expect(result).toEqual({ ok: false, error: 'Token expired' });
  });

  test('rejects unsupported alg', () => {
    const { privateKey, publicKey } = generateRsaPair();
    const jwks: JwtJwks = { keys: [publicKeyToJwk(publicKey, 'kid-1')] };
    const now = Math.floor(Date.now() / 1000);
    const token = signRs256Jwt({
      privateKey,
      header: { alg: 'HS256', typ: 'JWT', kid: 'kid-1' },
      claims: { email: 'a@b.com', exp: now + 3600 },
    });

    const result = verifyRs256JwtWithJwks({ token, jwks });
    expect(result).toEqual({ ok: false, error: 'Unsupported JWT alg' });
  });
});

describe('validateJwtWithCachedJwks', () => {
  beforeEach(() => {
    __for_testing.clearJwksCache();
    jest.restoreAllMocks();
  });

  test('caches JWKS and only fetches once on repeated success', async () => {
    const { privateKey, publicKey } = generateRsaPair();
    const jwks: JwtJwks = { keys: [publicKeyToJwk(publicKey, 'kid-1')] };
    const now = Math.floor(Date.now() / 1000);
    const token = signRs256Jwt({
      privateKey,
      header: { alg: 'RS256', typ: 'JWT', kid: 'kid-1' },
      claims: { email: 'a@b.com', exp: now + 3600 },
    });
    const fetchMock = mockFetchJson(jwks);

    const first = await validateJwtWithCachedJwks({
      token,
      jwksUrl: 'https://example.test/jwks',
    });
    const second = await validateJwtWithCachedJwks({
      token,
      jwksUrl: 'https://example.test/jwks',
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('coalesces concurrent cold-cache fetches into one request', async () => {
    const { privateKey, publicKey } = generateRsaPair();
    const jwks: JwtJwks = { keys: [publicKeyToJwk(publicKey, 'kid-1')] };
    const now = Math.floor(Date.now() / 1000);
    const token = signRs256Jwt({
      privateKey,
      header: { alg: 'RS256', typ: 'JWT', kid: 'kid-1' },
      claims: { email: 'a@b.com', exp: now + 3600 },
    });

    let resolveFetch!: (response: Response) => void;
    const fetchMock = jest.spyOn(jwksHttp, 'fetchJwksHttp').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const pending = Promise.all([
      validateJwtWithCachedJwks({
        token,
        jwksUrl: 'https://example.test/jwks-coalesce',
      }),
      validateJwtWithCachedJwks({
        token,
        jwksUrl: 'https://example.test/jwks-coalesce',
      }),
      validateJwtWithCachedJwks({
        token,
        jwksUrl: 'https://example.test/jwks-coalesce',
      }),
    ]);

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch({
      ok: true,
      status: 200,
      json: async () => jwks,
    } as Response);

    const results = await pending;
    expect(results.every((r) => r.ok)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('refreshes JWKS and retries when cached key fails and document changed', async () => {
    const wrongPair = generateRsaPair();
    const rightPair = generateRsaPair();
    const wrongJwks: JwtJwks = {
      keys: [publicKeyToJwk(wrongPair.publicKey, 'wrong')],
    };
    const rightJwks: JwtJwks = {
      keys: [publicKeyToJwk(rightPair.publicKey, 'right')],
    };
    const now = Math.floor(Date.now() / 1000);
    const token = signRs256Jwt({
      privateKey: rightPair.privateKey,
      header: { alg: 'RS256', typ: 'JWT', kid: 'right' },
      claims: { email: 'a@b.com', exp: now + 3600 },
    });

    const fetchMock = jest
      .spyOn(jwksHttp, 'fetchJwksHttp')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => wrongJwks,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => rightJwks,
      } as Response);

    const result = await validateJwtWithCachedJwks({
      token,
      jwksUrl: 'https://example.test/jwks-rotate',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.claims.email).toBe('a@b.com');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('does not retry verify when refreshed JWKS is unchanged', async () => {
    const wrongPair = generateRsaPair();
    const rightPair = generateRsaPair();
    const wrongJwks: JwtJwks = {
      keys: [publicKeyToJwk(wrongPair.publicKey, 'wrong')],
    };
    const now = Math.floor(Date.now() / 1000);
    const token = signRs256Jwt({
      privateKey: rightPair.privateKey,
      header: { alg: 'RS256', typ: 'JWT', kid: 'wrong' },
      claims: { email: 'a@b.com', exp: now + 3600 },
    });
    const fetchMock = mockFetchJson(wrongJwks);

    const result = await validateJwtWithCachedJwks({
      token,
      jwksUrl: 'https://example.test/jwks-unchanged',
    });

    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
