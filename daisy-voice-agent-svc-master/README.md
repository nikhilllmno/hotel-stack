# Daisy Voice Agent Service

Daisy is an AI voice agent that handles hotel reservations — availability & price checks, reservation creation/modification/cancellation, property enquiries, call forwarding to the hotel manager, and message taking.

## Architecture

New here? Start with the [architecture overview](README/architecture/architecture.md) — how the voice/text agents, Vapi, reservations, payments, and the dashboard fit together. A styled standalone version is at [`README/architecture/architecture.html`](README/architecture/architecture.html) (open in a browser).

Integration guides live under `README/`: PMS onboarding process ([`README/PMS`](README/PMS/pms-integration-process.md)), Cloudbeds ([`README/cloudbeds`](README/cloudbeds/Cloudbeds_integration.md)), ResNexus ([`README/resnexus`](README/resnexus/resnexus-flow.md)), Stayntouch + Shift4 ([`README/stayntouch`](README/stayntouch/stayntouch-shift4-integration.md)), the Shift4 payment flow diagrams ([`README/shift4`](README/shift4/shift4-payment-flow.md)), the Authorize.Net payment flow ([`README/authorizenet`](README/authorizenet/authorizenet-payment-flow.md)), lockbox codes from a hotel's Dropbox Excel log ([`README/lockbox`](README/lockbox/dropbox-excel-lockbox.md)), and sister-hotel availability for hotel groups ([`README/cross-sell`](README/cross-sell/sister-hotel-availability.md)).

## Stack

- **Voice:** Google Voice → Twilio → Vapi
- **Workflow automation:** N8n
- **Backend:** Node.js (TypeScript)
- **Database:** PostgreSQL
- **Infrastructure:** AWS (CloudWatch, S3, ECS + EC2, Lambda, EventBridge Scheduler)
- **Alerts:** Slack
- **Payment providers:** Stripe, Shift4, Mews, Authorize.Net, Opera, Cloudbeds SDK

## Key API Routes

- `GET /daisy/rooms` — static room info (no availability/pricing)
- `GET /daisy/availability-lite` — availability + pricing for all rooms
- `POST /daisy/availability-lite-v2` — Cloudbeds-only; same as `/daisy/availability-lite` but sources room types from `getAvailableRoomTypes` instead of `getRoomTypes`, working around a Cloudbeds bug where `getRoomTypes` intermittently errors for same-day check-ins
- `POST /daisy/multi-availability-lite-v2` — Cloudbeds-only; same as `/daisy/multi-availability-lite` but sources room types from `getAvailableRoomTypes` instead of `getRoomTypes` (same same-day check-in workaround)
- `GET /book/rate-calendar?business_id=&start_date=&end_date=` — public (no API key), read-only. Nightly rate, availability and minimum stay per room type for each night from `start_date` to `end_date` (both inclusive, at most 62 nights; a past `start_date` is moved up to today in the hotel's timezone). Returns `{ hotel_name, hotel_phone, hotel_website, currency, start_date, end_date, units[], nights[{ date, rates[{ unit_id, price, available, min_stay }] }] }` (`hotel_phone` is the hotel's `assistant_phone_number`, the line its agent answers). Supported for PMSs whose service implements `getRateCalendar` (ResNexus today, via `getcalendar`); others get a 400. Daisy fetches the whole calendar months a window falls in (from today in the current month) and caches them in-process for 10 minutes per hotel, so overlapping windows in the same months share one PMS call; the response still covers exactly `start_date` to `end_date`. Responses are sent with `Cache-Control: public, max-age=300`, so website traffic doesn't become one PMS call per visit.
- `GET /widgets/rate-calendar.js` — the embeddable rate calendar for hotel websites, built on `/book/rate-calendar`. A hotel adds `<script src="https://<daisy-host>/widgets/rate-calendar.js" defer></script>` and `<dextr-rate-calendar business-id="…" book-url="…" phone="…"></dextr-rate-calendar>`. `phone` defaults to the hotel's guest line. Optional attributes: `website-link`, `accent`, `theme="auto"`, `locale`, `week-start`, `months-ahead`, `unit`, `api-base`. It renders in a shadow root, inherits the host page's font and shows prices only, never guest data. Widget files are served with a 10-minute cache so fixes reach hotel sites quickly.
- `GET /rates/:businessId` — a shareable, hosted rates page for one hotel (the same widget on its own page), for hotels that can't edit their website or want a link for emails and social posts. Optional query parameters: `book` (booking page URL; otherwise the button opens the hotel's website), `accent`, `theme=auto`, `unit`.
- `POST /daisy/lockbox-code` — late-arrival lockbox code from the hotel's own lockbox log, an Excel workbook (`.xlsx`/`.xlsm`) the hotel shares with Dextr's Dropbox account and keeps up to date. Same middleware as the other agent tools (`x-api-key`, caller number, `assistant_phone_number`/`business_id`, `session_type`). Two ways to ask:
  - **By phone** (no `booking_id`; body `{ booking_phone?, last_name?, room_number? }`): Daisy lists tonight's arrivals in Cloudbeds and finds the live reservation(s) with a guest whose phone or cell phone is the caller ID (a `CALL` or `SMS` session's caller number; no name needed), or, with `booking_phone`, that number plus a guest whose last name loosely matches `last_name` (`last_name_required` without one; a wrong one answers `reservation_not_found`, like an unknown number). Numbers compare on their last 10 digits. The caller is the identified guest.
  - **By booking id** (unchanged; body `{ booking_id, customer_name, room_number? }`): `booking_id` (the reservation the agent found earlier in the call) needs `customer_name` (the caller's first and last name, as they said it), which must be a guest's on the reservation: the same name, or as speech-to-text may have heard it (the last name a few typos off, the first name or its first word a few typos off, or the first name run into the last, such as "Voicetester Tester"); a first or last name alone never matches; a `booking_id` without one is a `400`. A blank or `null` `booking_id` counts as not sent.

  Either way Daisy reads the reservation live from the hotel's PMS (Cloudbeds only) and only answers for an active stay that checks in on the date of the lockbox assignment in force (today in the hotel's timezone, or yesterday before noon), has a room assigned and owes nothing (Cloudbeds `balance` of 0 or less; a missing balance counts as owed) unless the hotel's `door_lock_config.lockbox_balance_policy` is `allow_with_note`. The main guest may have every room's boxes, another guest only those of the rooms the PMS puts them in. `room_number`, when sent, must be one of those rooms and narrows the answer to it. Boxes are matched on those rooms and the names the PMS lists in them, never on what the agent sent. Returns `200 { success: true, lockbox_number, code, note?, lockboxes: [{ lockbox_number, room_number, code, note? }] }` (`note` is the box's NOTES cell, when not blank), or `200 { success: false, reason }` with `reason` one of `last_name_required`, `reservation_not_found`, `reservation_not_active`, `not_arriving_tonight`, `no_room_assigned`, `reservation_mismatch`, `balance_due`, `reservation_lookup_failed`, `reservation_lookup_unsupported`, `not_found`, `no_assignment_today`, `log_unavailable`, `not_configured`. Configured per hotel in `hotel_configurations.door_lock_config.lockbox_log`, plus optional `door_lock_config.room_number_overrides` (Cloudbeds room name → the room number staff write in the log, for a room whose name doesn't end in it, e.g. `{ "Freya Accessible King Retreat": "19" }`) and `door_lock_config.lockbox_balance_policy` (`refuse`, the default, or `allow_with_note`). Phone lookup, reservation check, matching, date rule, setup and KPIs: [`README/lockbox/dropbox-excel-lockbox.md`](README/lockbox/dropbox-excel-lockbox.md).
- `POST /daisy/sister-property-availability` — cross-sell, read-only: availability and prices for the guest's dates and party at each of the calling hotel's sister hotels (`hotel_configurations.cross_sell_configuration`: Daisy hotel ids plus the name, website and phone the agent says; set it with `PUT /api/hotel/:id/configuration`). Two modes per hotel: with `check_all_sister_properties: true`, all sister hotels are checked in parallel through each one's own PMS lite availability (`getRoomAvailabilityWithQuoteLiteV2` for Cloudbeds, `getRoomAvailabilityWithQuoteLite` otherwise), each with a time limit (`timeout_ms`, default 8000), and a failing or slow hotel becomes an error entry while the rest are still returned, in configured order. Without it (the default, as Giri uses it), they are checked one at a time with `getRoomAvailabilityWithQuoteLite`, stopping at the first with a bookable room, with no time limit. Returns `{ cross_sell_available, results[{ hotel_name, website?, hotel_phone_number?, distance_miles?, available, groups?, date_correction_details?, error? }], message }`. It can't book at a sister hotel. Config, VAPI tool JSON and prompt rule: [`README/cross-sell/sister-hotel-availability.md`](README/cross-sell/sister-hotel-availability.md).
- `POST /daisy/reservation` — creates a reservation in Dextr and generates a booking review page link
- `GET /daisy/reservation/review` — loads the booking review page (customer enters details)
- `PATCH /daisy/reservation/review` — submits customer details; four flows:
  - Returns a Stripe Checkout payment link if a deposit is required (Stripe)
  - Returns a Stripe Checkout setup link (no charge) if deposit amount is 0 and provider is Stripe — card captured for future autocharge
  - Returns Shift4 iframe keys if provider is Shift4 — frontend collects card and posts token to `/shift4/card-token`
  - Returns Cloudbeds SDK config (api-key, property-id, env) if provider is Cloudbeds SDK — frontend renders Payment Element iframe, guest submits card, frontend posts token to `/cloudbeds/card-token` which books each room in Cloudbeds and attaches the card (no charge)
  - If no payment needed (`NOT_APPLICABLE`), creates the reservation in Dextr + PMS, sends SMS to customer via Dextr, PMS sends confirmation email
  - If the hotel is ResNexus-native (`payment_provider = resnexus`), returns nothing extra; the frontend collects the raw card and posts it to `/reservation/card`
- `POST /daisy/reservation/card` — ResNexus-native hotels only. Passes the card to ResNexus `addreservation` for each room of the booking; ResNexus takes its own deposit, auto-charges the balance and owns refunds. Dextr creates no `payments` row: these reservations have `payment_status = EXTERNALLY_MANAGED` from creation, and are excluded from Dextr payment reminders, auto-charge, manual charges and refunds. If the first room fails nothing is booked and the guest can retry with another card; if a later room fails, the rooms already booked are kept and the response lists the rest in `failed_booking_ids`. If ResNexus times out, gives no answer or returns a 5xx, the room may still have been booked, so it is set to `FAILED`, the hotel is alerted on Telegram, and the guest gets a 502 asking them not to submit the card again; further submissions for that booking get the same answer until staff confirm it in ResNexus. Hotels move to this flow one at a time by changing `payment_provider` from `stripe` to `resnexus`. While a submission books its rooms it holds a claim on them (`pms_booking_claimed_at`), so a second submission and the stale sweepers leave them alone; a claim older than `PMS_BOOKING_CLAIM_TTL_MINUTES` (default 5) is treated as left by a crashed request.
  - Card check: the card is first checked with a $0 authorization on Dextr's own Authorize.net account (`AUTHORIZE_NET_VERIFY_API_LOGIN_ID`, `AUTHORIZE_NET_VERIFY_TRANSACTION_KEY`, sandbox or production per `AUTHORIZE_NET_ENVIRONMENT`), using the guest's billing or contact street address and zip. Without those two credentials the check is skipped and the card goes straight to ResNexus. Otherwise a decline returns 400 with nothing booked, and the guest can try another card. If the check itself fails (invalid keys, a gateway problem, or a transaction held by the account's fraud filters), the card still goes to ResNexus.
  - Failed card limits (in memory per instance): a booking stops accepting cards after 5 declines, and a phone number with declines on 10 bookings at a hotel in 24 hours is refused new bookings there. Voice and SMS assistants get "This booking could not be completed. Escalate to the hotel." and the guest pages a generic contact-the-hotel message; neither mentions the number or the limit.
- `POST /escalations` — the agent's take-message tool (`x-api-key`, caller number, `assistant_phone_number`, `session_type`). Body `{ message, full_name }`: saves the message and posts it to the hotel's check-in chat. `message` is required; a missing, empty, whitespace-only or `null` `full_name` is saved as `Unknown caller`, so a message is never dropped because the caller gave no name.
- `GET /conversations/channel-history` — paginated conversation messages for a guest by channel (`x-api-key` + `X-Phone-Number`; hotel via `business_id` or `assistant_phone_number`; optional `session_type` = `CALL|CHAT|SMS|WEB`, default `SMS`; optional `include_tool_calls` = `true|false`, default `true` — includes `SYSTEM` / `TOOL_CALLS` / `TOOL_CALL_RESULT` rows with tool payload fields; set `false` for USER/AI only)

### Cloudbeds Webhooks

- `POST /webhooks/cloudbeds` — receives Cloudbeds webhook events. Only `reservation/status_changed` and `integration/appstate_changed` are currently routed (see ticket #1495); the others are implemented but their switch cases stay commented out pending re-enablement:
  - `reservation/created` → creates or updates local reservation for external bookings
  - `reservation/status_changed` → updates status on cancellation or no-show
  - `reservation/dates_changed` → syncs updated check-in/check-out dates
  - `reservation/accommodation_type_changed` → syncs room type changes
  - `integration/appstate_changed` → the only event that checks `clientID` against `CLOUDBEDS_CLIENT_ID` (identifies our marketplace app; a missing config value throws, a mismatched `clientID` is ignored — every other event relies on `propertyID` alone). Only `newState === 'disabled'` or `newState === 'enabled'` is processed — any other transition is ignored. On disable, sets `external_auth_config.disabledAt` on `hotel_configurations` and posts a critical Slack alert to `DEXTR_SLACK_WEBHOOK_URL` (mentioning `DEXTR_SLACK_ALERT_MENTION_USER_IDS`), naming the property that disconnected; it is not auto-cleared on reconnect. On enable, posts the same kind of Slack alert (same webhook + mentions) naming the property that raised the connection, with no DB changes. Any error while processing this event is also reported to the shared ops alerts channel (`SLACK_DAISY_ALERT_WEBHOOK_URL`).

### Chat notifications (Telegram and Teams)

Escalations, alerts, call transcripts, daily summaries and the manager reply flow go through `notificationFactory.getChatService(hotel.notification_type)`. `hotels.notification_type` is `telegram` (default) or `teams`. The `telegram_check_in_group_id`, `telegram_alerts_group_id` and `telegram_transcript_group_id` columns keep their names and hold the chat or channel ID of whichever provider the hotel uses. Message content is provider-neutral (`NotificationChatContent`: `parseMode`, `actions`, `replyToMessageId`); each adapter converts it. The shared inbound logic (escalation replies, reactions, manager replies, handback) lives in `ChatInteractionService`.

- `POST /webhook/telegram` — Telegram updates, checked with `TELEGRAM_WEBHOOK_SECRET`.
- `POST /webhook/teams` — Microsoft Teams (Bot Framework) activities. The Microsoft 365 Agents SDK (`@microsoft/agents-hosting`) validates the Bot Framework JWT. Needs `TEAMS_BOT_APP_ID`, `TEAMS_BOT_APP_PASSWORD` and `TEAMS_BOT_TENANT_ID` (one single-tenant Azure Bot owned by Daisy); without them the route answers 503 and Teams hotels cannot be used. Handles installs, `@Daisy link` (replies with the channel ID), thread replies, reactions and button clicks.
- Teams replies and reactions do not include the original text, so what the bot posts is stored in `chat_outbound_messages` and looked up by message ID. Channel service URLs live in `teams_conversation_references`.
- Teams traffic is counted with the `teams.message.sent`, `teams.message.send_failed` and `teams.message.received` KPIs. `received` counts message activities (thread replies, commands, button clicks) that passed JWT validation and the tenant check, not reactions or installs. `clientId` is the hotel found through the channel's check-in or transcript column, and is `??` for a channel not linked to a hotel.
- Teams limits: standard channels only (no private channels), a hotel manager's image attachments in escalation replies are not forwarded, and `ChannelMessage.Read.Group` must be consented so plain thread replies reach the bot.
- Setup and hotel onboarding steps: [`README/teams/teams-onboarding-and-app-setup.md`](README/teams/teams-onboarding-and-app-setup.md).

### PMS credential storage

`hotel_configurations.external_auth_config` (jsonb: `{ apiToken, disabledAt?, oauth_client_id?, oauth_client_secret? }`, secrets AES-256-GCM encrypted) is the live credential store for Cloudbeds, Stayntouch, and Mews — which provider applies is already known from `hotels.pms_provider`, so the column isn't keyed by provider name.

- **Cloudbeds**: every live credential lookup (`CloudbedsReservationService`, the webhook handlers above, refund notes, Stripe→Cloudbeds payment posting) resolves through `resolveCloudbedsCredentials` (`cloudbeds/services/cloudbedsCredentials.ts`), which refuses the call if `disabledAt` is set — even though `apiToken` is still present — since disabling never clears the token itself, only that marker.
- **Stayntouch**: `StayntouchTokenService.refreshToken()` (via `POST /jobs/stayntouch/token/refresh`, ~25-day EventBridge schedule) reads per-hotel OAuth `client_id`/`client_secret` from `external_auth_config.oauth_client_id` / `oauth_client_secret` (both encrypted), exchanges them at the Stayntouch OAuth endpoint, and writes the resulting Bearer token into `external_auth_config.apiToken`. Hotel discovery is DB-driven (`findHotelIdsWithOAuthClientCredentials`). Read via `PmsTokenService.getActiveToken`, shared with Mews.
- The legacy `api_token` text column is left in place for now (migrations `147`–`149` add `external_auth_config` and backfill it from `HOTEL_CLOUDBEDS_CONFIG` and existing `api_token` values); it will be dropped in a follow-up once the new column has been monitored in production.
- **RemoteLock**: `external_auth_config.remotelock_access_token` / `remotelock_refresh_token` (both AES-256-GCM encrypted) hold the door-lock credential, separate from `apiToken` — a hotel can run a PMS and RemoteLock at once. See below for how they get there.
- `POST /internal/pms/token` — manual write path for onboarding a PMS bearer token (`x-api-key`, `DAISY_INBOUND_API_KEYS`). Body: `{ hotel_id, pms_provider, token }`; `pms_provider` must match the enum in `types/enums.ts` and the hotel's own `hotels.pms_provider` (a mismatch is rejected as `400`, not silently stored under the wrong provider). Encrypts `token` and writes it to `external_auth_config.apiToken` via `HotelConfigurationRepository.updateExternalAuthConfigApiTokenByHotelId`, which merges into the existing JSON rather than overwriting `disabledAt` or the RemoteLock fields. Logs `pms.external_auth.token_stored`.
- `POST /internal/pms/client-credentials` — manual write path for onboarding OAuth client credentials (`x-api-key`, `DAISY_INBOUND_API_KEYS`). Body: `{ hotel_id, pms_provider, client_id, client_secret }`; same provider-match guard as `/pms/token`. Encrypts both and writes to `external_auth_config.oauth_client_id` / `oauth_client_secret`. Reusable for any OAuth PMS. Logs `pms.external_auth.client_credentials_stored`.

### RemoteLock

Dextr holds one RemoteLock account with one OAuth Application registered under it (`REMOTELOCK_CLIENT_ID` / `REMOTELOCK_CLIENT_SECRET`) — these are Dextr-level, never per hotel. Each hotel has its own RemoteLock account with its own locks; it authorizes Dextr's Application from the RemoteLock marketplace, which produces one independent token pair per hotel account.

- `GET /remotelock/oauth/callback` — public; the Redirect URI registered on Dextr's Application (must match `REMOTELOCK_OAUTH_REDIRECT_URI` byte for byte). RemoteLock calls it with a `code` after a hotel authorizes. Since RemoteLock — not Dextr — builds the authorize URL, there is no `state` to carry a `hotel_id`, so **the callback cannot tell which hotel just authorized**. It exchanges the code, calls `GET /user` to identify the authorizing RemoteLock user, logs that identity (never the tokens), and posts a Slack alert to `DEXTR_SLACK_WEBHOOK_URL` (mentioning `DEXTR_SLACK_ALERT_MENTION_USER_IDS`) carrying the account details **and the plaintext token pair**, so the handoff is one self-contained message. Someone then encrypts the pair and stores it on the matching hotel's `external_auth_config`. Those are live credentials to that hotel's locks — the refresh token lasts 90 days — so that channel must be access-restricted and messages cleared once acted on. Slack delivery failures are swallowed: the authorization already succeeded, and failing the callback would show the hotel an error for something that worked.
- `POST /jobs/remotelock/token/refresh` — refreshes every hotel that has a `remotelock_refresh_token` stored (the hotel list comes from the DB, not an env var). RemoteLock rotates and invalidates the refresh token on every exchange, so the exchange is never retried; only the DB write is.
- `POST /daisy/reservation/door-code` — resolves a guest's door PIN. A reservation is found either by `booking_id` (the guest's PMS confirmation number, or Daisy's own `BK...` id) or by `guest_name` **plus** `check_out_date` (`YYYY-MM-DD`) — a name alone is too weak a key for something that opens a physical door, so a request with `guest_name` and no date is rejected with a message telling the agent to ask for the check-out date. `booking_id` wins when both are supplied. If a name and check-out date still match more than one booking, no PIN is returned and the agent is told to ask for the booking ID (`remotelock.door_code.guest_name_ambiguous` KPI). A reservation is matched to a RemoteLock access guest on **first name only** plus a date-level overlap of the stay against the guest's `starts_at`/`ends_at`. Email and phone are not compared (the values the PMS and RemoteLock hold disagree in production; the checks are commented out rather than removed). When several access guests match one reservation, **all of them are returned** — each entry carries `booking_id`, `pin`, `guest_name`, `starts_at` and `ends_at` so the agent can tell them apart; that case is counted under `remotelock.door_code.ambiguous`. Access guests with no readable PIN are dropped before this point.
  - **Cloudbeds hotels with `hotel_configurations.door_lock_config.source_of_truth = daisy`** are answered from Cloudbeds instead, and RemoteLock is not called: the Cloudbeds Door Lock API first, then the reservation custom field whose shortcode is `door_lock_config.door_lock_custom_field`. A code is only given to a caller verified on the stay: the caller ID (a `CALL` or `SMS` session's caller number; any other session has none) must be the phone or cell phone of a guest on the reservation (last 10 digits compared, as for the lockbox), the reservation must be `confirmed` or `checked_in`, and today in the hotel's timezone must fall from its check-in date to its check-out date, both included. With `booking_id` (the Cloudbeds reservation ID, an OTA confirmation number or Daisy's `BK...` id) that one reservation is checked; without one (or blank or `null`; `guest_name`/`check_out_date` are ignored), Daisy finds the caller's live stays covering today by the caller ID (check-ins up to 30 nights back) and returns each one's code, unless they belong to different main guests (`ambiguous_caller`). Returns `200 { success: true, door_codes: [{ booking_id, room, code, door_code_text, check_in, check_out }] }` (no guest names), or `200 { success: false, reason }` with `reason` one of `caller_id_unavailable`, `reservation_not_found`, `caller_not_on_reservation`, `ambiguous_caller`, `reservation_not_active`, `not_in_stay_window`, `no_door_code`, `reservation_lookup_failed` (any Cloudbeds error or a 10-second timeout). A malformed request is still a `400`. KPIs: `cloudbeds.door_code.resolved`, `cloudbeds.door_code.not_found`, `cloudbeds.door_code.refused`, `cloudbeds.door_code.lookup_failed`. Setup and details: [`README/cloudbeds/cloudbeds-door-code.md`](README/cloudbeds/cloudbeds-door-code.md).
- `GET /internal/remotelock/hotels/:hotelId/access-persons/:accessPersonId` — read-only passthrough over RemoteLock's `access_persons` resource for machine callers (`x-api-key`, `DAISY_INBOUND_API_KEYS`). Used by Alfred's RemoteLock webhook drain, which already holds the reservation and only needs the raw access person, so there is no matching or reservation lookup here — unlike `POST /daisy/reservation/door-code`. Daisy holds the OAuth Application and the per-hotel token pair, so the RemoteLock credential never leaves this service; `hotelId` (Daisy's `hotels.id`) is the token-scoping key.

  The RemoteLock resource is relayed unreshaped as `{ id, type, attributes }`, and `attributes.starts_at`/`ends_at` are passed through verbatim — they are timezone-less lock-local strings, so callers must not read them as UTC. Error bodies carry a machine-readable `code` for callers to branch on instead of the prose `message`:

  | Status | `code` | Meaning |
    |---|---|---|
  | `400` | `invalid_request` | blank path parameter |
  | `401`/`403` | — | bad or missing `x-api-key` (from `apiKeyMiddleware`) |
  | `404` | `remotelock_access_person_not_found` | RemoteLock has no such access person (deleted) — terminal |
  | `422` | `remotelock_not_onboarded` | no RemoteLock token pair stored for the hotel — config error, terminal |
  | `422` | `remotelock_auth_failed` | RemoteLock rejected the stored token (401/403) — config error, terminal |
  | `422` | `remotelock_rejected` | RemoteLock refused the request itself (any other `4xx`) — terminal |
  | `502` | `remotelock_unavailable` | RemoteLock unreachable, `5xx`, or `429` — retryable |
  | `500` | `remotelock_misconfigured` / `internal_error` | Daisy-side failure |

  RemoteLock-side `401`/`403` is reissued as `422` on purpose, so `401`/`403` on this endpoint only ever means a bad `x-api-key`. Every hotel a caller asks about must already have its token pair stored (see the callback above), or every fetch returns `remotelock_not_onboarded`.


## Auth

`/api` routes accept a Daisy JWT from `POST /auth/login` (RS256/HS256 + user/role checks). Selected routes also accept a **Core JWT** Bearer token first; if Core auth fails or the route is not onboarded, Daisy JWT is used as usual.

**Core JWT**: for onboarded hotel, hotel-configuration, and recording-backfill routes (see `routeUsesAuthCore`) verified against JWKS at `https://core.dextr.ai/api/auth/jwks` (cached; JWKS is refreshed and verify is retried once if verification fails and keys changed). Requires a non-empty `email` claim, then continues when either `permissions` includes `"admin"` (system admin → `SUPERADMIN`, any onboarded route) or any `businessEnts[]` entry matches the hotel id in the request path (hotel-scoped → `ADMIN`).

`POST /api/hotel/recordings/backfill` and `POST /api/hotel/recordings/backfill/conversation` carry no hotel id in the path, so `businessEnts` cannot match: a Core caller reaches them only with `permissions: ["admin"]`. Other `/api` routes (`sessions`, `escalations`, `reservations`, `payments`) are not onboarded — they read `hotel_id` off the token rather than the URL, so they still require a Daisy JWT.

### Scheduled Jobs

Mounted at `/jobs` (`x-api-key` header, `DAISY_INBOUND_API_KEYS`), invoked on a schedule via AWS EventBridge Scheduler + Lambda:

- `POST /jobs/reservations/paid-not-created` — finds payments that completed successfully while their reservation never left `INACTIVE` (PMS reservation creation failed and was never retried), and posts each one to the shared Daisy alerts Slack channel (`SLACK_DAISY_ALERT_WEBHOOK_URL`). Reported again on every run until the underlying reservation is resolved — duplicates are expected. Intended to run twice daily as a safety net alongside the real-time escalation already fired from `stripeWebhookService.handlePaymentIntentSucceeded` on PMS failure.

## Payment Flows

### Stripe
- Uses webhooks
- `payment_intent.succeeded` → mark payment complete → create PMS reservation(s) → activate reservation in DB
- Stores a Stripe customer key in DB for future autocharge
- **Cloudbeds:** when `CLOUDBEDS_CARD_TOKEN_ENABLED=true`, the Stripe customer id (and, when a deposit was charged, the charge id) are forwarded on `postReservation` as `cardToken`/`paymentAuthorizationCode` so Cloudbeds attaches the card to the reservation — see [Pass Stripe tokens to Cloudbeds](https://developers.cloudbeds.com/docs/pass-stripe-tokens-to-cloudbeds). This only stores the card; it does not trigger any charge on Cloudbeds' side. When the flag is `false` (default), `postReservation` always sends `paymentMethod: 'cash'` with no card token
- On PMS failure (unavailability/error) → alert sent to team and hotel; manual resolution required
- `payment_intent.payment_failed` → mark payment as failed in DB

**Zero-deposit flow (card capture for autocharge)**
- Triggered when `initial_deposit_policy` has a 0-value tier and payment provider is Stripe
- `checkout.session.completed` (setup mode) → save payment method as customer default → create PMS reservation → activate reservation
- No charge at booking time; full amount is collected via autocharge before check-in
- Success redirect (`createPaymentLink`/`createSetupCheckoutSession`) includes `?initial-deposit=false` so the booking-success page knows no deposit was charged

### Shift4
- No webhook support — fully API-based
- **3D Secure (3DS)** is toggled per hotel via the `threeDS_config` jsonb column on `hotel_configurations` (shape `{ enabled: boolean }`). When `threeDS_config.enabled` is `true`, `handleShift4PreAuthorization` runs the pre-authorization with 3DS applied (i4go basket + `3DS_STANDALONE` step + `threedSecure` params, logged as the `payment.shift4.3ds_applied` KPI), and the downstream card-token/sale flow (`/shift4/card-token`) forwards the returned `threeDSecure` block on the sale transaction only — the 3DS cryptogram is sensitive authentication data and is never persisted (PCI-DSS 3.3.1). When the column is `null` or `enabled` is `false` (default), 3DS is skipped and only `CARD_VERIFY` runs; the frontend returns no `threeDSecure` block, which the card-token validator accepts as optional. 3DS applies to Shift4 only — Stripe and Cloudbeds have no 3DS handling.
  - **Operational note — 3DS on/off is a two-party change with the Shift4 team, and order matters:**
    - **To disable 3DS:** first ask the Shift4 team to turn 3DS off on their side for the merchant, then set `threeDS_config.enabled = false` (or clear the column) on our end. Flipping our toggle alone is not sufficient — Shift4 must disable it too.
    - **To enable 3DS:** first ask the Shift4 team to turn 3DS on for the merchant, then set `threeDS_config.enabled = true` on our end.
    - Keep the two sides in sync — a mismatch (one side on, the other off) can cause the pre-authorization to fail or silently skip 3DS.
  - **Frontend signal:** `GET /daisy/reservation/review` returns `hotel.enable_3ds` (`boolean | null`) in its payload so the frontend knows the 3DS status. It reflects the Shift4 hotel's toggle (`true`/`false`) when set, and is `null` when there is no 3DS setting — i.e. the config is absent or the hotel is not on Shift4.
- `PATCH /reservation/review` returns keys needed for the frontend
- Frontend embeds a Shift4 iframe to collect card details
- Card submitted → Shift4 creates a token → frontend sends token to `/shift4/card-token`
- Backend: store token → charge → update payment status → create PMS reservation → activate reservation in DB
- See `README/shift4` for flow diagrams

**Zero-deposit flow (card capture for autocharge)**
- Triggered when `initial_deposit_policy` has a 0-value tier and payment provider is Shift4
- Since Shift4 has no webhooks, `/shift4/card-token` detects `amount_charged === 0` and skips the sale transaction entirely — no equivalent of Stripe's setup-mode Checkout Session exists on Shift4's side, so the card token is stored on the customer record (`card_metadata`) with no `saleTransaction` call
- Payment marked `COMPLETED` → PMS reservation created → reservation activated → guest notified (no amount charged)
- `/shift4/card-token` responds `{ success: true }` for this flow (no `saleResponse`, since no sale transaction ran); the non-zero-deposit flow still responds `{ saleResponse: {...} }`
- No charge at booking time; the first real charge happens later via autocharge, using Shift4's cardholder-initiated `U01` card-on-file type (no prior transaction to reference) instead of the `U02` type used for subsequent charges — the `transactionId` that charge returns is then persisted so future charges can use `U02` as usual

### Cloudbeds SDK
- Card-on-file by default — Dextr does **not** charge the card; charging is managed by Cloudbeds (or the hotel)
- **Charge at booking (opt-in per hotel):** `hotel_configurations.payment_configuration.charge_at_booking: true` charges each room what the review page showed as due now — the deposit policy's `amount_charged` (no policy = the full total), capped by the Cloudbeds balance (read with `getReservation`; a full payment may settle Cloudbeds' total up to 5 cents above Daisy's quote) — to the stored card with `postCharge` (`description`, `redirectUrl` and `isDeposit: true`, all required or used by Cloudbeds; lowercase currency). A room with nothing due now (e.g. a 0% deposit policy) keeps the card on file only right after the card is attached (after a 3 s wait for the stored card to settle). Cloudbeds clearly refusing room 1 (`failed`/`canceled`, or a 4xx / `success: false`, after trying the payment-form card id and then the stored card id) cancels every room booked here and makes them pending again so the guest can retry with another card. An unknown outcome (timeout, 5xx, no usable balance) is never retried or cancelled, since money may have moved: the booking is kept and the Telegram note tells the team to check the payment in Cloudbeds — as for a later room refused, or rooms left uncharged behind a 3DS page. A charge that needs 3DS returns its `redirect_url`. No `payments` row is written; a fully charged booking's Telegram note says "Paid in full at booking through Cloudbeds Payments."
- `PATCH /reservation/review` returns SDK config (`cloudbedsSdkApiKey`, `cloudbedsSdkPropertyId`, `cloudbedsSdkEnv`)
- Frontend renders Cloudbeds Payment Element iframe → guest enters card → SDK returns `paymentMethodId`
- Reservations are created `NOT_APPLICABLE` with no `payments` row; the hotel charges the card in Cloudbeds
- Frontend posts to `/cloudbeds/card-token` → backend books each room in Cloudbeds, then attaches the card via `postCreditCard` (room 1 with the SDK token, later rooms with the stored card Cloudbeds returns)
- `GET /daisy/reservation/review` re-checks availability only for rooms still waiting to be booked, so reopening the link after booking doesn't count the guest's own booking against itself
- Card refused on room 1 → room 1 cancelled in Cloudbeds so the guest can retry; a later room failing keeps the booked rooms and returns `failed_booking_ids`
- Returns `redirect_url` when Cloudbeds needs 3DS
- Scheduled auto-charge, direct charge, and refunds are blocked on Dextr side — managed by Cloudbeds (charge at booking above is the only Dextr-side charge)
- SDK credentials (identity + encrypted secret) stored in `external_auth_config.cloudbedsPaymentSdk`, provisioned via `POST /internal/pms/token` with `cloudbeds_sdk_enabled: true`
- See `README/cloudbeds/cloudbeds-sdk-payment-flow.md` for detailed flow diagrams

### Authorize.Net
- Uses Accept UI (hosted modal via `AcceptUI.js`) for PCI-compliant client-side card tokenization → opaque data (`dataDescriptor` + `dataValue`)
- Per-hotel OAuth authentication with automatic token rotation (refresh tokens are single-use)
- `GET /reservation/review` returns `authnet_config: {apiLoginId, publicClientKey}` for Accept UI
- `PATCH /reservation/review` returns empty body — frontend collects card via Accept UI and posts opaque data to `/authorizenet/card-token`
- Deposit flow: backend charges via `authCaptureTransaction` (CIT, first COF auth), then creates a CIM profile from the transaction for future auto-charges
- Zero-deposit flow: backend creates a CIM profile directly from the nonce (no charge) — card captured for future auto-charges
- Auto-charges use CIM `customerProfileId` + `paymentProfileId` for merchant-initiated transactions (MIT)
- Refunds via `refundTransaction` using original transaction ID + last four digits
- See `README/authorizenet/authorizenet-payment-flow.md` for detailed flow diagrams

### Autocharge
- Deposit amount at booking time is determined by `initial_deposit_policy` (configured per property): PERCENTAGE 100 = full upfront, PERCENTAGE/FLAT 0 = zero deposit with card capture, anything else = partial deposit
- Remaining balance is charged N days before check-in (`auto_charge_days_before` + `auto_charge_time` in hotel config)
- **Stripe:** autocharge is instructed during `payment_intent.succeeded` (or after setup session completes for zero-deposit); Stripe fires `invoice_payment.paid` when charged → we update payment + reservation tables
- **Shift4:** a scheduler runs every ~5 minutes, calls `/process-shift4-auto-charges` → charges remaining amounts via Shift4 API → updates payment + reservation tables. For zero-deposit bookings, this is also the first-ever charge on the stored card (`U01`); its response's `transactionId` is saved so later charges can use `U02`

## Running Locally

```bash
npm i
npm run build
npm run migrate   # only if new migrations exist
npm run start
```

DB: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/daisy_local`

## Running via Docker

```bash
docker compose up --build --remove-orphans
```

DB: `DATABASE_URL=postgresql://postgres:postgres@db:5432/daisy_local`

## ENV Variables

Found in `.env.example`. Get actual values from your lead.

- `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN` — Dextr's read-only Dropbox app and the refresh token it was granted on Dextr's own Dropbox account. `POST /daisy/lockbox-code` uses them to download hotels' lockbox logs; without them it answers `log_unavailable`. The refresh token does not expire; Daisy exchanges it for short-lived access tokens in memory. Setup: [`README/lockbox/dropbox-excel-lockbox.md`](README/lockbox/dropbox-excel-lockbox.md).

## Testing (websocket-server)

From the `websocket-server` directory:

- `npm test` — fast tests: pure unit tests and pg-mem service tests (no Docker required)
- `npm run test:integration` — Postgres integration tests using Testcontainers + real Knex migrations (Docker required)
- `npm run test:all` — run both projects

**File naming:** only `*.test.integration.ts` files run in the integration project. Use `*.test.ts` for unit and pg-mem tests. Do not use `*.integration.test.ts`.

See `websocket-server/src/test/README.md` for test structure, stub policy, and how to add new tests.

### Prerequisites (integration tests)

- **Docker required** — Docker Desktop on Windows/Mac, or Colima/Rancher Desktop on Mac/Linux, as long as the `docker` CLI can reach the daemon.
- **First run is slow** — pulls the `postgres:16` image and runs ~131 Knex migrations (often 30–60+ seconds).
- **Postgres version** — docker-compose uses `postgres:17`; integration tests use `postgres:16`. This is intentional for now and is sufficient for current test coverage.

**Platform notes:**

- **Windows:** `TESTCONTAINERS_HOST_OVERRIDE=127.0.0.1` is set automatically to work around an IPv6 port-mapping issue ([testcontainers-node#818](https://github.com/testcontainers/testcontainers-node/issues/818)).
- **Mac (Apple Silicon):** no extra configuration; ensure Docker has sufficient CPU/RAM allocated.
- **Docker Desktop 4.42.x** had port-mapping regressions; upgrade to 4.44+ if port errors persist.

**CI (future):** run `npm run test:integration` only on runners with Docker available; keep `npm test` as the fast default PR gate.

**Debugging:** set `DEBUG=testcontainers*` for verbose Testcontainers logs when troubleshooting setup failures.

## Cursor AI Setup

This repo includes Cursor AI configuration for an assisted development workflow.

The `gh` CLI (GitHub CLI) can be used for GitHub operations and should be authenticated via `gh auth login`.

### PR Workflow
Rules are defined in `.cursor/rules/pr-workflow.mdc` and apply to every chat session in this repo:

- **Review comments** — use the `babysit` skill: the agent fetches open PR comments, evaluates validity, makes fixes, and confirms CI is green
- **Merging** — always **merge with a merge commit** into `master` (no squash), branch is deleted after merge

### Skills

- **`analyze-slack-errors`** — triages the production error-alert Slack channel (`#dextrai-aws-prod-alerts-daisy`) over a time range: fetches and categorizes alerts, separates routine guest-input noise from real infrastructure/integration failures, and spawns AWS CloudWatch investigation agents for anything critical. Use it to review, triage, or analyze prod alerts (e.g. "check the prod alerts channel", "any critical errors this week").