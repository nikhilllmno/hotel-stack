## 1. Schema and Configuration

- [x] 1.1 Create Knex migration to add nullable `cloudbeds_api_token TEXT` column to `hotels` table (with matching down migration)
- [x] 1.2 Update `Hotel` model and Hotel DTO to include optional `cloudbeds_api_token`
- [x] 1.3 Update `HotelRepository` select list / serializer to include `cloudbeds_api_token` (no change needed — uses `select *`)
- [x] 1.4 Document in `.env.example` and README that Cloudbeds tokens are per-hotel (DB-stored) and that base URL is a compile-time constant

## 2. Enum and Factory Wiring

- [x] 2.1 Add `CLOUDBEDS = 'cloudbeds'` to `PmsProvider` enum in `src/types/enums.ts`
- [x] 2.2 Import and add a `case PmsProvider.CLOUDBEDS` branch to `PMSServiceFactory.getReservationService` returning the new Cloudbeds service singleton
- [x] 2.3 Confirm `PMSServiceFactory` switch still falls through to `BadRequestError` for unknown providers

## 3. Directory Layout and Error Classes

- [x] 3.1 Create `src/cloudbeds/{client,services,types,validators,errors,utils}` folders
- [x] 3.2 Implement `CloudbedsAPIError`, `CloudbedsConfigurationError`, `CloudbedsRoomUnavailableError` under `src/cloudbeds/errors/` following `HostawayApiError` style (extend `BaseError`, set `statusCode`)
- [x] 3.3 Export error classes via `src/cloudbeds/errors/index.ts`

## 4. TypeScript Interfaces for Cloudbeds Payloads

- [x] 4.1 Define `CloudbedsRoom`, `CloudbedsRoomsResponse` for `getRooms`
- [x] 4.2 Define `CloudbedsRoomType`, `CloudbedsRoomTypesResponse` for `getRoomTypes`
- [x] 4.3 Define `CloudbedsRate`, `CloudbedsRateDetailed`, `CloudbedsGetRateResponse` for `getRate`
- [x] 4.4 Define `CloudbedsPostReservationRequest`, `CloudbedsPostReservationResponse` for `postReservation`
- [x] 4.5 Define `CloudbedsPutReservationRequest`, `CloudbedsPutReservationResponse` for `putReservation`
- [x] 4.6 Define `CloudbedsPostPaymentRequest`, `CloudbedsPostPaymentResponse` for `postPayment`
- [x] 4.7 Add a shared `CloudbedsApiEnvelope<T>` wrapper for `{ success, data, message? }` responses
- [x] 4.8 Avoid `any`/`unknown` except on fields where Cloudbeds returns genuinely free-form data; document each such exception inline

## 5. Cloudbeds HTTP Client

- [x] 5.1 Create `src/cloudbeds/client/CloudbedsClient.ts` exposing endpoint-typed methods (`getRooms`, `getRoomTypes`, `getRate`, `postReservation`, `putReservation`, `postPayment`)
- [x] 5.2 Accept per-hotel `apiToken` (injected per-call) and construct `Authorization: Bearer <token>` header
- [x] 5.3 Set base URL constant `https://hotels.cloudbeds.com/api/v1.3`
- [x] 5.4 Add a `src/cloudbeds/utils/formEncode.ts` helper that flattens nested objects into Cloudbeds bracket notation (`rooms[0][roomTypeID]=...`) for urlencoded bodies
- [x] 5.5 Wrap axios errors and `success: false` envelope responses into `CloudbedsAPIError`
- [x] 5.6 Add Winston logging around every request with requestId from AsyncLocalStorage (via shared `createHttpClient` which injects x-request-id)
- [x] 5.7 Export a default singleton instance

## 6. Joi Validators

- [x] 6.1 Create `src/cloudbeds/validators/availabilityValidator.ts` for availability/rate query params
- [x] 6.2 Create `src/cloudbeds/validators/reservationValidator.ts` for reservation creation and cancellation inputs
- [x] 6.3 Wire validators into the service layer at method entry

## 7. CloudbedsReservationService — Availability and Quote

- [x] 7.1 Create `src/cloudbeds/services/reservationService.ts` implementing `IPMSReservationService` (singleton export)
- [x] 7.2 Implement `getRoomsInfo(businessId)` → calls `getRooms` and maps to PMS-agnostic room objects
- [x] 7.3 Implement `getRoomTypeMap(...)` using `getRoomsInfo` results
- [x] 7.4 Implement a private helper to resolve hotel → `{ propertyID, apiToken }` (throws `CloudbedsConfigurationError` if missing)
- [x] 7.5 Implement `getQuote(params: PMSQuoteRequest)` → calls `getRate` for one `roomTypeID` (mapped from `room_id`), computes `base_rate`/`taxes`/`total_amount`, stores raw `getRate` response in `raw_response`. (Note: `force_full_payment` handling is a hotel-configuration concern applied in `roomReservationService`; the PMS service always returns `amountCharged = total_amount` like Stayntouch.)
- [x] 7.6 Implement `getRoomAvailabilityWithQuote` → calls `getRoomTypes`, filters by `roomsAvailable > 0`, parallel `getRate` per available room type, returns `{ groups, discount: null }`
- [x] 7.7 Implement `getRoomAvailabilityWithQuoteLite` → same logic returning simplified natural-language strings
- [x] 7.8 Ensure all monetary values are rounded to two decimals (using roundCurrency() function)

## 8. CloudbedsReservationService — Reservation Lifecycle

- [x] 8.1 Implement `createReservation(params: CreateReservationParams)` building the urlencoded body per spec:
      - `paymentMethod=credit` with `cardToken=customer.payment_provider_customer_id` and `paymentAuthorizationCode=payment.booking_confirmation_id` when both are present
      - fall back to `paymentMethod=cash` (no card fields) and log a warning otherwise
- [x] 8.2 Map Cloudbeds `reservationID` → `CreateReservationResponse.reservation_id`
- [x] 8.3 Implement `cancelReservation({ business_id, external_id, ... })` → `PUT /putReservation` with `status=canceled`, returning the mapped response
- [x] 8.4 Implement `validateRoomAvailability` — calls `getRoomTypes` and compares inventory against required per-type counts, throwing `CloudbedsRoomUnavailableError` on shortfall

## 9. Deferred Operations Guards

- [x] 9.1 `modifyReservation` and `getQuoteForModification` throw `BadRequestError` with clear "not yet supported for Cloudbeds" messages
- [x] 9.2 `getMultiRoomAvailabilityWithQuote` and `getMultiRoomAvailabilityWithQuoteLite` throw `BadRequestError` with the same pattern
- [x] 9.3 `getWebRoomAvailabilityV2` throws `BadRequestError` (matches Stayntouch's deferred stance; web/B2C flow is not in scope for initial Cloudbeds rollout)

## 10. Stripe Webhook — Autocharge

- [x] 10.1 Add a `createCloudbedsPayments(reservations, amountPaid, currency)` helper in `stripeWebhookService` that mirrors `createHostawayOfflineCharges` but calls the Cloudbeds client's `postPayment` endpoint
- [x] 10.2 In `handleInvoicePaymentSucceeded`, branch on `reservations[0].pms_provider` and call `createCloudbedsPayments` when it equals `PmsProvider.CLOUDBEDS` (leave the Hostaway branch untouched)
- [x] 10.3 In `handlePaymentIntentSucceeded`, add the same Cloudbeds branch alongside the existing `createHostawayOfflineCharges` call so first-charge autocharges are also recorded (both main path and `manual_charge` path)
- [x] 10.4 Distribute `invoice.amount_paid` / `payment.amount_charged` across multiple reservations the same way Hostaway does (per-reservation `quote.amount_charged`)
- [x] 10.5 Skip reservations with no `external_id` with a warning (do not fail the whole webhook)

## 11. Reservation Storage and Mapping

- [x] 11.1 Verified via `roomReservationService.createReservationsPostPayment` — the existing `pmsResponse.reservation_id` path writes to `reservations.external_id`, and the Cloudbeds service returns `reservation_id: response.reservationID`
- [x] 11.2 Verified `quote_object.raw_response` round-trips — `QuoteRepository.create` inserts the PMSQuote as-is into the `quote_object` JSONB; `raw_response` on the returned quote persists automatically

## 12. Logging and Observability

- [x] 12.1 Winston `info` logs at every Cloudbeds request/response boundary — shared `createHttpClient('cloudbeds', ...)` emits `Cloudbeds Request` / `Cloudbeds Response` logs with `{ method, url, status, duration, headers, body }`; per-endpoint wrappers log `{ endpoint, hotelId, ...params }`
- [x] 12.2 `CloudbedsClient.wrapAxiosError` emits error logs with `{ endpoint, status, message, errorCode }`
- [x] 12.3 `apiToken` redacted — shared `createHttpClient` redacts the `authorization` header (see `REDACTED_HEADERS` in `src/utils/httpClient.ts`); per-endpoint logs never include the raw token

## 13. Testing

- [ ] 13.1 Unit-test the Cloudbeds form-encoding helper (`rooms[0][roomTypeID]` flattening)
- [ ] 13.2 Manually run the full flow against sandbox property `320454` (token from `cloudbeds_plan.txt`): availability → quote → reservation → cancellation → autocharge
- [ ] 13.3 Regression-test existing ResNexus, Hostaway, Stayntouch flows on at least one hotel each
- [ ] 13.4 Verify `quote_object.raw_response` is persisted and returned on retrieval for a Cloudbeds quote
- [ ] 13.5 Verify `postPayment` is called once per reservation on `invoice_payment.paid` for a Cloudbeds hotel
- [ ] 13.6 Verify deferred-operation guards throw `BadRequestError` with the expected messages

## 14. Documentation

- [x] 14.1 Inline JSDoc blocks added across `CloudbedsClient`, `reservationService`, `formEncode`, types, and errors explaining API mappings
- [x] 14.2 Added `PMS-Readme/Cloudbeds_integration.md` (mirrors `Stayntouch_integration.md`) covering provisioning, reservation flow, file layout, deferred capabilities, errors, and manual-verification checklist
- [x] 14.3 `cardToken` / `paymentAuthorizationCode` → Stripe mapping documented in the service file header, at the `createReservation` call site, in `CloudbedsPostReservationRequest` JSDoc, and in `PMS-Readme/Cloudbeds_integration.md`
