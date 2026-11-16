const mockLoggerError = jest.fn();

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
    debug: jest.fn(),
  },
}));

jest.mock('@/config', () => ({
  __esModule: true,
  default: {
    AUTHORIZE_NET_VERIFY_API_LOGIN_ID: 'login',
    AUTHORIZE_NET_VERIFY_TRANSACTION_KEY: 'key',
    AUTHORIZE_NET_ENVIRONMENT: 'sandbox',
    API_TIMEOUT: 1000,
  },
}));

import authorizeNetService, {
  __for_testing,
} from '@/authorizeNet/services/authorizeNetService';
import config from '@/config';
import { Customer } from '@/dtos/Customer';
import { APIControllers } from 'authorizenet';

const { toCardCheckResponse, toOutcome } = __for_testing;

const PAN = '4111111111111111';
const CVV = '737';
const card = { pan: PAN, cvv: CVV, expiryMonth: 12, expiryYear: 2030 };

type CardCheckResponse = Parameters<typeof toOutcome>[0];

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'cust-1',
    first_name: 'Ada',
    last_name: 'Lovelace',
    address: {
      address_first_line: '1 Ada Way',
      city: 'Schmoton',
      state_or_province: 'OH',
      postal_code: '12345',
      country: 'US',
    },
    billing_address: null,
    ...overrides,
  } as Customer;
}

function checkResponse(
  overrides: Partial<CardCheckResponse> = {},
): CardCheckResponse {
  return {
    responseCode: null,
    avsResultCode: null,
    cvvResultCode: null,
    transId: 'T-1',
    reasonCode: null,
    messageCode: null,
    ...overrides,
  };
}

describe('toCardCheckResponse', () => {
  it('reads the documented fields of a transaction response', () => {
    expect(
      toCardCheckResponse({
        transactionResponse: {
          responseCode: '2',
          avsResultCode: 'Y',
          cvvResultCode: 'N',
          transId: '120091301591',
          errors: [{ errorCode: '65', errorText: 'declined' }],
        },
        messages: { resultCode: 'Ok', message: [{ code: 'I00001' }] },
      }),
    ).toEqual({
      responseCode: '2',
      avsResultCode: 'Y',
      cvvResultCode: 'N',
      transId: '120091301591',
      reasonCode: '65',
      messageCode: 'I00001',
    });
  });

  it('turns empty, zero and undocumented values into null', () => {
    expect(
      toCardCheckResponse({
        transactionResponse: {
          responseCode: '9',
          avsResultCode: 'Q',
          cvvResultCode: '',
          transId: '0',
          errors: [{ errorCode: 'E00027' }],
        },
        messages: { resultCode: 'Error', message: [{ code: 'E00027' }] },
      }),
    ).toEqual({
      responseCode: null,
      avsResultCode: null,
      cvvResultCode: null,
      transId: null,
      reasonCode: null,
      messageCode: 'E00027',
    });
  });

  it('handles a request rejected before any transaction', () => {
    expect(
      toCardCheckResponse({
        messages: { resultCode: 'Error', message: [{ code: 'E00001' }] },
      }),
    ).toEqual(checkResponse({ transId: null, messageCode: 'E00001' }));
  });
});

describe('toOutcome', () => {
  it.each<[Partial<CardCheckResponse>, string]>([
    [{ responseCode: '1', cvvResultCode: 'M' }, 'approved'],
    [{ responseCode: '1', cvvResultCode: 'P' }, 'approved'],
    [{ responseCode: '1', cvvResultCode: 'N' }, 'declined'],
    [{ responseCode: '2', reasonCode: '65' }, 'declined'],
    [{ responseCode: '3', reasonCode: '6' }, 'declined'],
    [{ responseCode: '3', reasonCode: '8' }, 'declined'],
    [{ responseCode: '3', reasonCode: '290' }, 'unavailable'],
    [{ responseCode: '4' }, 'unavailable'],
    [{}, 'unavailable'],
  ])('maps %j to %s', (response, outcome) => {
    expect(toOutcome(checkResponse(response))).toBe(outcome);
  });
});

describe('verifyCard', () => {
  let sent: { billTo?: Record<string, unknown> }[];
  let execute: jest.SpyInstance;

  beforeEach(() => {
    mockLoggerError.mockReset();
    sent = [];
    execute = jest
      .spyOn(APIControllers.CreateTransactionController.prototype, 'execute')
      .mockImplementation(function (
        this: { _request: Record<string, { transactionRequest: object }> },
        callback: () => void,
      ) {
        sent.push(Object.values(this._request)[0].transactionRequest);
        callback();
      });
    jest
      .spyOn(APIControllers.CreateTransactionController.prototype, 'getError')
      .mockReturnValue(null);
    jest
      .spyOn(
        APIControllers.CreateTransactionController.prototype,
        'getResponse',
      )
      .mockReturnValue({
        transactionResponse: { responseCode: '1', cvvResultCode: 'M' },
      });
  });

  afterEach(() => jest.restoreAllMocks());

  it('sends the contact address when there is no billing address', async () => {
    expect(await authorizeNetService.verifyCard(card, customer())).toBe(
      'approved',
    );
    expect(sent[0].billTo).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      address: '1 Ada Way',
      city: 'Schmoton',
      state: 'OH',
      zip: '12345',
      country: 'US',
    });
  });

  it('prefers the billing address', async () => {
    await authorizeNetService.verifyCard(
      card,
      customer({
        billing_address: {
          address_first_line: '9 Bill St',
          postal_code: '99999',
        },
      }),
    );
    expect(sent[0].billTo).toMatchObject({
      address: '9 Bill St',
      zip: '99999',
    });
  });

  it('is unavailable without a street address and zip, and makes no call', async () => {
    expect(
      await authorizeNetService.verifyCard(
        card,
        customer({ address: { postal_code: '12345' } }),
      ),
    ).toBe('unavailable');
    expect(execute).not.toHaveBeenCalled();
  });

  it('is unavailable without credentials, and makes no call', async () => {
    const original = config.AUTHORIZE_NET_VERIFY_TRANSACTION_KEY;
    (
      config as { AUTHORIZE_NET_VERIFY_TRANSACTION_KEY: string }
    ).AUTHORIZE_NET_VERIFY_TRANSACTION_KEY = '';
    try {
      expect(await authorizeNetService.verifyCard(card, customer())).toBe(
        'unavailable',
      );
      expect(execute).not.toHaveBeenCalled();
    } finally {
      (
        config as { AUTHORIZE_NET_VERIFY_TRANSACTION_KEY: string }
      ).AUTHORIZE_NET_VERIFY_TRANSACTION_KEY = original;
    }
  });

  it('is unavailable when the gateway call fails, without logging the card', async () => {
    jest
      .spyOn(APIControllers.CreateTransactionController.prototype, 'getError')
      .mockReturnValue(
        Object.assign(new Error('socket hang up'), {
          config: { data: JSON.stringify({ cardNumber: PAN, cardCode: CVV }) },
        }),
      );

    expect(await authorizeNetService.verifyCard(card, customer())).toBe(
      'unavailable',
    );
    const logged = JSON.stringify(mockLoggerError.mock.calls);
    expect(logged).toContain('socket hang up');
    expect(logged).not.toContain(PAN);
    expect(logged).not.toContain(CVV);
  });
});
