## Context

- **Isolation**: All three HTTP APIs (list threads, list messages, send) are **new** routes under the protected API surface (`/api` + `authMiddleware`). They **must not** modify behavior of unrelated routes (legacy `/sessions` at app root, webhooks, etc.). Implementation adds **new** router/controller/service methods on `sessionRouter` / `ProtectedSessionController` / `SessionService` rather than changing existing agent handlers.
- **Data model**: `sessions` holds `caller_phone_number`, `assistant_phone_number`, `session_type`, `session_status`, `hotel_id`. `conversations` links via `conversation_session_id`. `conversation_messages` links to `conversations.id` as `conversation_id`. **`hotels`** holds **`sms_number`** (per-hotel Twilio sender used across the app).
- **SMS transport**: Outbound SMS uses `smsNotificationService.sendMessage` (Twilio `messages.create`) and `HOTEL_TWILIO_CONFIG` keyed by the same sender number as **`hotels.sms_number`**. Inbound SMS uses Twilio **webhooks**; webhooks do **not** send outbound messages.
- **Staff UI vs legacy `/sessions`**: Root `/sessions` routes use `validatePhoneNumber` for agent/tool flows—**not** suitable for staff UI. SMS inbox lives under **`/api/sessions`** with **`authMiddleware`**; **hotel scope** comes from **`hotel_id` on the JWT** (no `hotelId` path segment).

## Goals / Non-Goals

**Goals:**

- Paginated **distinct** `caller_phone_number` list for `session_type = 'SMS'` and `session_status <> 'ended'` (map enum values to DB strings used today, e.g. `in-progress` vs `ended`).
- Paginated **messages** for a session via `sessions` → `conversations` → `conversation_messages`.
- **Consistent pagination metadata** on both list and messages responses: **`Pagination`** (`current_page`, `limit`, `total`, `total_pages`, `next_page`, `prev_page`).
- **Send** reply using Twilio with **`from` = `hotels.sms_number`** for the session’s hotel; persist in **`conversation_messages`** with **`role = AI`** and message text  
  **`Response from the manager at {hotel name}: {body}`** (guest still receives the raw **`body`** over SMS).

**Non-Goals:**

- Customer name enrichment (CRM)—explicitly out of scope for v1.
- Real-time push (WebSocket)—polling or separate work.
- Modifying n8n/Vapi SMS agent logic beyond what’s needed for persistence.

## Decisions

1. **Distinct list row selection**  
   **Decision**: One row per `caller_phone_number` per hotel using PostgreSQL `DISTINCT ON (caller_phone_number) ... ORDER BY caller_phone_number, created_at DESC`, then outer **`ORDER BY sub.created_at DESC`** so the list shows the **most recently created** active SMS session per guest and **newest threads first** in the inbox list.  
   **Alternatives**: `updated_at` for tie-breaking—superseded in favor of **`created_at`** for both selection and sort. Duplicating every session row per guest—rejected.

2. **Auth**  
   **Decision**: **`authMiddleware`** on `coreRouter`; **`hotel_id`** taken from the JWT (same pattern as other `/api` resources). No `hotelId` in the URL for these endpoints.  
   **Alternatives**: `apiKeyMiddleware` only, or `/api/hotel/:hotelId/...`—rejected; final implementation scopes by token only.

3. **Outbound SMS “from” address**  
   **Decision**: Use **`hotels.sms_number`** for `sessions.hotel_id` → `hotels.id`. Pass as `from` to **`smsNotificationService.sendMessage`** (must match `HOTEL_TWILIO_CONFIG`, same as other SMS flows). Reject send if `sms_number` is missing.  
   **Alternatives**: `sessions.assistant_phone_number` without hotel validation—rejected.

4. **Message role for operator send**  
   **Decision**: No separate **`MANAGER`** role. Persist staff replies as **`AI`** with **`message`** set to **`Response from the manager at {hotel.name}: {body}`** (fallback name **`the hotel`** if missing). Twilio payload uses the operator’s plain **`body`**.  
   **Alternatives**: Dedicated **`MANAGER`** enum / migration—rejected; use **`AI`** plus prefixed transcript text.

5. **Message list sort order**  
   **Decision**: Paginated inbox messages are ordered by **`conversation_messages.created_at DESC`** (newest first).  
   **Alternatives**: Chronological ascending by `timestamp`—rejected for operator inbox UX (latest on top).

6. **Pagination response shape (both endpoints)**  
   **Decision**: Same **`Pagination`** as other `/api` list endpoints: **`{ current_page, limit, total, total_pages, next_page, prev_page }`** via **`getPaginationUrls`**. Query params: **`page`** and **`limit`** (validated in **`sessionSchema.ts`**: `smsInboxPaginationQuerySchema`).

7. **API paths (final)**  
   Mounted under **`coreRouter`** at **`/api/sessions`** (see `sessionRouter`):
   - **`GET /api/sessions/sms-sessions?page=&limit=`** — distinct active SMS threads for the JWT hotel.
   - **`GET /api/sessions/sms-sessions/:sessionId/messages?page=&limit=`** — messages for that session.
   - **`POST /api/sessions/sms-sessions/:sessionId/messages`** — body `{ "body": "<string>" }` (validated by **`smsInboxSendBodySchema`** in **`sessionSchema.ts`**).
   - **`GET /api/sessions?session_type=SMS&page=&limit=`** — same thread list as the first endpoint (delegates to the same controller/service path).

8. **Layering**  
   **Decision**: SMS inbox logic lives in **`SessionService`** (with **`SessionRepository`**, **`ConversationService`** / **`ConversationMessageRepository`** for messages and inserts). No separate `SmsOperatorInboxService` type.

## Risks / Trade-offs

- **Duplicate active sessions per guest** (data anomaly) → Mitigation: `DISTINCT ON` + `created_at` ordering; optional admin cleanup later.  
- **Twilio deliverability** → Mitigation: log Twilio errors; generic error to client where appropriate.  
- **Migrations** → Use **`npm run migrate`** (builds then runs) so **`dist/migrations`** includes new files. No repo migration ships for **`MANAGER`** / **`116`** / **`117`**—operator sends use existing **`AI`** + prefixed **`message`** only.

## Migration Plan

1. Ship read APIs + pagination; validate against staging.  
2. Ship send path: Twilio + insert **`AI`** row with manager prefix as above.

## Open Questions

- Confirm canonical **`session_status`** values for “not ended” (e.g. only `in-progress` vs other intermediate states).  
- Whether list should filter by **assistant line** (`assistant_phone_number`) when a hotel has multiple numbers.
