import { ChatRoutingMode } from '../dtos/enum/ChatRoutingMode';
import { SessionType } from '../dtos/enum/SessionType';
import { SessionMetadata } from '../dtos/Session';
import { BaseModel } from './BaseModel';

export interface Session extends BaseModel {
  external_provider_id?: string;
  caller_phone_number: string;
  assistant_phone_number: string;
  session_status: string;
  session_type: SessionType;
  hotel_id: string;
  /** Latest conversation message activity (SMS inbox ordering, etc.) */
  last_messaged_at?: Date | null;
  /** Staff-facing: true when new guest message(s) may need attention */
  has_unread_messages?: boolean;
  metadata?: SessionMetadata | null;
  /** AI = AI agent handles replies; DIRECT = manager handles replies via SMS */
  chat_routing_mode?: ChatRoutingMode;
  /** When the routing mode was last changed; used for DIRECT-mode timeout */
  chat_routing_updated_at?: Date | null;
}
