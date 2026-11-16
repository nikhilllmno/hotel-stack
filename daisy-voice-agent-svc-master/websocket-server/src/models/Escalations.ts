import { EscalationStatus } from '../dtos/enum/EscalationStatus';
import { BaseModel } from './BaseModel';

export interface Escalation extends BaseModel {
  full_name: string;
  phone_number: string;
  message: string;
  hotel_id: string;
  status: EscalationStatus;
  session_id: string;
  external_message_id?: string;
  reminder_count?: number | null;
}
