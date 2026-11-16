/**
 * Posts money to an Opera reservation folio through Calry's passthrough.
 *
 * Two kinds of money reach a folio here and they must not be confused:
 * - money Opera settles itself, against the OPI token already on the
 *   reservation — posted with the hotel's card payment method code;
 * - money already collected on Stripe or Shift4, where the folio is only being
 *   told about it — posted with a non-card method code so Opera does not try to
 *   settle it a second time.
 *
 * Either way no card data is in the payload: only a payment method code.
 */

import { Currency } from '../../dtos/enum/Currency';
import { hotelConfigurationService } from '../../services/hotelConfiguration/hotelConfigurationService';
import { ExternalAuthConfig } from '../../types/hotelConfiguration';
import { KpiStat, KpiStatValue, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import operaClient, { OperaClient } from '../client/OperaClient';
import { CalryConfigurationError, OperaCardDeclinedError } from '../errors';
import {
  CalryCredentials,
  OperaFolioPosting,
  OperaFolioResponse,
  OperaPostChargeResponse,
  OperaPostPaymentResponse,
  OperaTarget,
} from '../types';
import { resolveCalryCredentials } from './calryCredentials';
import { resolveOperaTarget } from './operaAvailability';

/** Opera reports a declined settlement as a generic error; match on its text. */
const DECLINE_ERROR_PATTERN = /declin|do not honor|insufficient|card error/i;

/**
 * The posting id Opera assigned, when it says.
 *
 * Opera does not consistently return one for a cashiering post: a successful
 * payment can come back with only `links[]`, or with an empty body. The id is
 * the idempotency key for `operaPaymentRecorder`, so callers must treat
 * `undefined` as "posted, id unknown" rather than as a failure.
 */
function extractPostingId(
  response: OperaPostPaymentResponse | OperaPostChargeResponse | undefined,
): string | undefined {
  const direct =
    response?.postingId ??
    (response as OperaPostPaymentResponse)?.payment?.postingId ??
    (response as OperaPostChargeResponse)?.charge?.postingId;
  if (direct) return direct;

  // What Opera actually returns for a cashiering post: the created lines under
  // `postings[]`, identified by `transactionNo` rather than a posting id.
  const transactionNo = response?.postings?.[0]?.transactionNo;
  if (transactionNo !== undefined) return String(transactionNo);

  for (const link of response?.links ?? []) {
    const id = link?.href?.split('?')[0].match(/\/postings\/(\d+)$/)?.[1];
    if (id) return id;
  }

  return undefined;
}

/**
 * Opera wants an ISO 4217 code, but `hotels.currency` holds a display symbol
 * (`$`) and payments copy it. Anything already three letters is passed through,
 * so a caller that has a real code is unaffected.
 */
export function toIsoCurrency(currency: string | undefined): string {
  if (!currency) return 'USD';
  const mapped = Currency[currency as keyof typeof Currency];
  if (mapped) return mapped.toUpperCase();
  return currency.length === 3 ? currency.toUpperCase() : 'USD';
}

interface OperaContext {
  target: OperaTarget;
  credentials: CalryCredentials;
  authConfig: ExternalAuthConfig | null;
}

export interface PostPaymentParams {
  /** Internal hotel UUID. */
  hotelId: string;
  /** Opera reservation id. */
  reservationId: string;
  amount: number;
  currency: string;
  /** Opera payment method code, e.g. "VA" or the hotel's external-money code. */
  paymentMethodCode: string;
  postingReference?: string;
  /** Hotel identifier used as the KPI dimension. */
  clientId?: string;
  /** Which KPI pair to emit — a settlement and a record are different events. */
  kpi?: { success: KpiStatValue; failure: KpiStatValue };
}

export interface PostRefundParams {
  hotelId: string;
  reservationId: string;
  /** Positive amount to refund; it is negated before posting. */
  amount: number;
  currency: string;
  /** Method the money goes back on — the card code for an Opera-settled card. */
  paymentMethodCode: string;
  postingReference?: string;
  clientId?: string;
}

export interface GetFolioParams {
  hotelId: string;
  reservationId: string;
  folioWindowNo?: string;
  fetchInstructions?: string[];
}

export class CalryOperaFolioService {
  constructor(private client: OperaClient = operaClient) {}

  /**
   * @throws {@link CalryConfigurationError} when the hotel is not Opera-backed
   *   or has no cashier configured.
   */
  private async resolve(hotelId: string): Promise<OperaContext> {
    const credentials = await resolveCalryCredentials(hotelId);
    const authConfig =
      await hotelConfigurationService.getExternalAuthConfigByHotelId(hotelId);
    const target = resolveOperaTarget(credentials, authConfig);

    if (!target) {
      throw new CalryConfigurationError(
        `Hotel ${hotelId} is not Opera-backed; its folio cannot be reached`,
      );
    }

    return { target, credentials, authConfig };
  }

  private cashierId(hotelId: string, authConfig: ExternalAuthConfig | null) {
    if (authConfig?.operaCashierId === undefined) {
      throw new CalryConfigurationError(
        `No operaCashierId configured for hotel ${hotelId}; Opera cannot post without one`,
      );
    }
    return authConfig.operaCashierId;
  }

  /** Reads a reservation's folio: payments, postings and the running balance. */
  async getFolio(params: GetFolioParams): Promise<OperaFolioResponse> {
    const { target, credentials, authConfig } = await this.resolve(
      params.hotelId,
    );

    return this.client.getReservationFolio(
      target,
      params.reservationId,
      {
        folioWindowNo: params.folioWindowNo ?? authConfig?.operaFolioWindowNo,
        ...(params.fetchInstructions?.length && {
          fetchInstructions: params.fetchInstructions,
        }),
      },
      credentials,
    );
  }

  /**
   * @returns The Opera posting id, when the response carries one.
   * @throws {@link CalryConfigurationError} when the hotel has no cashier id.
   * @throws {@link OperaCardDeclinedError} when Opera reports a declined card.
   */
  async postPayment(params: PostPaymentParams): Promise<string | undefined> {
    const {
      hotelId,
      reservationId,
      amount,
      currency,
      paymentMethodCode,
      postingReference,
      clientId,
      kpi,
    } = params;

    const { target, credentials, authConfig } = await this.resolve(hotelId);
    const cashierId = this.cashierId(hotelId, authConfig);

    const kpiContext = {
      contextName: 'CalryOperaFolioService.postPayment',
      clientId: clientId ?? hotelId,
      contextId: reservationId,
    };

    try {
      const response = await this.client.postReservationPayment(
        target,
        reservationId,
        {
          criteria: {
            reservationId: {
              idContext: 'OPERA',
              id: reservationId,
              type: 'Reservation',
            },
            paymentMethod: { paymentMethod: paymentMethodCode },
            ...(postingReference && { postingReference }),
            postingAmount: { amount, currencyCode: toIsoCurrency(currency) },
            cashierId,
            hotelId: target.propertyCode,
            folioWindowNo: authConfig?.operaFolioWindowNo ?? '1',
            overrideInsufficientCC: false,
            applyCCSurcharge: false,
            vATOffset: false,
            overrideARCreditLimit: false,
          },
        },
        credentials,
      );

      logKpi({
        stat: kpi?.success ?? KpiStat.OperaDepositPosted,
        value: 1,
        ...kpiContext,
      });

      return extractPostingId(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      logger.error('CalryOperaFolioService.postPayment: failed to post', {
        hotelId,
        reservationId,
        error: message,
      });
      logKpi({
        stat: kpi?.failure ?? KpiStat.OperaDepositFailed,
        value: 1,
        ...kpiContext,
      });

      if (
        !(error instanceof OperaCardDeclinedError) &&
        DECLINE_ERROR_PATTERN.test(message)
      ) {
        throw new OperaCardDeclinedError(`Card was declined: ${message}`);
      }
      throw error;
    }
  }

  /**
   * Refunds money on the folio by posting a negative payment.
   *
   * Opera has no refund endpoint. A negative *payment* on the original method
   * is the reversal: it reduces the guest's credit and, for a card method,
   * returns the money through OPI. A negative *charge* would look similar on
   * paper but moves the balance the wrong way — it adds credit rather than
   * removing it.
   */
  async postRefund(params: PostRefundParams): Promise<string | undefined> {
    const {
      hotelId,
      reservationId,
      amount,
      currency,
      paymentMethodCode,
      postingReference,
      clientId,
    } = params;

    const { target, credentials, authConfig } = await this.resolve(hotelId);
    const cashierId = this.cashierId(hotelId, authConfig);

    const kpiContext = {
      contextName: 'CalryOperaFolioService.postRefund',
      clientId: clientId ?? hotelId,
      contextId: reservationId,
    };

    try {
      const response = await this.client.postReservationPayment(
        target,
        reservationId,
        {
          criteria: {
            reservationId: {
              idContext: 'OPERA',
              id: reservationId,
              type: 'Reservation',
            },
            paymentMethod: { paymentMethod: paymentMethodCode },
            ...(postingReference && { postingReference }),
            postingAmount: {
              amount: -Math.abs(amount),
              currencyCode: toIsoCurrency(currency),
            },
            cashierId,
            hotelId: target.propertyCode,
            folioWindowNo: authConfig?.operaFolioWindowNo ?? '1',
            overrideInsufficientCC: false,
            applyCCSurcharge: false,
            vATOffset: false,
            overrideARCreditLimit: false,
          },
        },
        credentials,
      );

      logKpi({ stat: KpiStat.OperaRefundPosted, value: 1, ...kpiContext });

      return extractPostingId(response);
    } catch (error) {
      logger.error('CalryOperaFolioService.postRefund: failed to post', {
        hotelId,
        reservationId,
        error: error instanceof Error ? error.message : String(error),
      });
      logKpi({ stat: KpiStat.OperaRefundFailed, value: 1, ...kpiContext });
      throw error;
    }
  }

  /**
   * The posting id carrying `reference`, if the folio already holds one. Opera
   * cashiering has no idempotency key, so this is the only way to tell a lost
   * response apart from a post that never happened.
   */
  async findPostingByReference(
    hotelId: string,
    reservationId: string,
    reference: string,
  ): Promise<string | undefined> {
    const folio = await this.getFolio({ hotelId, reservationId });
    const info = folio.reservationFolioInformation;

    const postings: OperaFolioPosting[] = [
      ...(info?.postings ?? []),
      ...(info?.folioWindows ?? []).flatMap((w) => w.postings ?? []),
    ];

    return postings.find((p) => p.postingReference === reference)?.postingId;
  }
}

export const operaFolioService = new CalryOperaFolioService();
