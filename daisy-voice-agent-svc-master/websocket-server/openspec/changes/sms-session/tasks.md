## 1. Routing and auth

- [x] 1.1 Add **new** protected routes only under **`/api/sessions`** (`authMiddleware` via `coreRouter`); **`hotel_id` from JWT** (no `:hotelId` in path). Do **not** change legacy `/sessions` (root) or webhook routes.
- [x] 1.2 Define Joi validators in **`sessionSchema.ts`**: **`smsInboxPaginationQuerySchema`** (`page` / `limit`), **`smsInboxSendBodySchema`** (`body` string bounds).

## 2. Schema

- [x] 2.1 operator sends persist as **`AI`** with prefixed **`message`** (no dedicated migration in repo).

## 3. Data access

- [x] 2.3 **`SessionRepository`**: paginated **distinct** active SMS sessions per `hotel_id` (`session_type = SMS`, `session_status != ended`), **`DISTINCT ON (caller_phone_number)`** with **`created_at DESC`** tie-break; outer list **`ORDER BY created_at DESC`**; **total count** query for pagination.
- [x] 2.4 **`ConversationMessageRepository`**: paginated messages for conversation (**all roles** for inbox), ordered by **`created_at DESC`**; **total count** for pagination.
- [x] 2.5 Session lookup by id + **`hotel_id`** from JWT; load hotel (e.g. **`getHotelById`**) for **`sms_number`** and **`name`** on send.

## 4. Services and controllers

- [x] 3.1 **`SessionService`**: `listActiveSmsSessions`, `listSmsInboxMessages`, `sendSmsInboxManagerReply`; response shape **`{ data, pagination: Pagination }`** for both list APIs.
- [x] 3.2 **`ProtectedSessionController`**: handlers for SMS routes + **`GET /api/sessions`** with **`session_type=SMS`** delegating to the same list.

## 5. Outbound SMS and persistence

- [x] 4.1 **`smsNotificationService.sendMessage`**: `to` = session **`caller_phone_number`**, `from` = **`hotels.sms_number`** (reject if missing); SMS body = operator **`body`** (no prefix in Twilio).
- [x] 4.2 Insert **`conversation_messages`** after send with **`role = AI`**, **`message`** = **`Response from the manager at {hotel name}: {body}`** via **`ConversationService.createConversationMessage`**.

## 6. Quality

- [ ] 5.1 Add unit/integration tests for repository queries or service with test DB
- [ ] 5.2 Manual test: list → pagination → messages → send; verify Twilio **`from`** and DB **`AI`** row with prefixed **`message`**

## 7. Documentation

- [x] 6.1 Endpoints, auth, ordering, and pagination documented in **OpenSpec** (`design.md`, `proposal.md`, **`specs/sms-operator-inbox/spec.md`**)
