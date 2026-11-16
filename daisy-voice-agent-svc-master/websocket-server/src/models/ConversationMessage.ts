import { ConversationMessageRole } from '../dtos/enum/ConversationMessageRole';
import { BaseModel } from './BaseModel';
import { ToolCall } from './request/EndOfCallReport';

export interface ConversationMessage extends BaseModel {
  conversation_id: string;
  role: ConversationMessageRole;
  message?: string;
  tool_calls?: ToolCall[];
  tool_call_results?: any;
  tool_call_name?: string;
  timestamp: Date;
}

export interface DebugConversationMessage extends ConversationMessage {
  phone_number: string;
  hotel_id: string;
}
