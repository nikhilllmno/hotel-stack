import { StatusUpdateType } from '../models/request/StatusUpdate';
import { SessionType } from './enum/SessionType';

export interface SessionMetadata {
  availability_enquired?: boolean | null;
  payment_link_sent?: boolean | null;
  customer_satisfaction_score?: number | null;
  customer_frustration_score?: number | null;
  call_forwarded?: boolean | null;
}

export interface HotelAnalyticsSummary {
  hotel_id: string;
  total_calls: number;
  availability_enquired_calls: number;
  payment_link_sent_calls: number;
  successful_reservation_calls: number;
  avg_satisfaction_score?: number | null;
  high_frustration_calls: number;
}

export interface SessionLog {
  // sessions
  id: string;
  caller_phone_number: string;
  created_at: Date;
  updated_at: Date;

  // conversations
  started_at: Date;
  ended_at: Date;
  cost: number;
  intent: string;

  // payments
  total_amount_charged: number;
  payment_status: string;
}

export interface SessionCreateDto {
  caller_phone_number: string;
  session_type: SessionType;
  assistant_phone_number: string;
  session_status: StatusUpdateType;
  hotel_id?: string;
}
