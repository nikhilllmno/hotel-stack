/**
 * Opera cashiering (`csh/v1`) and OPI token-exchange shapes, as reached through
 * Calry's passthrough. Payloads follow the cashiering requests in Oracle's
 * Property REST API Workflows collection and the OPI Token Exchange 1.0.1 spec.
 */

export interface OperaAmount {
  amount: number;
  currencyCode: string;
}

/** Body of `POST /tokenExchange/v1/hotels/{hotelCode}/tokens`. */
export interface OperaTokenExchangeRequest {
  /** Primary Account Number, digits only. Never logged, never persisted. */
  pan: string;
  /** Expiration date in YYMM. */
  expiryDate: string;
}

/** Response of `POST /tokenExchange/v1/hotels/{hotelCode}/tokens`. */
export interface OperaTokenExchangeResponse {
  /** Card token issued by the property's payment service provider. */
  token: string;
  /** Opera card type, e.g. "VA". */
  cardType: string;
  /** Expiration date in YYMM. */
  expiryDate: string;
  /** Masked PAN, e.g. "XXXXXXXXXXXX4444". */
  pan: string;
}

/** A tokenized card, as carried through a booking without ever being stored. */
export interface OperaCardToken {
  token: string;
  /** Opera card type returned by token exchange, e.g. "VA". */
  cardType: string;
  /** Expiration date in YYMM. */
  expiryDate: string;
  /** Masked PAN, safe to log and to show a guest. */
  maskedPan: string;
  cardHolderName?: string;
}

/** One entry of `reservationPaymentMethods` on an Opera reservation. */
export interface OperaReservationPaymentMethod {
  paymentMethod: string;
  folioView: string;
  description?: string;
  paymentCard?: {
    cardOrToken: 'Token' | 'CardNumber';
    cardNumber?: string;
    cardType?: string;
    /** `YYYY-MM-DD` — Opera wants a date here, not the YYMM the token carries. */
    expirationDate?: string;
    cardHolderName?: string;
  };
  authorizationRule?: {
    code?: string;
    amount?: OperaAmount;
  };
}

/** Body of `PUT /rsv/v1/hotels/{hotelId}/reservations/{reservationId}`. */
export interface OperaUpdateReservationPaymentRequest {
  reservations: {
    reservationPaymentMethods: OperaReservationPaymentMethod[];
  };
}

/** Body of `POST /csh/v1/hotels/{hotelId}/reservations/{reservationId}/payments`. */
export interface OperaPostPaymentRequest {
  criteria: {
    reservationId: { idContext: string; id: string; type: string };
    paymentMethod: { paymentMethod: string };
    postingReference?: string;
    postingAmount: OperaAmount;
    cashierId: number;
    hotelId: string;
    folioWindowNo: string;
    overrideInsufficientCC: boolean;
    applyCCSurcharge: boolean;
    vATOffset: boolean;
    overrideARCreditLimit: boolean;
  };
}

/**
 * Response of the cashiering payment post. Opera returns the created posting
 * under one of several envelopes depending on release, so all fields are
 * optional.
 */
export interface OperaPostPaymentResponse {
  postingId?: string;
  payment?: { postingId?: string; transactionNo?: string };
  /** What Opera actually returns: the created posting lines. */
  postings?: { transactionNo?: number | string; receiptNo?: number }[];
  links?: { href?: string; rel?: string }[];
}

/**
 * Body of `POST /csh/v1/hotels/{hotelId}/reservations/{reservationId}/charges`.
 * A negative `postingAmount` is how a posting is reversed — Opera has no
 * refund endpoint.
 */
export interface OperaPostChargeRequest {
  criteria: {
    /**
     * The charge itself. `transactionCode` is a number and lives here, not on
     * `criteria` — Opera rejects `criteria.transactionCode` outright with
     * `OPERAWS-GEN01242 Unknown property`.
     */
    charges: {
      postingQuantity: number;
      usePackageAllowance: boolean;
      price: OperaAmount;
      transactionCode: number;
      applyRoutingInstructions: boolean;
      postingReference?: string;
      /**
       * Required on a negative posting: Opera refuses one without a
       * supplement (`FOF00202 A supplement is required for a negative
       * posting`), and this is the field that satisfies it.
       */
      postingRemark?: string;
    };
    reservationId: { idContext: string; id: string; type: string };
    cashierId: number;
    hotelId: string;
    postIt: boolean;
  };
}

/** Response of the cashiering charge post; same envelope spread as payments. */
export interface OperaPostChargeResponse {
  postingId?: string;
  charge?: { postingId?: string; transactionNo?: string };
  postings?: { transactionNo?: number | string; receiptNo?: number }[];
  links?: { href?: string; rel?: string }[];
}

/** Query for `GET /csh/v1/hotels/{hotelId}/reservations/{reservationId}/folios`. */
export interface OperaGetFolioParams {
  folioWindowNo?: string;
  /** Blocks Opera should return, e.g. Payment, Postings, Totalbalance. */
  fetchInstructions?: string[];
  reservationBalanceOnly?: boolean;
  limit?: number;
}

/**
 * Folio as Opera returns it. Shapes vary by release and by the
 * `fetchInstructions` sent, so only the useful totals are typed and the rest
 * passes through untouched.
 */
export interface OperaFolioResponse {
  reservationFolioInformation?: {
    folioWindows?: OperaFolioWindow[];
    reservationInfo?: unknown;
    postings?: OperaFolioPosting[];
    balance?: OperaAmount;
    totalBalance?: OperaAmount;
  };
  [key: string]: unknown;
}

/** One posting line on a folio. Only the fields we match on are typed. */
export interface OperaFolioPosting {
  postingId?: string;
  postingReference?: string;
  transactionNo?: string;
  amount?: OperaAmount;
  [key: string]: unknown;
}

export interface OperaFolioWindow {
  folioWindowNo?: number | string;
  postings?: OperaFolioPosting[];
  [key: string]: unknown;
}

/** One payment method from Opera's `paymentMethods` list of values. */
export interface OperaPaymentMethodLov {
  code: string;
  description?: string;
  paymentType?: string;
  active?: boolean;
}

export interface OperaPaymentMethodsResponse {
  listOfValues?: { items?: OperaPaymentMethodLov[] };
}

/**
 * Body of `POST /rsv/v1/hotels/{hotelId}/reservations`.
 *
 * Only the fields Daisy sets are typed; Opera accepts many more. `roomType`
 * and `ratePlanCode` are Opera codes, never Calry ids.
 */
export interface OperaCreateReservationRequest {
  reservations: {
    reservation: {
      sourceOfSale: { sourceType: string; sourceCode: string };
      roomStay: {
        roomRates: {
          total: { amountBeforeTax: string };
          rates: {
            rate: {
              base: { amountBeforeTax: string; currencyCode?: string };
              start: string;
              end: string;
            }[];
          };
          guestCounts: { adults: string; children: string };
          roomType: string;
          ratePlanCode: string;
          start: string;
          end: string;
          marketCode?: string;
          sourceCode?: string;
          numberOfUnits: string;
          roomTypeCharged: string;
          pseudoRoom: boolean;
          houseUseOnly: boolean;
          complimentary: boolean;
          fixedRate: boolean;
          discountAllowed: boolean;
          bogoDiscount: boolean;
        }[];
        guestCounts: { adults: string; children: string };
        arrivalDate: string;
        departureDate: string;
        guarantee?: { guaranteeCode: string };
        roomNumberLocked: boolean;
        printRate: boolean;
      };
      reservationGuests: unknown[];
      reservationPaymentMethods: OperaReservationPaymentMethod[];
      comments?: unknown[];
      hotelId: string;
      roomStayReservation: boolean;
      reservationStatus: string;
      computedReservationStatus: string;
      walkIn: boolean;
      printRate: boolean;
      preRegistered: boolean;
      upgradeEligible: boolean;
      allowAutoCheckin: boolean;
      hasOpenFolio: boolean;
      allowMobileCheckout: boolean;
      allowMobileViewFolio: boolean;
      allowPreRegistration: boolean;
      optedForCommunication: boolean;
    }[];
  };
}

/**
 * Opera answers a reservation create with links rather than a body. The
 * reservation id is the last path segment of the `getReservation` href, and
 * the guest-facing confirmation number is the `confirmationNumberList` query
 * parameter on the search href.
 */
export interface OperaCreateReservationResponse {
  links?: { href?: string; rel?: string; method?: string }[];
}

/**
 * `GET /rsv/v1/hotels/{hotelId}/reservations` — only the id list is typed,
 * since that is all the confirmation-number lookup reads.
 */
export interface OperaReservationSearchResponse {
  reservations?: {
    reservationInfo?: {
      reservationIdList?: { id?: string; type?: string }[];
    }[];
  };
}

/** RFC 7807 problem details, as returned by OPI and the Opera REST APIs. */
export interface OperaProblemDetail {
  title: string;
  type: string;
  detail?: string;
  status?: number;
  correlationId?: string;
  'o:errorCode'?: string;
  'o:errorPath'?: string;
  'o:errorDetails'?: OperaProblemDetail[];
}
