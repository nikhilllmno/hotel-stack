# ResNexus native payments

How a booking is taken and paid for at a hotel whose `payment_provider` is `resnexus`.

## Why this exists

Every hotel we integrate with through the ResNexus PMS pays through Stripe today.
Dextr collects the card, charges the deposit and the balance, and issues refunds, and the hotel reconciles two ledgers.

These hotels want the money to land in ResNexus.
So the card goes straight to ResNexus, and ResNexus owns the deposit, the balance and the refunds.
Dextr still owns the conversation, the quote and the reservation lifecycle, but it moves no money.

## The constraint that shapes everything

ResNexus creates the reservation and takes the card in a single `addreservation` call.
That call has no amount field, and its response has no charge result, no decline code and no amount taken.
There is no payments API and there are no webhooks.

Live tests on business 19175 showed `addreservation` returns `SUCCESS` even for an invalid, an expired and a declined test card.
So a `SUCCESS` only means the booking exists.
Since we can never know or reconcile what was charged, Dextr keeps no payment record at all.

## Who owns what

| Concern | Owner |
|---|---|
| Quote and the deposit figure shown to the guest | Dextr |
| Deposit, balance and refunds | ResNexus or the property, by its own policy |
| Reservation lifecycle, review page and guest comms | Dextr |

## Co-existence

The flow is chosen per hotel by `hotels.payment_provider`, so Stripe and ResNexus-native hotels run side by side.
A hotel moves over with one `UPDATE` from `stripe` to `resnexus`, and back with the reverse, with no migration.
Bookings made while a hotel was on Stripe keep their Stripe payment after the switch.

## Payment status

ResNexus-native reservations are created with `payment_status = EXTERNALLY_MANAGED` and no `payments` row.
They share the existing no-payment path with `NOT_APPLICABLE`, through `hasNoDextrPayment(status)`.
That keeps them out of payment reminders, charges, auto-charge, payment summaries and refunds.
They are not kept out of the stale sweep: `findStaleReservations` excludes only `NOT_APPLICABLE`, so `cancelStaleReservationsAndPayments` is what cancels an unsubmitted ResNexus booking.

## The booking flow

1. The agent quotes the guest and creates every room as INACTIVE and `EXTERNALLY_MANAGED`, with a review link and no payment link.
2. The guest opens the review page. `GET /daisy/reservation/review` returns `payment_provider = resnexus`, so the page renders the card form.
3. `PATCH /daisy/reservation/review` returns only the policy signature URL.
4. The guest submits PAN, expiry (YYMM), cardholder name and CVV to `POST /daisy/reservation/card`.
5. The guards run, all before any call to ResNexus.
6. Each pending room is booked in turn with `addreservation`, using the same card, and goes ACTIVE.
7. The guest gets the no-payment confirmation SMS and the property the no-payment Telegram message.
8. The response is `{ success, resnexus_reservation_ids, failed_booking_ids? }`.

## Guards before the call

In order, because once `addreservation` succeeds the room is booked and cannot be reversed from here:

1. **Wrong provider:** the hotel must be on `resnexus`.
2. **Created for this flow:** every reservation must be `EXTERNALLY_MANAGED`, so a Stripe-era booking is never charged twice.
3. **Expired link:** no reservation may be CANCELLED by the stale sweep.
4. **Already confirmed:** at least one reservation must still be INACTIVE.
5. **Same-day bookability and availability,** checked for every room up front so a sold-out second room cannot leave a half-booked stay.
6. **Failed card limits:** a booking with 5 declined card checks, or a phone number with declined checks on 10 bookings at the hotel in 24 hours, is refused.
7. **$0 card check,** only when `AUTHORIZE_NET_VERIFY_API_LOGIN_ID` and `AUTHORIZE_NET_VERIFY_TRANSACTION_KEY` are set: a $0 authorization on Dextr's own Authorize.net account. A decline returns 400 with nothing booked. Without the credentials, or when the check itself fails, the card goes straight to ResNexus.

## Multi-room

One `addreservation` per room with the same card, so ResNexus takes one deposit per room.

- **First room fails:** nothing is booked, the error is returned, and the guest can retry with another card.
- **A later room fails:** the booked rooms are kept, since Dextr cannot refund their deposits. The failed rooms stay INACTIVE and are returned in `failed_booking_ids`, with a CRITICAL log and a KPI.
- **Retry:** only the rooms still INACTIVE are booked.

## Card handling

The card lives in memory for one request and is never persisted, returned or logged.

- The intake schema overrides every Joi message, so a failing value never appears in an error or a log.
- The request logger replaces the card endpoint's body, and outbound body logs have card fields redacted.
- The CVV is required at our edge, since ResNexus reports nothing about the card.
- Expiry is posted as YYMM like other providers and split into month and year at the ResNexus boundary.

### PCI

This is a raw PAN over TLS, the same shape Opera uses, which moves this service from SAQ A to SAQ D.
ResNexus refuses card fields without a PCI attestation from us.
A temporary certification is in place until the end of October 2026, so the full audit is needed before real hotels go live.

## Card form

The card form is in `dextr-public`, as a payment provider adapter like Shift4, Mews and Cloudbeds.

- `public/resnexus-payment.html` is our own form in an iframe that loads no third-party script. It checks the name, Luhn, expiry and CVV before handing the card to the page.
- `src/pages/Payment/providers/resnexus.ts` checks the card again and posts it to `/daisy/reservation/card`.
- After a partial booking the guest stays on the page with the failed rooms named, so a retry books the rest.
- On success the guest is told the request was processed, not that the deposit was paid.

## Expiry and cancellation

An unsubmitted booking is cancelled by the stale sweep (`cancelStaleReservationsAndPayments`), locally, with no call to ResNexus.
The card endpoint refuses a cancelled booking, so an open tab cannot outlive the sweep.
A confirmed booking cancels through the normal PMS path, and the property handles any refund in ResNexus.

## Failure

ResNexus accepts a card that is invalid, expired, declined or short of funds, so without the $0 card check the guest gets a confirmation and the property only finds out when it charges the card.
With the check configured, an invalid or declined card returns 400 ("We could not verify this card") before anything is booked.
A gateway problem, invalid Dextr keys, or a check held by the account's fraud filters does not block the booking, and the card goes to ResNexus unchecked.
The failed card limits then stop a booking or phone number that keeps failing the check.

The other risk is a lost response: ResNexus may have booked the room and taken the deposit even though we got a timeout, no answer or a 5xx.
The client reports those as `PmsBookingOutcomeUnknownError`, separately from an explicit rejection.
The room is set to FAILED, which keeps it out of booking claims, retries and the stale sweep, and the hotel gets a Telegram alert, a CRITICAL log and the `pms.booking.outcome_unknown` KPI.
The guest gets a 502 asking them not to submit the card again, and any later submission for that booking gets the same answer until staff confirm the booking in ResNexus.

## Where the behaviour lives

`websocket-server/src`:

| File | Role |
|---|---|
| `router/roomReservationRouter.ts` | `POST /daisy/reservation/card` |
| `middleware/requestLogger.ts` | replaces the card endpoints' request bodies in logs |
| `validators/cardSubmissionSchema.ts` | `resNexusCardSchema` and the shared card keys |
| `utils/helper.ts` | `parseYyMm` |
| `dtos/enum/ReservationPaymentStatus.ts` | `EXTERNALLY_MANAGED` and `hasNoDextrPayment` |
| `services/roomReservation/roomReservationService.ts` | creation status, guards, `processResNexusCardAndCreateReservations` |
| `repositories/ReservationRepository.ts` | the stale sweep queries |
| `resNexus/service/reservation/reservationService.ts` | maps the card onto the `addreservation` fields |
| `utils/httpClient.ts`, `resNexus/utils/helper.ts` | outbound body redaction |
| `services/payment/PaymentProviderFactory.ts` | refuses `RESNEXUS`, since no payment is created |

The main test is `services/roomReservation/__tests__/resNexusCardSubmissionFlow.test.ts`.

