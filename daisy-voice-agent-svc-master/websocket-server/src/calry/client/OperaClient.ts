/**
 * Opera Cloud calls made through Calry's authenticated passthrough.
 *
 * Calry's unified `/availability` and `/quote` endpoints do not work for
 * Opera/OHIP — availability returns an empty `roomRates[]` and quote 500s —
 * so the three pieces Daisy needs are read straight off Opera instead:
 *
 * - `GET /rtp/v1/hotels/{id}/ratePlans` — which rate plans exist and which
 *   room types each one sells.
 * - `GET /par/v1/hotels/{id}/availability/alternate` — per-date
 *   `Available` / `Restricted` for one rate plan + room type. This is the
 *   only availability endpoint Opera answers with real data; it carries no
 *   unit counts, so availability here is a boolean, not a quantity.
 * - `GET /rsv/v1/hotels/{id}/reservations/rateInfo` — prices a hypothetical
 *   stay (`summaryInfo=true`) without creating a reservation.
 *
 * Calry injects the upstream Opera auth, so no app key or token is sent from
 * here. `x-hotelid` is not injected and must be passed per call.
 */

import {
  CalryCredentials,
  CalryPassthroughRequest,
  OperaAlternateAvailabilityResponse,
  OperaCreateReservationRequest,
  OperaCreateReservationResponse,
  OperaFolioResponse,
  OperaGetFolioParams,
  OperaListOfValuesResponse,
  OperaPaymentMethodLov,
  OperaPaymentMethodsResponse,
  OperaPostChargeRequest,
  OperaPostChargeResponse,
  OperaPostPaymentRequest,
  OperaPostPaymentResponse,
  OperaRateInfoResponse,
  OperaRatePlan,
  OperaRatePlansResponse,
  OperaReservationSearchResponse,
  OperaRoomTypeLov,
  OperaTarget,
  OperaUpdateReservationPaymentRequest,
} from '../types';
import calryClient from './CalryClient';

/** Calry rejects a `sourceUrl` that carries its own query string (500). */
type QueryParams = Record<string, string | number | boolean>;

export class OperaClient {
  private async get<T>(
    target: OperaTarget,
    path: string,
    queryParams: QueryParams,
    credentials: CalryCredentials,
    pathParams: Record<string, string> = {},
  ): Promise<T> {
    const request: CalryPassthroughRequest = {
      method: 'GET',
      sourceUrl: `${target.host.replace(/\/+$/, '')}${path}`,
      data: {
        pathParams: { hotelId: target.propertyCode, ...pathParams },
        queryParams,
        headers: { 'x-hotelid': target.propertyCode },
      },
    };

    return calryClient.passthrough<T>(request, credentials);
  }

  /** As `get`, for the cashiering and reservation writes. */
  private async send<T>(
    target: OperaTarget,
    method: 'POST' | 'PUT',
    path: string,
    body: unknown,
    credentials: CalryCredentials,
    pathParams: Record<string, string> = {},
  ): Promise<T> {
    const request: CalryPassthroughRequest = {
      method,
      sourceUrl: `${target.host.replace(/\/+$/, '')}${path}`,
      data: {
        pathParams: { hotelId: target.propertyCode, ...pathParams },
        headers: { 'x-hotelid': target.propertyCode },
        body,
      },
    };

    return calryClient.passthrough<T>(request, credentials);
  }

  /**
   * The property's room types. Calry's own `/room-types` reports Opera rooms
   * rather than room types, so the codes every other Opera call needs come
   * from here.
   */
  async listRoomTypes(
    target: OperaTarget,
    credentials: CalryCredentials,
  ): Promise<OperaRoomTypeLov[]> {
    const response = await this.get<OperaListOfValuesResponse>(
      target,
      '/lov/v1/listOfValues/hotels/{hotelId}/resortRoomTypes',
      { includeInactiveFlag: false },
      credentials,
    );
    return response.listOfValues?.items ?? [];
  }

  async listRatePlans(
    target: OperaTarget,
    credentials: CalryCredentials,
    limit = 500,
  ): Promise<OperaRatePlan[]> {
    const response = await this.get<OperaRatePlansResponse>(
      target,
      '/rtp/v1/hotels/{hotelId}/ratePlans',
      { limit },
      credentials,
    );
    return response.ratePlans ?? [];
  }

  /**
   * Per-date status for one rate plan and room type. Opera returns a window
   * wider than the dates asked for, so callers must filter to the stay.
   */
  async getDateStatuses(
    target: OperaTarget,
    query: {
      ratePlanCode: string;
      roomType: string;
      startDate: string;
      endDate: string;
      adults: number;
    },
    credentials: CalryCredentials,
  ): Promise<{ date: string; status: string }[]> {
    const response = await this.get<OperaAlternateAvailabilityResponse>(
      target,
      '/par/v1/hotels/{hotelId}/availability/alternate',
      { ...query },
      credentials,
    );
    return response.alternates ?? [];
  }

  /**
   * Prices a stay. `ratePlanCode` is required — without it Opera answers 200
   * with every amount zeroed rather than an error.
   */
  async getRateInfo(
    target: OperaTarget,
    query: {
      ratePlanCode: string;
      roomType: string;
      adults: number;
      criteriaStartDate: string;
      criteriaEndDate: string;
    },
    credentials: CalryCredentials,
  ): Promise<OperaRateInfoResponse> {
    return this.get<OperaRateInfoResponse>(
      target,
      '/rsv/v1/hotels/{hotelId}/reservations/rateInfo',
      { summaryInfo: true, ...query },
      credentials,
    );
  }

  /**
   * The property's payment methods. Which code to post against is a property
   * configuration decision, so nothing here may be hardcoded.
   */
  async listPaymentMethods(
    target: OperaTarget,
    credentials: CalryCredentials,
  ): Promise<OperaPaymentMethodLov[]> {
    const response = await this.get<OperaPaymentMethodsResponse>(
      target,
      '/lov/v1/listOfValues/hotels/{hotelId}/paymentMethods',
      { includeInactiveFlag: false },
      credentials,
    );
    return response.listOfValues?.items ?? [];
  }

  /**
   * Attaches payment methods to a reservation. A card is sent as an OPI token,
   * never as a PAN — Opera settles it through the property's own integration.
   */
  async setReservationPaymentMethods(
    target: OperaTarget,
    reservationId: string,
    body: OperaUpdateReservationPaymentRequest,
    credentials: CalryCredentials,
  ): Promise<void> {
    await this.send<void>(
      target,
      'PUT',
      '/rsv/v1/hotels/{hotelId}/reservations/{reservationId}',
      body,
      credentials,
      { reservationId },
    );
  }

  /**
   * Moves a reservation's stay dates and guest counts.
   *
   * The same `PUT` that attaches a card, with a `roomStay` instead. Opera
   * reprices the stay itself against the reservation's existing rate plan, so
   * no amounts are sent — the caller re-quotes afterwards to learn the new
   * total.
   */
  async updateReservationStay(
    target: OperaTarget,
    reservationId: string,
    stay: {
      arrivalDate: string;
      departureDate: string;
      adults: number;
      children: number;
    },
    credentials: CalryCredentials,
  ): Promise<unknown> {
    return this.send<unknown>(
      target,
      'PUT',
      '/rsv/v1/hotels/{hotelId}/reservations/{reservationId}',
      {
        // Flat under `reservations`, like `reservationPaymentMethods` — the
        // nested `reservation: [...]` array is the *create* shape and Opera
        // rejects it here (`OPERAWS-GEN01242 Unknown property`).
        reservations: {
          roomStay: {
            arrivalDate: stay.arrivalDate,
            departureDate: stay.departureDate,
            guestCounts: {
              adults: String(stay.adults),
              children: String(stay.children),
            },
          },
        },
      },
      credentials,
      { reservationId },
    );
  }

  /**
   * Creates a reservation directly on Opera.
   *
   * Calry's unified `POST /reservations` answers
   * `500 This Integration doesn't support this path/model` for Opera, so the
   * booking is placed here instead. Opera returns no reservation body — the
   * ids are only in the `links[]` hrefs, which is what
   * `extractOperaReservationIds` reads.
   */
  async createReservation(
    target: OperaTarget,
    body: OperaCreateReservationRequest,
    credentials: CalryCredentials,
  ): Promise<OperaCreateReservationResponse> {
    return this.send<OperaCreateReservationResponse>(
      target,
      'POST',
      '/rsv/v1/hotels/{hotelId}/reservations',
      body,
      credentials,
    );
  }

  /**
   * Changes a reservation's room type and/or rate plan.
   *
   * Separate from `updateReservationStay` because Opera needs the whole
   * `roomRates` entry restated when either changes — a partial one is refused
   * with `RSV01414 Source code is required`. No amounts are sent: Opera prices
   * the stay from the rate plan, and the caller re-quotes afterwards.
   */
  async updateReservationRoomRate(
    target: OperaTarget,
    reservationId: string,
    stay: {
      arrivalDate: string;
      departureDate: string;
      adults: number;
      children: number;
      roomType: string;
      ratePlanCode: string;
      marketCode?: string;
      sourceCode?: string;
    },
    credentials: CalryCredentials,
  ): Promise<unknown> {
    const guestCounts = {
      adults: String(stay.adults),
      children: String(stay.children),
    };

    return this.send<unknown>(
      target,
      'PUT',
      '/rsv/v1/hotels/{hotelId}/reservations/{reservationId}',
      {
        reservations: {
          roomStay: {
            roomRates: [
              {
                roomType: stay.roomType,
                ratePlanCode: stay.ratePlanCode,
                start: stay.arrivalDate,
                end: stay.departureDate,
                guestCounts,
                numberOfUnits: '1',
                ...(stay.marketCode && { marketCode: stay.marketCode }),
                ...(stay.sourceCode && { sourceCode: stay.sourceCode }),
              },
            ],
            arrivalDate: stay.arrivalDate,
            departureDate: stay.departureDate,
            guestCounts,
          },
        },
      },
      credentials,
      { reservationId },
    );
  }

  /**
   * The Opera reservation id behind a guest-facing confirmation number.
   *
   * Daisy reads the confirmation number back to guests as
   * `external_public_id`, so it is what they quote on a callback — but every
   * Opera and Calry lookup is keyed by the numeric reservation id, and passing
   * a confirmation number to `getReservation` answers 400.
   *
   * @returns The reservation id, or null when nothing matches — the caller
   *   then treats the input as a reservation id already.
   */
  async findReservationIdByConfirmation(
    target: OperaTarget,
    confirmationNumber: string,
    credentials: CalryCredentials,
  ): Promise<string | null> {
    const response = await this.get<OperaReservationSearchResponse>(
      target,
      '/rsv/v1/hotels/{hotelId}/reservations',
      { confirmationNumberList: confirmationNumber, limit: 5 },
      credentials,
    );

    const found = (response.reservations?.reservationInfo ?? []).find((info) =>
      (info.reservationIdList ?? []).some(
        (id) => id.type === 'Confirmation' && id.id === confirmationNumber,
      ),
    );

    return (
      (found?.reservationIdList ?? []).find((id) => id.type === 'Reservation')
        ?.id ?? null
    );
  }

  /**
   * Cancels a reservation on Opera.
   *
   * Calry's unified update/cancel answers 500 for Opera, so an unpaid booking
   * can only be unwound here — without this a failed card attach leaves the
   * room held with no payment against it.
   */
  async cancelReservation(
    target: OperaTarget,
    reservationId: string,
    reason: string,
    reasonCode: string,
    credentials: CalryCredentials,
  ): Promise<unknown> {
    return this.send<unknown>(
      target,
      'POST',
      '/rsv/v1/hotels/{hotelId}/reservations/{reservationId}/cancellations',
      {
        // Opera rejects a cancellation with no reason code
        // (`OPERAWS-RSV11046 Cancellation reason cannot be empty`).
        reason: { description: reason, code: reasonCode },
        reservations: [
          {
            reservationIdList: [{ id: reservationId, type: 'Reservation' }],
            allowedActions: ['Cancel'],
            hotelId: target.propertyCode,
            cxlInstr: { deleteResTraces: false },
          },
        ],
        // Oracle's sample sends `true`, which only validates the cancellation.
        verificationOnly: false,
      },
      credentials,
      { reservationId },
    );
  }

  /** Posts a payment to the reservation's folio. */
  async postReservationPayment(
    target: OperaTarget,
    reservationId: string,
    body: OperaPostPaymentRequest,
    credentials: CalryCredentials,
  ): Promise<OperaPostPaymentResponse> {
    return this.send<OperaPostPaymentResponse>(
      target,
      'POST',
      '/csh/v1/hotels/{hotelId}/reservations/{reservationId}/payments',
      body,
      credentials,
      { reservationId },
    );
  }

  /**
   * Posts a charge to the reservation's folio. A negative amount reverses an
   * earlier posting, which is how a refund is recorded — Opera has no refund
   * endpoint.
   */
  async postReservationCharge(
    target: OperaTarget,
    reservationId: string,
    body: OperaPostChargeRequest,
    credentials: CalryCredentials,
  ): Promise<OperaPostChargeResponse> {
    return this.send<OperaPostChargeResponse>(
      target,
      'POST',
      '/csh/v1/hotels/{hotelId}/reservations/{reservationId}/charges',
      body,
      credentials,
      { reservationId },
    );
  }

  /**
   * Reads a reservation's folio.
   *
   * `fetchInstructions` is deliberately not sent: Opera rejects the repeated
   * parameter through Calry's passthrough with `OPERAWS-GEN01346 Invalid value
   * of: Query`, both comma-joined and as an array, because Calry serialises
   * `queryParams` as scalars. Omitting it returns Opera's default blocks,
   * which carry the postings and balance this is read for.
   */
  async getReservationFolio(
    target: OperaTarget,
    reservationId: string,
    params: OperaGetFolioParams,
    credentials: CalryCredentials,
  ): Promise<OperaFolioResponse> {
    return this.get<OperaFolioResponse>(
      target,
      '/csh/v1/hotels/{hotelId}/reservations/{reservationId}/folios',
      {
        folioWindowNo: params.folioWindowNo ?? '1',
        ...(params.reservationBalanceOnly !== undefined && {
          reservationBalanceOnly: params.reservationBalanceOnly,
        }),
        ...(params.limit !== undefined && { limit: params.limit }),
      },
      credentials,
      { reservationId },
    );
  }
}

/**
 * Pulls the reservation id and confirmation number out of a create response.
 *
 * Opera returns no body for a reservation create, only `links[]`: the
 * reservation id is the last path segment of the `getReservation` href, and
 * the confirmation number is the `confirmationNumberList` query parameter on
 * the reservation-search href.
 */
export function extractOperaReservationIds(
  response: OperaCreateReservationResponse,
): { reservationId?: string; confirmationNumber?: string } {
  const result: { reservationId?: string; confirmationNumber?: string } = {};

  for (const link of response?.links ?? []) {
    const href = link?.href;
    if (!href) continue;

    const confirmation = href.match(/confirmationNumberList=([^&]+)/)?.[1];
    if (confirmation) {
      result.confirmationNumber ??= confirmation;
      continue;
    }

    const id = href.split('?')[0].match(/\/reservations\/(\d+)$/)?.[1];
    if (id) result.reservationId ??= id;
  }

  return result;
}

const operaClient = new OperaClient();
export default operaClient;
