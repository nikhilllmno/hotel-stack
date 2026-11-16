# Cloudbeds Integration

> **Note:** All monetary values are rounded to two decimal places. Do not use `any` for Cloudbeds payloads — `src/cloudbeds/types/` contains interfaces for every request/response shape.

## Overview

Cloudbeds is the fourth supported PMS (alongside ResNexus, Hostaway, and Stayntouch). This integration covers:

- Single-room availability and rate quoting
- Reservation creation (with Stripe-derived `cardToken` / `paymentAuthorizationCode`)
- Reservation cancellation
- Stripe-triggered autocharges recorded via `postPayment`

Multi-room bookings and reservation modifications are intentionally deferred and throw `BadRequestError`.

## Configuration

The Cloudbeds API token is stored in the environment and read at startup. Each Cloudbeds hotel is identified in the database, but the bearer token comes from the environment:

| Source                          | Key / Column                                                 | Value                                          |
| ------------------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| Environment variable            | `CLOUDBEDS_API_TOKEN`                                        | Cloudbeds Bearer token (partner-issued `cbat_*`) |
| `hotels.pms_provider`           | database column                                              | `cloudbeds`                                    |
| `hotels.business_id`            | database column                                              | Cloudbeds `propertyID` (e.g. `320454`)         |

Base URL is a compile-time constant in `src/cloudbeds/client/CloudbedsClient.ts`: `https://hotels.cloudbeds.com/api/v1.3`.

Add the token to your `.env` before running the service:

```env
CLOUDBEDS_API_TOKEN=cbat_xxxxxxxxxxxx
```

## Provisioning a Cloudbeds Hotel

```sql
UPDATE hotels
SET pms_provider = 'cloudbeds',
    business_id = '320454'
WHERE id = '<hotel-uuid>';
```

## Reservation Flow

### Step 1: Availability — `GET /getRoomTypes`

```bash
curl --location 'https://hotels.cloudbeds.com/api/v1.3/getRoomTypes?propertyIDs=320454&startDate=2026-05-10&endDate=2026-05-12&adults=2&children=0' \
  --header 'Authorization: Bearer cbat_xxxxxxxxxxxx'
```

Returns room types with `roomsAvailable` per type.

### Step 2: Detailed Rate — `GET /getRate`

Called in parallel for each `roomsAvailable > 0` room type:

```bash
curl --location 'https://hotels.cloudbeds.com/api/v1.3/getRate?propertyID=320454&roomTypeID=1234&startDate=2026-05-10&endDate=2026-05-12&adults=2&children=0&detailedRates=true' \
  --header 'Authorization: Bearer cbat_xxxxxxxxxxxx'
```

The service computes:

- `base_rate` = sum of `roomRateDetailed[].rate`
- `total_amount` = `totalRate`
- `taxes` = `max(0, total_amount - base_rate)` (Cloudbeds v1.3 does not itemize taxes)

The full `getRate` response is preserved in `quote_object.raw_response`.

### Step 3: Create Reservation — `POST /postReservation`

Request body is `application/x-www-form-urlencoded` with bracket-notation nesting (`rooms[0][roomTypeID]=...`), handled by `src/cloudbeds/utils/formEncode.ts`. Fields set by the service:

- `paymentMethod=credit` when the Stripe webhook has populated both `customer.payment_provider_customer_id` and the payment's `booking_confirmation_id`; otherwise falls back to `paymentMethod=cash` with a warning log.
- `cardToken` = Stripe customer id (from `customer.payment_provider_customer_id`)
- `paymentAuthorizationCode` = Stripe latest_charge id (from `payment.booking_confirmation_id`)

Returned `reservationID` is stored as `reservations.external_id`.

### Step 4: Cancel Reservation — `PUT /putReservation`

```bash
curl --location --request PUT 'https://hotels.cloudbeds.com/api/v1.3/putReservation' \
  --header 'Authorization: Bearer cbat_xxxxxxxxxxxx' \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'propertyID=320454' \
  --data-urlencode 'reservationID=<cloudbeds-id>' \
  --data-urlencode 'status=canceled'
```

### Step 5: Autocharge — `POST /postPayment`

Triggered from the Stripe `invoice_payment.paid` webhook (and `payment_intent.succeeded` for first-charge deposits). The `createCloudbedsPayments` helper in `stripeWebhookService` distributes the total amount across reservations using each `quote.amount_charged`, and records a Cloudbeds payment per reservation with `type=credit`, `cardType=""`.

Reservations without an `external_id` are logged and skipped; the webhook does not fail for them.

## Webhooks

Unlike Stayntouch (where the PMS team manages subscriptions on their side),
**Cloudbeds webhooks are self-subscribed via API** — we register each event we
want by calling `POST /postWebhook`, once per `object`+`action` pair.

### Subscribe to an event — `POST /postWebhook`

```bash
curl --location --globoff '{{url}}/postWebhook' \
  --header 'Authorization: Bearer {{property_access_token}}' \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'endpointUrl=https://alfred-core-svc.dev.dextr.ai/webhooks/cloudbeds' \
  --data-urlencode 'object=reservation' \
  --data-urlencode 'action=created'
```

Call this **once for each webhook event for each property** you need (each `object`/`action`
combination is a separate subscription).

### List current subscriptions — `GET /getWebhooks`

```bash
curl --location --globoff '{{url}}/getWebhooks?propertyID={{PROPERTY_ID}}' \
  --header 'Authorization: Bearer {{property_access_token}}'
```

Use this to see which webhooks we are currently subscribed to for a property.

## File Layout

```
src/cloudbeds/
├── client/
│   └── CloudbedsClient.ts        # Axios-based client with per-call apiToken
├── errors/
│   ├── CloudbedsAPIError.ts
│   ├── CloudbedsConfigurationError.ts
│   ├── CloudbedsRoomUnavailableError.ts
│   └── index.ts
├── services/
│   └── reservationService.ts     # Implements IPMSReservationService
├── types/
│   ├── AvailabilityRequest.ts
│   ├── CloudbedsApiEnvelope.ts
│   ├── PaymentRequest.ts
│   ├── RateResponse.ts
│   ├── ReservationRequest.ts
│   ├── RoomInfo.ts
│   ├── RoomsResponse.ts
│   ├── RoomTypesResponse.ts
│   └── index.ts
├── utils/
│   ├── formEncode.ts             # Cloudbeds bracket-notation encoder
└── validators/
    ├── availabilityValidator.ts
    └── reservationValidator.ts
```

## Deferred Capabilities

These operations throw `BadRequestError` on Cloudbeds hotels until they are implemented:

- `modifyReservation` / `getQuoteForModification`
- `getMultiRoomAvailabilityWithQuote` / `getMultiRoomAvailabilityWithQuoteLite`
- `getWebRoomAvailabilityV2`

## Error Model

| Error                              | HTTP status | Raised when                                             |
| ---------------------------------- | ----------- | ------------------------------------------------------- |
| `CloudbedsConfigurationError`      | 500         | `business_id` missing on hotel or `CLOUDBEDS_API_TOKEN` not set in env |
| `CloudbedsAPIError`                | upstream    | Network error or `success: false` envelope             |
| `CloudbedsRoomUnavailableError`    | 400         | No availability / inventory shortfall                  |

## Logging

- Every HTTP call goes through the shared `createHttpClient('cloudbeds', ...)` which emits `Cloudbeds Request` / `Cloudbeds Response` Winston logs with redacted `Authorization` header and truncated body.
- Per-endpoint wrappers in `CloudbedsClient` add `{ endpoint, hotelId, ...params }` context.
- Error responses are logged with `{ endpoint, status, message, errorCode }`.

## Manual Verification Checklist

Sandbox property: **`320454`**. Set `CLOUDBEDS_API_TOKEN` in `.env` to the sandbox bearer token before running.

- [ ] `GET /getRoomTypes` returns available rooms for a future date range
- [ ] `GET /getRate?detailedRates=true` returns `roomRateDetailed` array with per-night `rate`
- [ ] `POST /postReservation` succeeds with `paymentMethod=credit`, returns `reservationID`
- [ ] `reservations.external_id` is populated after Stripe payment succeeds
- [ ] `PUT /putReservation` cancels the reservation
- [ ] `POST /postPayment` records the Stripe autocharge
- [ ] ResNexus, Hostaway, Stayntouch hotels continue to work unchanged
