import { ChatNotificationType } from '../services/notification/notificationType';
import { RoomTypesResponse } from '../stayntouch/types/RoomTypesResponse';
import { Country, PaymentProvider } from '../types/enums';
import { BaseModel } from './BaseModel';

export interface Hotel extends BaseModel {
  name: string;
  business_id: string;
  pms_provider: string;
  assistant_phone_number: string;
  country: Country;
  timezone: string;
  telegram_check_in_group_id: string;
  telegram_alerts_group_id: string;
  telegram_transcript_group_id?: string;
  /** Chat provider the telegram_*_group_id columns refer to; Telegram when absent */
  notification_type?: ChatNotificationType;
  sms_number: string;
  // hotel internal phone number is used to display to customer in SMS notifications
  internal_phone_number: string;
  url: string;
  address: string;
  image_url: string;
  currency: string;
  payment_provider: PaymentProvider;
  room_types?: RoomTypesResponse | null;
  deleted_at?: Date | null;
}
