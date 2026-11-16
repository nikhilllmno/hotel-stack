## ADDED Requirements

### Requirement: Additive API surface (no change to existing flows)
The three capabilities below (session list, message list, operator send) SHALL be implemented as **new** HTTP routes with **new** path prefixes. The system SHALL **not** alter the behavior, URLs, middleware chains, or response shapes of existing public or agent-facing APIs (including but not limited to `/sessions`, Twilio inbound webhooks, n8n tool routes, and reservation SMS helpers).

#### Scenario: Existing clients unchanged
- **WHEN** existing integrations call current production endpoints unrelated to this feature
- **THEN** their request and response behavior SHALL remain unchanged

### Requirement: List active SMS threads for a hotel
The system SHALL expose a **new** paginated API that returns one row per **distinct** `caller_phone_number` for which there exists at least one **active** SMS session for the authenticated hotel, where **active** means `session_type = 'SMS'` and `session_status` is not `'ended'`.

#### Scenario: Successful list with pagination
- **WHEN** an authenticated user requests the list with **`hotel_id` on the JWT** and pagination query parameters **`page`** and **`limit`**
- **THEN** the system SHALL return a page of items each containing at minimum: `caller_phone_number`, the **canonical session id** for that row (the session used for the thread—see design for tie-breaking), `assistant_phone_number`, `session_status`, `created_at`, `updated_at`
- **AND** the response SHALL include **pagination metadata** matching the shared **`Pagination`** shape: **`current_page`** (1-based), **`limit`**, **`total`**, **`total_pages`**, **`next_page`**, **`prev_page`**

#### Scenario: Distinct phone numbers only
- **WHEN** multiple session rows exist for the same `caller_phone_number` and hotel that still satisfy the active SMS filter
- **THEN** the system SHALL return at most **one** list row per `caller_phone_number` per request (deterministic rule: **`DISTINCT ON (caller_phone_number)`** with **`created_at DESC`** tie-break; list sorted **newest session first** by **`created_at`**)

#### Scenario: Wrong hotel or unauthorized
- **WHEN** the caller is not allowed to access the hotel
- **THEN** the system SHALL respond with `403` or `404` without leaking whether the hotel exists

### Requirement: List messages for an SMS session
The system SHALL expose a **new** paginated API that returns messages for the **conversation** linked to a given **session id**, ordered **newest first** by **`created_at`** (descending).

#### Scenario: Resolve session to conversation
- **WHEN** a valid active SMS session id is provided for the authenticated hotel
- **THEN** the system SHALL resolve `conversations.conversation_session_id = sessions.id` and read rows from `conversation_messages` for that conversation’s `conversation_id`

#### Scenario: Paginated messages
- **WHEN** the client requests messages with pagination parameters
- **THEN** the system SHALL return a page of messages including at minimum: `id`, `role`, `message`, `timestamp` (or `created_at`)
- **AND** the response SHALL include the **same `Pagination` shape** as the session list API (`current_page`, `limit`, `total`, `total_pages`, `next_page`, `prev_page`)

#### Scenario: Session not found or not SMS / ended
- **WHEN** the session id does not exist, belongs to another hotel, is not `SMS`, or is `ended`
- **THEN** the system SHALL return `404` or `400` with a clear error code

### Requirement: Send outbound operator SMS for a session
The system SHALL expose a **new** API that sends an SMS to the session’s `caller_phone_number` using the **`sms_number`** stored on the **`hotels`** row for that session’s `hotel_id` as the Twilio **from** address (aligned with existing `HOTEL_TWILIO_CONFIG` / `smsNotificationService` behavior). The Twilio message body SHALL be the operator’s submitted text. The system SHALL persist the send in `conversation_messages` with **`role = AI`** and **`message`** text of the form **`Response from the manager at {hotel name}: {body}`** (using the hotel’s display name when available).

#### Scenario: Successful send via Twilio
- **WHEN** the operator submits a non-empty message body for a valid active SMS session for their hotel
- **THEN** the system SHALL load the hotel’s `sms_number` from `hotels`, call Twilio’s REST API to create the outbound message via the existing SMS notification path with `from` = that `sms_number` and the plain **`body`** as the SMS text, and insert a `conversation_messages` row with **`role` AI** and the prefixed **`message`** string associated with the conversation

#### Scenario: Twilio or configuration failure
- **WHEN** Twilio rejects the message, the hotel has no `sms_number`, or there is no valid Twilio mapping for that number
- **THEN** the system SHALL return an error response and SHALL NOT claim success; optionally no DB row or a failed state per design

#### Scenario: Inbound vs outbound transport
- **WHEN** documenting behavior for operators
- **THEN** documentation SHALL state that **inbound** SMS continues to use existing **Twilio webhooks**; **outbound** uses Twilio **REST** (`messages.create`), not a webhook

### Requirement: Operator reply transcript in storage
Staff-originated SMS replies SHALL be persisted as normal **`AI`** role rows; the **`message`** field SHALL carry the human-readable prefix **`Response from the manager at {hotel name}:`** so the thread transcript distinguishes operator sends without a dedicated **`MANAGER`** role value.

#### Scenario: Persisted role for operator send
- **WHEN** an operator send succeeds
- **THEN** the inserted `conversation_messages` row SHALL use **`AI`** as the role value and SHALL include the manager prefix in **`message`** as specified in design

### Requirement: Authentication and authorization
All list, message, and send endpoints SHALL require **authenticated** access and SHALL scope data by **hotel** using **`hotel_id` from the JWT** (sessions must match that hotel). Paths are under **`/api/sessions/...`** (no `hotelId` URL segment for these operations).

#### Scenario: Unauthenticated request
- **WHEN** a request omits valid auth
- **THEN** the system SHALL return `401`
