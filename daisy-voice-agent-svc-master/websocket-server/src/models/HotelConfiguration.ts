import { GetRateResponse } from '../stayntouch/types/GetRateResponse';
import {
  CallForwardingConfiguration,
  CancellationPolicy,
  CheckInCheckOutConfiguration,
  CrossSellConfiguration,
  DiscountSettings,
  DoorLockConfig,
  EscalationReportConfiguration,
  FollowupPaymentLinkConfiguration,
  InitialDepositPolicy,
  LastDailyMessage,
  LengthOfStayDiscountPolicy,
  OnboardingSmsConfiguration,
  PaymentConfiguration,
  PetFeeConfiguration,
  PetPolicyConfiguration,
  RateCodeConfig,
  ReservationDatePolicy,
  SameDayBookingConfiguration,
  TermsAndPolicyConfig,
  ThreeDSConfig,
  TwilioConfiguration,
} from '../types/hotelConfiguration';
import { PlatformFeeSettings } from '../types/platformFeeSettings';

export interface HotelConfiguration {
  id: number;
  hotel_id: string;
  payment_configuration?: PaymentConfiguration | null;
  same_day_booking_configuration?: SameDayBookingConfiguration | null;
  reservation_date_policy?: ReservationDatePolicy | null;
  onboarding_sms_configuration?: OnboardingSmsConfiguration | null;
  last_daily_message?: LastDailyMessage | null;
  discount_settings?: DiscountSettings | null;
  cancellation_policy?: CancellationPolicy | null;
  platform_fee_settings?: PlatformFeeSettings | null;
  pet_fee_configuration?: PetFeeConfiguration | null;
  pet_policy_configuration?: PetPolicyConfiguration | null;
  sms_agent_enabled: boolean;
  terms_and_policy_config?: TermsAndPolicyConfig | null;
  length_of_stay_discount_policy?: LengthOfStayDiscountPolicy | null;
  initial_deposit_policy?: InitialDepositPolicy | null;
  check_in_check_out_configuration?: CheckInCheckOutConfiguration | null;
  negative_sentiment_followup_enabled: boolean;
  processing_fee_percentage?: number | null;
  rate_code_config?: RateCodeConfig | null;
  call_forwarding_configuration?: CallForwardingConfiguration | null;
  /** When true, managers can barge in (DIRECT routing mode). */
  enable_manager_barge_in?: boolean | null;
  /** Per-hotel override for DIRECT-mode expiry. Null/absent uses the global env default. */
  manager_routing_timeout_seconds?: number | null;
  /** Per-hotel n8n webhook URL for appending voice-agent SMS to the SMS agent transcript. */
  transcript_agent_url?: string | null;
  /** Per-hotel n8n webhook URL for routing manager replies (from Telegram) back to the guest. */
  escalation_agent_url?: string | null;
  escalation_report_configuration?: EscalationReportConfiguration | null;
  /** Addon IDs that do not block reservation modification. All other addon IDs will prevent modification. */
  addon_modification_allowlist?: number[] | null;
  hotel_rates?: GetRateResponse[] | null;
  followup_payment_link_configuration?: FollowupPaymentLinkConfiguration | null;
  /** Identifier marking Dextr as the booking source in the hotel's external PMS (e.g. Cloudbeds sourceID). */
  dextr_pms_source_id?: string | null;
  twilio_configuration?: TwilioConfiguration | null;
  /** Stripe connected account ID for hotels using Stripe Connect. */
  payment_account_id?: string | null;
  /** Per-hotel 3D Secure config for Shift4. Null column or `enabled: false` disables 3DS. */
  threeDS_config?: ThreeDSConfig | null;
  /** Door lock resolution config. Controls whether door codes come from Daisy or Alfred. */
  door_lock_config?: DoorLockConfig | null;
  /** Cross-sell config for hotel groups (e.g. Giri). Lists sister properties by distance for availability fallback. */
  cross_sell_configuration?: CrossSellConfiguration | null;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date | null;
}
