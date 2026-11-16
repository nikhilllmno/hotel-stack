import { PaymentStatus } from '../dtos/enum/PaymentStatus';
import { PaymentProvider } from '../types/enums';
import { PaymentCreationMetadata } from '../types/payment';
import { BaseModel } from './BaseModel';

export interface Payment extends BaseModel {
  hotel_id: string;
  booking_confirmation_id?: string;
  payment_link?: string;
  payment_link_id?: string;
  amount_charged: number;
  amount_refunded?: number;
  payment_status: PaymentStatus;
  currency: string;
  payment_provider: PaymentProvider;
  payment_link_disabled?: boolean;
  metadata?: PaymentCreationMetadata;
  created_at: Date;
  notification_count?: number;
}
