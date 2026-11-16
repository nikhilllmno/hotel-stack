import { Response } from 'express';
import jwt from 'jsonwebtoken';
import { validateCoreJwt } from '../../auth/auth-core/validate-core-jwt';
import config from '../../config';
import { UserRole } from '../../models/User';
import { userService } from '../../services/user/userService';
import { AuthenticatedRequest } from '../../types/customRequest';
import { KpiStat } from '../../utils/kpiLogger';
import { authMiddleware } from '../authMiddleware';

jest.mock('../../auth/auth-core/validate-core-jwt', () => ({
  validateCoreJwt: jest.fn(),
}));

jest.mock('../../services/user/userService', () => ({
  userService: {
    getUserById: jest.fn(),
  },
}));

jest.mock('../../utils/kpiLogger', () => {
  const actual = jest.requireActual('../../utils/kpiLogger');
  return { ...actual, logKpi: jest.fn() };
});

const { logKpi } = jest.requireMock('../../utils/kpiLogger');

const mockValidateCoreJwt = validateCoreJwt as jest.MockedFunction<
  typeof validateCoreJwt
>;
const mockGetUserById = userService.getUserById as jest.MockedFunction<
  typeof userService.getUserById
>;

const hotelId = '11111111-1111-1111-1111-111111111111';
const jwtSecret = 'auth-middleware-test-jwt-secret';

async function invokeAuthMiddleware(args: {
  path: string;
  originalUrl: string;
  token: string;
}) {
  const req = {
    method: 'GET',
    path: args.path,
    originalUrl: args.originalUrl,
    headers: { authorization: `Bearer ${args.token}` },
  } as unknown as AuthenticatedRequest;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  const next = jest.fn();

  await authMiddleware(req, res, next);

  return { req, status, json, next };
}

function signDaisyJwt(payload: {
  id: string;
  username: string;
  role: UserRole;
  hotel_id?: string;
}): string {
  return jwt.sign(payload, jwtSecret, { algorithm: 'HS256' });
}

describe('authMiddleware Core JWT integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(config, { JWT_SECRET: jwtSecret });
  });

  test('sets req.user.hotel_id from businessEnts on token-scoped /sessions routes', async () => {
    mockValidateCoreJwt.mockResolvedValue({
      ok: true,
      email: 'staff@hotel.com',
      claims: {
        email: 'staff@hotel.com',
        businessEnts: [{ serviceRefs: { daisyId: hotelId } }],
      },
    });

    const { req, next, status } = await invokeAuthMiddleware({
      path: '/sessions/summary',
      originalUrl: '/api/sessions/summary?start_date=2025-01-01',
      token: 'core-token',
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
    expect(req.user).toEqual({
      id: 'staff@hotel.com',
      username: 'staff@hotel.com',
      role: UserRole.ADMIN,
      hotel_id: hotelId,
    });
    expect(mockGetUserById).not.toHaveBeenCalled();
    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({
        stat: KpiStat.AuthCoreAccepted,
        value: 1,
        contextName: '/sessions/summary',
        clientId: hotelId,
      }),
    );
  });

  test('sets optional hotel_id for admin on token-scoped routes when businessEnts resolves', async () => {
    mockValidateCoreJwt.mockResolvedValue({
      ok: true,
      email: 'prospector_dev',
      claims: {
        email: 'prospector_dev',
        permissions: ['admin'],
        businessEnts: [{ crossData: { daisy_ref_id: hotelId } }],
      },
    });

    const { req, next } = await invokeAuthMiddleware({
      path: '/sessions',
      originalUrl: '/api/sessions?page=1',
      token: 'core-admin-token',
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({
      id: 'prospector_dev',
      username: 'prospector_dev',
      role: UserRole.SUPERADMIN,
      hotel_id: hotelId,
    });
    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({
        stat: KpiStat.AuthCoreAccepted,
        clientId: hotelId,
      }),
    );
  });

  test('admin on token-scoped route omits hotel_id when businessEnts has no Daisy hotel fields', async () => {
    mockValidateCoreJwt.mockResolvedValue({
      ok: true,
      email: 'admin@core.dev',
      claims: {
        email: 'admin@core.dev',
        permissions: ['admin'],
        businessEnts: [{ id: 'core-entity-id', slug: 'tenant' }],
      },
    });

    const { req, next } = await invokeAuthMiddleware({
      path: '/escalations',
      originalUrl: '/api/escalations?page=1',
      token: 'core-admin-no-hotel',
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({
      id: 'admin@core.dev',
      username: 'admin@core.dev',
      role: UserRole.SUPERADMIN,
    });
    expect(req.user?.hotel_id).toBeUndefined();
    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({
        stat: KpiStat.AuthCoreAccepted,
      }),
    );
  });

  test('falls back to Daisy JWT when Core JWT has no admin permission or resolvable hotel', async () => {
    const daisyToken = signDaisyJwt({
      id: 'daisy-user-1',
      username: 'hotel-admin',
      role: UserRole.ADMIN,
      hotel_id: hotelId,
    });

    mockValidateCoreJwt.mockResolvedValue({
      ok: true,
      email: 'hotel-admin',
      claims: {
        email: 'hotel-admin',
        businessEnts: [{ id: 'core-entity-id' }],
      },
    });
    mockGetUserById.mockResolvedValue({
      id: 'daisy-user-1',
      username: 'hotel-admin',
      role: UserRole.ADMIN,
      hotel_id: hotelId,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const { req, next, status } = await invokeAuthMiddleware({
      path: '/sessions/summary',
      originalUrl: '/api/sessions/summary',
      token: daisyToken,
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
    expect(mockGetUserById).toHaveBeenCalledWith('daisy-user-1');
    expect(req.user).toEqual(
      expect.objectContaining({
        id: 'daisy-user-1',
        username: 'hotel-admin',
        role: UserRole.ADMIN,
        hotel_id: hotelId,
      }),
    );
    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({
        stat: KpiStat.AuthNativeAccepted,
        value: 1,
        contextName: '/sessions/summary',
        clientId: hotelId,
      }),
    );
  });

  test('falls back to Daisy JWT when Core JWT validation fails', async () => {
    const daisyToken = signDaisyJwt({
      id: 'daisy-user-2',
      username: 'hotel-admin-2',
      role: UserRole.ADMIN,
      hotel_id: hotelId,
    });

    mockValidateCoreJwt.mockResolvedValue({
      ok: false,
      error: 'Invalid token signature',
    });
    mockGetUserById.mockResolvedValue({
      id: 'daisy-user-2',
      username: 'hotel-admin-2',
      role: UserRole.ADMIN,
      hotel_id: hotelId,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const { req, next } = await invokeAuthMiddleware({
      path: '/reservations',
      originalUrl: '/api/reservations?page=1',
      token: daisyToken,
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user?.id).toBe('daisy-user-2');
    expect(req.user?.hotel_id).toBe(hotelId);
    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({
        stat: KpiStat.AuthNativeAccepted,
        clientId: hotelId,
      }),
    );
  });
});
