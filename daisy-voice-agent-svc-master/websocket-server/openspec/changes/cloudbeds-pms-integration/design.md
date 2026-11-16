## Context

The Daisy Voice Agent Service currently supports three PMS providers — ResNexus, Hostaway, and Stayntouch — through a factory pattern in `/src/pms/PMSServiceFactory.ts`. Each provider has a dedicated directory (`/src/resNexus/`, `/src/hostaway/`, `/src/stayntouch/`) implementing the `IPMSReservationService` interface. The `roomReservationService` orchestrates availability, quoting, reservation creation, cancellation, and modification by delegating to the factory-resolved provider.

Cloudbeds exposes a REST API at `https://hotels.cloudbeds.com/api/v1.3` with Bearer token authentication. Tokens are issued per property (partner OAuth apps produce `cbat_*` tokens scoped to a single `propertyID`). The endpoints relevant to this change are:

1. `GET /getRooms?propertyIDs=<id>` — physical rooms grouped by room type. Used primarily for room-type metadata (names, descriptions, max guests).
2. `GET /getRoomTypes?propertyIDs=<id>&startDate=&endDate=&adults=&children=` — availability per room type with a headline `roomRate` and `roomsAvailable`.
3. `GET /getRate?roomTypeID=&startDate=&endDate=&adults=&children=&propertyID=&detailedRates=true` — per-night and total rate for a specific room type.
4. `POST /postReservation` (multipart / urlencoded form) — creates a reservation. Accepts `cardToken` (Stripe customer id) and `paymentAuthorizationCode` (Stripe latest_charge id) when `paymentMethod=credit`.
5. `PUT /putReservation` (urlencoded) — cancellation via `status=canceled`.
6. `POST /postPayment` — records a payment against an existing reservation; used for autocharge after Stripe `invoice_payment.paid`.

Existing Stripe webhook plumbing already populates the values Cloudbeds needs:
- `customers.payment_provider_customer_id` = Stripe customer id, updated by `handlePaymentIntentSucceeded`.
- `payments.booking_confirmation_id` = Stripe latest_charge id (from `extractLatestChargeId`), updated by both `handlePaymentIntentSucceeded` and `handleInvoicePaymentSucceeded`.

Relevant integration seams:
- `PmsProvider` enum in `/src/types/enums.ts`.
- `PMSServiceFactory.getReservationService()` switch.
- `roomReservationService.createReservationsPostPayment()` (called from `handlePaymentIntentSucceeded`).
- `roomReservationService.cancelReservation()` (routes to PMS `cancelReservation`).
- `stripeWebhookService.handleInvoicePaymentSucceeded()` — today calls `createHostawayOfflineCharges`; Cloudbeds needs an analogous `postPayment` branch.

## Goals / Non-Goals

**Goals:**
- Add Cloudbeds as a supported PMS for single-room availability, quotes, reservation creation, and cancellation.
- Reuse the existing factory + `IPMSReservationService` contract without modifying its interface types (per explicit constraint in `cloudbeds_plan.txt`).
- Keep Cloudbeds-specific types strictly typed — define interfaces for every request/response shape; use `any`/`unknown` only where Cloudbeds returns genuinely free-form data.
- Record Stripe autocharges (`invoice_payment.paid`) in Cloudbeds via `postPayment`, mirroring how Hostaway offline charges are posted.
- Persist the full raw Cloudbeds response in the existing `quote_object.raw_response` JSONB field for audit/debugging parity with Hostaway and Stayntouch.
- Preserve backward compatibility: hotels on other PMS providers are unaffected.

**Non-Goals:**
- Reservation modification (date / occupancy changes) — the service will throw `BadRequestError` from `modifyReservation`, matching the current Hostaway guardrail.
- Multi-room reservations — `getMultiRoomAvailability*` and any multi-room booking branch throw `BadRequestError`.
- Inbound Cloudbeds webhooks into Daisy.
- Migration of existing hotels from other PMS providers to Cloudbeds.
- Changing `IPMSReservationService` interface types.

## Decisions

### 1. Provider implementation location
**Decision:** Create `/src/cloudbeds/` with sub-folders `client/`, `services/`, `types/`, `validators/`, `errors/`, `utils/`, mirroring `/src/stayntouch/`.

**Rationale:** Consistent with existing per-PMS layout; keeps Cloudbeds-specific payload shapes and mappers isolated.

**Alternatives considered:**
- Dropping Cloudbeds logic inside `/src/pms/` as a generic: rejected; Cloudbeds has provider-specific form-encoding and nested `rooms[0][roomTypeID]` syntax that does not generalize.
- Sharing an HTTP client across PMS providers: rejected; each PMS has distinct auth, base URL, and error shapes.

### 2. Credential storage: propertyID + API token
**Decision:** Use the existing `hotels.business_id` column for `propertyID`. Add a new column `hotels.cloudbeds_api_token` (nullable TEXT, migration-only) for the per-property Bearer token.

**Rationale:** Cloudbeds tokens are issued per property, not per application — there is no meaningful shared value to keep in env vars (unlike Stayntouch's shared API key). Storing the token alongside other hotel-level credentials keeps multi-tenant parity and lets a single deployment serve many Cloudbeds properties.

**Alternatives considered:**
- Single global `CLOUDBEDS_TOKEN` env var: rejected; it would only work for a single-property deployment.
- Storing the token in `hotel_configurations` JSON: rejected; follows Stripe-per-hotel pattern which uses a dedicated column on `hotels` for easier SQL-level reasoning and indexing.
- Storing OAuth refresh tokens and performing token refresh: rejected for initial scope; partner-issued long-lived `cbat_*` tokens are sufficient for the sandbox and initial production rollout. Refresh flow can be added later without breaking the schema.

### 3. IPMSReservationService mapping
**Decision:** Implement `IPMSReservationService` without changing its types. `room_id` in `PMSQuoteRequest` is mapped to Cloudbeds `roomTypeID`. Multi-room and `getQuoteForModification` throw `BadRequestError`.

**Rationale:** The plan explicitly forbids changing the interface. Cloudbeds' `roomTypeID` is the appropriate target for the existing single-room flow; Daisy already treats `room_id` as PMS-specific per the interface docstring.

### 4. Availability flow
**Decision:** `getRoomAvailabilityWithQuote` calls `getRoomTypes` (step 1) for the requested date range to discover available room types with `roomsAvailable > 0`, then calls `getRate` (step 2) per available room type in parallel (`Promise.all`) to obtain `roomRate`, `totalRate`, and `roomRateDetailed` per-night breakdown. Room-type metadata (description, max guests) comes from `getRooms`, cached on a short-lived in-memory basis keyed by `propertyID` for the request lifetime.

**Rationale:**
- Mirrors Stayntouch's two-step flow and matches Hostaway's parallel-per-listing availability pattern.
- Cloudbeds' `getRoomTypes` already returns most display fields, so `getRooms` is only needed when richer descriptions are requested.
- Parallel `getRate` calls keep voice-agent latency low; Cloudbeds' API tolerates modest concurrency.

**Alternatives considered:**
- Single `getRoomTypes` call returning headline `roomRate` as the quote: rejected; it lacks per-night breakdown needed for detailed SMS/voice responses and for `quote_modified_by_dextr`.
- Sequential `getRate` calls: rejected for latency; parallel is safe here because we do not mutate shared state between calls.

### 5. Rate handling, taxes, and totals
**Decision:** Compute `base_rate` = sum of `roomRateDetailed[*].rate` (pre-tax nightly rates), `total_amount` = `totalRate` from `getRate`. Because `getRate` does not itemize taxes/fees, compute `taxes = total_amount - base_rate` with a floor at 0 and store it as a single line item. Persist the full `getRate` response in `quote_object.raw_response`.

**Rationale:** Cloudbeds' v1.3 `getRate` does not break out taxes and fees separately — only the aggregate `totalRate`. Treating the delta as `taxes` keeps `PMSQuote` invariants satisfied while the raw response preserves fidelity for future breakdowns.

**Alternatives considered:**
- Calling a separate Cloudbeds tax endpoint: not available in v1.3 for public consumption.
- Leaving `taxes = 0` and inflating `base_rate`: rejected; it would mis-report "pre-tax" figures to guests.

### 6. Payment method during reservation creation
**Decision:** `createReservation` sets `paymentMethod="credit"`, `cardToken = reservation.customer.payment_provider_customer_id`, `paymentAuthorizationCode = payment.booking_confirmation_id`. If either is missing (e.g. Shift4 path), fall back to `paymentMethod="cash"` without `cardToken`/`paymentAuthorizationCode` and log a warning; the reservation still gets created and any downstream recording happens via `postPayment`.

**Rationale:** The plan defines the exact mapping. Fallback prevents hard failures for non-Stripe hotels while surfacing the anomaly in logs for ops review.

### 7. Autocharge via `postPayment`
**Decision:** Extend `stripeWebhookService.handleInvoicePaymentSucceeded` (and the corresponding path in `handlePaymentIntentSucceeded` that calls `createHostawayOfflineCharges`) to branch on `reservation.pms_provider`. When it equals `PmsProvider.CLOUDBEDS`, call a new `createCloudbedsPayments` helper that invokes `POST /postPayment` with `propertyID`, `reservationID = reservation.external_id`, `type="credit"`, `amount` (distributed per-reservation analogous to Hostaway), `description="Advance deposit"`, `cardType=""` (blank per plan unless detectable).

**Rationale:** Keeps parity with Hostaway's offline-charge recording path and avoids a parallel webhook router. `cardType` is optional in Cloudbeds' API, and blank is acceptable.

**Alternatives considered:**
- Routing autocharge through a dedicated payment-provider-specific hook: rejected as over-engineering for a single new branch.

### 8. Cancellation flow
**Decision:** `cancelReservation` calls `PUT /putReservation` with `propertyID`, `reservationID = external_id`, `status=canceled`. The method returns the mapped response so `roomReservationService.cancelReservation` can continue its existing post-cancellation workflow.

**Rationale:** Straight translation of the documented API; no refund handling is performed here (refunds remain in Stripe's responsibility or a future capability).

### 9. Error handling
**Decision:** Create `CloudbedsAPIError`, `CloudbedsConfigurationError`, and `CloudbedsRoomUnavailableError` under `/src/cloudbeds/errors/`, each extending the existing `BaseError` pattern with `statusCode`. The client inspects `response.data.success === false` and throws `CloudbedsAPIError` with the Cloudbeds `message`/`errorCode` on the error payload; HTTP-level axios errors are wrapped the same way.

**Rationale:** Mirrors Hostaway/Stayntouch error-class style and gives `roomReservationService` predictable failure modes.

### 10. Request encoding
**Decision:** Use `application/x-www-form-urlencoded` for all write endpoints (`postReservation`, `putReservation`, `postPayment`). Serialize nested arrays (`rooms[0][roomTypeID]`, `adults[0][quantity]`, etc.) via a small helper in `/src/cloudbeds/utils/` that flattens objects into the bracket notation Cloudbeds expects. Reads (`getRooms`, `getRoomTypes`, `getRate`) use standard query strings via axios.

**Rationale:** Cloudbeds' docs and real-world curl samples confirm urlencoded form bodies are accepted for writes and are simpler than multipart. Centralizing the flattening helper keeps the reservation service free of serialization noise.

### 11. Raw-response storage
**Decision:** Attach the raw `getRate` response to the `PMSQuote.raw_response` field (same pattern as Hostaway and Stayntouch). The `postReservation` raw response is logged but not persisted to the quote; the reservation's Cloudbeds `reservationID` is stored in `reservations.external_id`.

**Rationale:** Keeps a clean separation between quote-time data (stays in `quote_object`) and reservation-time data (stays on the reservation row).

## Risks / Trade-offs

- **Risk:** Cloudbeds tax figures are not itemized in v1.3; guests may see a single taxes line rather than jurisdictional taxes and fees.
  **Mitigation:** Document the limitation; reserve room in `quote_modified_by_dextr` for future per-jurisdiction breakdown if Cloudbeds exposes it.

- **Risk:** Per-property API tokens complicate provisioning — each hotel must have its `cloudbeds_api_token` set before go-live.
  **Mitigation:** Fail fast with `CloudbedsConfigurationError` when the token is missing, with a log line that names the hotel and required column.

- **Risk:** `getRate` may rate-limit under parallel calls for large properties.
  **Mitigation:** Parallelize with `Promise.all` but cap concurrency if needed via a small `p-limit`-style semaphore (defer until observed); back off on 429.

- **Risk:** `paymentAuthorizationCode` / `cardToken` missing when `createReservation` is called (e.g. reservations created before payment completes).
  **Mitigation:** Guard with explicit checks; if missing and `paymentMethod` would otherwise be `credit`, fall back to `cash` and rely on `postPayment` to record the actual charge post-webhook.

- **Trade-off:** Adding a new `hotels.cloudbeds_api_token` column instead of a generic JSON credential blob.
  **Acceptance:** Matches existing Stripe-per-hotel columns (`stripe_secret_key`, `stripe_webhook_secret`), keeping the schema uniform.

- **Trade-off:** Deferring modification and multi-room.
  **Acceptance:** Explicitly requested by the plan; guarded by `BadRequestError` to surface the limitation clearly if invoked.

## Migration Plan

1. **Schema migration**
   - Add `cloudbeds_api_token TEXT NULLABLE` column to `hotels` table via a new `/src/migrations/` file.
   - Update the `Hotel` model and DTO to include the new optional field.

2. **Configuration**
   - Add a constant `CLOUDBEDS_BASE_URL = 'https://hotels.cloudbeds.com/api/v1.3'` in `/src/cloudbeds/client/cloudbedsClient.ts` (no env var required).
   - Document in `.env.example` that Cloudbeds tokens are per-hotel and stored in the database.

3. **Deployment**
   - Run migration on the target database.
   - For each hotel that uses Cloudbeds, update `hotels.pms_provider = 'cloudbeds'`, `hotels.business_id = <propertyID>`, and `hotels.cloudbeds_api_token = <cbat_token>`.
   - Deploy application code — hotels on other PMS providers are unaffected.

4. **Rollback**
   - Revert deployment.
   - Drop `hotels.cloudbeds_api_token` column via a down migration.
   - Re-point any Cloudbeds hotels to their previous PMS provider if necessary.

5. **Testing**
   - Use sandbox property `320454` (per plan) for end-to-end flow: availability → quote → reservation → cancellation → autocharge.
   - Regression-test ResNexus / Hostaway / Stayntouch flows by exercising at least one hotel per provider.

## Open Questions

- **Q:** Should Cloudbeds reservations support discount application on the quote the way ResNexus/Hostaway do today?
  **A:** Initial release applies discounts to `base_rate` locally (same as other providers) but does not push discount metadata to Cloudbeds. Cloudbeds surcharges/fees remain opaque, so discount-as-negative-adjustment is kept Dextr-side.

- **Q:** How do we determine `cardType` in `postPayment` (visa, mc, etc.)?
  **A:** Leave blank for v1; Stripe's payment method card brand could be passed later if needed.

- **Q:** Should we gate Cloudbeds behind a feature flag on the hotel?
  **A:** Not necessary — `pms_provider` already acts as the gate via `PMSServiceFactory`.
