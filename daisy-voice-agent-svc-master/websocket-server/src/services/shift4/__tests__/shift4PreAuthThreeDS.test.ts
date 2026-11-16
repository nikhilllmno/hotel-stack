jest.mock('axios');

import { Shift4PreAuthRequest } from '@/types/shift4';
import axios from 'axios';
import type FormData from 'form-data';
import { Shift4Service } from '../shift4Service';

const mockedAxios = axios as jest.Mocked<typeof axios>;

function buildRequest(
  overrides: Partial<Shift4PreAuthRequest> = {},
): Shift4PreAuthRequest {
  const address = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    address1: '1 Analytical Way',
    city: 'London',
    state: 'LDN',
    postalCode: 'EC1',
    countryCode: 'GB',
    phone1: '+445551234567',
  };
  return {
    orderNumber: 'BK500_1',
    amount: 100,
    currencyCode: 'USD',
    consumer: {
      mobilePhone: '+445551234567',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      billingAddress: address,
      shippingAddress: address,
    },
    invoice: '1234567890',
    customerDeviceIP: '203.0.113.5',
    hotelShift4Config: { authToken: 'auth-token', accessToken: 'access-token' },
    ...overrides,
  };
}

// Reads the multipart body sent to Shift4 so we can assert which 3DS
// fields were appended to the FormData.
function capturePostedBody(): string {
  const formData = mockedAxios.post.mock.calls[0][1] as FormData;
  return formData.getBuffer().toString('utf8');
}

describe('Shift4Service.preauthorizeClient 3DS toggle', () => {
  const service = new Shift4Service();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.post.mockResolvedValue({
      data: { i4go_responsecode: 1, i4go_response: 'ok' },
    });
  });

  it('applies 3DS when enable3DS is true', async () => {
    await service.preauthorizeClient(buildRequest({ enable3DS: true }));

    const body = capturePostedBody();
    expect(body).toContain('i4go_basket');
    expect(body).toContain('3DS_STANDALONE');
    expect(body).toContain('threedSecure');
  });

  it('omits 3DS when enable3DS is false', async () => {
    await service.preauthorizeClient(buildRequest({ enable3DS: false }));

    const body = capturePostedBody();
    expect(body).not.toContain('i4go_basket');
    expect(body).not.toContain('3DS_STANDALONE');
    expect(body).not.toContain('threedSecure');
    expect(body).toContain('CARD_VERIFY');
  });

  it('omits 3DS when enable3DS is undefined (default off)', async () => {
    await service.preauthorizeClient(buildRequest());

    const body = capturePostedBody();
    expect(body).not.toContain('i4go_basket');
    expect(body).not.toContain('3DS_STANDALONE');
    expect(body).not.toContain('threedSecure');
    expect(body).toContain('CARD_VERIFY');
  });
});
