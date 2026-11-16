import type { Request, Response } from 'express';
import type { Hotel } from '../../../models/Hotel';
import type { HotelRepository } from '../../../repositories/HotelRepository';
import type { HotelConfigurationService } from '../../../services/hotelConfiguration/hotelConfigurationService';
import { PmsProvider } from '../../../types/enums';
import { InternalPmsTokenController } from '../internalPmsTokenController';

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

jest.mock('../../../utils/encryption', () => ({
  encrypt: jest.fn((plaintext: string) => `encrypted:${plaintext}`),
}));

const { logKpi } = jest.requireMock('../../../utils/kpiLogger');
const { encrypt } = jest.requireMock('../../../utils/encryption');

const HOTEL_ID = 'ffb4d2a0-1111-4b2a-9c3d-000000000001';
const HOTEL: Hotel = {
  id: HOTEL_ID,
  pms_provider: PmsProvider.CLOUDBEDS,
  assistant_phone_number: '+14155550000',
} as unknown as Hotel;

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

function createRequest(body: Record<string, unknown>) {
  return { body } as unknown as Request;
}

function createRequestWithoutBody() {
  return {} as unknown as Request;
}

describe('InternalPmsTokenController.storeToken', () => {
  const findById = jest.fn();
  const updateExternalAuthConfigApiTokenByHotelId = jest.fn();
  let controller: InternalPmsTokenController;
  let res: ReturnType<typeof createResponse>;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new InternalPmsTokenController(
      {
        updateExternalAuthConfigApiTokenByHotelId,
      } as unknown as HotelConfigurationService,
      { findById } as unknown as HotelRepository,
    );
    res = createResponse();
  });

  it('encrypts the token and stores it against the hotel', async () => {
    findById.mockResolvedValue(HOTEL);
    updateExternalAuthConfigApiTokenByHotelId.mockResolvedValue(1);

    await controller.storeToken(
      createRequest({
        hotel_id: HOTEL_ID,
        pms_provider: PmsProvider.CLOUDBEDS,
        token: 'raw-token',
      }),
      res,
    );

    expect(encrypt).toHaveBeenCalledWith('raw-token');
    expect(updateExternalAuthConfigApiTokenByHotelId).toHaveBeenCalledWith(
      HOTEL_ID,
      'encrypted:raw-token',
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({
        stat: 'pms.external_auth.token_stored',
        clientId: HOTEL.assistant_phone_number,
        contextId: HOTEL_ID,
      }),
    );
  });

  it('400s when a required field is missing', async () => {
    await controller.storeToken(
      createRequest({
        hotel_id: HOTEL_ID,
        pms_provider: PmsProvider.CLOUDBEDS,
      }),
      res,
    );

    expect(findById).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });

  it('400s when req.body is absent', async () => {
    await controller.storeToken(createRequestWithoutBody(), res);

    expect(findById).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });

  it('400s on a non-string token instead of erroring on encrypt', async () => {
    await controller.storeToken(
      createRequest({
        hotel_id: HOTEL_ID,
        pms_provider: PmsProvider.CLOUDBEDS,
        token: 42,
      }),
      res,
    );

    expect(findById).not.toHaveBeenCalled();
    expect(encrypt).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });

  it('400s on an unknown pms_provider', async () => {
    await controller.storeToken(
      createRequest({
        hotel_id: HOTEL_ID,
        pms_provider: 'not_a_provider',
        token: 'raw-token',
      }),
      res,
    );

    expect(findById).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });

  it('404s when the hotel does not exist', async () => {
    findById.mockResolvedValue(null);

    await controller.storeToken(
      createRequest({
        hotel_id: HOTEL_ID,
        pms_provider: PmsProvider.CLOUDBEDS,
        token: 'raw-token',
      }),
      res,
    );

    expect(res.statusCode).toBe(404);
    expect(updateExternalAuthConfigApiTokenByHotelId).not.toHaveBeenCalled();
  });

  it("400s when pms_provider does not match the hotel's configured provider", async () => {
    findById.mockResolvedValue(HOTEL);

    await controller.storeToken(
      createRequest({
        hotel_id: HOTEL_ID,
        pms_provider: PmsProvider.STAYNTOUCH,
        token: 'raw-token',
      }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(updateExternalAuthConfigApiTokenByHotelId).not.toHaveBeenCalled();
  });

  it('404s when no active hotel_configurations row was updated', async () => {
    findById.mockResolvedValue(HOTEL);
    updateExternalAuthConfigApiTokenByHotelId.mockResolvedValue(0);

    await controller.storeToken(
      createRequest({
        hotel_id: HOTEL_ID,
        pms_provider: PmsProvider.CLOUDBEDS,
        token: 'raw-token',
      }),
      res,
    );

    expect(res.statusCode).toBe(404);
    expect(logKpi).not.toHaveBeenCalled();
  });
});

describe('InternalPmsTokenController.storeClientCredentials', () => {
  const findById = jest.fn();
  const updateExternalAuthConfigOAuthCredentialsByHotelId = jest.fn();
  let controller: InternalPmsTokenController;
  let res: ReturnType<typeof createResponse>;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new InternalPmsTokenController(
      {
        updateExternalAuthConfigOAuthCredentialsByHotelId,
      } as unknown as HotelConfigurationService,
      { findById } as unknown as HotelRepository,
    );
    res = createResponse();
  });

  it('encrypts both credentials and stores them against the hotel', async () => {
    findById.mockResolvedValue(HOTEL);
    updateExternalAuthConfigOAuthCredentialsByHotelId.mockResolvedValue(1);

    await controller.storeClientCredentials(
      createRequest({
        hotel_id: HOTEL_ID,
        pms_provider: PmsProvider.CLOUDBEDS,
        client_id: 'my-client-id',
        client_secret: 'my-client-secret',
      }),
      res,
    );

    expect(encrypt).toHaveBeenCalledWith('my-client-id');
    expect(encrypt).toHaveBeenCalledWith('my-client-secret');
    expect(
      updateExternalAuthConfigOAuthCredentialsByHotelId,
    ).toHaveBeenCalledWith(
      HOTEL_ID,
      'encrypted:my-client-id',
      'encrypted:my-client-secret',
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({
        stat: 'pms.external_auth.client_credentials_stored',
        clientId: HOTEL.assistant_phone_number,
        contextId: HOTEL_ID,
      }),
    );
  });

  it('400s when a required field is missing', async () => {
    await controller.storeClientCredentials(
      createRequest({
        hotel_id: HOTEL_ID,
        pms_provider: PmsProvider.CLOUDBEDS,
        client_id: 'my-client-id',
      }),
      res,
    );

    expect(findById).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });

  it('400s when req.body is absent', async () => {
    await controller.storeClientCredentials(createRequestWithoutBody(), res);

    expect(findById).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });

  it('400s on a non-string client_secret instead of erroring on encrypt', async () => {
    await controller.storeClientCredentials(
      createRequest({
        hotel_id: HOTEL_ID,
        pms_provider: PmsProvider.CLOUDBEDS,
        client_id: 'my-client-id',
        client_secret: 42,
      }),
      res,
    );

    expect(findById).not.toHaveBeenCalled();
    expect(encrypt).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });

  it('400s on an unknown pms_provider', async () => {
    await controller.storeClientCredentials(
      createRequest({
        hotel_id: HOTEL_ID,
        pms_provider: 'not_a_provider',
        client_id: 'my-client-id',
        client_secret: 'my-client-secret',
      }),
      res,
    );

    expect(findById).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });

  it('404s when the hotel does not exist', async () => {
    findById.mockResolvedValue(null);

    await controller.storeClientCredentials(
      createRequest({
        hotel_id: HOTEL_ID,
        pms_provider: PmsProvider.CLOUDBEDS,
        client_id: 'my-client-id',
        client_secret: 'my-client-secret',
      }),
      res,
    );

    expect(res.statusCode).toBe(404);
    expect(
      updateExternalAuthConfigOAuthCredentialsByHotelId,
    ).not.toHaveBeenCalled();
  });

  it("400s when pms_provider does not match the hotel's configured provider", async () => {
    findById.mockResolvedValue(HOTEL);

    await controller.storeClientCredentials(
      createRequest({
        hotel_id: HOTEL_ID,
        pms_provider: PmsProvider.STAYNTOUCH,
        client_id: 'my-client-id',
        client_secret: 'my-client-secret',
      }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(
      updateExternalAuthConfigOAuthCredentialsByHotelId,
    ).not.toHaveBeenCalled();
  });

  it('404s when no active hotel_configurations row was updated', async () => {
    findById.mockResolvedValue(HOTEL);
    updateExternalAuthConfigOAuthCredentialsByHotelId.mockResolvedValue(0);

    await controller.storeClientCredentials(
      createRequest({
        hotel_id: HOTEL_ID,
        pms_provider: PmsProvider.CLOUDBEDS,
        client_id: 'my-client-id',
        client_secret: 'my-client-secret',
      }),
      res,
    );

    expect(res.statusCode).toBe(404);
    expect(logKpi).not.toHaveBeenCalled();
  });
});
