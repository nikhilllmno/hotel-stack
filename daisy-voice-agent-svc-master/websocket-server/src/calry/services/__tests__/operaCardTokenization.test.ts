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

import { OperaCardDeclinedError } from '@/calry/errors';
import { resolveCalryCredentials } from '@/calry/services/calryCredentials';
import { OperaCardTokenService } from '@/calry/services/operaCardTokenService';
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
  operaHost: 'https://opera.example.com',
  operaPropertyCode: 'DEMO1',
};

/** A Luhn-valid test PAN. */
const VALID_PAN = '4111111111111111';

const mockResolveCredentials = resolveCalryCredentials as jest.Mock;
const mockGetAuthConfig =
  hotelConfigurationService.getExternalAuthConfigByHotelId as jest.Mock;

describe('OperaCardTokenService.exchangeCard', () => {
  let client: { exchangeCardToken: jest.Mock };
  let service: OperaCardTokenService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveCredentials.mockResolvedValue(CREDENTIALS);
    mockGetAuthConfig.mockResolvedValue(AUTH_CONFIG);

    client = {
      exchangeCardToken: jest.fn().mockResolvedValue({
        token: 'opi-token-1',
        cardType: 'VA',
        expiryDate: '2612',
        pan: 'XXXXXXXXXXXX1111',
      }),
    };
    service = new OperaCardTokenService(client as never);
  });

  it('exchanges the card and returns only the token and masked pan', async () => {
    const card = await service.exchangeCard('hotel-uuid-1', {
      pan: VALID_PAN,
      expiryDate: '2612',
      cardHolderName: 'A Guest',
    });

    // OPI is reached on the property's own Opera gateway, not a separate host.
    expect(client.exchangeCardToken).toHaveBeenCalledWith(
      'https://opera.example.com',
      'DEMO1',
      { pan: VALID_PAN, expiryDate: '2612' },
      CREDENTIALS,
    );
    expect(card).toEqual({
      token: 'opi-token-1',
      cardType: 'VA',
      expiryDate: '2612',
      maskedPan: 'XXXXXXXXXXXX1111',
      cardHolderName: 'A Guest',
    });
    expect(JSON.stringify(card)).not.toContain(VALID_PAN);
  });

  it('rejects a pan that fails the Luhn check before calling out', async () => {
    await expect(
      service.exchangeCard('hotel-uuid-1', {
        pan: '4111111111111112',
        expiryDate: '2612',
      }),
    ).rejects.toThrow('Card number is not valid');
    expect(client.exchangeCardToken).not.toHaveBeenCalled();
  });

  it('rejects an expiry that is not YYMM', async () => {
    await expect(
      service.exchangeCard('hotel-uuid-1', {
        pan: VALID_PAN,
        expiryDate: '12/26',
      }),
    ).rejects.toThrow('YYMM');
    expect(client.exchangeCardToken).not.toHaveBeenCalled();
  });

  it('propagates a decline', async () => {
    client.exchangeCardToken.mockRejectedValue(
      new OperaCardDeclinedError('Card was declined'),
    );

    await expect(
      service.exchangeCard('hotel-uuid-1', {
        pan: VALID_PAN,
        expiryDate: '2612',
      }),
    ).rejects.toBeInstanceOf(OperaCardDeclinedError);
  });
});
