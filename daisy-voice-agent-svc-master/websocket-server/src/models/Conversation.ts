import { BaseModel } from './BaseModel';
import { ConversationMessage } from './ConversationMessage';
import { Call, CostBreakdown } from './request/EndOfCallReport';

export interface Conversation extends BaseModel {
  phone_number: string;
  hotel_id: string;
  started_at: Date;
  ended_at?: Date;
  cost?: number;
  recording_url?: string;
  summary?: string;
  metadata?: Call;
  cost_details?: CostBreakdown;
  intent?: string;
  conversation_session_id?: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: Omit<
    ConversationMessage,
    'id' | 'conversation_id' | 'created_at' | 'updated_at'
  >[];
}
