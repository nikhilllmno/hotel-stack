const mockPost = jest.fn();

jest.mock('@/utils/httpClient', () => ({
  createHttpClient: jest.fn(() => ({
    get: jest.fn(),
    post: mockPost,
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  })),
}));

jest.mock('@/utils/kpiLogger', () => ({
  ...jest.requireActual('@/utils/kpiLogger'),
  logKpi: jest.fn(),
}));

jest.mock('@/config', () => ({
  __esModule: true,
  default: {
    ...jest.requireActual('@/config').default,
    SUPPORT_OPS_API_KEY: 'support-ops-token',
    DAISY_API_KEY_V2: 'daisy-inbound-key',
  },
}));

import config from '@/config';
import { TokenError } from '@/errors/TokenError';
import { HotelRepository } from '@/repositories/HotelRepository';
import { ChatInteractionService } from '@/services/chat/chatInteractionService';
import { EscalationService } from '@/services/escalation/escalationService';
import { HotelConfigurationService } from '@/services/hotelConfiguration/hotelConfigurationService';
import { KpiStat, logKpi } from '@/utils/kpiLogger';
import { AxiosError, AxiosHeaders } from 'axios';

const URL =
  'https://support-ops.example.com/webhook/sms/manager-escalation-response';
const CLIENT_ID = '15551234567';
const PAYLOAD = {
  customer_phone_number: '+14155551234',
  assistant_phone_number: '+15551234567',
  manager_response: 'Your late checkout is approved.',
  hotel_name: 'Test Hotel',
};

function axiosErrorWithStatus(status: number): AxiosError {
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    undefined,
    undefined,
    {
      status,
      statusText: 'Forbidden',
      data: { message: 'Invalid webhook token' },
      headers: {},
      config: { headers: new AxiosHeaders() },
    },
  );
}

describe('ChatInteractionService.sendEscalationResponse', () => {
  const originalToken = config.SUPPORT_OPS_API_KEY;
  const service = new ChatInteractionService(
    {} as HotelRepository,
    {} as HotelConfigurationService,
    {} as EscalationService,
  );
  const send = (
    service as unknown as {
      sendEscalationResponse: (
        url: string,
        payload: typeof PAYLOAD,
        clientId: string,
      ) => Promise<void>;
    }
  ).sendEscalationResponse.bind(service);

  beforeEach(() => {
    mockPost.mockReset();
    (logKpi as jest.Mock).mockReset();
    config.SUPPORT_OPS_API_KEY = originalToken;
  });

  it('sends the support-ops token, not a Daisy key, and logs the sent KPI', async () => {
    mockPost.mockResolvedValue({ status: 200 });

    await send(URL, PAYLOAD, CLIENT_ID);

    expect(mockPost).toHaveBeenCalledWith(
      URL,
      PAYLOAD,
      expect.objectContaining({
        headers: expect.objectContaining({ token: 'support-ops-token' }),
      }),
    );
    expect(logKpi).toHaveBeenCalledTimes(1);
    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({
        stat: KpiStat.EscalationResponseSent,
        value: 1,
        clientId: CLIENT_ID,
      }),
    );
  });

  it('throws and logs the failed KPI when the support-ops token is not configured', async () => {
    config.SUPPORT_OPS_API_KEY = '';

    await expect(send(URL, PAYLOAD, CLIENT_ID)).rejects.toBeInstanceOf(
      TokenError,
    );

    expect(mockPost).not.toHaveBeenCalled();
    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({
        stat: KpiStat.EscalationResponseFailed,
        clientId: CLIENT_ID,
      }),
    );
  });

  it('throws with the HTTP status and logs the failed KPI when support-ops rejects the token', async () => {
    mockPost.mockRejectedValue(axiosErrorWithStatus(403));

    await expect(send(URL, PAYLOAD, CLIENT_ID)).rejects.toThrow('HTTP 403');

    expect(logKpi).toHaveBeenCalledTimes(1);
    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({
        stat: KpiStat.EscalationResponseFailed,
        clientId: CLIENT_ID,
      }),
    );
  });
});
