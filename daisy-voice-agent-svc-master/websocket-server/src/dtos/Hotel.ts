import { ChatNotificationType } from '../services/notification/notificationType';
import { Country, PaymentProvider } from '../types/enums';

export interface Hotel {
  id: string;
  name: string;
  pms_provider: string;
  telegram_check_in_group_id: string;
  telegram_alerts_group_id: string;
  telegram_transcript_group_id?: string;
  notification_type?: ChatNotificationType;
  assistant_phone_number: string;
  business_id: string;
  country: Country;
  created_at: Date;
  updated_at: Date;
  timezone: string;
  sms_number: string;
  // hotel internal phone number is used to display to customer in SMS notifications
  internal_phone_number: string;
  url: string;
  address: string;
  image_url: string;
  currency: string;
  payment_provider: PaymentProvider;
}

export type CreateHotelRequest = Omit<
  Hotel,
  'id' | 'created_at' | 'updated_at'
>;
export type UpdateHotelRequest = Partial<CreateHotelRequest>;

export interface AdminUpdateHotelPhoneRequest {
  hotel_id: string;
  current_phone?: string | null;
  new_phone: string;
}
