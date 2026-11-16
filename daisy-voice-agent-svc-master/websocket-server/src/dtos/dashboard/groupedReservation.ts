import { Discount } from '../../models/Discount';
import { AutoChargeInfo } from '../../types/reservation';
import { Customer } from '../Customer';
import { ReservationPaymentStatus } from '../enum/ReservationPaymentStatus';
import { ReservationStatus } from '../enum/ReservationStatus';
import { SessionType } from '../enum/SessionType';
import { Payment } from '../Payment';
import { Quote } from '../Quote';

export interface RoomDetail {
  id: string;
  booking_id: string;
  external_id?: string;
  room_type: string;
  room_id: number | string;
  num_adults: number;
  num_children: number;
  num_pets?: number;
  status: ReservationStatus;
  previous_status?: ReservationStatus;
  payments: Payment[] | null;
  quote: Quote | null;
  discount: Discount | null;
  customer_special_request?: string;
  notes_from_partner?: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface GroupedReservation {
  id: string;
  booking_id: string;
  external_id?: string;
  session_id?: string;
  check_in: Date;
  check_out: Date;
  status: ReservationStatus;
  previous_status?: ReservationStatus;
  payment_status?: ReservationPaymentStatus;
  phone_number: string;
  type: SessionType;
  business_id: string;
  created_at?: Date;
  updated_at?: Date;
  customer: Customer;
  num_adults: number;
  num_children: number;
  num_pets?: number;
  room_type: string | null;
  room_id: number | string | null;
  payments: Payment[] | null;
  quote: Partial<Quote> | null;
  discount: Discount | null;
  customer_special_request?: string;
  notes_from_partner?: string;
  rooms: RoomDetail[] | null;
  auto_charge?: AutoChargeInfo;
}
