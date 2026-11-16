jest.mock('@/cloudbeds/client/CloudbedsClient', () => ({
  __esModule: true,
  default: { getReservation: jest.fn(), postCharge: jest.fn() },
}));
jest.mock('@/cloudbeds/services/cloudbedsCredentials', () => ({
  resolveCloudbedsCredentials: jest.fn().mockResolvedValue({
    propertyID: '316912',
    apiToken: 'token',
    hotelId: 'hotel-1',
  }),
}));
jest.mock('@/services/hotel/hotelService', () => ({
  hotelService: { getHotelById: jest.fn() },
}));

import cloudbedsClient from '@/cloudbeds/client/CloudbedsClient';
import { CloudbedsSdkPaymentProviderService } from '@/cloudbeds/services/CloudbedsSdkPaymentProviderService';
import { hotelService } from '@/services/hotel/hotelService';

const getReservation = cloudbedsClient.getReservation as jest.Mock;
const postCharge = cloudbedsClient.postCharge as jest.Mock;
const getHotelById = hotelService.getHotelById as jest.Mock;

describe('CloudbedsSdkPaymentProviderService.chargeReservationBalance', () => {
  const service = new CloudbedsSdkPaymentProviderService({} as never);
  const params = {
    hotelId: 'hotel-1',
    cloudbedsReservationId: 'CB-1',
    paymentMethodId: 'stored-pm-1',
    description: 'Booking BK1',
    returnUrl: 'https://secure.dextr.ai/booking/success',
    maxAmount: 1000,
  };

  beforeEach(() => {
    getReservation.mockReset().mockResolvedValue({ balance: 361.49 });
    postCharge.mockReset().mockResolvedValue({
      paymentID: 'pay-1',
      transactionID: 'tx-1',
      paymentStatus: 'successful',
    });
    getHotelById.mockReset().mockResolvedValue({ currency: '$' });
  });

  it('charges the Cloudbeds balance in the hotel currency as a deposit', async () => {
    const result = await service.chargeReservationBalance(params);

    expect(postCharge).toHaveBeenCalledWith(
      {
        propertyID: '316912',
        reservationID: 'CB-1',
        paymentMethodId: 'stored-pm-1',
        amount: '361.49',
        currency: 'usd',
        description: 'Booking BK1',
        isDeposit: true,
        redirectUrl: 'https://secure.dextr.ai/booking/success',
      },
      { apiToken: 'token', hotelId: 'hotel-1' },
    );
    expect(result).toEqual({
      status: 'successful',
      amount: 361.49,
      paymentId: 'pay-1',
      redirectUrl: null,
    });
  });

  it('never charges more than the guest agreed to pay now', async () => {
    await service.chargeReservationBalance({ ...params, maxAmount: 100 });

    expect(postCharge).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '100.00' }),
      expect.anything(),
    );
  });

  it('returns the 3DS page when Cloudbeds needs one', async () => {
    postCharge.mockResolvedValueOnce({
      paymentID: 'pay-1',
      transactionID: 'tx-1',
      paymentStatus: 'pending',
      nextAction: { type: 'redirect', details: { url: 'https://3ds.example' } },
    });

    const result = await service.chargeReservationBalance(params);

    expect(result.status).toBe('pending');
    expect(result.redirectUrl).toBe('https://3ds.example');
  });

  it('charges nothing when the balance is already paid', async () => {
    getReservation.mockResolvedValueOnce({ balance: 0 });

    const result = await service.chargeReservationBalance(params);

    expect(result).toEqual({
      status: 'nothing_due',
      amount: 0,
      paymentId: null,
      redirectUrl: null,
    });
    expect(postCharge).not.toHaveBeenCalled();
  });

  it('fails loudly when Cloudbeds returns no balance', async () => {
    getReservation.mockResolvedValueOnce({});

    await expect(service.chargeReservationBalance(params)).rejects.toThrow(
      'no usable balance',
    );
    expect(postCharge).not.toHaveBeenCalled();
  });

  it('refuses a hotel currency with no currency code', async () => {
    getHotelById.mockResolvedValueOnce({ currency: 'USD' });

    await expect(service.chargeReservationBalance(params)).rejects.toThrow(
      'has no currency code',
    );
    expect(postCharge).not.toHaveBeenCalled();
  });
});
