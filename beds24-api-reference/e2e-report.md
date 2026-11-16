# Beds24 hotel API end to end test report

Core reservation, pricing, inventory and housekeeping workflows passed live tests on **Lotus Demo Hotel (TEST)**, property **366736**, on **8 November 2026** in Asia/Kolkata. The hotel has 20 units across Standard Double, Deluxe Double and Family Suite, with prices in INR. All original baseline comparisons passed after cleanup.

This is a point-in-time functional check of the operations described below. It does not certify the entire PMS, every field combination, production readiness, performance or connected payment and channel workflows.

## Coverage

The official catalog contains **38 entries**: **33 documented callable methods**, **4 marked Coming soon**, and **1 outbound webhook definition**. This run exercised **26 of the 33 callable methods** through 76 journaled requests plus the initial invite-code exchange, which occurred before the journal began.

| Outcome | Callable methods | Meaning |
| --- | ---: | --- |
| Passed | 18 | The stated operation and its relevant readback or outcome passed. |
| Passed with caveat | 2 | Useful behavior passed, with a specific limitation described below. |
| Behavior unverified | 1 | The request returned success but the intended message read-state change was not observed. |
| Empty response | 5 | The route returned HTTP 200 with empty data; its connected workflow remains unverified. |
| Not tested | 7 | Required account scope or external integration was absent, or external changes were outside this test. |
| **Total callable methods** | **33** | **26 exercised, including the five empty responses.** |

The four Coming soon entries and the webhook definition are outside that callable-method total. Alpha and beta labels in the matrix are vendor labels from the published schema; an unlabelled stage does not imply a stability guarantee.

## Results that were verified

- **Reservations:** created and retrieved a temporary reservation, changed its room, unit, dates and guest fields, then cancelled and deleted it. Inventory decreased on creation, moved with the reservation and was released after cancellation. Read-after-delete confirmed absence.
- **Financial and booking information:** created, read, updated and removed test invoice charges and booking info items. The invoice endpoint reflected the remaining INR 9,000 accommodation charges. Invoice numbering and finalization were not tested.
- **Internal notes and housekeeping:** created and retrieved an internal note; no test messages remained after booking deletion. Changed one physical unit's housekeeping status and color, read the changes back and restored its original values.
- **Rates and offers:** changed the Standard nightly fixed rate from INR 3,000 to 3,100 and back; the two-night quote moved from INR 6,000 to 6,200 and back. A daily price of INR 2,500 plus the following night's INR 3,000 produced INR 5,500. Quantity 8 and minimum stay 2 were enforced.
- **Availability rejection:** blackout with quantity zero produced no offer. Attempting a reservation returned HTTP 201 with per-item `success=false` and a no-availability error; no reservation was created. Integrations must inspect each result and its errors rather than treating an HTTP success code as booking success.
- **Authentication:** invite exchange, access-token refresh, scope and validity inspection, and temporary refresh-token revocation were verified.

## Two behavior caveats

1. **Internal-note read state did not change.** `PATCH /bookings/messages` with `read=true` returned HTTP 200 and `[true]`; the corresponding POST update with `read=false` also returned success. Subsequent GET responses still contained `read=null`. Internal-note creation and retrieval passed, but persistent read-state changes were not verified. The result does not establish how guest or channel messages behave; no outbound messaging was tested.
2. **A null minimum stay did not clear the restriction.** After setting a calendar minimum stay of 2, `minStay:null` was ignored. Explicit `minStay:1` restored the original restriction and offers. `price1:null` did clear the test daily price. Restore captured field values explicitly and verify the resulting calendar and quote.

## Every catalog entry

“Passed” applies only to the tested scope in that row. Empty responses establish reachability, not a working external integration. Paths are relative to `https://beds24.com/api/v2`; the webhook entry is a documentation label, not a REST path.

| # | Method and path | Vendor stage | Status | Tested scope or reason |
| ---: | --- | --- | --- | --- |
| 1 | `GET /authentication/setup` | Unlabelled | Passed | Invite-code exchange created the hotel-scoped test credential; this initial exchange predates the request journal. |
| 2 | `GET /authentication/token` | Unlabelled | Passed | Refresh issued a working access token; refresh was rejected with HTTP 401 after revocation. |
| 3 | `DELETE /authentication/token` | Unlabelled | Passed | Temporary write refresh token deleted; access token subsequently reported validToken=false. |
| 4 | `GET /authentication/details` | Unlabelled | Passed | Verified hotel scope and token validity before/after revocation; original read-only credential remains valid. |
| 5 | `GET /bookings` | Unlabelled | Passed | Read original reservations and exact test-booking changes; deleted test booking returned no records. |
| 6 | `POST /bookings` | Unlabelled | Passed | Created a reservation, changed room/unit/dates/guest fields, added/updated/deleted invoice charges and info items, and cancelled it. Sold-out creation correctly returned per-item success=false despite HTTP 201. |
| 7 | `DELETE /bookings` | Unlabelled | Passed | Removed the disposable reservation and confirmed its absence. |
| 8 | `GET /bookings/messages` | Unlabelled | Passed | Retrieved the disposable internal note; no test notes remained after booking deletion. |
| 9 | `POST /bookings/messages` | Unlabelled | Passed with caveat | Created an internal note and read it back. An update to read=false returned success but read stayed null. No outbound guest or channel messaging tested. |
| 10 | `PATCH /bookings/messages` | Unlabelled | Behavior unverified | Read=true update returned HTTP 200 and [true], but internal-note read state stayed null. Real guest/channel read-state behavior is unverified. |
| 11 | `GET /bookings/invoices` | Alpha | Passed | Retrieved invoice-item totals for original and test bookings; test invoice charges totalled INR 9000. Invoice numbering/finalization not tested. |
| 12 | `GET /inventory/rooms/offers` | Unlabelled | Passed | Verified quotes, capacity, inventory consumption/release, changed prices, minimum-stay restrictions and blackout rejection. |
| 13 | `GET /inventory/rooms/availability` | Unlabelled | Passed | Retrieved November availability and matched the original availability snapshot after cleanup. |
| 14 | `GET /inventory/rooms/unitBookings` | Beta | Passed | Retrieved unit allocations and matched the original snapshot after cleanup. |
| 15 | `GET /inventory/rooms/calendar` | Unlabelled | Passed | Read back daily prices, inventory, stay restrictions and blackout changes; original calendar restored. |
| 16 | `POST /inventory/rooms/calendar` | Unlabelled | Passed with caveat | Updated daily price, quantity, minimum stay and blackout; quotes enforced changes. minStay:null was ignored, so explicit minStay:1 restored the original restriction. price1:null cleared the test daily price. |
| 17 | `GET /inventory/fixedPrices` | Unlabelled | Passed | Retrieved fixed-rate definitions and verified unchanged baseline after restoration. |
| 18 | `POST /inventory/fixedPrices` | Unlabelled | Passed | Changed Standard nightly rate from INR 3000 to 3100; two-night quote changed to INR 6200, then returned to INR 6000 after restoration. New rate creation was not tested because no deletion endpoint is documented. |
| 19 | `GET /accounts` | Alpha | Not tested | Account scope was not granted; testing was restricted to property 366736. |
| 20 | `POST /accounts` | Alpha | Not tested | Account scope was not granted; account-level mutations were outside the hotel test. |
| 21 | `GET /properties` | Beta | Passed | Read hotel details, room quantities and physical units; final response matched the original baseline. |
| 22 | `POST /properties` | Beta | Passed | Changed one unit housekeeping status/color, verified readback, then restored its original values. Property/room creation and other settings were not exhaustively tested. |
| 23 | `DELETE /properties` | Coming soon | Coming soon | Listed as Coming soon by the official schema; not a currently callable documented route. |
| 24 | `GET /properties/rooms` | Coming soon | Coming soon | Listed as Coming soon by the official schema; not a currently callable documented route. |
| 25 | `DELETE /properties/rooms` | Coming soon | Coming soon | Listed as Coming soon by the official schema; not a currently callable documented route. |
| 26 | `GET /channels/settings` | Alpha | Passed | Read channel settings successfully. No live Airbnb or iCal connection was enabled; integration delivery was not tested. |
| 27 | `POST /channels/settings` | Alpha | Not tested | Channel-write scope was not granted; no external channel settings were changed. |
| 28 | `GET /channels/airbnb/users` | Beta | Empty response | HTTP 200, empty data; no Airbnb account connected. |
| 29 | `GET /channels/airbnb/listings` | Alpha | Not tested | No connected Airbnb user ID is available to query listings. |
| 30 | `GET /channels/airbnb/reviews` | Beta | Empty response | HTTP 200, empty data; no connected Airbnb review workflow verified. |
| 31 | `POST /channels/airbnb` | Alpha | Not tested | No connected Airbnb account; external channel mutations not performed. |
| 32 | `POST /channels/booking` | Alpha | Not tested | No connected Booking.com workflow; external channel mutations not performed. |
| 33 | `GET /channels/booking/reviews` | Alpha | Empty response | HTTP 200, empty data; no connected Booking.com review workflow verified. |
| 34 | `POST /channels/stripe` | Alpha | Not tested | Payment gateways are disabled; no charges, refunds or real payment actions performed. |
| 35 | `GET /channels/stripe/paymentMethods` | Alpha | Empty response | HTTP 200, empty data; no stored payment method or connected payment workflow verified. |
| 36 | `GET /channels/stripe/charges` | Alpha | Empty response | HTTP 200, empty data; no actual Stripe charge workflow verified. |
| 37 | `POST Webhooks - bookings` | Alpha | Webhook not tested | Documentation entry for outbound booking webhook payloads, not a callable REST path. No webhook receiver configured/tested. |
| 38 | `GET /organizations/users` | Coming soon | Coming soon | Listed as Coming soon by the official schema; not a currently callable documented route. |

## Cleanup and credential status

All original baseline comparisons passed: property and physical-unit settings, fixed rates, the five original reservations, test-date calendars, November availability and unit allocations matched their captured baselines. The temporary reservation was deleted and zero temporary messages remained.

The temporary write credential was **revoked**. Its refresh request was rejected with **HTTP 401**, and authentication details reported **`validToken=false`** for its access token. The original read-only credential remained valid. No credentials are included in this report or the sanitized results.

The retained credential has only five scopes: `read:properties`, `read:inventory`, `read:bookings`, `read:bookings-personal` and `read:bookings-financial`. The now-revoked test credential had `all:bookings`; read and write access to `bookings-personal`, `bookings-financial`, `inventory` and `properties`; and `read:channels`. **Repeating writes or channel reads requires a fresh credential with the appropriate scopes.** Passing those tests does not mean the retained read-only credential can invoke them.

## Remaining limits

Real payment processing, guest or channel messaging, OTA synchronization and booking webhook delivery remain untested. Account administration, channel writes, new property or room creation, new fixed-rate creation, invoice numbering and all possible field combinations were outside this run. Five external-service reads returned empty data, so their full workflows remain unverified. The earlier account configuration indicated a 14-day trial; continued operation through 30 November depends on account continuation.

## Evidence and references

The [sanitized test results](e2e-results.json) contain the endpoint outcomes, request metadata, cleanup checks and credential-revocation results used here. The [previous read-only verification report](verification-report.md) records the earlier configuration, inventory and quote checks as a separate run.

The method inventory and vendor stages follow the [official Beds24 API V2 documentation](https://beds24.com/api/v2/) and its [published OpenAPI specification](https://beds24.com/api/v2/apiV2.yaml). The [local endpoint catalog](endpoint-catalog.md) provides the full reference alongside this test report.
