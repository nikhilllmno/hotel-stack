/**
 * Exchanges a guest's card for an OPI token.
 *
 * Nothing here logs, returns, or persists the PAN: it exists only for the
 * duration of the call and is replaced by the token, which is handed straight
 * to the reservation and never stored on our side either.
 *
 * The exchange runs against the property's own Opera gateway: OPI is reached at
 * the `/tokenExchange/v1` base path on the same host as every other Opera call,
 * verified working through Calry's passthrough. It needs no host of its own.
 */

import { BadRequestError } from '../../errors/BadRequestError';
import { hotelConfigurationService } from '../../services/hotelConfiguration/hotelConfigurationService';
import { CARD_EXPIRY_YYMM_PATTERN } from '../../utils/helper';
import { KpiStat, logKpi } from '../../utils/kpiLogger';
import calryCardTokenClient, {
  CalryCardTokenClient,
} from '../client/CalryCardTokenClient';
import { CalryConfigurationError, OperaCardDeclinedError } from '../errors';
import { OperaCardToken } from '../types';
import { resolveCalryCredentials } from './calryCredentials';
import { resolveOperaTarget } from './operaAvailability';

const PAN_PATTERN = /^[0-9]{8,19}$/;

/** Standard mod-10 check, so an obvious typo never reaches Oracle. */
function passesLuhn(pan: string): boolean {
  let sum = 0;
  let double = false;

  for (let i = pan.length - 1; i >= 0; i--) {
    let digit = pan.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }

  return sum % 10 === 0;
}

export interface ExchangeCardParams {
  pan: string;
  /** Expiry in YYMM. */
  expiryDate: string;
  cardHolderName?: string;
}

export class OperaCardTokenService {
  constructor(private client: CalryCardTokenClient = calryCardTokenClient) {}

  /**
   * @param hotelId - Internal hotel UUID.
   * @param clientId - Hotel identifier used as the KPI dimension.
   * @throws {@link BadRequestError} when the card details are malformed.
   * @throws {@link CalryConfigurationError} when card tokenization is not
   *   enabled for the hotel.
   * @throws {@link OperaCardDeclinedError} when the provider declines the card.
   */
  async exchangeCard(
    hotelId: string,
    params: ExchangeCardParams,
    clientId?: string,
  ): Promise<OperaCardToken> {
    const { pan, expiryDate, cardHolderName } = params;

    if (!PAN_PATTERN.test(pan) || !passesLuhn(pan)) {
      throw new BadRequestError('Card number is not valid');
    }
    if (!CARD_EXPIRY_YYMM_PATTERN.test(expiryDate)) {
      throw new BadRequestError('Card expiry must be in YYMM format');
    }

    const credentials = await resolveCalryCredentials(hotelId);
    const authConfig =
      await hotelConfigurationService.getExternalAuthConfigByHotelId(hotelId);
    const target = resolveOperaTarget(credentials, authConfig);

    if (!target) {
      throw new CalryConfigurationError(
        `Hotel ${hotelId} is not Opera-backed; a card cannot be tokenized`,
      );
    }

    const kpiContext = {
      contextName: 'OperaCardTokenService.exchangeCard',
      clientId: clientId ?? hotelId,
    };

    try {
      const response = await this.client.exchangeCardToken(
        // OPI token exchange is served on the property's own Opera gateway —
        // `/tokenExchange/v1` is a base path on it, not a separate host.
        target.host,
        target.propertyCode,
        { pan, expiryDate },
        credentials,
      );

      logKpi({ stat: KpiStat.OperaCardTokenized, value: 1, ...kpiContext });

      return {
        token: response.token,
        cardType: response.cardType,
        expiryDate: response.expiryDate || expiryDate,
        maskedPan: response.pan,
        cardHolderName,
      };
    } catch (error) {
      logKpi({
        stat:
          error instanceof OperaCardDeclinedError
            ? KpiStat.OperaCardDeclined
            : KpiStat.OperaCardTokenizationFailed,
        value: 1,
        ...kpiContext,
      });
      throw error;
    }
  }
}

export const operaCardTokenService = new OperaCardTokenService();
