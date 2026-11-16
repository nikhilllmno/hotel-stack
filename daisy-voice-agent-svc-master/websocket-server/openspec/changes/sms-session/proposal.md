## Why

Hotel staff need a server-driven **SMS inbox** to see active guest SMS threads (by phone number), open a thread to read message history, and **reply** from the same Twilio line—without exposing Vapi or Twilio keys to the browser. Today there is no dedicated REST surface for this workflow; sessions, conversations, and `conversation_messages` already hold the data, but operators cannot list/filter them safely for a UI.

## What Changes

- **New authenticated REST APIs only** under **`/api/sessions`** (**`hotel_id` from JWT**)—**no** changes to legacy root `/sessions` or agent/webhook contracts:
  - **`GET /api/sessions/sms-sessions`** (and **`GET /api/sessions?session_type=SMS`**) for **distinct** guest lines with **one active SMS session row per `caller_phone_number`**, `session_type = SMS`, `session_status != ended`, paginated with shared **`Pagination`**, list sorted **newest first** by session **`created_at`**.
  - **`GET /api/sessions/sms-sessions/:sessionId/messages`** for paginated messages (**newest first** by **`created_at`**), same **`Pagination`** shape.
  - **`POST /api/sessions/sms-sessions/:sessionId/messages`** with **`{ "body": "..." }`** — outbound SMS via **`smsNotificationService.sendMessage`** with **`from` = `hotels.sms_number`**; inbound remains on existing Twilio webhooks.
- **Persistence**: operator replies are stored as **`conversation_messages`** with **`role = AI`** and **`message`** = **`Response from the manager at {hotel name}: {body}`** (guest SMS uses the plain **`body`**).

## Capabilities

### New Capabilities

- `sms-operator-inbox`: REST APIs and persistence rules for listing active SMS sessions per hotel, loading thread messages, and sending staff replies via Twilio using **`hotels.sms_number`**, with **AI**-role transcript lines prefixed for manager context.

### Modified Capabilities

<!-- No existing OpenSpec capability docs are modified at requirement level; implementation touches Session/Conversation repositories and router auth. -->

## Impact

- **Code**: Routes under **`/api/sessions`** (`coreRouter` + `authMiddleware`), **`ProtectedSessionController`**, **`SessionService`**, repositories; Joi validators in **`sessionSchema.ts`**.
- **APIs**: **New** **`GET/POST /api/sessions/sms-sessions/...`** (and **`GET /api/sessions?session_type=SMS`** for the same list); legacy root **`/sessions`** and webhooks unchanged (**additive**).
- **Data**: Read-heavy queries on `sessions`, `hotels`, `conversations`, `conversation_messages`; writes on send (Twilio + insert **`AI`** row with prefixed **`message`**).
- **External**: Twilio outbound SMS (existing account/token config); **no** new “webhook to send SMS”—webhooks are for **inbound** events only.
