import {
  routeUsesAuthCore,
  routeUsesTokenScopedHotelAuth,
} from './route-uses-auth-core';

describe('routeUsesAuthCore', () => {
  const hotelId = '22222222-2222-2222-2222-222222222222';
  const sessionId = '33333333-3333-3333-3333-333333333333';

  const shouldBeTrue: Array<{
    method: string;
    path: string;
    originalUrl?: string;
  }> = [
    { method: 'GET', path: '/hotel' },
    { method: 'POST', path: '/', originalUrl: '/api/hotel?x=1' },
    { method: 'GET', path: `/hotel/${hotelId}` },
    { method: 'PATCH', path: `/hotel/${hotelId}` },
    { method: 'DELETE', path: `/hotel/${hotelId}` },
    { method: 'PUT', path: `/hotel/${hotelId}` },
    { method: 'GET', path: `/hotel/${hotelId}/configuration` },
    { method: 'POST', path: `/hotel/${hotelId}/configuration` },
    { method: 'DELETE', path: `/hotel/${hotelId}/configuration` },
    {
      method: 'PUT',
      path: '/',
      originalUrl: `/api/hotel/${hotelId}/configuration?x=1`,
    },
    { method: 'POST', path: '/hotel/recordings/backfill' },
    { method: 'POST', path: '/hotel/recordings/backfill/conversation' },
    {
      method: 'POST',
      path: '/',
      originalUrl: '/api/hotel/recordings/backfill?x=1',
    },
    // Indistinguishable from `/hotel/:id`, so already onboarded by `/hotel/*`.
    { method: 'GET', path: '/hotel/recordings' },
    { method: 'GET', path: '/sessions' },
    { method: 'GET', path: '/sessions/summary' },
    { method: 'GET', path: '/sessions/intents' },
    { method: 'GET', path: '/sessions/sms-sessions' },
    {
      method: 'GET',
      path: `/sessions/${sessionId}/conversations/transcripts`,
    },
    {
      method: 'GET',
      path: '/',
      originalUrl: '/api/sessions/summary?start_date=2024-01-01',
    },
    { method: 'GET', path: '/escalations' },
    { method: 'PATCH', path: `/escalations/${hotelId}` },
    { method: 'GET', path: '/reservations' },
    { method: 'GET', path: '/reservations/summary' },
    { method: 'GET', path: `/reservations/${hotelId}/payments` },
    { method: 'GET', path: `/payments/${hotelId}` },
  ];

  const shouldBeFalse: Array<{
    method: string;
    path: string;
    originalUrl?: string;
  }> = [
    // Backfill patterns are literal, not prefixes.
    { method: 'POST', path: '/hotel/recordings/backfill/other' },
    { method: 'GET', path: '/', originalUrl: `/user/${hotelId}` },
    { method: 'POST', path: '/signup', originalUrl: '/auth/signup' },
  ];

  test.each(shouldBeTrue)('true for %# %j', (input) => {
    expect(routeUsesAuthCore(input)).toBe(true);
  });

  test.each(shouldBeFalse)('false for %# %j', (input) => {
    expect(routeUsesAuthCore(input)).toBe(false);
  });
});

describe('routeUsesTokenScopedHotelAuth', () => {
  const hotelId = '22222222-2222-2222-2222-222222222222';

  test('true for token-scoped API routes', () => {
    expect(routeUsesTokenScopedHotelAuth({ path: '/sessions/summary' })).toBe(
      true,
    );
    expect(routeUsesTokenScopedHotelAuth({ path: '/escalations' })).toBe(true);
    expect(
      routeUsesTokenScopedHotelAuth({ path: `/reservations/${hotelId}` }),
    ).toBe(true);
  });

  test('false for URL-scoped hotel routes', () => {
    expect(
      routeUsesTokenScopedHotelAuth({
        path: `/hotel/${hotelId}/configuration`,
      }),
    ).toBe(false);
    expect(
      routeUsesTokenScopedHotelAuth({ path: '/hotel/recordings/backfill' }),
    ).toBe(false);
  });
});
