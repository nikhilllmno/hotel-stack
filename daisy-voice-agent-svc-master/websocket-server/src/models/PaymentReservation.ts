import { BaseModel } from './BaseModel';

export interface PaymentReservation extends BaseModel {
  payment_id: string;
  reservation_id: string;
}
