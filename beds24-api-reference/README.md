# Beds24 API reference for the demo hotel

This package contains the complete published Beds24 API V2 specification, a readable endpoint catalog, and examples for hotel **366736**. It supports building an MCP adapter around reservations, prices, availability, room configuration, and supported channel operations. Specification retrieved **8 November 2026**. Core read/write workflows have now been tested live using a temporary credential restricted to this hotel. The temporary write credential was revoked after cleanup; the original read-only credential remains valid.

**Latest live check: 26 of 33 documented callable methods exercised across 76 journaled requests plus the initial credential exchange.** Results: 18 passed within the tested scope, 2 passed with caveats, 1 messaging behavior remains unverified, and 5 returned empty results for unconnected services. See [e2e-report.md](e2e-report.md) for every method and [e2e-results.json](e2e-results.json) for sanitized evidence.

The earlier read-only run passed 70 of 70 checks across 14 GET requests; its [report](verification-report.md) is retained as a separate historical run.

## Hotel identifiers

| Object | ID | API field |
|---|---:|---|
| Hotel | 366736 | `id` in `/properties`; `propertyId` in most filtered reads |
| Standard Double | 754948 | `roomId` |
| Deluxe Double | 754949 | `roomId` |
| Family Suite | 754950 | `roomId` |

These are property and room-type identifiers, not credentials. A room-type ID differs from the `unitId` identifying an individual physical room. The identifiers were supplied from this setup session; changes to room configuration do not create a separate API service for this hotel.

## Saved hotel configuration

The demo now has **20 physical units**: 10 Standard, 6 Deluxe, and 4 Suites. Fixed prices cover **1 November–31 December 2026**. Five synthetic reservations exercise historical, checked-in, future, and month-boundary stays. See [setup-notes.md](setup-notes.md) for saved values and [hotel-config.json](hotel-config.json) for their machine-readable form. A **read-only API credential scoped to property 366736** has been created. Authentication and selected hotel-data reads succeeded; credential values are excluded from this package.

## Files and official sources

| File | Contents |
|---|---|
| [endpoint-catalog.md](endpoint-catalog.md) | Every published method/path, grouping, status, scope family, parameter name, and body-schema reference |
| [beds24-api-v2.yaml](beds24-api-v2.yaml) | Unchanged official OpenAPI source |
| [beds24-api-v2.json](beds24-api-v2.json) | JSON representation of the same source |
| [endpoints.json](endpoints.json) | Structured catalog with complete per-operation parameters and request bodies |
| [endpoints.csv](endpoints.csv) | Compact endpoint inventory for spreadsheets |
| [hotel-examples.md](hotel-examples.md) | Hotel-specific authentication, read, and write examples |
| [hotel-readonly.postman_collection.json](hotel-readonly.postman_collection.json) | Prepared read requests with token placeholder and this hotel's IDs |
| [hotel-config.json](hotel-config.json) | Saved room quantities, unit labels, fixed-rate IDs, operational settings, and synthetic reservations |
| [setup-notes.md](setup-notes.md) | Saved configuration and configured-versus-live boundaries |
| [e2e-report.md](e2e-report.md) | Latest end-to-end results and complete 38-entry method coverage matrix |
| [e2e-results.json](e2e-results.json) | Sanitized end-to-end results, cleanup confirmation, and request metadata |
| [verification-report.md](verification-report.md) | Earlier read-only verification summary, quote results, and limits |
| [verification-report.json](verification-report.json) | Sanitized results for all 70 checks |
| [manifest.json](manifest.json) | Source URL, checksum, retrieval date, counts, and identifiers |

Official sources: [interactive Swagger documentation](https://beds24.com/api/v2/), [downloadable OpenAPI YAML](https://beds24.com/api/v2/apiV2.yaml), [API V2 guide](https://wiki.beds24.com/index.php/Category:API_V2), [webhooks](https://wiki.beds24.com/index.php/Category:Webhooks), and [API change log](https://wiki.beds24.com/index.php/API_V2.0_changelog).

The catalog has **33 documented API operations**, including alpha/beta operations, plus **4 planned operations** and **1 outbound webhook definition**. It is complete against the downloaded source, not a claim that every endpoint is enabled for this account. API V1 is deprecated; build new integrations on V2. [Version guidance](https://wiki.beds24.com/index.php/Category:API_V2)

## Connect this hotel

Use the base URL `https://beds24.com/api/v2`. Resource requests authenticate with a header named `token`, not a Bearer Authorization header. The official specification also describes an `organization` header for integration partners; omit it for your own hotel. [OpenAPI authentication definitions](https://beds24.com/api/v2/apiV2.yaml)

[Settings → Marketplace → API](https://beds24.com/control3.php?pagetype=apiv2) is enabled. The created credential was verified as valid for owner **182366**, restricted to property **366736**, with exactly five read scopes: properties, inventory, bookings, bookings-personal, and bookings-financial. It grants no write or delete scopes. A separate temporary write credential was used for the end-to-end run and then revoked; both its refresh token and access token were verified unusable. No secret is included in these files.

For a new credential, create a scoped invite code there and exchange it using **GET `/authentication/setup`** with a `code` header, and retain both returned tokens securely. Refresh through **GET `/authentication/token`** with a `refreshToken` header. Use the response's `expiresIn` to schedule renewal. A long-life token is read-only; writes require the refresh-token flow. [Authentication guide](https://wiki.beds24.com/index.php/Category:API_V2#Authentication)

For the initial read-only MCP, select read access to properties, inventory, bookings, booking personal information, and booking financial information. Add write permissions for the operations you intend to expose. The catalog explains the scope-family mapping; the published OpenAPI does not provide a complete machine-readable per-operation scope matrix.

Keep credentials in the MCP server's secret store. Restrict its property access to 366736 and its room allowlist to 754948, 754949, and 754950. These restrictions are implementation choices for this hotel's adapter, not extra Beds24 API endpoints.

## What an MCP can expose

| Suggested MCP tool | Beds24 operation |
|---|---|
| `get_hotel` | GET `/properties?id=366736` |
| `list_reservations` | GET `/bookings` with property/date/status filters |
| `get_arrivals` / `get_departures` | GET `/bookings` with `filter=arrivals` or `filter=departures` |
| `quote_stay` | GET `/inventory/rooms/offers` |
| `get_availability` | GET `/inventory/rooms/availability` |
| `get_unit_bookings` | GET `/inventory/rooms/unitBookings` |
| `get_calendar` | GET `/inventory/rooms/calendar` with explicit include flags |
| `set_calendar` | POST `/inventory/rooms/calendar` |
| `get_fixed_prices` / `set_fixed_prices` | GET / POST `/inventory/fixedPrices` |
| `create_reservation` / `update_reservation` | POST `/bookings` |
| `cancel_reservation` | POST `/bookings` with existing `id` and `status: cancelled` |
| `get_invoice_items` | GET `/bookings?includeInvoiceItems=true` |
| `get_messages` / `send_channel_message` | GET / POST `/bookings/messages` |
| `update_room_settings` | POST `/properties` with property ID and nested room ID |

MCP tool names above are proposed adapter design, not existing Beds24 MCP tools. Channel and payment methods in the full catalog require their corresponding connected services; they are not enabled simply by creating the hotel.

## Live response behavior

For full nested room details, use `GET /properties?id=366736&includeAllRooms=true&includeUnitDetails=true&includePriceRules=true&includeOffers=true`. In this account, omitting `includeAllRooms=true` returned room IDs, offers, and price rules without room names, quantities, or units. Adding it returned all 20 units. The saved API unit IDs are in `hotel-config.json`. The booking UI reference maps to the API `reference` field; DEMO-001 is booking **95853447**.

On **8 November 2026**, requests for **1–30 November** to the calendar, availability, and unitBookings endpoints returned dates **8–30 November**. Treat this as observed behavior, not a general retention guarantee, and retrieve historical reservations through `/bookings`. Missing past inventory dates do not mean zero historical bookings. The [Daily Prices guide](https://wiki.beds24.com/index.php/Category:Daily_Prices) separately documents deletion of past daily prices; it does not establish this date-range behavior for every inventory endpoint.

## End-to-end observations

Core reservation create/update/cancel/delete, invoice-charge and info-item changes, internal-note creation/retrieval, housekeeping updates, fixed-rate updates and daily calendar changes worked. Quotes and availability reflected the changes. The five original bookings and all compared property, rate, calendar, availability and allocation baselines were restored exactly.

Two behaviors need explicit handling in an MCP: `minStay:null` did not clear the calendar restriction (an explicit `minStay:1` restored it), and read/unread updates on an internal note returned success while its `read` value stayed `null`. A deliberately sold-out booking returned HTTP 201 with a per-item failure, so HTTP status alone is insufficient. See [the full coverage matrix](e2e-report.md) for tested scope and integrations that remain unverified.

## Request behavior and known boundaries

Use JSON arrays for bulk POST operations. Include an existing item's `id` when updating it; creation omits that ID. Inspect every returned item's result. A successful HTTP response can contain failures for individual array items. Retrieve all result pages. [API usage guide](https://wiki.beds24.com/index.php/Category:API_V2#POST_requests)

Default usage allowance is **100 credits per five minutes per account**, shared by its tokens; requests have variable cost. Respect the remaining-credit and reset headers. The spec spells these `X-FiveMinCreditLimit`, `X-FiveMinCreditLimit-Remaining`, `X-FiveMinCreditLimit-ResetsIn`, and `X-RequestCost`. The wiki shows alternative spellings: inspect actual responses. [Rate limits](https://wiki.beds24.com/index.php/Category:API_V2#What_is_the_API_credit_limit.3F), [header definitions](https://beds24.com/api/v2/apiV2.yaml)

The current FAQ states there is **no separate sandbox**, no API subaccount creation, and no property/room picture retrieval. Some corresponding schema fields exist, so do not infer working capability from schema presence alone. [Current FAQ](https://wiki.beds24.com/index.php/Category:API_V2#FAQ)

The source itself marks these operations **Coming soon**: DELETE `/properties`, GET `/properties/rooms`, DELETE `/properties/rooms`, and GET `/organizations/users`. Do not expose them as available MCP tools. `/accounts`, invoices, and several channel functions are alpha; property functions and unit-booking lookup are beta. [Operation status](https://beds24.com/api/v2/apiV2.yaml)

The calendar contains per-day values, while fixed prices have their own endpoints. In particular, reading `price1` from the calendar is not a general stay quote. Use `/inventory/rooms/offers` for the dates and occupancy you need. The offer query uses `numAdults` and `numChildren`, while booking bodies use `numAdult` and `numChild`. [Endpoint schemas](https://beds24.com/api/v2/apiV2.yaml)

## Webhooks

Configure the V2 booking webhook at **Settings → Properties → Access → Booking Webhook**. Beds24 POSTs JSON to your URL; `Webhooks - bookings` in the OpenAPI file describes that payload and is not an endpoint to call. Inventory/price callbacks are separately configured under **Settings → Marketplace → Webhooks**. Auto Action callbacks follow their configured triggers. [Webhook documentation](https://wiki.beds24.com/index.php/Category:Webhooks)

For API booking mutations, `actions.allowWebhooks` explicitly controls availability-affecting callbacks. Changes to status, arrival, departure, roomId, unitId, or roomQty qualify; an isolated surname change does not. `actions.notifyGuest` and `actions.notifyHost` are separate email controls. [Booking action schema](https://beds24.com/api/v2/apiV2.yaml)

## Documentation discrepancies to preserve in implementation

The Swagger source is the method/schema authority for this snapshot. Its setup method is **GET**, although one wiki FAQ paragraph says POST. Its calendar flag is **`includeOverride`**, although wiki examples sometimes pluralize it. Its DELETE `/bookings` description is deletion; the source's cancellation example instead POSTs an existing ID with `status: cancelled`. Use that explicit status update when preserving a cancellation record. [Official source](https://beds24.com/api/v2/apiV2.yaml)

The untouched OpenAPI includes the non-slash webhook pseudo-path and a relative `servers` value. Code generators may need an import copy that removes the pseudo-path and sets the absolute base URL. Keep the original source for comparison. `openapi: 3.0.0` describes the specification format, not a change from Beds24 API V2 to V3.
