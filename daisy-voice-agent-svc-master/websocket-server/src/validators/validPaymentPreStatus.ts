import { PaymentStatus } from '../dtos/enum/PaymentStatus';

export const validPaymentPreStatus: { [key: string]: PaymentStatus[] } = {
  COMPLETED: [PaymentStatus.PENDING, PaymentStatus.FAILED],
  FAILED: [PaymentStatus.PENDING],
  CANCELLED: [PaymentStatus.PENDING, PaymentStatus.FAILED],
  REFUNDED: [PaymentStatus.COMPLETED],
};
