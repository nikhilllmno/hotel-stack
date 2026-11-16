import { DiscountType } from '../types/discount';

export interface Discount {
  id: string;
  phone_number: string;
  value: number;
  type: DiscountType;
  hotel_id: string;
  expiry_days: number;
  note: string;
  deleted_at?: Date;
  reservation_id?: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface CreateDiscountDto {
  phone_number: string;
  value: number;
  type: DiscountType;
  hotel_id: string;
  expiry_days: number;
  note: string;
}
