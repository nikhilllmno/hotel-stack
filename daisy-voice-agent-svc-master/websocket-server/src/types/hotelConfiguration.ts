/**
 * Payment configuration types for hotels
 */

import { AuthorizeNetConfig } from '../authorizeNet/types';
import { CloudbedsPaymentSdkConfig } from '../cloudbeds/types';
import { DiscountType } from './discount';
import { PetFeeStrategyType } from './petFeeStrategy';
import { PlatformFeeSettings } from './platformFeeSettings';

export interface PaymentConfiguration {
  /**
   * Number of days before check-in when auto-charge should occur
   * @example 1 - Auto-charge 1 day before check-in
   */
  auto_charge_days_before?: number | null;

  /**
   * Time of day when auto-charge should occur (24-hour format HH:MM:SS)
   * @example "18:00:00" - Auto-charge at 6:00 PM
   */
  auto_charge_time?: string | null;

  /**
   * Max number of retry attempts for Shift4 auto-charge before giving up.
   * Cron runs every 5 minutes, so 3 retries ≈ 15 minutes of attempts.
   * @default 3
   */
  auto_charge_max_retries?: number | null;

  /**
   * Cloudbeds SDK hotels only: charge each room's Cloudbeds balance to the
   * guest's card as soon as the card is attached, instead of leaving the
   * charge to the hotel. Off (null/false) keeps the card-only capture.
   */
  charge_at_booking?: boolean | null;
}

/**
 * Per-hotel 3D Secure (3DS) configuration. Applies to Shift4 card
 * authorizations only. A null column or `enabled: false` disables 3DS.
 */
export interface ThreeDSConfig {
  enabled: boolean;
}

export interface SameDayBookingConfiguration {
  cutoff_time: string; // should be in HH:MM format. This check should happen before all other checks
  allow_same_day_checkin: boolean; // if false, do not allow same-day bookings
  transfer_to_manager_for_same_day: boolean; // if true, and if same-day bookings are allowed, transfer same-day bookings to manager
}

export interface RoomConfig {
  room_number: string;
  door_code: string;
}

export interface CheckInCheckOutConfiguration {
  check_in: string; // HH:MM format, e.g., "15:00"
  check_out: string; // HH:MM format, e.g., "11:00"
}

export interface OnboardingSmsConfiguration {
  enabled: boolean;
  message_template: string;
  days_before_check_in?: number; // Number of days before check-in to send SMS (default: 1)
  check_in_time?: string;
  check_out_time?: string;
  contact_phone?: string;
  urgent_contact_phone?: string;
  room_config: Record<string, RoomConfig>; // Maps unit_group_id to room details
}

export interface LastDailyMessage {
  message_id: number | string;
  date: string; // YYYY-MM-DD format in hotel's timezone
}

export interface DiscountSettings {
  expiry_days: number;
  note: string;
  discount_type: DiscountType;
  discount_value: number;
}

export interface CancellationPolicy {
  cancellation_deadline_days: number;
}

/**
 * Policy when reservation check-in is beyond the configured date offset (e.g. 6 months out).
 * - ESCALATE_TO_MANAGER: do not check availability; ask guest to contact manager.
 * - NOT_ALLOWED: do not allow; reservation is not possible.
 */
export enum ReservationDatePolicyType {
  ESCALATE_TO_MANAGER = 'escalate_to_manager',
  NOT_ALLOWED = 'not_allowed',
}

/**
 * Reservation-by-date policy: block or escalate bookings when check-in is more than
 * date_offset_days in the future (e.g. 180 = 6 months). Skip availability check and
 * return a clear error so a manager request can be created.
 */
export interface ReservationDatePolicy {
  /** Max days from today that the system will handle; beyond this, policy applies. e.g. 180 = 6 months. */
  date_offset_days: number;
  /** What to do when check-in is beyond date_offset_days. */
  reservation_policy: ReservationDatePolicyType;
}

/**
 * Hotel configuration metadata for terms & conditions and policy signature.
 * Used for review-payment flow: terms to display and whether guest must sign.
 */
export interface TermsAndPolicyConfig {
  terms_and_conditions?: string[];
  enable_policy_signature?: boolean;
}

export interface LengthOfStayDiscountRule {
  /**
   * Room types this rule applies to. Omitted or empty array = all room types.
   * @example [101, 102]
   */
  unit_group_ids?: number[];

  /**
   * Minimum guest count (inclusive) for this rule to apply.
   * Omitted = no lower bound.
   * @example 1
   */
  min_occupancy?: number;

  /**
   * Maximum guest count (inclusive) for this rule to apply.
   * Omit or set to null for an open-ended upper bound (e.g. 3+ guests).
   * @example 2
   */
  max_occupancy?: number | null;

  /**
   * Minimum number of nights (inclusive) for this rule to apply.
   * @example 2
   */
  min_nights: number;

  /**
   * Maximum number of nights (inclusive) for this rule to apply.
   * Omit or set to null for an open-ended upper bound (e.g. 15+ nights).
   * @example 14
   */
  max_nights: number | null;

  /**
   * Whether the discount_value is a flat amount or a percentage of the total.
   */
  discount_type: DiscountType;

  /**
   * The discount amount. Interpreted as a percentage (0–100) when discount_type
   * is PERCENTAGE, or as a flat monetary value when discount_type is FLAT.
   * @example 10
   */
  discount_value: number;
}

/**
 * Length-of-stay discount policy. Rules are evaluated in order and the first
 * matching rule is applied to the reservation total. Each rule can optionally
 * be scoped by unit_group_ids and occupancy range in addition to night count.
 */
export interface LengthOfStayDiscountPolicy {
  enabled: boolean;
  rules: LengthOfStayDiscountRule[];
}

/**
 * Deposit type for initial amount to collect.
 * - FIRST_NIGHT_PLUS_TAX: charge first night rate + proportional tax (e.g. for 1–2 night stays).
 * - FIRST_NIGHT_PLUS_TAX_PLUS_FEE: charge first night rate + tax + fees.
 * - PERCENTAGE: charge a percentage of the total (e.g. 50 means 50%).
 * - FLAT: charge a fixed flat amount.
 */
export enum DepositType {
  FIRST_NIGHT_PLUS_TAX = 'first_night_plus_tax',
  FIRST_NIGHT_PLUS_TAX_PLUS_FEE = 'first_night_plus_tax_plus_fee',
  PERCENTAGE = 'percentage',
  FLAT = 'flat',
}

/**
 * One tier of the initial deposit policy. First matching tier by night count is applied.
 */
export interface InitialDepositTier {
  /** Minimum nights (inclusive) for this tier. */
  min_nights: number;
  /** Maximum nights (inclusive). Omit or null = open-ended (e.g. 3+). */
  max_nights?: number | null;
  /** How to compute the initial amount. */
  deposit_type: DepositType;
  /**
   * Numeric value used by the deposit_type:
   * - PERCENTAGE: percentage of total_amount to collect (e.g. 50 = 50%).
   * - FLAT: fixed amount to collect in the hotel's currency.
   */
  value?: number;
}

/**
 * Initial deposit policy: how much to collect upfront based on length of stay.
 * Tiers are evaluated in order; first matching tier sets amountCharged.
 */
export interface InitialDepositPolicy {
  enabled: boolean;
  tiers: InitialDepositTier[];
}

/**
 * Returns true when the matching deposit tier for the given stay length
 * would collect the full reservation amount upfront (PERCENTAGE 100).
 * Used to decide between immediate charge vs autocharge on modification.
 */
export function isFullPaymentPolicy(
  policy: InitialDepositPolicy | null | undefined,
  nights: number,
): boolean {
  if (!policy?.enabled || !policy.tiers?.length) return false;
  const matched = policy.tiers.find((t) => {
    const meetsMin = nights >= t.min_nights;
    const meetsMax = t.max_nights == null || nights <= t.max_nights;
    return meetsMin && meetsMax;
  });
  if (!matched) return false;
  return (
    matched.deposit_type === DepositType.PERCENTAGE && matched.value === 100
  );
}

/**
 * PMS rate code configuration for a hotel.
 * - allowed: rate codes (uppercase) that are surfaced to the agent / allowed for booking.
 *   Other rate codes returned by the PMS are ignored to reduce information overflow.
 * - full_deposit: rate codes (uppercase) for which the full reservation amount must be
 *   collected upfront as the initial deposit (e.g. advance-purchase rates like ADVP on
 *   Stayntouch). Bypasses the hotel's tiered initial_deposit_policy.
 */
export interface RateCodeConfig {
  allowed: string[];
  full_deposit?: string[];
}

export interface CallForwardingTimeRange {
  start: string; // "HH:MM" 24h format in hotel timezone
  end: string; // "HH:MM" 24h format; if end < start, range spans midnight
}

export interface CallForwardingRuleConditions {
  days_of_week?: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
  specific_dates?: string[]; // ISO date strings: "2025-12-25"
  time_range?: CallForwardingTimeRange;
}

export interface CallForwardingRule {
  id: string; // UUID for management via API
  priority: number; // higher number = higher precedence
  phone_number: string; // E.164 format
  label?: string; // e.g. "Weekend Night Manager"
  conditions: CallForwardingRuleConditions;
  enabled: boolean;
}

export interface CallForwardingConfiguration {
  enabled: boolean;
  default_phone_number: string; // fallback when no rule matches (E.164)
  rules: CallForwardingRule[];
}

/**
 * Door lock configuration: controls where door codes are resolved from.
 * - DAISY: resolve directly within Daisy (PMS-specific logic).
 * - ALFRED: use existing Alfred door code path.
 */
export enum DoorLockSourceOfTruth {
  DAISY = 'daisy',
  ALFRED = 'alfred',
}

export enum LockboxLogProvider {
  /** The hotel's own Excel workbook, shared from their Dropbox with Dextr's Dropbox account. */
  DROPBOX_EXCEL = 'dropbox_excel',
}

/** What `POST /daisy/lockbox-code` does for a reservation that still owes a balance. */
export enum LockboxBalancePolicy {
  /** No code (`balance_due`): staff collect the balance first. The default. */
  REFUSE = 'refuse',
  /** The code anyway: staff collect the balance later, as the box's NOTES can tell the guest. */
  ALLOW_WITH_NOTE = 'allow_with_note',
}

/**
 * Where a hotel keeps its lockbox assignment log, read by
 * `POST /daisy/lockbox-code` for a reservation it first checks live in the
 * hotel's PMS (Cloudbeds hotels only). Workbook layout, reservation check,
 * matching and date rules: README/lockbox/dropbox-excel-lockbox.md.
 */
export interface LockboxLogConfig {
  provider: LockboxLogProvider;
  /** Dropbox shared link to the workbook, exactly as Dropbox issued it. */
  shared_link: string;
}

/** `door_lock_config.room_number_overrides`: rooms per hotel, and name / room-number lengths. */
export const ROOM_NUMBER_OVERRIDES_MAX = 200;
export const ROOM_NUMBER_OVERRIDE_NAME_MAX = 100;
export const ROOM_NUMBER_OVERRIDE_VALUE_MAX = 20;

export interface DoorLockConfig {
  source_of_truth?: DoorLockSourceOfTruth;
  /** Shortcode of the Cloudbeds custom field that holds the door lock code (legacy/RemoteLock path). */
  door_lock_custom_field?: string;
  lockbox_log?: LockboxLogConfig | null;
  /**
   * PMS room name → the room number staff write in the lockbox log, for rooms
   * whose name doesn't end in that number (The Marlo's "Freya Accessible King
   * Retreat" is room 19). Names match after trimming, ignoring case. Read by
   * `POST /daisy/lockbox-code` only: README/lockbox/dropbox-excel-lockbox.md.
   */
  room_number_overrides?: Record<string, string> | null;
  /** Read by `POST /daisy/lockbox-code` only. Missing, null or unknown: `refuse`. */
  lockbox_balance_policy?: LockboxBalancePolicy | null;
}

export interface EscalationReportConfiguration {
  period_hours: number; // look-back window for open escalations in report
  reporting_time: string; // "HH:mm" in hotel local timezone, e.g. "19:00"
  cron_window_minutes: number; // Lambda cadence — must match EventBridge schedule (e.g. 15 or 30)
  reminder_delay_minutes: number; // min gap between reminders per escalation; should be >= cron_window_minutes
  reminder_resend_count: number; // max number of reminders per escalation
  allowed_emojis: string[]; // emojis that mark an escalation as DONE, e.g. ["👍", "✅"]
}

export interface HotelConfigurationTypes {
  payment_configuration?: PaymentConfiguration | null;
  same_day_booking_configuration?: SameDayBookingConfiguration | null;
  reservation_date_policy?: ReservationDatePolicy | null;
  room_config?: RoomConfig | null;
  onboarding_sms_configuration?: OnboardingSmsConfiguration | null;
  last_daily_message?: LastDailyMessage | null;
  discount_settings?: DiscountSettings | null;
  cancellation_policy?: CancellationPolicy | null;
  platform_fee_settings?: PlatformFeeSettings | null;
  sms_agent_enabled?: boolean | null;
  negative_sentiment_followup_enabled?: boolean | null;
  length_of_stay_discount_policy?: LengthOfStayDiscountPolicy | null;
  initial_deposit_policy?: InitialDepositPolicy | null;
  terms_and_policy_config?: TermsAndPolicyConfig | null;
}

export type ThresholdOccupancyMode = 'requested' | 'default';

export interface FollowupPaymentLinkConfiguration {
  enabled: boolean;
  threshold_check_enabled: boolean;
  min_available_rooms_threshold: number;
  threshold_occupancy_mode: ThresholdOccupancyMode;
}

export interface PetFeeRoomTypeRule {
  room_type_ids: string[];
  strategy: PetFeeStrategyType;
  fee_amount: number;
  max_pets_per_room?: number;
}

export interface PetFeeConfiguration {
  strategy: PetFeeStrategyType;
  fee_amount: number;
  max_pets_per_room?: number;
  discounted_fee_amount?: number;
  discounted_unit_group_ids?: number[];
  room_type_overrides?: PetFeeRoomTypeRule[];
  mews_pet_product_id?: string;
}

/**
 * Pet policy configuration for a hotel.
 * Stores the list of unit group IDs that explicitly allow pets.
 * Any unit group ID not in this list is treated as not pet-friendly.
 *
 * Used to filter availability results: when num_pets > 0, only rooms
 * whose unit_group_id appears in pet_friendly_unit_group_ids are returned.
 */
export interface PetPolicyConfiguration {
  pet_friendly_unit_group_ids: number[];
}

export interface TwilioConfiguration {
  twilioAccountSid: string;
  twilioAuthToken: string;
}

/**
 * `hotel_configurations.external_auth_config` — service credentials for a hotel.
 * Contains PMS credentials (apiToken) and optionally payment provider credentials
 * nested under service-specific keys (e.g. `authorizeNet`).
 *
 * `apiToken` is AES-256-GCM encrypted (iv:authTag:ciphertext hex) — never
 * stored or read as plaintext. `disabledAt` is not sensitive and stays
 * plain; only Cloudbeds sets it today (integration/appstate_changed).
 *
 * The `remotelock_*` tokens are a separate credential from `apiToken`: they
 * authorize Daisy against the hotel's own RemoteLock account, independently of
 * whichever PMS `apiToken` belongs to. Both are AES-256-GCM encrypted. They are
 * seeded by hand after a hotel authorizes Daisy from the RemoteLock
 * marketplace — that callback has no way to identify the hotel, so it only logs
 * the token pair (see `RemoteLockOAuthService`).
 *
 * `integrationAccountId` is Calry-only: Calry routes a call to the right
 * upstream PMS connection by header, so the token alone does not identify
 * the hotel. Not a secret, so it stays plain.
 * `oauth_client_id` / `oauth_client_secret` hold per-hotel OAuth Application
 * credentials (e.g. Stayntouch `client_credentials` grant). Both AES-256-GCM
 * encrypted. Which provider they belong to is determined by `hotels.pms_provider`,
 * so the fields are provider-agnostic — reusable for any future OAuth PMS.
 */
export interface ExternalAuthConfig {
  apiToken?: string;
  disabledAt?: string | null;
  authorizeNet?: AuthorizeNetConfig;
  remotelock_access_token?: string;
  remotelock_refresh_token?: string;
  integrationAccountId?: string;
  /**
   * Opera-backed Calry hotels only. Calry's unified availability and quote
   * endpoints do not work for Opera/OHIP, so those two reads go straight to
   * Opera through Calry's passthrough — which needs the property's own OHIP
   * host and property code. Neither is a secret.
   */
  operaHost?: string;
  operaPropertyCode?: string;
  /**
   * Calry room type id → Opera room type code. Calry reports Opera *rooms*
   * as room types (`1000`, `1001`, …) while every Opera availability and
   * rate call is keyed by room type code (`ECO`, `DEL`), and no Calry field
   * carries the code. Without an entry here the code is inferred from the
   * room description, which is only reliable when descriptions are distinct.
   */
  operaRoomTypeMap?: Record<string, string>;
  /**
   * Cashier Opera posts payments as. Opera rejects a cashiering post without
   * one, and the cashier must be open for the property's business date.
   */
  operaCashierId?: number;
  /**
   * Opera payment method code used when the money was collected outside Opera
   * (Stripe or Shift4) and the folio is only being told about it. Must be a
   * non-card method, otherwise Opera tries to settle it through OPI a second
   * time. Read from `GET /lov/v1/listOfValues/hotels/{id}/paymentMethods`.
   */
  operaExternalPaymentMethodCode?: string;
  /**
   * Opera payment method code for a card Opera settles itself through OPI.
   * Falls back to the card type returned by token exchange.
   */
  operaCardPaymentMethodCode?: string;
  /** Folio window payments are posted to. Defaults to `1`. */
  operaFolioWindowNo?: string;
  /** Transaction code used for the reversal posting that records a refund. */
  /**
   * Codes stamped on a reservation Daisy creates on Opera. All property
   * configuration, so each is omitted from the payload when unset rather than
   * defaulted to a code that may not exist on the property.
   */
  operaMarketCode?: string;
  operaSourceCode?: string;
  operaGuaranteeCode?: string;
  /**
   * Cancellation reason code. Opera refuses a cancellation without one
   * (`OPERAWS-RSV11046`); `CXL` is Oracle's common default but the valid codes
   * are per-property.
   */
  operaCancellationReasonCode?: string;
  oauth_client_id?: string;
  oauth_client_secret?: string;
  cloudbedsPaymentSdk?: CloudbedsPaymentSdkConfig;
}

export interface SisterProperty {
  /** Daisy `hotels.id` of the sister hotel. */
  hotel_id: string;
  /** Name the agent says, e.g. "The Haven Hotel". */
  name: string;
  distance_miles?: number;
  /** Guest-facing phone number for call transfer (may differ from the hotel's VAPI assistant_phone_number). */
  phone_number?: string;
  /** Website the agent gives the guest. Defaults to the sister hotel's `hotels.url`. */
  website?: string;
}

export interface CrossSellConfiguration {
  enabled: boolean;
  /** In the order the agent should offer them (nearest first). */
  sister_properties: SisterProperty[];
  /**
   * true: check every sister hotel at once, each with `timeout_ms`, and return
   * all of them. Missing or false: the original check, one sister hotel at a
   * time, stopping at the first with a room (what Giri was built on).
   */
  check_all_sister_properties?: boolean;
  /** Time limit for each sister hotel's PMS availability check, with `check_all_sister_properties` only. Default {@link DEFAULT_SISTER_PROPERTY_TIMEOUT_MS}. */
  timeout_ms?: number;
}

export const DEFAULT_SISTER_PROPERTY_TIMEOUT_MS = 8000;
export const MIN_SISTER_PROPERTY_TIMEOUT_MS = 1000;
export const MAX_SISTER_PROPERTY_TIMEOUT_MS = 15000;
export const MAX_SISTER_PROPERTIES = 10;

export { type AuthorizeNetConfig } from '../authorizeNet/types';
export { type CloudbedsPaymentSdkConfig } from '../cloudbeds/types';
