import dotenv from 'dotenv';

// Jest sets NODE_ENV=test before any module loads, so this reliably keeps
// tests off the developer's real .env (secrets, real hotel/PMS config).
// `override: true` in test mode so .env.test wins even if a real secret is
// already exported in the shell/CI environment.
const isTest = process.env.NODE_ENV === 'test';
if (isTest) {
  dotenv.config({ path: '.env.test', override: true });
} else {
  dotenv.config();
}

function trimEnv(key: string): string | undefined {
  const v = process.env[key];
  if (v === undefined || v === null) return undefined;
  const t = String(v).trim();
  return t === '' ? undefined : t;
}

/** Splits a comma-separated env value into trimmed, non-empty entries. */
function parseCsvKeys(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

/**
 * `DAISY_JWT_PRIVATE_KEY_PEM` may be raw PEM or base64 of the PEM (common in secret stores).
 * If the value does not look like PEM, it is decoded from base64.
 */
function resolveDaisyJwtPrivateKeyPem(
  raw: string | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trim();
  if (t === '') return undefined;
  if (t.includes('-----BEGIN')) return t;
  return Buffer.from(t, 'base64').toString('utf8').trim();
}

// Validate required Stayntouch environment variables
function validateStayntouchConfig(): void {
  if (process.env.STAYNTOUCH_BASE_URL) {
    const missingVars: string[] = [];

    if (!process.env.STAYNTOUCH_BASE_URL?.trim()) {
      missingVars.push('STAYNTOUCH_BASE_URL');
    }

    if (!process.env.STAYNTOUCH_AUTH_URL?.trim()) {
      missingVars.push('STAYNTOUCH_AUTH_URL');
    }

    if (missingVars.length > 0) {
      console.warn(
        `Stayntouch configuration incomplete. Missing or empty: ${missingVars.join(', ')}`,
      );
    }
  }
}

// Validate required RemoteLock environment variables
// function validateRemoteLockConfig(): void {
//   // Any RemoteLock variable being set means the integration is meant to be on,
//   // so gate on all of them — gating on one alone hides the case where that one
//   // is the variable an operator forgot.
//   const remoteLockConfigured = [
//     process.env.REMOTELOCK_API_URL,
//     process.env.REMOTELOCK_AUTH_URL,
//     process.env.REMOTELOCK_CLIENT_ID,
//     process.env.REMOTELOCK_CLIENT_SECRET,
//     process.env.REMOTELOCK_OAUTH_REDIRECT_URI,
//   ].some((value) => value?.trim());

//   if (remoteLockConfigured) {
//     const missingVars: string[] = [];

//     if (!process.env.REMOTELOCK_API_URL?.trim()) {
//       missingVars.push('REMOTELOCK_API_URL');
//     }

//     if (!process.env.REMOTELOCK_AUTH_URL?.trim()) {
//       missingVars.push('REMOTELOCK_AUTH_URL');
//     }

//     if (!process.env.REMOTELOCK_CLIENT_ID?.trim()) {
//       missingVars.push('REMOTELOCK_CLIENT_ID');
//     }

//     if (!process.env.REMOTELOCK_CLIENT_SECRET?.trim()) {
//       missingVars.push('REMOTELOCK_CLIENT_SECRET');
//     }

//     if (!process.env.REMOTELOCK_OAUTH_REDIRECT_URI?.trim()) {
//       missingVars.push('REMOTELOCK_OAUTH_REDIRECT_URI');
//     }

//     if (missingVars.length > 0) {
//       console.warn(
//         `RemoteLock configuration incomplete. Missing or empty: ${missingVars.join(', ')}`,
//       );
//     }
//   }
// }

validateStayntouchConfig();
// validateRemoteLockConfig();

const config = {
  HOST: process.env.HOST,
  PORT: parseInt(process.env.PORT || '', 10),
  PUBLIC_URL: process.env.PUBLIC_URL || '',
  SECURE_URL: process.env.SECURE_URL || '',

  // DEPRECATED / TRANSITIONAL: hotel_configurations.twilio_configuration
  // now replaces HOTEL_TWILIO_CONFIG. Kept only so the backfill migration
  // (146_migrate_twilio_configuration_to_db) can seed the table. Safe to remove once
  // the table is the source of truth.
  HOTEL_TWILIO_CONFIG: JSON.parse(process.env.HOTEL_TWILIO_CONFIG || '{}'),
  HOTELS_WHERE_SAME_DAY_CHECKIN_SHOULD_BE_HANDLED_BY_MANAGER: (
    process.env.HOTELS_WHERE_SAME_DAY_CHECKIN_SHOULD_BE_HANDLED_BY_MANAGER || ''
  )
    .split(',')
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id)),
  HOTEL_MULTIPLE_PHONE_NUMBER_CONFIG: JSON.parse(
    process.env.HOTEL_MULTIPLE_PHONE_NUMBER_CONFIG || '{}',
  ),
  HOTEL_SHIFT4_CONFIG: JSON.parse(process.env.HOTEL_SHIFT4_CONFIG || '{}'),

  // TODO: Remove PET_POLICY_FILTER_ENABLED once all hotels have pet_policy_configuration seeded.
  // When true, hotels with no pet_policy_configuration will return an error for pet requests.
  // Keep false until pet_policy_configuration is seeded for all hotels, then remove this flag.
  PET_POLICY_FILTER_ENABLED: process.env.PET_POLICY_FILTER_ENABLED === 'true',

  // When true, createReservation sends cardToken/paymentAuthorizationCode and
  // paymentMethod: 'credit' to Cloudbeds. Keep false until rollout is confirmed,
  // then remove this flag.
  CLOUDBEDS_CARD_TOKEN_ENABLED:
    process.env.CLOUDBEDS_CARD_TOKEN_ENABLED === 'true',

  CAVE_SPRINGS_ID: process.env.CAVE_SPRINGS_ID,
  CAVE_SPRINGS_PER_ROOM_PET_CAPACITY: parseInt(
    process.env.CAVE_SPRINGS_PER_ROOM_PET_CAPACITY || '2',
    10,
  ),
  CAVE_SPRINGS_PET_FEE_PER_NIGHT: parseFloat(
    process.env.CAVE_SPRINGS_PET_FEE_PER_NIGHT || '25',
  ),
  SPRINGS_MOTEL_ID:
    process.env.SPRINGS_MOTEL_ID || '2d7758d4-57f8-4ffe-aaa1-16f85ef09df4', // Hotel ID of the Springs Motel
  SPRINGS_MOTEL_FLAT_FEE: parseFloat(
    process.env.SPRINGS_MOTEL_FLAT_FEE || '50',
  ),
  ASHLEY_ROSE_ID: process.env.ASHLEY_ROSE_ID,
  ASHLEY_ROSE_PER_ROOM_PET_CAPACITY: parseInt(
    process.env.ASHLEY_ROSE_PER_ROOM_PET_CAPACITY || '2',
    10,
  ),
  ASHLEY_ROSE_FLAT_FEE: parseFloat(process.env.ASHLEY_ROSE_FLAT_FEE || '150'),
  LOS_RIOS_ID:
    process.env.LOS_RIOS_ID || '8b1c2997-59c0-4855-82de-9315b285e6a1',
  LOS_RIOS_PER_ROOM_PET_CAPACITY: parseInt(
    process.env.LOS_RIOS_PER_ROOM_PET_CAPACITY || '2',
    10,
  ),
  LOS_RIOS_PET_FEE_PER_NIGHT: parseFloat(
    process.env.LOS_RIOS_PET_FEE_PER_NIGHT || '15',
  ),
  LOS_RIOS_DISCOUNTED_PET_FEE_PER_NIGHT: parseFloat(
    process.env.LOS_RIOS_DISCOUNTED_PET_FEE_PER_NIGHT || '5',
  ),
  LOS_RIOS_DISCOUNTED_UNIT_GROUP_IDS: (
    process.env.LOS_RIOS_DISCOUNTED_UNIT_GROUP_IDS ??
    '18150,18151,18152,18153,18154,18155,18156,18157,18158,18159,18160,18161,18162,18163'
  )
    .split(',')
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id)),
  CAPE_COLLECTION_HOTEL_IDS: process.env.CAPE_COLLECTION_HOTEL_IDS
    ? process.env.CAPE_COLLECTION_HOTEL_IDS.split(',')
    : [],
  CAPE_COLLECTION_EXTERNAL_PHONE_NUMBER:
    process.env.CAPE_COLLECTION_EXTERNAL_PHONE_NUMBER,
  VISTA_VERDE_ID: process.env.VISTA_VERDE_ID,
  SHERIDAN_LAKE_RESORT_ID: process.env.SHERIDAN_LAKE_RESORT_ID,
  PROSPECTOR_INN_ID: process.env.PROSPECTOR_INN_ID,

  VINEYARD_HOTEL_ID: process.env.VINEYARD_HOTEL_ID,
  VINEYARD_ZERO_DEPOSIT_CONFIG: (() => {
    const raw = process.env.VINEYARD_ZERO_DEPOSIT_CONFIG;
    if (!raw) return {} as Record<string, string[]>;
    try {
      return JSON.parse(raw) as Record<string, string[]>;
    } catch {
      return {} as Record<string, string[]>;
    }
  })(),

  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  DATABASE_URL: process.env.DATABASE_URL || '',
  API_TIMEOUT: parseInt(process.env.API_TIMEOUT || '30000', 10) || 30000,
  // How long a card submission holds its rooms while booking them in the PMS.
  // Assumes the multi-room cap (6-7 rooms), each create bounded by API_TIMEOUT.
  PMS_BOOKING_CLAIM_TTL_MINUTES:
    parseInt(process.env.PMS_BOOKING_CLAIM_TTL_MINUTES || '5', 10) || 5,

  // ResNexus
  RESNEXUS_BASE_URL:
    process.env.RESNEXUS_BASE_URL ||
    'https://www.availabilityexchange.com/gateway',
  RESNEXUS_USERNAME: process.env.RESNEXUS_USERNAME || '',
  RESNEXUS_PASSWORD: process.env.RESNEXUS_PASSWORD || '',

  RESNEXUS_AVAILABILITY_EVALUATE_1_RESPONSE: JSON.parse(
    process.env.RESNEXUS_AVAILABILITY_EVALUATE_1_RESPONSE || '{}',
  ),
  RESNEXUS_AVAILABILITY_EVALUATE_2_RESPONSE: JSON.parse(
    process.env.RESNEXUS_AVAILABILITY_EVALUATE_2_RESPONSE || '{}',
  ),
  RESNEXUS_AVAILABILITY_ATTEST_1_RESPONSE: JSON.parse(
    process.env.RESNEXUS_AVAILABILITY_ATTEST_1_RESPONSE || '{}',
  ),
  RESNEXUS_AVAILABILITY_ATTEST_2_RESPONSE: JSON.parse(
    process.env.RESNEXUS_AVAILABILITY_ATTEST_2_RESPONSE || '{}',
  ),
  RESNEXUS_QUOTE_EVALUATE_1_RESPONSE: JSON.parse(
    process.env.RESNEXUS_QUOTE_EVALUATE_1_RESPONSE || '{}',
  ),
  RESNEXUS_QUOTE_EVALUATE_2_RESPONSE: JSON.parse(
    process.env.RESNEXUS_QUOTE_EVALUATE_2_RESPONSE || '{}',
  ),
  RESNEXUS_QUOTE_ATTEST_1_RESPONSE: JSON.parse(
    process.env.RESNEXUS_QUOTE_ATTEST_1_RESPONSE || '{}',
  ),
  RESNEXUS_QUOTE_ATTEST_2_RESPONSE: JSON.parse(
    process.env.RESNEXUS_QUOTE_ATTEST_2_RESPONSE || '{}',
  ),
  RESNEXUS_TEST_MODE: process.env.RESNEXUS_TEST_MODE,
  RESNEXUS_TEST_BUSINESS_ID: parseInt(
    process.env.RESNEXUS_TEST_BUSINESS_ID || '16609',
    10,
  ),

  // Alfred
  ALFRED_API_BASE_URL: process.env.ALFRED_API_BASE_URL || '',
  ALFRED_API_KEY: process.env.ALFRED_API_KEY || '',

  // Support-ops
  SUPPORT_OPS_API_KEY: process.env.SUPPORT_OPS_API_KEY || '',

  REVIEW_TIMEOUT: parseInt(process.env.PAYMENT_TIMEOUT || '90', 10) || 90,
  PAYMENT_AGE_THRESHOLD:
    parseInt(process.env.PAYMENT_AGE_THRESHOLD || '30', 10) || 30,
  PAYMENT_REMINDER_NOTIFICATION_LIMIT:
    parseInt(process.env.PAYMENT_REMINDER_NOTIFICATION_LIMIT || '3', 10) || 3,

  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
  STRIPE_PAYMENT_LINK_URL: process.env.STRIPE_PAYMENT_LINK_URL || '',
  STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET:
    process.env.STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET || '',
  // DEPRECATED / TRANSITIONAL: connected account IDs now live on
  // hotel_configurations.payment_account_id. Kept only so the backfill migration
  // (144_migrate_payment_account_id_to_db) can seed the table. Safe to remove once
  // the table is the source of truth.
  HOTEL_STRIPE_CONNECTED_ACCOUNT_ID_CONFIG: JSON.parse(
    process.env.HOTEL_STRIPE_CONNECTED_ACCOUNT_ID_CONFIG || '{}',
  ),

  // Shift4
  SHIFT4_ACCESS_URL: process.env.SHIFT4_ACCESS_URL || '',
  SHIFT4_BASE_URL: process.env.SHIFT4_BASE_URL || '',
  SHIFT4_INTERFACE_VERSION: process.env.SHIFT4_INTERFACE_VERSION || '4.0',
  SHIFT4_INTERFACE_NAME: process.env.SHIFT4_INTERFACE_NAME || 'Dextr',
  SHIFT4_COMPANY_NAME: process.env.SHIFT4_COMPANY_NAME || 'Dextr',
  SHIFT4_CLIENT_GUID: process.env.SHIFT4_CLIENT_GUID || '',
  SHIFT4_GLOBAL_TIMER_MS:
    parseInt(process.env.SHIFT4_GLOBAL_TIMER_MS || '65000', 10) || 65000,
  SHIFT4_INVOICE_LOOKUP_DELAY_MS:
    parseInt(process.env.SHIFT4_INVOICE_LOOKUP_DELAY_MS || '3000', 10) || 3000,

  // Slack (incoming webhook), single shared alerts channel — used by the DB
  // activity monitor and the paid-reservation/PMS-mismatch job, among others.
  SLACK_DAISY_ALERT_WEBHOOK_URL:
    process.env.SLACK_DAISY_ALERT_WEBHOOK_URL || '',

  // Telegram Service
  TELEGRAM_BOT_TOKEN_PREFIX: process.env.TELEGRAM_BOT_TOKEN_PREFIX || '',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET || '',
  TELEGRAM_TRANSCRIPTS_GROUP_ID: process.env.TELEGRAM_TRANSCRIPTS_GROUP_ID,

  // Microsoft Teams (single-tenant Azure Bot + Entra app owned by Daisy)
  TEAMS_BOT_APP_ID: process.env.TEAMS_BOT_APP_ID || '',
  TEAMS_BOT_APP_PASSWORD: process.env.TEAMS_BOT_APP_PASSWORD || '',
  TEAMS_BOT_TENANT_ID: process.env.TEAMS_BOT_TENANT_ID || '',

  // Escalation instruction: per-hotel JSON map keyed by hotel ID.
  // ESCALATION_INSTRUCTION_CONFIG={"hotel_id_1": {"start":"18:00","end":"07:30",...}, "hotel_id_2": {...}}
  ESCALATION_INSTRUCTION_CONFIG: (() => {
    const defaultConfig = {
      start: '18:00',
      end: '07:00',
      within_hours:
        'Since this issue needs more attention, forward the call to the manager along with a callback message.',
      outside_hours: 'Escalate the issue to manager as a callback message.',
    };
    try {
      const raw = process.env.ESCALATION_INSTRUCTION_CONFIG;
      if (!raw)
        return { default: defaultConfig } as Record<
          string,
          typeof defaultConfig
        >;
      const parsed = JSON.parse(raw) as Record<
        string,
        Partial<typeof defaultConfig>
      >;
      const result: Record<string, typeof defaultConfig> = {
        default: defaultConfig,
      };
      for (const [hotelId, overrides] of Object.entries(parsed)) {
        result[hotelId] = { ...defaultConfig, ...overrides };
      }
      return result;
    } catch {
      return { default: defaultConfig } as Record<string, typeof defaultConfig>;
    }
  })(),

  // n8n
  ESCALATION_AGENT_URL_CONFIG: JSON.parse(
    process.env.ESCALATION_AGENT_URL_CONFIG || '{}',
  ),
  TRANSCRIPT_AGENT_URL_CONFIG: JSON.parse(
    process.env.TRANSCRIPT_AGENT_URL_CONFIG || '{}',
  ),
  /**
   * Shared n8n handback webhook URL (all hotels).
   * Called when "Switch to AI" is clicked — accepts plain JSON, bypasses the
   * Twilio trigger node so no signature verification is needed.
   * Example: https://n8n.example.com/webhook/.../handback
   */
  HANDBACK_AGENT_URL: (process.env.HANDBACK_AGENT_URL || '').trim(),
  MANAGER_ROUTING_TIMEOUT_SECONDS:
    parseInt(process.env.MANAGER_ROUTING_TIMEOUT_SECONDS || '300', 10) || 300,

  // Vapi Call Assistant
  VAPI_ASSISTANT_SERVER_TOKEN:
    process.env.VAPI_ASSISTANT_SERVER_TOKEN || 'Daisy',
  VAPI_API_KEY: (process.env.VAPI_API_KEY || '').trim(),
  /** Non-production VAPI key for recording backfill (always used when NODE_ENV !== production). */
  VAPI_OLD_API_KEY: (process.env.VAPI_OLD_API_KEY || '').trim(),
  VAPI_API_BASE_URL: process.env.VAPI_API_BASE_URL || 'https://api.vapi.ai',
  VAPI_FOLLOWUP_AVAILABILITY_STRUCTURED_OUTPUT_ID: (
    process.env.VAPI_FOLLOWUP_AVAILABILITY_STRUCTURED_OUTPUT_ID || ''
  ).trim(),
  VAPI_PAYMENT_LINK_SENT_STRUCTURED_OUTPUT_ID: (
    process.env.VAPI_PAYMENT_LINK_SENT_STRUCTURED_OUTPUT_ID || ''
  ).trim(),
  VAPI_AVAILABILITY_ENQUIRED_STRUCTURED_OUTPUT_ID: (
    process.env.VAPI_AVAILABILITY_ENQUIRED_STRUCTURED_OUTPUT_ID || ''
  ).trim(),

  // JWT (RS256 inter-op with dextr-deepagent when DAISY_JWT_PRIVATE_KEY_PEM is set; else HS256 + JWT_SECRET)
  JWT_SECRET: trimEnv('JWT_SECRET'),
  DAISY_JWT_PRIVATE_KEY_PEM: resolveDaisyJwtPrivateKeyPem(
    trimEnv('DAISY_JWT_PRIVATE_KEY_PEM'),
  ),
  DAISY_JWT_KID: trimEnv('DAISY_JWT_KID') ?? 'daisy-jwt-1',
  JWT_ISS: trimEnv('JWT_ISS') ?? 'daisy-voice-agent-svc',
  JWT_AUDIENCE: trimEnv('JWT_AUDIENCE') ?? 'dextr-deepagent',
  CORE_JWKS_URL:
    trimEnv('CORE_JWKS_URL') ?? 'https://core.dextr.ai/api/auth/jwks',

  //EMAIL
  EMAIL_API_URL: process.env.EMAIL_API_URL || '',
  SES_FROM_EMAIL: process.env.SES_FROM_EMAIL || '',
  SES_REGION: process.env.SES_REGION || '',

  // AWS
  AWS_REGION: process.env.AWS_REGION || 'us-west-1',
  S3_BUCKET: process.env.S3_BUCKET || '',

  // Outbound token for the transcript agent (smsAgentUtils). Not used for inbound auth.
  DAISY_API_KEY_V2: process.env.DAISY_API_KEY_V2 || '',
  // Inbound x-api-key auth (apiKeyMiddleware). Active keys are accepted
  // silently; expired keys are still accepted but logged as a rotation bridge.
  DAISY_INBOUND_API_KEYS: parseCsvKeys(process.env.DAISY_INBOUND_API_KEYS),
  DAISY_INBOUND_API_KEYS_EXPIRED: parseCsvKeys(
    process.env.DAISY_INBOUND_API_KEYS_EXPIRED,
  ),

  // Hostaway
  HOSTAWAY_API_BASE_URL: process.env.HOSTAWAY_API_BASE_URL,
  HOSTAWAY_ACCESS_TOKEN: process.env.HOSTAWAY_ACCESS_TOKEN,
  HOSTAWAY_CHANNEL_ID: parseInt(process.env.HOSTAWAY_CHANNEL_ID || '', 10),
  HOSTAWAY_PROVIDER_ID: process.env.HOSTAWAY_PROVIDER_ID,

  // Stayntouch
  STAYNTOUCH_BASE_URL: process.env.STAYNTOUCH_BASE_URL || '',
  STAYNTOUCH_AUTH_URL: process.env.STAYNTOUCH_AUTH_URL || '',
  STAYNTOUCH_TOKEN: process.env.STAYNTOUCH_TOKEN || '',

  // RemoteLock
  REMOTELOCK_API_URL: process.env.REMOTELOCK_API_URL || '',
  REMOTELOCK_AUTH_URL: process.env.REMOTELOCK_AUTH_URL || '',
  // Credentials of Dextr's OAuth Application, registered under Dextr's own
  // RemoteLock account — one Application for every hotel, never per hotel.
  // Hotels never hold these; they authorize it from their own RemoteLock
  // account, which yields one independent token pair per hotel account.
  REMOTELOCK_CLIENT_ID: process.env.REMOTELOCK_CLIENT_ID || '',
  REMOTELOCK_CLIENT_SECRET: process.env.REMOTELOCK_CLIENT_SECRET || '',
  // Must byte-for-byte match the Redirect URI registered on the Daisy
  // Application — RemoteLock rejects the code exchange otherwise.
  REMOTELOCK_OAUTH_REDIRECT_URI:
    process.env.REMOTELOCK_OAUTH_REDIRECT_URI || '',

  // Dropbox: one read-only app on Dextr's own Dropbox account, used to read
  // files hotels share with that account (e.g. lockbox logs). The refresh
  // token comes from the token_access_type=offline code flow and does not
  // expire; Daisy exchanges it for short-lived access tokens.
  DROPBOX_APP_KEY: process.env.DROPBOX_APP_KEY || '',
  DROPBOX_APP_SECRET: process.env.DROPBOX_APP_SECRET || '',
  DROPBOX_REFRESH_TOKEN: process.env.DROPBOX_REFRESH_TOKEN || '',

  // Encryption (AES-256-GCM) — used for tokens stored in DB
  ENCRYPTION_SECRET: process.env.ENCRYPTION_SECRET || '',

  // Cloudbeds
  CLOUDBEDS_BASE_URL: process.env.CLOUDBEDS_BASE_URL || '',
  CLOUDBEDS_SDK_ENV: (process.env.CLOUDBEDS_SDK_ENV || 'stage') as
    | 'prod'
    | 'stage'
    | 'dev'
    | 'local',
  CLOUDBEDS_DOORLOCK_API_BASE_URL:
    process.env.CLOUDBEDS_DOORLOCK_API_BASE_URL || '',
  CLOUDBEDS_SDK_API_BASE_URL: process.env.CLOUDBEDS_SDK_API_BASE_URL || '',
  // Uniquely identifies our marketplace app to Cloudbeds. Used to filter
  // integration/appstate_changed webhooks down to events about our own app.
  CLOUDBEDS_CLIENT_ID: process.env.CLOUDBEDS_CLIENT_ID || '',
  CLOUDBEDS_ROOM_TYPE_TAX_FILTER_HOTEL_IDS: process.env
    .CLOUDBEDS_ROOM_TYPE_TAX_FILTER_HOTEL_IDS
    ? process.env.CLOUDBEDS_ROOM_TYPE_TAX_FILTER_HOTEL_IDS.split(',')
    : [],
  // Incoming webhook URL for critical Cloudbeds integration alerts, e.g.
  // integration/appstate_changed → disabled. A dedicated webhook (rather than
  // a `channel` override on SLACK_DAISY_ALERT_WEBHOOK_URL) since the `channel`
  // param on Slack incoming webhooks only works for legacy webhooks.
  DEXTR_SLACK_WEBHOOK_URL: process.env.DEXTR_SLACK_WEBHOOK_URL || '',
  // Slack user IDs (comma-separated) to @-mention on those critical alerts.
  DEXTR_SLACK_ALERT_MENTION_USER_IDS: (
    process.env.DEXTR_SLACK_ALERT_MENTION_USER_IDS || ''
  )
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),

  // Authorize.net OAuth (app-level — single OAuth app for all hotels)
  AUTHORIZE_NET_ENVIRONMENT: (process.env.AUTHORIZE_NET_ENVIRONMENT ||
    'sandbox') as 'sandbox' | 'production',
  AUTHORIZE_NET_CLIENT_ID: process.env.AUTHORIZE_NET_CLIENT_ID || '',
  AUTHORIZE_NET_CLIENT_SECRET: process.env.AUTHORIZE_NET_CLIENT_SECRET || '',
  AUTHORIZE_NET_REDIRECT_URI: process.env.AUTHORIZE_NET_REDIRECT_URI || '',
  AUTHORIZE_NET_SOLUTION_ID: process.env.AUTHORIZE_NET_SOLUTION_ID || '',
  AUTHORIZE_NET_VERIFY_API_LOGIN_ID:
    process.env.AUTHORIZE_NET_VERIFY_API_LOGIN_ID || '',
  AUTHORIZE_NET_VERIFY_TRANSACTION_KEY:
    process.env.AUTHORIZE_NET_VERIFY_TRANSACTION_KEY || '',

  // Mews
  MEWS_BASE_URL: process.env.MEWS_BASE_URL || '',
  /** Shared integration token — same for all Mews hotels. */
  MEWS_CLIENT_TOKEN: process.env.MEWS_CLIENT_TOKEN || '',
  /** Identifies this integration to Mews (e.g. "Dextr"). */
  MEWS_CLIENT: process.env.MEWS_CLIENT || '',

  // Calry — unified gateway API fronting Oracle Opera (and other PMSes).
  // The per-PMS connection itself is configured in the Calry dashboard, so
  // nothing here is Opera-specific.
  CALRY_BASE_URL: process.env.CALRY_BASE_URL || '',
  /**
   * Dextr's Calry workspace. Sent as the `workspaceId` header on every
   * unified (`/api/v2/vrs/*`) call. Global rather than per-hotel — each
   * hotel is a separate integration account *inside* this one workspace.
   */
  CALRY_WORKSPACE_ID: process.env.CALRY_WORKSPACE_ID || '',
  /**
   * Opera Cloud host, used only for Calry passthrough calls — Calry has no
   * unified availability endpoint for Opera/OHIP, so `sourceUrl` is built
   * against Opera directly (e.g. `https://<host>.ocs.oraclecloud.com`).
   */
  OPERA_HOST: process.env.OPERA_HOST || '',
  /** Opera property code (`x-hotelid`), not the Calry propertyId. */
  OPERA_HOTEL_ID: process.env.OPERA_HOTEL_ID || '',
  /** Opera `x-app-key`. Leave empty if Calry injects it on passthrough. */
  OPERA_APP_KEY: process.env.OPERA_APP_KEY || '',
  /**
   * How many Opera rate plans are tried per room type when a hotel has no
   * `rate_code_config`. Each candidate costs two Opera calls, and a property
   * can define hundreds of plans.
   */
  OPERA_MAX_RATE_PLAN_CANDIDATES: Number(
    process.env.OPERA_MAX_RATE_PLAN_CANDIDATES || 5,
  ),

  DEFAULT_CHECK_IN_TIME: process.env.DEFAULT_CHECK_IN_TIME || '15:00',
  DEFAULT_CHECK_OUT_TIME: process.env.DEFAULT_CHECK_OUT_TIME || '11:00',

  BOOKING_REVIEW_ID_MAX_RETRIES:
    parseInt(process.env.BOOKING_REVIEW_ID_MAX_RETRIES || '10', 10) || 10,
  PAYMENT_LINK_ID_MAX_RETRIES:
    parseInt(process.env.PAYMENT_LINK_ID_MAX_RETRIES || '10', 10) || 10,

  /** Test lines; phone lookups are capped to TEST_RESERVATION_LIMIT reservations for these numbers. */
  TEST_NUMBERS: (process.env.TEST_NUMBERS || '')
    .split(',')
    .map((number) => number.trim())
    .filter(Boolean),
};

export default config;
