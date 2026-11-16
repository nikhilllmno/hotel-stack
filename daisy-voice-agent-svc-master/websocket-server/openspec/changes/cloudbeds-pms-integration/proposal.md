## Why

Cloudbeds is a widely-used Property Management System (PMS) that needs to be supported by the Daisy Voice Agent Service to expand hotel compatibility beyond the existing ResNexus, Hostaway, and Stayntouch integrations. Adding Cloudbeds enables hotels on this platform to use Daisy's AI-powered voice and SMS booking assistants for availability checks, price quotes, single-room reservation creation, cancellations, and Stripe-driven autocharges.

## What Changes

- Add Cloudbeds as a fourth PMS provider alongside ResNexus, Hostaway, and Stayntouch by extending the `PmsProvider` enum and `PMSServiceFactory` routing.
- Implement a Cloudbeds API client (`/src/cloudbeds/client/`) that wraps `getRooms`, `getRoomTypes`, `getRate`, `postReservation`, `putReservation`, and `postPayment` endpoints on `https://hotels.cloudbeds.com/api/v1.3`.
- Create `CloudbedsReservationService` (`/src/cloudbeds/services/reservationService.ts`) implementing `IPMSReservationService` (unchanged interface) for availability (single-room), quotes, reservation creation, and cancellation. Multi-room and modification flows are explicitly deferred and throw a `BadRequestError` when invoked.
- Store hotel-specific Cloudbeds credentials in the database: `propertyID` in the existing `hotels.business_id` column and a per-hotel Cloudbeds API token (new column on `hotels` via migration). Cloudbeds tokens are per-property, so no shared env token is introduced.
- Map Stripe `payment_intent.succeeded` customer + latest_charge values into Cloudbeds reservation creation (`cardToken` = stripe customer id, `paymentAuthorizationCode` = stripe latest_charge id) by reading the existing `customer.payment_provider_customer_id` and `payment.booking_confirmation_id` already populated by the Stripe webhook.
- Extend the Stripe `invoice_payment.paid` webhook path (`handleInvoicePaymentSucceeded`) with a Cloudbeds branch that calls `postPayment` (analogous to the existing `createHostawayOfflineCharges`) to record the autocharge in Cloudbeds.
- Preserve complete Cloudbeds API responses in the existing `quote_object.raw_response` JSONB field for audit / debugging, following the pattern introduced for Hostaway and Stayntouch.
- Add Cloudbeds-specific error classes (`CloudbedsAPIError`, `CloudbedsConfigurationError`, `CloudbedsRoomUnavailableError`) under `/src/cloudbeds/errors/` following existing error-class conventions.
- Add Joi validators and TypeScript interfaces for all Cloudbeds request / response payloads under `/src/cloudbeds/types/` and `/src/cloudbeds/validators/`. No `any` is introduced unless a Cloudbeds field is genuinely unconstrained.

Out of scope (explicitly deferred):
- Reservation modification (date changes, occupancy changes).
- Multi-room reservations in a single booking.
- Cloudbeds-driven webhooks back into Daisy.

## Capabilities

### New Capabilities
- `cloudbeds-pms-integration`: Integration with Cloudbeds PMS API for single-room availability, rate quoting, reservation creation, cancellation, and Stripe-triggered autocharge posting.

### Modified Capabilities
<!-- No existing capability spec files exist in openspec/specs/ for prior PMS integrations; all changes land in the new cloudbeds-pms-integration capability. -->

## Impact

- **Code**: New `/src/cloudbeds/` directory (client, services, types, validators, errors, utils). Updates to `PMSServiceFactory.ts` and `PmsProvider` enum in `/src/types/enums.ts`. One new branch in `stripeWebhookService.handleInvoicePaymentSucceeded` (and where applicable in `handlePaymentIntentSucceeded`) to route Cloudbeds autocharges to `postPayment`.
- **APIs**: No new external HTTP endpoints exposed by this service. New outbound calls to Cloudbeds v1.3 API. Existing internal availability / reservation endpoints automatically route via the PMS factory.
- **Configuration**: No new global env vars (Cloudbeds base URL is a constant; tokens are per-hotel). `.env.example` documents this.
- **Data Model**: New migration adds `cloudbeds_api_token` column to `hotels` table. `quote_object.raw_response` is reused (already supported, no schema change). No changes to `IPMSReservationService` interface types.
- **Dependencies**: No new npm packages anticipated; Cloudbeds accepts both `application/x-www-form-urlencoded` and multipart form requests which are supported by existing `axios` usage.
- **Testing**: Manual verification against Cloudbeds sandbox property `320454` using the sample flows in `cloudbeds_plan.txt`; regression checks that existing ResNexus / Hostaway / Stayntouch flows are unaffected.
