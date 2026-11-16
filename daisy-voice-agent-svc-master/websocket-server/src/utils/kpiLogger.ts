/**
 * KPI logger — CloudWatch EMF metric emission.
 *
 * ## Usage
 *
 * Import `logKpi` and a constant from `KpiStat`. Never pass raw strings as
 * `stat` — use the enum so metric names stay consistent across the codebase
 * and typos are caught at compile time.
 *
 * ```typescript
 * import { KpiStat, logKpi } from '../../utils/kpiLogger';
 *
 * logKpi({
 *   stat: KpiStat.PmsBookingCreated,
 *   value: 1,
 *   contextName: 'MyService.myMethod', // appears as a CloudWatch dimension
 *   clientId: hotel.assistant_phone_number ?? hotel.id,
 *   contextId: paymentId,              // optional; falls back to request ID
 * });
 * ```
 *
 * `clientId` falls back to the current async-local request context
 * (`assistantPhoneNumber` then `hotelId`) when omitted, and only becomes the
 * `'??'` sentinel if neither the argument nor the context has one.
 *
 * ## When to instrument
 *
 * - PMS API outcomes (booking created/cancelled/modified, availability, quote)
 * - Payment outcomes (success, failed, refund, autocharge, setup session)
 * - Reservation lifecycle events triggered by the system (stale cancellation)
 *
 * ## Adding new stats
 *
 * Add an entry to `KpiStat` below before calling `logKpi`. Follow the
 * `<domain>.<sub-domain>.<outcome>` naming convention.
 *
 * ## Infrastructure
 *
 * Each call emits one JSON line to stdout in AWS EMF format. CloudWatch Logs
 * agent picks it up and creates a metric under the `daisy-voice-agent-svc`
 * namespace, dimensioned by `stat`, `clientId` and `contextName`.
 *
 * Keep that dimension set fixed. A metric is billed per unique combination of
 * dimension values, and consumers key off the exact combination — widening it
 * both costs more and silently orphans anything watching the narrower shape.
 */

import { getRequestContext } from './requestContext';

export type KpiLogArgs = {
  stat: string;
  value: number;
  contextName: string;
  clientId?: string;
  contextId?: string;
};

export type KpiMetricUnit = 'Count';

export const KPI_NAMESPACE = 'daisy-voice-agent-svc';
export const KPI_METRIC_NAME = 'value';
export const KPI_METRIC_UNIT: KpiMetricUnit = 'Count';
export const KPI_MISSING_CLIENT_ID = '??';

/**
 * Canonical KPI stat names.
 *
 * Convention: `<domain>.<sub-domain>.<outcome>`
 *
 * Use these constants everywhere instead of raw strings so that dashboard
 * metric names stay consistent and typos are caught at compile time.
 */
export const KpiStat = {
  // ---- Payments ----
  /** Guest submitted payment and Stripe collected it successfully. */
  PaymentSuccess: 'payment.success',
  /** Stripe payment intent failed (card declined, authentication error, etc.). */
  PaymentFailed: 'payment.failed',
  /** Payment link / setup session URL dispatched to the guest. */
  PaymentLinkSent: 'payment.link_sent',
  /** Dollar amount associated with a sent payment link. */
  PaymentLinkSentAmount: 'payment.link_sent_amount',
  /** Refund webhook confirmed as succeeded on Stripe's side. */
  PaymentRefundSucceeded: 'payment.refund_succeeded',
  /** Refund webhook confirmed as failed on Stripe's side. */
  PaymentRefundFailed: 'payment.refund_failed',
  /** Stripe invoice auto-charge for a zero-deposit booking succeeded. */
  PaymentAutochargeSucceeded: 'payment.autocharge_succeeded',
  /** Dollar amount collected by a successful autocharge. */
  PaymentAutochargeSucceededAmount: 'payment.autocharge_succeeded_amount',
  /** Stripe invoice auto-charge attempt failed. */
  PaymentAutochargeFailed: 'payment.autocharge_failed',
  /** Guest completed zero-deposit card capture (Stripe setup session or Shift4 card-on-file token save), no charge collected. */
  PaymentSetupSessionCompleted: 'payment.setup_session_completed',
  /** 3D Secure was applied to a Shift4 pre-authorization for a hotel with threeDS_config.enabled turned on. */
  PaymentShift4ThreeDSApplied: 'payment.shift4.3ds_applied',

  // ---- PMS bookings ----
  /** PMS reservation created successfully. */
  PmsBookingCreated: 'pms.booking.created',
  /** Rooms of a multi-room booking that failed after other rooms were booked. */
  PmsBookingPartiallyCreated: 'pms.booking.partially_created',
  /** PMS reservation cancelled successfully. */
  PmsBookingCancelled: 'pms.booking.cancelled',
  /** PMS reservation modified successfully. */
  PmsBookingModified: 'pms.booking.modified',

  /** A PMS product (e.g. Mews pet product) was attached to a reservation at creation. */
  PmsProductAdded: 'pms.product.added',
  /** Same-day booking refused before payment because the hotel's cutoff had passed. */
  PmsBookingSameDayCutoffRejected: 'pms.booking.same_day_cutoff_rejected',
  /** Reservation start had already passed at creation time — Mews would reject it. */
  PmsBookingPastStartRejected: 'pms.booking.past_start_rejected',
  /** Booking refused because a PMS restriction closed the rate/room for those dates. */
  PmsBookingRestrictionRejected: 'pms.booking.restriction_rejected',
  /** A room was sent with the guest's card to a PMS that takes the card in its create call, whatever the outcome. */
  PmsBookingCardSent: 'pms.booking.card_sent',
  /** A PMS that takes the card in its create call refused the booking. */
  PmsBookingCardRejected: 'pms.booking.card_rejected',
  /** A PMS create call got no answer or a server error, so the room may or may not be booked. */
  PmsBookingOutcomeUnknown: 'pms.booking.outcome_unknown',
  PmsCardVerificationApproved: 'pms.card_verification.approved',
  PmsCardVerificationDeclined: 'pms.card_verification.declined',
  PmsCardVerificationUnavailable: 'pms.card_verification.unavailable',
  PmsCardVerificationRateLimited: 'pms.card_verification.rate_limited',

  // ---- PMS API calls ----
  /** Availability check sent to a PMS. */
  PmsAvailabilityRequested: 'pms.availability.requested',
  /** Quote requested from a PMS. */
  PmsQuoteRequested: 'pms.quote.requested',
  /**
   * A raw PMS API call succeeded. Deliberately generic across providers:
   * one stat for every integration rather than a stat per provider/endpoint.
   */
  PmsApiCall: 'pms.api.call',
  /** A raw PMS API call failed. */
  PmsApiCallError: 'pms.api.call_error',

  // ---- Voice call lifecycle ----
  /** A voice call went in-progress (Vapi status-update). */
  CallStarted: 'call.started',
  /** A voice call ended (Vapi status-update). */
  CallEnded: 'call.ended',
  /** A call was handed off to a human/hotel destination. */
  CallTransferred: 'call.transferred',

  // ---- Vapi structured outputs (end-of-call-report) ----
  /**
   * All structured outputs expected for this hotel's Vapi config —
   * "Customer Satisfaction", "Customer Frustration Score" and "Caller
   * Intent" always, plus "Availability Enquired", "Payment Link Sent" and
   * "Followup Availability" when
   * hotelConfiguration.followup_payment_link_configuration.enabled — were
   * present on the end-of-call-report's artifact.structuredOutputs.
   * Logged as 0/1 on every call (not just on absence) so the metric always
   * has data: a hotel's Vapi config dropping one of these outputs shows up
   * as this value going to 0 instead of a zeroed digest count noticed days
   * later. Flags that something is missing, not which output — check the
   * call's stored conversation record to pinpoint it.
   */
  VapiStructuredOutputsAllPresent: 'vapi.structured_output.all_present',
  /**
   * resolveGuestIntentFromVapiPayload produced an empty string — neither the
   * "Caller Intent" structured output nor the legacy
   * analysis.structuredData.intent fallback yielded a usable intent. Distinct
   * from VapiStructuredOutputsAllPresent going to 0: that one can be caused
   * by any expected output going missing; this one flags the call actually
   * ending up unclassified, which is what silently skews intent-keyed KPIs
   * (e.g. booking_intent_calls in getKpiSummary).
   */
  VapiGuestIntentUnresolved: 'vapi.guest_intent.unresolved',

  // ---- Vapi call recording ----
  /**
   * The end-of-call-report had no usable recording URL in artifact.recording
   * or any of the legacy fallback fields — the call has no recording at all.
   */
  VapiRecordingUrlMissing: 'vapi.recording.url_missing',
  /**
   * A recording URL was present but persisting it to S3 failed; we fall back
   * to storing the raw (often HIPAA/private) Vapi URL, which isn't
   * anonymously playable and may expire.
   */
  VapiRecordingS3UploadFailed: 'vapi.recording.s3_upload_failed',

  // ---- PMS external auth ----
  /** A PMS token was encrypted and stored in a hotel's external_auth_config. */
  PmsExternalAuthTokenStored: 'pms.external_auth.token_stored',
  /**
   * The reservation the PMS actually created costs a different amount than
   * the quote we spoke to the guest. Calry cannot bind a booking to a rate
   * plan, so this is the only detector for the PMS silently applying a
   * different rate than the one quoted.
   */
  PmsQuotedPriceMismatch: 'pms.quote.price_mismatch',
  /** OAuth client credentials (client_id/client_secret) were stored for a hotel. */
  PmsOAuthClientCredentialsStored:
    'pms.external_auth.client_credentials_stored',
  /** Cloudbeds Payments SDK key pair issued and stored for a hotel. */
  CloudbedsSdkApiKeyIssued: 'cloudbeds.sdk.api_key_issued',

  // ---- Reservation lifecycle ----
  /** INACTIVE reservation cancelled by the stale-reservation cron. */
  ReservationStaleCancelled: 'reservation.stale_cancelled',
  /** Payment completed but the linked reservation never left INACTIVE (PMS creation failed). */
  ReservationPaidPmsCreationFailed: 'reservation.paid_pms_creation_failed',

  // ---- PMS reservation lookup (Stayntouch) ----
  /** Stayntouch external-ID lookup attempted. */
  StayntouchExternalIdLookup: 'stayntouch.external_id.lookup',
  /** Stayntouch external-ID lookup returned at least one result. */
  StayntouchExternalIdSuccess: 'stayntouch.external_id.success',

  // ---- Cloudbeds API client calls ----
  CloudbedsApiGetRooms: 'cloudbeds.api.get_rooms',
  CloudbedsApiGetRoomsError: 'cloudbeds.api.get_rooms_error',
  CloudbedsApiGetRoomTypesCatalog: 'cloudbeds.api.get_room_types_catalog',
  CloudbedsApiGetRoomTypesCatalogError:
    'cloudbeds.api.get_room_types_catalog_error',
  CloudbedsApiGetRoomTypes: 'cloudbeds.api.get_room_types',
  CloudbedsApiGetRoomTypesError: 'cloudbeds.api.get_room_types_error',
  CloudbedsApiGetAvailableRoomTypes: 'cloudbeds.api.get_available_room_types',
  CloudbedsApiGetAvailableRoomTypesError:
    'cloudbeds.api.get_available_room_types_error',
  CloudbedsApiGetRate: 'cloudbeds.api.get_rate',
  CloudbedsApiGetRateError: 'cloudbeds.api.get_rate_error',
  CloudbedsApiPostReservation: 'cloudbeds.api.post_reservation',
  CloudbedsApiPostReservationError: 'cloudbeds.api.post_reservation_error',
  CloudbedsApiPutReservation: 'cloudbeds.api.put_reservation',
  CloudbedsApiPutReservationError: 'cloudbeds.api.put_reservation_error',
  CloudbedsApiGetTaxesAndFees: 'cloudbeds.api.get_taxes_and_fees',
  CloudbedsApiGetTaxesAndFeesError: 'cloudbeds.api.get_taxes_and_fees_error',
  CloudbedsApiGetItems: 'cloudbeds.api.get_items',
  CloudbedsApiGetItemsError: 'cloudbeds.api.get_items_error',
  CloudbedsApiPostItem: 'cloudbeds.api.post_item',
  CloudbedsApiPostItemError: 'cloudbeds.api.post_item_error',
  CloudbedsApiGetPaymentMethods: 'cloudbeds.api.get_payment_methods',
  CloudbedsApiGetPaymentMethodsError: 'cloudbeds.api.get_payment_methods_error',
  CloudbedsApiPostReservationNote: 'cloudbeds.api.post_reservation_note',
  CloudbedsApiPostReservationNoteError:
    'cloudbeds.api.post_reservation_note_error',
  CloudbedsApiGetReservation: 'cloudbeds.api.get_reservation',
  CloudbedsApiGetReservationError: 'cloudbeds.api.get_reservation_error',
  CloudbedsApiGetReservationsBySource:
    'cloudbeds.api.get_reservations_by_source',
  CloudbedsApiGetReservationsBySourceError:
    'cloudbeds.api.get_reservations_by_source_error',
  CloudbedsApiGetReservationsByGuestName:
    'cloudbeds.api.get_reservations_by_guest_name',
  CloudbedsApiGetReservationsByGuestNameError:
    'cloudbeds.api.get_reservations_by_guest_name_error',
  CloudbedsApiGetReservationsByCheckInDate:
    'cloudbeds.api.get_reservations_by_check_in_date',
  CloudbedsApiGetReservationsByCheckInDateError:
    'cloudbeds.api.get_reservations_by_check_in_date_error',
  CloudbedsApiPostPayment: 'cloudbeds.api.post_payment',
  CloudbedsApiPostPaymentError: 'cloudbeds.api.post_payment_error',
  CloudbedsApiPostCreditCard: 'cloudbeds.api.post_credit_card',
  CloudbedsApiPostCreditCardError: 'cloudbeds.api.post_credit_card_error',
  CloudbedsApiPostCharge: 'cloudbeds.api.post_charge',
  CloudbedsApiPostChargeError: 'cloudbeds.api.post_charge_error',

  // ---- Cloudbeds reservation service ----
  /** Cloudbeds room availability quote requested. */
  CloudbedsReservationAvailabilityRequested:
    'cloudbeds.reservation.availability_requested',
  /** Cloudbeds reservation created via the service layer. */
  CloudbedsReservationCreated: 'cloudbeds.reservation.created',
  /** Cloudbeds reservation cancelled via the service layer. */
  CloudbedsReservationCancelled: 'cloudbeds.reservation.cancelled',
  /** Reservation lookup by external ID returned at least one result. */
  CloudbedsReservationLookupSuccess: 'cloudbeds.reservation.lookup_success',
  /** Reservation lookup by external ID returned no results. */
  CloudbedsReservationLookupNoResult: 'cloudbeds.reservation.lookup_no_result',

  // ---- Cloudbeds door-code resolution (POST /daisy/reservation/door-code) ----
  /** At least one door code was read from Cloudbeds for a stay the caller is verified on. */
  CloudbedsDoorCodeResolved: 'cloudbeds.door_code.resolved',
  /** The caller's stay was verified, but Cloudbeds held no door code for it. */
  CloudbedsDoorCodeNotFound: 'cloudbeds.door_code.not_found',
  /**
   * No code was given: no caller ID, no such reservation (or none in house
   * with the caller ID), the caller ID isn't on the reservation, or the stay
   * isn't active or doesn't cover today. The reason is in the log.
   */
  CloudbedsDoorCodeRefused: 'cloudbeds.door_code.refused',
  /** Cloudbeds (or Daisy's own booking lookup) couldn't be asked, or didn't answer in time. */
  CloudbedsDoorCodeLookupFailed: 'cloudbeds.door_code.lookup_failed',

  // ---- RemoteLock API client calls ----
  RemoteLockAccessPersonsFetched: 'remotelock.api.access_persons_fetched',
  RemoteLockAccessPersonsError: 'remotelock.api.access_persons_error',
  RemoteLockUserFetched: 'remotelock.api.user_fetched',

  // ---- RemoteLock marketplace authorization ----
  /** A hotel authorized Dextr from the RemoteLock marketplace. */
  RemoteLockAuthorizationCompleted: 'remotelock.oauth.authorization_completed',

  // ---- RemoteLock door-code resolution ----
  /** Exactly one RemoteLock access guest matched the reservation; PIN returned. */
  RemoteLockDoorCodeResolved: 'remotelock.door_code.resolved',
  /** Multiple access guests matched; PIN returned from the newest match. */
  RemoteLockDoorCodeAmbiguous: 'remotelock.door_code.ambiguous',
  /** No access guest matched the reservation; caller escalated. */
  RemoteLockDoorCodeNotFound: 'remotelock.door_code.not_found',
  /**
   * A guest-name + check-out-date lookup still matched several bookings, so no
   * PIN was released and the caller was asked for their booking ID.
   */
  RemoteLockDoorCodeGuestNameAmbiguous:
    'remotelock.door_code.guest_name_ambiguous',

  // ---- Lockbox log (hotel-kept lockbox assignments, POST /daisy/lockbox-code) ----
  /** At least one lockbox matched the caller's rooms on the reservation; its code was returned. */
  LockboxCodeResolved: 'lockbox.code.resolved',
  /**
   * The log has assignments for the date, but no lockbox matched the caller's
   * rooms, or only a blank-room box another arrival's name also fits.
   */
  LockboxCodeNotFound: 'lockbox.code.not_found',
  /** Neither the Today tab nor the Archive has assignments for today: the log is stale. */
  LockboxLogNoAssignment: 'lockbox.log.no_assignment',
  /** The log could not be downloaded (Dropbox token refresh or file download failed). */
  LockboxLogFetchFailed: 'lockbox.log.fetch_failed',
  /** The downloaded file is not a readable workbook, or its layout changed. */
  LockboxLogParseFailed: 'lockbox.log.parse_failed',
  /**
   * The booking can't have a code: no such reservation, not active, not
   * checking in on the assignment date, or no room assigned.
   */
  LockboxReservationNotVerified: 'lockbox.reservation.not_verified',
  /** The name or room the agent sent isn't a guest's or a room on the reservation. */
  LockboxReservationMismatch: 'lockbox.reservation.mismatch',
  /**
   * The reservation still owes a balance, or the PMS gave none that can be
   * read: the hotel collects it before a self check-in.
   */
  LockboxReservationBalanceDue: 'lockbox.reservation.balance_due',
  /**
   * The PMS couldn't be asked (error, timeout, or a PMS that can't load a
   * reservation by id): for the reservation, or for the same-name check a
   * blank-room box needs.
   */
  LockboxReservationLookupFailed: 'lockbox.reservation.lookup_failed',
  /** A request without a booking id found tonight's reservation(s) by the caller ID. */
  LockboxPhoneLookupCallerIdMatched: 'lockbox.phone_lookup.caller_id_matched',
  /**
   * A request without a booking id found tonight's reservation(s) by a phone
   * number the caller gave, with a guest's last name on them.
   */
  LockboxPhoneLookupBookingPhoneMatched:
    'lockbox.phone_lookup.booking_phone_matched',
  /**
   * A request without a booking id found no live arrival tonight with a guest
   * with the phone number (and, for a number the caller gave, their last name).
   */
  LockboxPhoneLookupNotFound: 'lockbox.phone_lookup.not_found',

  // ---- Alfred external-partner door code ----
  /** Alfred door-code request withheld because no ongoing/upcoming reservation was fully paid. */
  AlfredDoorCodeRestricted: 'alfred.door_code.restricted',

  // ---- RemoteLock access-person passthrough (partner-driven) ----
  /**
   * A partner service (Alfred) fetched an access person through the internal
   * passthrough endpoint. Separate from the client-level stats so the
   * webhook-driven volume is distinguishable from the voice path's.
   */
  RemoteLockAccessPersonFetched: 'remotelock.access_person.fetched',
  /** The partner-driven access-person fetch failed for any reason. */
  RemoteLockAccessPersonFetchError: 'remotelock.access_person.fetch_error',

  // ---- Auth migration (Core JWT vs Daisy/native JWT) ----
  /** Request authenticated via Dextr Core JWT. */
  AuthCoreAccepted: 'auth.core.accepted',
  /** Request authenticated via Daisy (native) JWT. */
  AuthNativeAccepted: 'auth.native.accepted',

  // ---- Inbound x-api-key auth (apiKeyMiddleware) ----
  /** Request authenticated with a key from DAISY_INBOUND_API_KEYS_EXPIRED (rotation bridge). */
  AuthApiKeyExpiredAccepted: 'auth.api_key.expired_accepted',
  /** Request rejected because its x-api-key header was missing or matched no configured key. */
  AuthApiKeyRejected: 'auth.api_key.rejected',

  // ---- Opera cashiering (through Calry passthrough) ----
  /** A card was exchanged for an OPI token. */
  OperaCardTokenized: 'opera.card.tokenized',
  /** Token exchange failed for a reason other than a decline. */
  OperaCardTokenizationFailed: 'opera.card.tokenization_failed',
  /** The payment service provider declined the card at token exchange. */
  OperaCardDeclined: 'opera.card.declined',
  /** An OPI token was attached to an Opera reservation. */
  OperaCardAttached: 'opera.card.attached',
  /** Attaching the token to the reservation failed — Opera cannot settle. */
  OperaCardAttachFailed: 'opera.card.attach_failed',
  /** A deposit was posted to an Opera folio. */
  OperaDepositPosted: 'opera.deposit.posted',
  /** Posting a deposit to an Opera folio failed. */
  OperaDepositFailed: 'opera.deposit.failed',
  /**
   * Money collected on Stripe or Shift4 was recorded on the Opera folio.
   * Distinct from `OperaDepositPosted`, which is money Opera itself settled.
   */
  OperaPaymentRecorded: 'opera.payment.recorded',
  /**
   * Recording an externally collected payment failed. The guest has been
   * charged and the booking stands, so this always needs reconciling by hand.
   */
  OperaPaymentRecordFailed: 'opera.payment.record_failed',
  /** A refund reversal was posted to an Opera folio. */
  OperaRefundPosted: 'opera.refund.posted',
  /** Posting a refund reversal to an Opera folio failed. */
  OperaRefundFailed: 'opera.refund.failed',
  /** Opera settled the remaining balance on the auto-charge schedule. */
  OperaAutochargeSuccess: 'opera.autocharge.success',
  /** Opera failed to settle the remaining balance. */
  OperaAutochargeFailure: 'opera.autocharge.failure',

  // ---- Manager escalation reply ----
  EscalationResponseSent: 'escalation.response.sent',
  EscalationResponseFailed: 'escalation.response.failed',

  // ---- Microsoft Teams ----
  /** A new message was posted to a Teams channel (edits are not counted). */
  TeamsMessageSent: 'teams.message.sent',
  /** Posting to a Teams channel failed: app not installed there, throttled past the retry limit, or an API error. */
  TeamsMessageSendFailed: 'teams.message.send_failed',
  /**
   * A message activity (thread reply, command or button click) passed Bot
   * Framework JWT validation and came from the tenant the channel was first
   * seen in. Reactions and install events are not counted.
   */
  TeamsMessageReceived: 'teams.message.received',

  // ---- Cross-sell (sister property) ----
  CrossSellAvailabilityRequested: 'cross_sell.availability.requested',
  CrossSellAvailabilityFound: 'cross_sell.availability.found',
  CrossSellAvailabilityNoneFound: 'cross_sell.availability.none_found',
  /** One sister hotel's PMS availability check failed or timed out (contextId = sister hotel id). */
  CrossSellAvailabilityCheckFailed: 'cross_sell.availability.check_failed',
} as const;

export type KpiStatValue = (typeof KpiStat)[keyof typeof KpiStat];

type KpiEmfLogObject = Record<string, unknown>;

const KPI_DIMENSIONS: readonly (readonly string[])[] = [
  ['stat', 'clientId', 'contextName'],
];

/** Emits one EMF JSON line to stdout for CloudWatch metric extraction. */
export function logKpi(args: KpiLogArgs): void {
  try {
    const emfLogObject = buildKpiEmfLogObject(args);
    console.log(JSON.stringify(emfLogObject));
  } catch (err) {
    console.warn('logKpi failed');
  }
}

function buildKpiEmfLogObject(args: KpiLogArgs): KpiEmfLogObject {
  const resolvedClientId = resolveKpiClientId(args.clientId);
  const resolvedContextId = resolveKpiContextId(args.contextId);
  const result: KpiEmfLogObject = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: KPI_NAMESPACE,
          Dimensions: KPI_DIMENSIONS.map((dimensionSet) => [...dimensionSet]),
          Metrics: [{ Name: KPI_METRIC_NAME, Unit: KPI_METRIC_UNIT }],
        },
      ],
    },
    stat: args.stat,
    value: args.value,
    clientId: resolvedClientId,
    contextName: args.contextName,
  };
  if (resolvedContextId !== undefined) {
    result.contextId = resolvedContextId;
  }
  return result;
}

function resolveKpiClientId(clientId: string | undefined): string {
  if (clientId !== undefined && clientId !== '') {
    return clientId;
  }
  const context = getRequestContext();
  const fallback = context?.assistantPhoneNumber ?? context?.hotelId;
  if (fallback !== undefined && fallback !== '') {
    return fallback;
  }
  return KPI_MISSING_CLIENT_ID;
}

function resolveKpiContextId(
  contextId: string | undefined,
): string | undefined {
  if (contextId !== undefined && contextId !== '') {
    return contextId;
  }
  return getRequestContext()?.requestId;
}
