import { Hotel } from '../../../dtos/Hotel';
import { HotelConfiguration } from '../../../dtos/HotelConfiguration';
import { Reservation as ReservationDTO } from '../../../dtos/Reservation';
import { PaymentProvider } from '../../../types/enums';

export interface AutoChargeExecutionRequest {
  bookingIdPrefix: string;
  hotel: Hotel;
  hotelConfig: HotelConfiguration | null;
  reservations: ReservationDTO[];
  amount: number;
  paymentId: string;
  isManualCharge?: boolean;
}

export interface AutoChargeExecutionResult {
  success: boolean;
  provider: PaymentProvider;
  bookingConfirmationId?: string;
  providerResponseCode?: string;
  error?: string;
  raw?: unknown;
  mewsAccountId?: string;
  mewsCreditCardId?: string;
}

export interface IAutoChargeExecutor {
  executeAutoCharge(
    request: AutoChargeExecutionRequest,
  ): Promise<AutoChargeExecutionResult>;
}
