export type OfflineChargeStatus = 'awaiting' | 'paid';

export type OfflineChargePaymentMethod =
  | 'credit_card'
  | 'vcc'
  | 'cash'
  | 'paypal'
  | 'venmo'
  | 'bank_transfer'
  | 'bank_check'
  | 'ota'
  | 'other';

export interface HostawayOfflineChargeRequest {
  title: string;
  description?: string;
  amount: number;
  paymentMethod: OfflineChargePaymentMethod;
  status: OfflineChargeStatus;
  scheduledDate: string;
}

export interface HostawayOfflineChargeResult {
  id: number;
  listingMapId: number;
  reservationId: number;
  autopaymentId: number | null;
  type: string;
  title: string;
  description: string | null;
  currency: string;
  paymentMethod: string;
  amount: number;
  capturedAmount: number;
  status: string;
  paymentProvider: string;
  paymentProviderMessage: string | null;
  paymentProviderInvoiceId: string | null;
  paymentProviderChargeId: string | null;
  scheduledDate: string;
  chargeDate: string;
  holdReleaseDate: string | null;
  isManual: number;
  autoChargeId: number | null;
  triggerEvent: string | null;
  triggerTimeDelta: number;
  flatFee: number;
  percentageFee: number;
  transactions: any[];
}

export interface HostawayOfflineChargeResponse {
  status: string;
  result: HostawayOfflineChargeResult;
}
