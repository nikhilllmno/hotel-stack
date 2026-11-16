import { ReservationPaymentStatus } from '../dtos/enum/ReservationPaymentStatus';
import { ReservationSource } from '../dtos/enum/ReservationSource';
import { ReservationStatus } from '../dtos/enum/ReservationStatus';
import { SessionType } from '../dtos/enum/SessionType';
import { AutoChargeInfo } from '../types/reservation';
import { BaseModel } from './BaseModel';

export interface Reservation extends BaseModel {
  booking_id: string;
  business_id: string;
  hotel_id: string;
  pms_provider: string;
  room_id: number | string;
  customer_id: string;
  session_id?: string;
  check_in: Date;
  check_out: Date;
  num_adults: number;
  num_children: number;
  num_pets?: number;
  phone_number: string;
  status: ReservationStatus;
  previous_status?: ReservationStatus;
  payment_status?: ReservationPaymentStatus;
  pms_booking_claimed_at?: Date | null;
  notes_from_partner?: string;
  room_type: string;
  customer_special_request?: string;
  external_id?: string;
  external_public_id?: string;
  type: SessionType;
  source: ReservationSource;
  auto_charge?: AutoChargeInfo;
  onboarding_sms_sent?: boolean;
  customer_device_location?: string | null;
  customer_device_ip?: string | null;
  policy_signature?: string | null;
  rate_code?: string | null;
}
