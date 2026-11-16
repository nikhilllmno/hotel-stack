jest.mock('@/calry/services/calryCredentials', () => ({
  resolveCalryCredentials: jest.fn(),
}));

jest.mock('@/services/hotelConfiguration/hotelConfigurationService', () => ({
  hotelConfigurationService: {
    getExternalAuthConfigByHotelId: jest.fn(),
  },
}));

jest.mock('@/utils/kpiLogger', () => ({
  ...jest.requireActual('@/utils/kpiLogger'),
  logKpi: jest.fn(),
}));

jest.mock('@/calry/client/CalryClient', () => ({
  __esModule: true,
  default: { passthrough: jest.fn() },
}));

import calryClient from '@/calry/client/CalryClient';
import operaClient from '@/calry/client/OperaClient';
import { OperaCardDeclinedError } from '@/calry/errors';
import { resolveCalryCredentials } from '@/calry/services/calryCredentials';
import { CalryOperaFolioService } from '@/calry/services/operaFolioService';
import { CalryCredentials } from '@/calry/types';
import { hotelConfigurationService } from '@/services/hotelConfiguration/hotelConfigurationService';

const CREDENTIALS: CalryCredentials = {
  propertyId: '212815',
  apiToken: 'calry_token_abc',
  workspaceId: 'workspace-1',
  integrationAccountId: 'integration-account-1',
  hotelId: 'hotel-uuid-1',
};

const AUTH_CONFIG = {
  operaHost: 'https://opera.example.com/',
  operaPropertyCode: 'DEMO1',
  operaCashierId: 4,
};

const mockResolveCredentials = resolveCalryCredentials as jest.Mock;
const mockGetAuthConfig =
  hotelConfigurationService.getExternalAuthConfigByHotelId as jest.Mock;
const mockPassthrough = calryClient.passthrough as jest.Mock;

describe('CalryOperaFolioService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveCredentials.mockResolvedValue(CREDENTIALS);
    mockGetAuthConfig.mockResolvedValue(AUTH_CONFIG);
  });

  it('posts a payment as a passthrough request Opera cashiering accepts', async () => {
    mockPassthrough.mockResolvedValue({ postingId: 'posting-1' });
    const service = new CalryOperaFolioService(operaClient);

    const postingId = await service.postPayment({
      hotelId: 'hotel-uuid-1',
      reservationId: '9961197',
      amount: 429,
      currency: 'USD',
      paymentMethodCode: 'CA',
      postingReference: 'Dextr deposit abc12345',
    });

    expect(postingId).toBe('posting-1');
    const [request, credentials] = mockPassthrough.mock.calls[0];
    expect(credentials).toEqual(CREDENTIALS);
    expect(request.method).toBe('POST');
    // Calry 500s on a sourceUrl that carries its own query string.
    expect(request.sourceUrl).toBe(
      'https://opera.example.com/csh/v1/hotels/{hotelId}/reservations/{reservationId}/payments',
    );
    expect(request.data.pathParams).toEqual({
      hotelId: 'DEMO1',
      reservationId: '9961197',
    });
    expect(request.data.headers).toEqual({ 'x-hotelid': 'DEMO1' });
    expect(request.data.body.criteria).toMatchObject({
      reservationId: { idContext: 'OPERA', id: '9961197', type: 'Reservation' },
      paymentMethod: { paymentMethod: 'CA' },
      postingAmount: { amount: 429, currencyCode: 'USD' },
      cashierId: 4,
      hotelId: 'DEMO1',
      folioWindowNo: '1',
    });
  });

  it('maps a declined settlement onto OperaCardDeclinedError', async () => {
    mockPassthrough.mockRejectedValue(
      new Error('Calry passthrough failed: Do not honor'),
    );
    const service = new CalryOperaFolioService(operaClient);

    await expect(
      service.postPayment({
        hotelId: 'hotel-uuid-1',
        reservationId: '9961197',
        amount: 429,
        currency: 'USD',
        paymentMethodCode: 'VA',
      }),
    ).rejects.toBeInstanceOf(OperaCardDeclinedError);
  });

  it('refuses to post for a Calry hotel that is not Opera-backed', async () => {
    mockGetAuthConfig.mockResolvedValue({ integrationAccountId: 'acct-1' });
    const service = new CalryOperaFolioService(operaClient);

    await expect(
      service.postPayment({
        hotelId: 'hotel-uuid-1',
        reservationId: '9961197',
        amount: 429,
        currency: 'USD',
        paymentMethodCode: 'CA',
      }),
    ).rejects.toThrow('not Opera-backed');
    expect(mockPassthrough).not.toHaveBeenCalled();
  });
});
