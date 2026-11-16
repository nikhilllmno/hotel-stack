import type { Request, Response } from 'express';
import { TokenError } from '../../../errors/TokenError';
import type { RemoteLockClient } from '../../../remotelock/client/RemoteLockClient';
import {
  RemoteLockAPIError,
  RemoteLockConfigurationError,
} from '../../../remotelock/errors';
import type { AccessGuest } from '../../../remotelock/types';
import { InternalRemoteLockController } from '../internalRemoteLockController';

jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../../utils/kpiLogger', () => {
  const actual = jest.requireActual('../../../utils/kpiLogger');
  return { ...actual, logKpi: jest.fn() };
});

const { logKpi } = jest.requireMock('../../../utils/kpiLogger');

const HOTEL_ID = 'ffb4d2a0-1111-4b2a-9c3d-000000000001';
const ACCESS_PERSON_ID = 'ap_123';

const ACCESS_GUEST: AccessGuest = {
  id: ACCESS_PERSON_ID,
  type: 'access_guest',
  attributes: {
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '+14155551234',
    status: 'current',
    // Timezone-less lock-local strings — must be relayed verbatim.
    starts_at: '2026-08-12T15:00:00',
    ends_at: '2026-08-14T11:00:00',
    pin: '123456',
    department: null,
  },
};

function createResponse() {
  const res = {} as Response & { statusCode?: number; body?: unknown };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response['status'];
  res.json = jest.fn((payload: unknown) => {
    res.body = payload;
    return res;
  }) as unknown as Response['json'];
  return res;
}

function createRequest(params: Record<string, unknown>) {
  return { params } as unknown as Request;
}

describe('InternalRemoteLockController.getAccessPerson', () => {
  const getAccessPerson = jest.fn();
  const clientFactory = jest.fn(
    () => ({ getAccessPerson }) as unknown as RemoteLockClient,
  );
  let controller: InternalRemoteLockController;
  let res: ReturnType<typeof createResponse>;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new InternalRemoteLockController(clientFactory);
    res = createResponse();
  });

  it('passes the RemoteLock resource through unreshaped', async () => {
    getAccessPerson.mockResolvedValue(ACCESS_GUEST);

    await controller.getAccessPerson(
      createRequest({ hotelId: HOTEL_ID, accessPersonId: ACCESS_PERSON_ID }),
      res,
    );

    expect(clientFactory).toHaveBeenCalledWith(HOTEL_ID);
    expect(getAccessPerson).toHaveBeenCalledWith(ACCESS_PERSON_ID);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(ACCESS_GUEST);
  });

  it('emits the partner-path KPI on success', async () => {
    getAccessPerson.mockResolvedValue(ACCESS_GUEST);

    await controller.getAccessPerson(
      createRequest({ hotelId: HOTEL_ID, accessPersonId: ACCESS_PERSON_ID }),
      res,
    );

    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({
        stat: 'remotelock.access_person.fetched',
        clientId: HOTEL_ID,
        contextId: ACCESS_PERSON_ID,
      }),
    );
  });

  it('400s on a blank path parameter without calling RemoteLock', async () => {
    await controller.getAccessPerson(
      createRequest({ hotelId: '  ', accessPersonId: ACCESS_PERSON_ID }),
      res,
    );

    expect(clientFactory).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({ code: 'invalid_request' }),
    );
  });

  it('404s when RemoteLock has no such access person', async () => {
    getAccessPerson.mockRejectedValue(
      new RemoteLockAPIError('Resource not found: nope', 404),
    );

    await controller.getAccessPerson(
      createRequest({ hotelId: HOTEL_ID, accessPersonId: ACCESS_PERSON_ID }),
      res,
    );

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual(
      expect.objectContaining({
        code: 'remotelock_access_person_not_found',
      }),
    );
  });

  it('422s when the hotel has no stored RemoteLock token', async () => {
    getAccessPerson.mockRejectedValue(
      new TokenError(
        `No RemoteLock access token available for hotel ${HOTEL_ID}`,
      ),
    );

    await controller.getAccessPerson(
      createRequest({ hotelId: HOTEL_ID, accessPersonId: ACCESS_PERSON_ID }),
      res,
    );

    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual(
      expect.objectContaining({ code: 'remotelock_not_onboarded' }),
    );
  });

  it('422s — not 401 — when RemoteLock rejects the stored token', async () => {
    getAccessPerson.mockRejectedValue(
      new RemoteLockAPIError('Authentication failed with RemoteLock API', 401),
    );

    await controller.getAccessPerson(
      createRequest({ hotelId: HOTEL_ID, accessPersonId: ACCESS_PERSON_ID }),
      res,
    );

    // 401/403 on this endpoint must keep meaning "bad x-api-key".
    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual(
      expect.objectContaining({ code: 'remotelock_auth_failed' }),
    );
  });

  it('422s — not 502 — when RemoteLock rejects the request itself', async () => {
    getAccessPerson.mockRejectedValue(
      new RemoteLockAPIError('RemoteLock API error: unprocessable', 422),
    );

    await controller.getAccessPerson(
      createRequest({ hotelId: HOTEL_ID, accessPersonId: ACCESS_PERSON_ID }),
      res,
    );

    // A 502 would tell the caller to retry a request RemoteLock already refused.
    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual(
      expect.objectContaining({ code: 'remotelock_rejected' }),
    );
  });

  it('422s on a RemoteLock 400', async () => {
    getAccessPerson.mockRejectedValue(
      new RemoteLockAPIError('RemoteLock API error: bad request', 400),
    );

    await controller.getAccessPerson(
      createRequest({ hotelId: HOTEL_ID, accessPersonId: ACCESS_PERSON_ID }),
      res,
    );

    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual(
      expect.objectContaining({ code: 'remotelock_rejected' }),
    );
  });

  it('502s when RemoteLock returns 5xx', async () => {
    getAccessPerson.mockRejectedValue(
      new RemoteLockAPIError('RemoteLock API error: boom', 503),
    );

    await controller.getAccessPerson(
      createRequest({ hotelId: HOTEL_ID, accessPersonId: ACCESS_PERSON_ID }),
      res,
    );

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual(
      expect.objectContaining({ code: 'remotelock_unavailable' }),
    );
  });

  it('502s when RemoteLock rate-limits', async () => {
    getAccessPerson.mockRejectedValue(
      new RemoteLockAPIError('Rate limit exceeded for RemoteLock API', 429),
    );

    await controller.getAccessPerson(
      createRequest({ hotelId: HOTEL_ID, accessPersonId: ACCESS_PERSON_ID }),
      res,
    );

    expect(res.statusCode).toBe(502);
  });

  it('502s on a network error (client wraps it as a 500)', async () => {
    getAccessPerson.mockRejectedValue(
      new RemoteLockAPIError('Network error connecting to RemoteLock API', 500),
    );

    await controller.getAccessPerson(
      createRequest({ hotelId: HOTEL_ID, accessPersonId: ACCESS_PERSON_ID }),
      res,
    );

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual(
      expect.objectContaining({ code: 'remotelock_unavailable' }),
    );
  });

  it('500s on Daisy-side misconfiguration', async () => {
    getAccessPerson.mockRejectedValue(
      new RemoteLockConfigurationError('REMOTELOCK_API_URL is not configured'),
    );

    await controller.getAccessPerson(
      createRequest({ hotelId: HOTEL_ID, accessPersonId: ACCESS_PERSON_ID }),
      res,
    );

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(
      expect.objectContaining({ code: 'remotelock_misconfigured' }),
    );
  });

  it('500s with internal_error on an unclassified failure', async () => {
    getAccessPerson.mockRejectedValue(new Error('unexpected'));

    await controller.getAccessPerson(
      createRequest({ hotelId: HOTEL_ID, accessPersonId: ACCESS_PERSON_ID }),
      res,
    );

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      code: 'internal_error',
      message: 'Internal Server error',
    });
    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({
        stat: 'remotelock.access_person.fetch_error',
      }),
    );
  });
});
