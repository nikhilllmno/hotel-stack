/**
 * Puts the tokenized card on an Opera reservation.
 *
 * Calry's unified `POST /reservations` carries no payment fields, so the card
 * is attached after create with a passthrough `PUT`. Opera settles against
 * whatever is on the reservation, so this must succeed before a card payment is
 * posted — an unattached card means the folio post has nothing to draw on.
 */

import { hotelConfigurationService } from '../../services/hotelConfiguration/hotelConfigurationService';
import { ExternalAuthConfig } from '../../types/hotelConfiguration';
import { yyMmToEndOfMonthDate } from '../../utils/helper';
import { KpiStat, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import operaClient, { OperaClient } from '../client/OperaClient';
import { CalryConfigurationError } from '../errors';
import { OperaCardToken, OperaReservationPaymentMethod } from '../types';
import { resolveCalryCredentials } from './calryCredentials';
import { resolveOperaTarget } from './operaAvailability';

/**
 * Opera's own default when no card is held. Kept for the zero-deposit case,
 * where the guest is booked without one.
 */
const CASH_PAYMENT_METHOD = 'CA';

export function buildReservationPaymentMethods(
  authConfig: ExternalAuthConfig | null,
  card?: OperaCardToken,
): OperaReservationPaymentMethod[] {
  if (!card) {
    return [{ paymentMethod: CASH_PAYMENT_METHOD, folioView: '1' }];
  }

  return [
    {
      paymentMethod: authConfig?.operaCardPaymentMethodCode ?? card.cardType,
      paymentCard: {
        cardOrToken: 'Token',
        // The OPI token rides in `cardNumber`; Opera has no `token` property.
        cardNumber: card.token,
        cardType: card.cardType,
        expirationDate: yyMmToEndOfMonthDate(card.expiryDate),
        ...(card.cardHolderName && { cardHolderName: card.cardHolderName }),
      },
      folioView: '1',
    },
  ];
}

export class OperaCardAttachService {
  constructor(private client: OperaClient = operaClient) {}

  /**
   * @param clientId - Hotel identifier used as the KPI dimension.
   * @throws {@link CalryConfigurationError} when the hotel is not Opera-backed.
   */
  async attachCard(params: {
    hotelId: string;
    reservationId: string;
    card: OperaCardToken;
    clientId?: string;
  }): Promise<void> {
    const { hotelId, reservationId, card, clientId } = params;

    const credentials = await resolveCalryCredentials(hotelId);
    const authConfig =
      await hotelConfigurationService.getExternalAuthConfigByHotelId(hotelId);
    const target = resolveOperaTarget(credentials, authConfig);

    if (!target) {
      throw new CalryConfigurationError(
        `Hotel ${hotelId} is not Opera-backed; a card cannot be attached`,
      );
    }

    const kpiContext = {
      contextName: 'OperaCardAttachService.attachCard',
      clientId: clientId ?? hotelId,
      contextId: reservationId,
    };

    try {
      await this.client.setReservationPaymentMethods(
        target,
        reservationId,
        {
          reservations: {
            reservationPaymentMethods: buildReservationPaymentMethods(
              authConfig,
              card,
            ),
          },
        },
        credentials,
      );

      logKpi({ stat: KpiStat.OperaCardAttached, value: 1, ...kpiContext });
    } catch (error) {
      // maskedPan is safe to log; token and PAN are not.
      logger.error(
        'OperaCardAttachService.attachCard: failed to attach card to reservation',
        {
          hotelId,
          reservationId,
          maskedPan: card.maskedPan,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      logKpi({ stat: KpiStat.OperaCardAttachFailed, value: 1, ...kpiContext });
      throw error;
    }
  }
}

export const operaCardAttachService = new OperaCardAttachService();
