jest.mock('@/calry/services/calryCredentials', () => ({
  resolveCalryCredentials: jest.fn(),
}));

jest.mock('@/services/hotelConfiguration/hotelConfigurationService', () => ({
  hotelConfigurationService: {
    getExternalAuthConfigByHotelId: jest.fn(),
  },
}));

jest.mock('@/services/payment/paymentService', () => ({
  __esModule: true,
  default: { updatePaymentMetadata: jest.fn() },
}));

jest.mock('@/calry/services/operaFolioService', () => ({
  operaFolioService: { postPayment: jest.fn(), postReversal: jest.fn() },
}));

import { resolveCalryCredentials } from '@/calry/services/calryCredentials';
import { operaFolioService } from '@/calry/services/operaFolioService';
import { recordCollectedPaymentInOpera } from '@/calry/services/operaPaymentRecorder';
import { CalryCredentials } from '@/calry/types';
import { Reservation as ReservationDto } from '@/dtos/Reservation';
import { Payment } from '@/models/Payment';
import { hotelConfigurationService } from '@/services/hotelConfiguration/hotelConfigurationService';
import paymentService from '@/services/payment/paymentService';
import { PmsProvider } from '@/types/enums';

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
  operaCashierId: 4,
  operaExternalPaymentMethodCode: 'DX',
};

function buildReservation(
  overrides: Partial<ReservationDto> = {},
): ReservationDto {
  return {
    id: 'reservation-1',
    hotel_id: 'hotel-uuid-1',
    pms_provider: PmsProvider.CALRY,
    external_id: '9961197',
    hotel: { id: 'hotel-uuid-1', assistant_phone_number: '+15550000000' },
    quote: { amount_charged: 100 },
    ...overrides,
  } as unknown as ReservationDto;
}

function buildPayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'payment-uuid-1234',
    amount_charged: 100,
    currency: 'USD',
    metadata: {},
    ...overrides,
  } as unknown as Payment;
}

const mockResolveCredentials = resolveCalryCredentials as jest.Mock;
const mockGetAuthConfig =
  hotelConfigurationService.getExternalAuthConfigByHotelId as jest.Mock;
const mockPostPayment = operaFolioService.postPayment as jest.Mock;
const mockUpdateMetadata = paymentService.updatePaymentMetadata as jest.Mock;

describe('recordCollectedPaymentInOpera', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveCredentials.mockResolvedValue(CREDENTIALS);
    mockGetAuthConfig.mockResolvedValue(AUTH_CONFIG);
    mockPostPayment.mockResolvedValue('posting-1');
  });

  it('posts the deposit against the hotel non-card payment method', async () => {
    await recordCollectedPaymentInOpera({
      reservations: [buildReservation()],
      currency: 'USD',
      payment: buildPayment(),
    });

    expect(mockPostPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: '9961197',
        amount: 100,
        paymentMethodCode: 'DX',
        postingReference: 'Dextr deposit payment-',
      }),
    );
    expect(mockUpdateMetadata).toHaveBeenCalledWith('payment-uuid-1234', {
      opera_posting_id: 'posting-1',
    });
  });

  it('does nothing for a booking on another PMS', async () => {
    await recordCollectedPaymentInOpera({
      reservations: [buildReservation({ pms_provider: PmsProvider.MEWS })],
      currency: 'USD',
      payment: buildPayment(),
    });

    expect(mockPostPayment).not.toHaveBeenCalled();
  });

  it('does not post twice when the deposit is already on the folio', async () => {
    await recordCollectedPaymentInOpera({
      reservations: [buildReservation()],
      currency: 'USD',
      payment: buildPayment({
        metadata: { opera_posting_id: 'posting-1' } as never,
      }),
    });

    expect(mockPostPayment).not.toHaveBeenCalled();
  });

  it('still records the autocharge after the deposit was posted', async () => {
    await recordCollectedPaymentInOpera({
      reservations: [
        buildReservation({
          quote: {
            amount_charged: 100,
            base_rate: 200,
            taxes: 30,
            fees: 20,
          } as never,
        }),
      ],
      currency: 'USD',
      payment: buildPayment({
        metadata: { opera_posting_id: 'posting-1' } as never,
      }),
      isAutoCharge: true,
    });

    expect(mockPostPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 150 }),
    );
  });

  it('swallows a folio failure so a captured payment never fails the booking', async () => {
    mockPostPayment.mockRejectedValue(new Error('cashier is closed'));

    await expect(
      recordCollectedPaymentInOpera({
        reservations: [buildReservation()],
        currency: 'USD',
        payment: buildPayment(),
      }),
    ).resolves.toBeUndefined();
    expect(mockUpdateMetadata).not.toHaveBeenCalled();
  });
});
