import { ChannelModel } from '../models/ChannelModel';
import { Discount } from '../models/Discount';
import { AutoChargeInfo, PricingBreakdown } from '../types/reservation';
import { Customer } from './Customer';
import { ReservationPaymentStatus } from './enum/ReservationPaymentStatus';
import { ReservationSource } from './enum/ReservationSource';
import { ReservationStatus } from './enum/ReservationStatus';
import { SessionType } from './enum/SessionType';
import { Hotel } from './Hotel';
import { HotelConfiguration } from './HotelConfiguration';
import { Payment } from './Payment';
import { Quote } from './Quote';

export interface Reservation {
  id: string;
  booking_id: string;
  phone_number: string;
  type: SessionType;
  session_id?: string;
  room_id: number | string;
  room_type: string;
  /** Physical room label/number (e.g. "025"), as configured by the PMS. Only populated by providers that expose it. */
  room_name?: string | null;
  /** Numeric room number parsed from `room_name` (e.g. "025" from "Solstice King . 025"). Null when the label has no trailing number. */
  room_number?: string | null;
  business_id: string;
  hotel_id: string;
  pms_provider: string;
  status: ReservationStatus;
  previous_status?: ReservationStatus;
  payment_status?: ReservationPaymentStatus;
  check_in: Date;
  check_out: Date;
  num_adults: number;
  num_children: number;
  num_pets?: number;
  created_at?: Date;
  updated_at?: Date;
  customer_special_request?: string;
  notes_from_partner?: string;
  external_id?: string;
  external_public_id?: string;
  auto_charge?: AutoChargeInfo;
  onboarding_sms_sent?: boolean;
  rate_code?: string | null;
  rate_id?: number | string | null;
  customer: Customer;
  hotel: Hotel | null;
  hotel_configuration: HotelConfiguration | null;
  channel: ChannelModel | null;
  payments: Payment[] | null;
  quote: Quote | null;
  discount: Discount | null;
  reservation_source?: ReservationSource;
}

export interface ReservationWithPricingBreakdown extends Reservation {
  has_pricing_breakdown?: boolean;
  pricing_breakdown?: PricingBreakdown;
}
export interface SetupAutoChargeRequest {
  finalizes_at?: Date;
  amount?: number;
  is_enabled: boolean;
}

export interface SetupAutoChargeResponse {
  success: boolean;
  message: string;
  finalizes_at?: Date;
  charge_amount?: number;
}
