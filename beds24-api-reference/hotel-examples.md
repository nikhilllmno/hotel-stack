# Hotel specific Beds24 API examples

Property **366736**; Standard Double **754948**; Deluxe Double **754949**; Family Suite **754950**. These examples target the published schemas. Core read/write workflows were subsequently verified in a separate reversible test run; these illustrative payloads are not all verbatim replayable tests. See [e2e-report.md](e2e-report.md) for exact coverage and caveats. All credential values shown are placeholders. [Official schema](https://beds24.com/api/v2/apiV2.yaml)

## Authentication

A valid read-only credential scoped to this property has been created; its value is not in this package. The separate credential used for write and channel-read testing was revoked after cleanup. Obtain appropriate scopes on a fresh credential before repeating those operations. For a new credential, generate an invite code at [Settings → Marketplace → API](https://beds24.com/control3.php?pagetype=apiv2). Store secrets locally in `BEDS24_INVITE_CODE`, `BEDS24_REFRESH_TOKEN`, and `BEDS24_TOKEN`; do not commit their values.

```bash
# Exchange the one-time invite code. Store the returned token and refreshToken securely.
curl --fail-with-body --silent --show-error \
  'https://beds24.com/api/v2/authentication/setup' \
  --header "code: ${BEDS24_INVITE_CODE}" \
  --header 'deviceName: demo-hotel-mcp'

# Refresh when the access token expires.
curl --fail-with-body --silent --show-error \
  'https://beds24.com/api/v2/authentication/token' \
  --header "refreshToken: ${BEDS24_REFRESH_TOKEN}"
```

Use the returned `token` in the `token` header. For normal hotel access omit the integration-partner `organization` header.

## Read hotel and room configuration

```bash
curl --fail-with-body --silent --show-error --get \
  'https://beds24.com/api/v2/properties' \
  --header "token: ${BEDS24_TOKEN}" \
  --data-urlencode 'id=366736' \
  --data-urlencode 'includeAllRooms=true' \
  --data-urlencode 'includeUnitDetails=true' \
  --data-urlencode 'includePriceRules=true' \
  --data-urlencode 'includeOffers=true'
```

## Read stays overlapping November

The wider server-side range below accommodates the documentation's ambiguous boundary wording. In your adapter, retain records for which `arrival < 2026-12-01` and `departure > 2026-11-01`, and follow all pagination links. This returns stays occupying at least one November night, including those arriving in October. Add explicit status filters when you need cancelled records.

```bash
curl --fail-with-body --silent --show-error --get \
  'https://beds24.com/api/v2/bookings' \
  --header "token: ${BEDS24_TOKEN}" \
  --data-urlencode 'propertyId=366736' \
  --data-urlencode 'arrivalTo=2026-12-01' \
  --data-urlencode 'departureFrom=2026-10-31' \
  --data-urlencode 'includeInvoiceItems=true' \
  --data-urlencode 'includeInfoItems=true'
```

## Request the November calendar

```bash
curl --fail-with-body --silent --show-error --get \
  'https://beds24.com/api/v2/inventory/rooms/calendar' \
  --header "token: ${BEDS24_TOKEN}" \
  --data-urlencode 'propertyId=366736' \
  --data-urlencode 'startDate=2026-11-01' \
  --data-urlencode 'endDate=2026-11-30' \
  --data-urlencode 'includePrices=true' \
  --data-urlencode 'includeNumAvail=true' \
  --data-urlencode 'includeMinStay=true' \
  --data-urlencode 'includeMaxStay=true' \
  --data-urlencode 'includeOverride=true'
```

The API only returns requested calendar fields. In the live check on 8 November, this 1–30 November request returned only 8–30 November; use the booking endpoint for historical reservations. Fixed prices are read separately:

```bash
curl --fail-with-body --silent --show-error --get \
  'https://beds24.com/api/v2/inventory/fixedPrices' \
  --header "token: ${BEDS24_TOKEN}" \
  --data-urlencode 'propertyId=366736'
```

## Quote a stay

```bash
curl --fail-with-body --silent --show-error --get \
  'https://beds24.com/api/v2/inventory/rooms/offers' \
  --header "token: ${BEDS24_TOKEN}" \
  --data-urlencode 'propertyId=366736' \
  --data-urlencode 'roomId=754948' \
  --data-urlencode 'arrival=2026-11-20' \
  --data-urlencode 'departure=2026-11-22' \
  --data-urlencode 'numAdults=2' \
  --data-urlencode 'numChildren=0'
```

## Create a booking

This is a **write example**, not a booking that has been created. Obtain the actual quote first and set `price` to the booking total; the `6000` below is an illustrative amount. The `actions` object controls availability checking, assignment, notifications, and webhook behavior. Omitting guest contact fields avoids attaching a real recipient to the sample.

```http
POST https://beds24.com/api/v2/bookings
Content-Type: application/json
token: YOUR_ACCESS_TOKEN
```

```json
[
  {
    "roomId": 754948,
    "status": "confirmed",
    "arrival": "2026-11-20",
    "departure": "2026-11-22",
    "numAdult": 2,
    "numChild": 0,
    "firstName": "TEST",
    "lastName": "API Guest",
    "price": 6000,
    "notes": "Synthetic API example. Do not treat as a real guest.",
    "actions": {
      "checkAvailability": true,
      "assignBooking": true,
      "notifyGuest": false,
      "notifyHost": false,
      "allowWebhooks": false,
      "autoInvoiceItemCharge": true
    }
  }
]
```

After creation, read back the returned booking ID and inspect each item result. For a lost response, reconcile existing records before retrying creation, to avoid duplicate reservations.

## Cancel without deleting the booking record

Replace the illustrative ID below with the real booking ID you intend to cancel. This is a write operation.

```http
POST https://beds24.com/api/v2/bookings
Content-Type: application/json
token: YOUR_ACCESS_TOKEN
```

```json
[
  {
    "id": 123456789,
    "status": "cancelled",
    "actions": {
      "notifyGuest": false,
      "notifyHost": false,
      "allowWebhooks": false
    }
  }
]
```

## Update the saved fixed prices

The hotel currently uses these fixed-price records, all covering **1 November–31 December 2026**:

| Room type | Room ID | Fixed-price ID | Saved nightly price |
|---|---:|---:|---:|
| Standard Double | 754948 | 7046325 | ₹3,000 |
| Deluxe Double | 754949 | 7046326 | ₹4,500 |
| Family Suite | 754950 | 7046327 | ₹6,500 |

This **write example** shows how to address the existing fixed-price records. Read them first and substitute the intended values. Including `id` updates the existing record; omitting it would create another fixed price. Changes can reach connected channels if those connections are later enabled.

```http
POST https://beds24.com/api/v2/inventory/fixedPrices
Content-Type: application/json
token: YOUR_ACCESS_TOKEN
```

```json
[
  {"id": 7046325, "propertyId": 366736, "roomId": 754948, "roomPrice": 3000},
  {"id": 7046326, "propertyId": 366736, "roomId": 754949, "roomPrice": 4500},
  {"id": 7046327, "propertyId": 366736, "roomId": 754950, "roomPrice": 6500}
]
```

Use `GET /inventory/fixedPrices` and `GET /inventory/rooms/offers` afterward to verify stored rules and effective prices respectively. `/inventory/rooms/calendar` remains the endpoint for explicit daily overrides and restrictions; daily-price writes can introduce prices that compete with the saved fixed prices.
