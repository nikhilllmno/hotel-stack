# Beds24 API V2 endpoint catalog

Snapshot retrieved 8 November 2026 from the [official OpenAPI YAML](https://beds24.com/api/v2/apiV2.yaml), which powers [Swagger UI](https://beds24.com/api/v2/). Selected read operations were subsequently verified for the demo hotel; see [verification-report.md](verification-report.md). The catalog also includes operations outside that verification scope.

The specification contains **38 method entries**: **33 described API operations**, **4 unavailable operations labelled Coming soon**, and **1 webhook payload definition**. The 33 include alpha and beta functionality; presence in this catalog does not establish account entitlement or successful execution.

Use `https://beds24.com/api/v2` as the base URL. Append each slash-prefixed path below. `Webhooks - bookings` is a documentation label, not a URL.

## Authentication and scope notation

Resource operations use the `token` HTTP header. An integration partner additionally sends its `organization` header; an ordinary hotel integration omits that header. Setup and refresh operations instead use their credential header listed below.

The scope-family column is a routing guide based on the documented resource families. Resource permissions combine a method with a family, such as `read:bookings`, `write:inventory`, or `delete:bookings`; `all` combines methods. Personal and financial booking fields require their additional families. The OpenAPI security objects do not encode operation-level scope requirements, so the table does not claim a separately verified permission matrix. [Scope guide](https://wiki.beds24.com/index.php/Category:API_V2#Scopes)

## Authentication

| Method | Path | Purpose | Stage | Scope family |
|---|---|---|---|---|
| GET | `/authentication/setup` | Exchange an invite code for access and refresh tokens | Not labelled | Credential header; no resource scope |
| GET | `/authentication/token` | Issue an access token from a refresh token | Not labelled | Credential header; no resource scope |
| DELETE | `/authentication/token` | Revoke a refresh token | Not labelled | Credential header; no resource scope |
| GET | `/authentication/details` | Inspect token permissions and diagnostics | Not labelled | Credential header; no resource scope |

## Bookings

| Method | Path | Purpose | Stage | Scope family |
|---|---|---|---|---|
| GET | `/bookings` | Search reservations and retrieve booking records | Not labelled | bookings |
| POST | `/bookings` | Create or amend reservations, invoice items, and booking information | Not labelled | bookings |
| DELETE | `/bookings` | Delete reservation records by ID; use a status update for cancellation | Not labelled | bookings |
| GET | `/bookings/messages` | Read booking conversation records | Not labelled | bookings + bookings-personal |
| POST | `/bookings/messages` | Add a message or update its read state | Not labelled | bookings + bookings-personal |
| PATCH | `/bookings/messages` | Change read state across a selected message set | Not labelled | bookings + bookings-personal |
| GET | `/bookings/invoices` | Retrieve invoice records | Alpha | bookings + bookings-financial |

## Inventory

| Method | Path | Purpose | Stage | Scope family |
|---|---|---|---|---|
| GET | `/inventory/rooms/offers` | Calculate stay offers for dates and occupancy | Not labelled | inventory |
| GET | `/inventory/rooms/availability` | Retrieve date availability for room types | Not labelled | inventory |
| GET | `/inventory/rooms/unitBookings` | Read booking coverage for individual physical units | Beta | inventory |
| GET | `/inventory/rooms/calendar` | Read selected daily prices, inventory, and restrictions | Not labelled | inventory |
| POST | `/inventory/rooms/calendar` | Write daily prices, inventory, and restrictions | Not labelled | inventory |
| GET | `/inventory/fixedPrices` | Read fixed prices and their rules | Not labelled | inventory |
| POST | `/inventory/fixedPrices` | Create or amend fixed prices | Not labelled | inventory |

## Accounts

| Method | Path | Purpose | Stage | Scope family |
|---|---|---|---|---|
| GET | `/accounts` | Read account records and optional usage data | Alpha | accounts |
| POST | `/accounts` | Write account fields; subaccount creation is excluded by the current FAQ | Alpha | accounts |

## Properties

| Method | Path | Purpose | Stage | Scope family |
|---|---|---|---|---|
| GET | `/properties` | Read properties, nested room types, units, offers, and price rules | Beta | properties |
| POST | `/properties` | Create or amend properties and nested room configuration | Beta | properties |
| DELETE | `/properties` | Planned property deletion | Coming soon | properties |
| GET | `/properties/rooms` | Planned standalone room retrieval; use GET /properties today | Coming soon | properties |
| DELETE | `/properties/rooms` | Planned room deletion | Coming soon | properties |

## Channels - settings

| Method | Path | Purpose | Stage | Scope family |
|---|---|---|---|---|
| GET | `/channels/settings` | Read channel configuration | Alpha | channels |
| POST | `/channels/settings` | Amend channel configuration | Alpha | channels |

## Channels - Airbnb

| Method | Path | Purpose | Stage | Scope family |
|---|---|---|---|---|
| GET | `/channels/airbnb/users` | List connected Airbnb account IDs | Beta | channels |
| GET | `/channels/airbnb/listings` | List listings for a connected Airbnb account | Alpha | channels |
| GET | `/channels/airbnb/reviews` | Read Airbnb guest reviews | Beta | channels |
| POST | `/channels/airbnb` | Import, connect, or disconnect Airbnb listings | Alpha | channels |

## Channels - Booking.com

| Method | Path | Purpose | Stage | Scope family |
|---|---|---|---|---|
| POST | `/channels/booking` | Report invalid cards, no-shows, or cancellation requests to Booking.com | Alpha | channels |
| GET | `/channels/booking/reviews` | Read Booking.com guest reviews | Alpha | channels |

## Channels - Stripe

| Method | Path | Purpose | Stage | Scope family |
|---|---|---|---|---|
| POST | `/channels/stripe` | Create checkout sessions and manage charges, refunds, holds, or payment methods | Alpha | channels |
| GET | `/channels/stripe/paymentMethods` | Read Stripe payment methods associated with a booking | Alpha | channels |
| GET | `/channels/stripe/charges` | Read Stripe charges associated with a booking | Alpha | channels |

## Webhooks

| Method | Path | Purpose | Stage | Scope family |
|---|---|---|---|---|
| POST | `Webhooks - bookings` | Describe the POST payload Beds24 delivers to your webhook URL | Alpha | Webhook delivery |

## Organizations

| Method | Path | Purpose | Stage | Scope family |
|---|---|---|---|---|
| GET | `/organizations/users` | Planned organization user retrieval | Coming soon | Not specified; endpoint unavailable |

## Parameters and body schemas

These are the names in the downloaded specification. A trailing `*` identifies a required parameter. Arrays, enums, descriptions, examples, and response schemas remain in the full YAML and JSON. Parameters not expressly required are optional.

### GET /authentication/setup

Header: `code`*, `deviceName`.

### GET /authentication/token

Header: `refreshToken`*.

### DELETE /authentication/token

Header: `refreshToken`*.

### GET /authentication/details

Header: `token`.

### GET /bookings

Query: `filter`, `propertyId`, `roomId`, `id`, `masterId`, `apiReference`, `channel`, `arrival`, `arrivalFrom`, `arrivalTo`, `departure`, `departureFrom`, `departureTo`, `bookingTimeFrom`, `bookingTimeTo`, `modifiedFrom`, `modifiedTo`, `searchString`, `includeInvoiceItems`, `includeInfoItems`, `includeGuests`, `includeBookingGroup`, `status`, `page`.

### POST /bookings

No operation parameters are declared.
Body: `application/json`. Schemas: `newBooking`, `bookingActions`.

### DELETE /bookings

Query: `id`.

### GET /bookings/messages

Query: `id`, `propertyId`, `roomId`, `bookingId`, `masterId`, `filter`, `maxAge`, `source`, `page`.

### POST /bookings/messages

No operation parameters are declared.
Body: `application/json`. Schemas: `hostMessage`.

### PATCH /bookings/messages

Query: `messageId`, `propertyId`, `roomId`, `bookingId`, `masterId`.
Body: `application/json`. Inline schema in the full specification.

### GET /bookings/invoices

Query: `bookingId`, `page`.

### GET /inventory/rooms/offers

Query: `propertyId`, `roomId`, `offerId`, `arrival`*, `departure`*, `numAdults`*, `numChildren`, `includeTexts`, `agentCode`, `page`.

### GET /inventory/rooms/availability

Query: `roomId`, `propertyId`, `startDate`, `endDate`, `page`.

### GET /inventory/rooms/unitBookings

Query: `roomId`, `propertyId`, `startDate`, `endDate`, `page`.

### GET /inventory/rooms/calendar

Query: `startDate`*, `endDate`*, `roomId`, `propertyId`, `includeNumAvail`, `includeMinStay`, `includeMaxStay`, `includeMultiplier`, `includeOverride`, `includePrices`, `includeLinkedPrices`, `includeChannels`, `page`.

### POST /inventory/rooms/calendar

No operation parameters are declared.
Body: `application/json`. Schemas: `calendar`.

### GET /inventory/fixedPrices

Query: `id`, `roomId`, `propertyId`, `includeRateCodes`, `page`.

### POST /inventory/fixedPrices

No operation parameters are declared.
Body: `application/json`. Schemas: `fixedPrice`.

### GET /accounts

Query: `includeSubAccounts`, `includeUsage`, `includeLanguages`.

### POST /accounts

No operation parameters are declared.
Body: `application/json`. Schemas: `account`.

### GET /properties

Query: `id`, `includeLanguages`, `includeTexts`, `includePictures`, `includeOffers`, `includePriceRules`, `includeUpsellItems`, `includeAllRooms`, `includeUnitDetails`, `roomId`, `page`.

### POST /properties

No operation parameters are declared.
Body: `application/json`. Schemas: `property`.

### DELETE /properties

Query: `id`.

### GET /properties/rooms

Query: `id`, `propertyId`, `includeLanguages`, `includeTexts`, `includePictures`, `includeOffers`, `includePriceRules`, `includeUpsellItems`, `includeUnitDetails`, `page`.

### DELETE /properties/rooms

Query: `id`.

### GET /channels/settings

Query: `propertyId`*, `roomId`, `channel`.

### POST /channels/settings

No operation parameters are declared.
Body: `application/json`. Schemas: `vrboSettingsPost`, `airbnbSettingsPost`, `iCalExportSettingsPost`, `iCalImportSettingsPost`.

### GET /channels/airbnb/users

No operation parameters are declared.

### GET /channels/airbnb/listings

Query: `airbnbUserId`*, `airbnbListingId`, `airbnbApiVersion`.

### GET /channels/airbnb/reviews

Query: `roomId`*.

### POST /channels/airbnb

No operation parameters are declared.
Body: `application/json`. Inline schema in the full specification.

### POST /channels/booking

No operation parameters are declared.
Body: `application/json`. Inline schema in the full specification.

### GET /channels/booking/reviews

Query: `propertyId`*, `from`*.

### POST /channels/stripe

No operation parameters are declared.
Body: `application/json`. Schemas: `stripeCreateSession`, `stripeChargePaymentMethod`, `stripeRefundCharge`, `stripeReleaseCharge`, `stripeCaptureCharge`, `stripeAddPaymentMethod`, `stripeDetachPaymentMethod`.

### GET /channels/stripe/paymentMethods

Query: `bookingId`*, `stripePaymentMethodId`, `stripeApiVersion`.

### GET /channels/stripe/charges

Query: `bookingId`*, `stripeChargeId`, `stripeApiVersion`.

### POST Webhooks - bookings

No operation parameters are declared.
Body: `application/json`. Schemas: `invoiceItem`, `message`.

### GET /organizations/users

No operation parameters are declared.
