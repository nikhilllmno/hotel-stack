import { ToolCall } from '../models/request/EndOfCallReport';
import { ConversationMessageRole } from './enum/ConversationMessageRole';

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: ConversationMessageRole;
  message?: string;
  tool_calls?: ToolCall[];
  tool_call_name?: string;
  tool_call_results?: any;
  timestamp: Date;
  created_at: Date;
  updated_at: Date;
}

export interface TranscriptQueryMetadata {
  startTime?: Date;
  endTime?: Date;
}
