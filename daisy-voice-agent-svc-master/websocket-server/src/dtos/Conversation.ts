import { Call, CostBreakdown } from '../models/request/EndOfCallReport';

export interface Conversation {
  id: string;
  phone_number: string;
  started_at: Date;
  ended_at?: Date;
  cost?: number;
  recording_url?: string;
  summary?: string;
  metadata?: Call;
  cost_details?: CostBreakdown;
  conversation_session_id?: string;
  created_at: Date;
  updated_at: Date;
}
