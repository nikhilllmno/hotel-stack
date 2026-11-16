const mockPost = jest.fn();

jest.mock('axios', () => ({
  __esModule: true,
  default: { create: jest.fn(() => ({ post: mockPost })) },
}));

const mockLoggerError = jest.fn();

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

import { CalryCardTokenClient } from '@/calry/client/CalryCardTokenClient';
import { CalryAPIError, OperaCardDeclinedError } from '@/calry/errors';
import { CalryCredentials } from '@/calry/types';

const PAN = '4111111111111111';
const OPI_HOST = 'https://opi.opera.test';
const PROPERTY_CODE = 'DEMO1';

const CREDENTIALS: CalryCredentials = {
  propertyId: '212815',
  apiToken: 'calry_token_abc',
  workspaceId: 'workspace-1',
  integrationAccountId: 'integration-account-1',
  hotelId: 'hotel-uuid-1',
};

/** Shaped like an AxiosError; the client only reads `response` and `message`. */
function httpError(status: number, data: unknown) {
  return {
    response: { status, data, config: { data: { pan: PAN } } },
    config: { data: { pan: PAN } },
    message: `Request failed: ${status}`,
  };
}

function exchange(client: CalryCardTokenClient) {
  return client.exchangeCardToken(
    OPI_HOST,
    PROPERTY_CODE,
    { pan: PAN, expiryDate: '2612' },
    CREDENTIALS,
  );
}

function expectNoCardInLogs() {
  const logged = JSON.stringify(mockLoggerError.mock.calls);
  expect(logged).not.toContain(PAN);
  expect(logged).not.toContain('1111');
}

describe('CalryCardTokenClient', () => {
  let client: CalryCardTokenClient;

  beforeEach(() => {
    mockPost.mockReset();
    mockLoggerError.mockReset();
    client = new CalryCardTokenClient();
  });

  it('wraps the card in a Calry passthrough to the property token endpoint', async () => {
    mockPost.mockResolvedValue({
      data: {
        data: {
          token: '483204890324827',
          cardType: 'VA',
          expiryDate: '2612',
          pan: 'XXXXXXXXXXXX1111',
        },
      },
    });

    const result = await exchange(client);

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v2/vrs/passthrough',
      {
        method: 'POST',
        sourceUrl: `${OPI_HOST}/tokenExchange/v1/hotels/{hotelId}/tokens`,
        data: {
          pathParams: { hotelId: PROPERTY_CODE },
          headers: { 'x-hotelid': PROPERTY_CODE },
          body: { pan: PAN, expiryDate: '2612' },
        },
      },
      {
        headers: {
          Authorization: 'Bearer calry_token_abc',
          workspaceId: 'workspace-1',
          integrationAccountId: 'integration-account-1',
        },
      },
    );
    expect(result.token).toBe('483204890324827');
  });

  it('fails when the response carries no token', async () => {
    mockPost.mockResolvedValue({ data: { data: { cardType: 'VA' } } });

    await expect(exchange(client)).rejects.toThrow(CalryAPIError);
  });

  it('maps an upstream 422 to a declined card', async () => {
    mockPost.mockRejectedValue(
      httpError(422, { status: 422, 'o:errorCode': 'OPICS-0204' }),
    );

    await expect(exchange(client)).rejects.toThrow(OperaCardDeclinedError);
  });

  it('never writes the card number to the logs when the exchange fails', async () => {
    mockPost.mockRejectedValue(
      httpError(400, {
        title: 'Bad Request',
        correlationId: 'corr-1',
        'o:errorCode': 'OPICS-BAD_REQUEST',
      }),
    );

    await expect(exchange(client)).rejects.toThrow(CalryAPIError);

    expect(mockLoggerError).toHaveBeenCalled();
    expectNoCardInLogs();
  });

  it('never writes the card number to the logs on a network error', async () => {
    mockPost.mockRejectedValue({
      message: 'socket hang up',
      config: { data: { pan: PAN } },
    });

    await expect(exchange(client)).rejects.toThrow(CalryAPIError);

    expect(mockLoggerError).toHaveBeenCalled();
    expectNoCardInLogs();
  });
});
