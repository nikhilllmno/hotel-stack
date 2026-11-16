import { randomUUID as uuidv4 } from 'node:crypto';
import config from '../../config';
import { NoDataError } from '../../errors/NoDataError';
import { hotelService } from '../../services/hotel/hotelService';
import {
  IPaymentProviderService,
  PaymentLinkParams,
  PaymentLinkResponse,
} from '../../services/payment/IPaymentProviderService';
import { Country } from '../../types/enums';
import { formatPhoneNumber } from '../../utils/helper';
import { logKpi } from '../../utils/kpiLogger';
import { mewsClient } from '../client/MewsClient';
import { MewsConfigurationError } from '../errors';
import { mewsTokenService } from '../services/tokenService';
import { MewsCredentials, MewsRefundPaymentResponse } from '../types';

export class MewsPaymentProviderService implements IPaymentProviderService {
  private async resolveCredentials(hotelId: string): Promise<MewsCredentials> {
    const clientToken = config.MEWS_CLIENT_TOKEN;
    const client = config.MEWS_CLIENT;
    if (!clientToken || !client) {
      throw new MewsConfigurationError(
        'MewsPaymentProviderService: MEWS_CLIENT_TOKEN and MEWS_CLIENT must be set in environment',
      );
    }
    const accessToken = await mewsTokenService.getActiveToken(hotelId);
    const baseCredentials = { clientToken, accessToken, client };
    // business_id holds the hotel's Mews enterprise id, but EnterpriseIds
    // must only be sent when the access token is actually Portfolio-scoped.
    const hotel = await hotelService.getHotelById(hotelId);
    const enterpriseId = await mewsTokenService.resolveEnterpriseId(
      baseCredentials,
      hotel?.business_id,
    );
    return {
      ...baseCredentials,
      enterpriseId,
    };
  }

  private async resolveHotelCredentials(
    hotelPhoneNumber: string,
  ): Promise<MewsCredentials> {
    const hotel =
      await hotelService.getHotelByAssistantPhoneNumber(hotelPhoneNumber);
    if (!hotel) {
      throw new NoDataError(
        `MewsPaymentProviderService: Hotel not found for phone ${hotelPhoneNumber}`,
      );
    }
    return this.resolveCredentials(hotel.id);
  }

  async createPaymentLink(
    params: PaymentLinkParams,
  ): Promise<PaymentLinkResponse> {
    const hotelPath = (params.metadata.hotel_name || 'hotel')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    const linkId = uuidv4();
    const url = `${config.SECURE_URL}/${hotelPath}/${linkId}`;
    return { id: linkId, url };
  }

  async disablePaymentLink(_paymentLinkId: string): Promise<void> {
    // Mews payment links are review page URLs — nothing to disable externally
  }

  async getPublicKey(hotelPhoneNumber: string): Promise<string> {
    const credentials = await this.resolveHotelCredentials(hotelPhoneNumber);
    const configuration = await mewsClient.getConfiguration(credentials);
    if (!configuration.PaymentCardStorage?.PublicKey) {
      throw new MewsConfigurationError(
        `MewsPaymentProviderService: Hotel ${hotelPhoneNumber} does not have payment card storage configured in Mews`,
      );
    }
    return configuration.PaymentCardStorage.PublicKey;
  }

  private async tokenizeCard(params: {
    hotelPhoneNumber: string;
    customer: {
      firstName: string;
      lastName: string;
      email?: string;
      phone?: string;
      country: Country;
    };
    transactionId: string;
    expiration: string;
  }): Promise<{
    credentials: MewsCredentials;
    mewsAccountId: string;
    creditCardId: string;
  }> {
    const credentials = await this.resolveHotelCredentials(
      params.hotelPhoneNumber,
    );
    // Customer search/create require ChainId under a portfolio token. Resolve
    // it lazily here (cached) since only this flow touches customer records.
    credentials.chainId = await mewsTokenService.resolveChainId(credentials);

    const normalizedPhone = params.customer.phone
      ? formatPhoneNumber(params.customer.phone, params.customer.country)
      : undefined;

    let mewsAccountId: string;
    const searchFilters: { emails?: string[]; phoneNumbers?: string[] } = {};
    if (params.customer.email) searchFilters.emails = [params.customer.email];
    if (normalizedPhone) searchFilters.phoneNumbers = [normalizedPhone];

    const existingCustomers =
      searchFilters.emails || searchFilters.phoneNumbers
        ? await mewsClient.searchCustomers(searchFilters, credentials)
        : [];

    if (existingCustomers.length > 0) {
      mewsAccountId = existingCustomers[0].Id;
    } else {
      const customerResponse = await mewsClient.createCustomer(
        {
          FirstName: params.customer.firstName,
          LastName: params.customer.lastName,
          ...(params.customer.email && { Email: params.customer.email }),
          ...(normalizedPhone && { Phone: normalizedPhone }),
        },
        credentials,
      );
      mewsAccountId = customerResponse.Id;
    }

    const cardResponse = await mewsClient.addTokenizedCreditCard(
      {
        CustomerId: mewsAccountId,
        CreditCardData: {
          StorageData: params.transactionId,
          Expiration: params.expiration,
        },
      },
      credentials,
    );

    logKpi({
      stat: 'mews_addTokenizedCard_success',
      value: 1,
      contextName: 'MewsPaymentProviderService.tokenizeCard',
      clientId: params.hotelPhoneNumber,
    });

    return {
      credentials,
      mewsAccountId,
      creditCardId: cardResponse.CreditCardId,
    };
  }

  /**
   * Zero-deposit: tokenize and store the card on the Mews customer without
   * charging it.
   */
  async captureCardWithoutCharge(params: {
    hotelPhoneNumber: string;
    customer: {
      firstName: string;
      lastName: string;
      email?: string;
      phone?: string;
      country: Country;
    };
    transactionId: string;
    expiration: string;
  }): Promise<{
    mewsAccountId: string;
    creditCardId: string;
  }> {
    const { mewsAccountId, creditCardId } = await this.tokenizeCard(params);
    return { mewsAccountId, creditCardId };
  }

  async processCardPayment(params: {
    hotelPhoneNumber: string;
    customer: {
      firstName: string;
      lastName: string;
      email?: string;
      phone?: string;
      country: Country;
    };
    transactionId: string;
    expiration: string;
    amount: number;
    currency: string;
  }): Promise<{
    paymentId: string;
    mewsAccountId: string;
    creditCardId: string;
  }> {
    const { credentials, mewsAccountId, creditCardId } =
      await this.tokenizeCard(params);

    const chargeResponse = await mewsClient.chargeCreditCard(
      {
        CreditCardId: creditCardId,
        Amount: {
          GrossValue: params.amount,
          Currency: params.currency.toUpperCase(),
        },
      },
      credentials,
    );

    logKpi({
      stat: 'mews_charge_success',
      value: 1,
      contextName: 'MewsPaymentProviderService.processCardPayment',
      clientId: params.hotelPhoneNumber,
      contextId: chargeResponse.PaymentId,
    });
    logKpi({
      stat: 'mews_charge_amount',
      value: params.amount,
      contextName: 'MewsPaymentProviderService.processCardPayment',
      clientId: params.hotelPhoneNumber,
      contextId: chargeResponse.PaymentId,
    });

    return {
      paymentId: chargeResponse.PaymentId,
      mewsAccountId,
      creditCardId,
    };
  }

  async chargeStoredCard(params: {
    hotelPhoneNumber: string;
    creditCardId: string;
    amount: number;
    currency: string;
  }): Promise<{ paymentId: string }> {
    const credentials = await this.resolveHotelCredentials(
      params.hotelPhoneNumber,
    );
    const response = await mewsClient.chargeCreditCard(
      {
        CreditCardId: params.creditCardId,
        Amount: {
          GrossValue: params.amount,
          Currency: params.currency.toUpperCase(),
        },
      },
      credentials,
    );
    logKpi({
      stat: 'mews_charge_success',
      value: 1,
      contextName: 'MewsPaymentProviderService.chargeStoredCard',
      clientId: params.hotelPhoneNumber,
      contextId: response.PaymentId,
    });
    logKpi({
      stat: 'mews_charge_amount',
      value: params.amount,
      contextName: 'MewsPaymentProviderService.chargeStoredCard',
      clientId: params.hotelPhoneNumber,
      contextId: response.PaymentId,
    });
    return { paymentId: response.PaymentId };
  }

  /**
   * Same as chargeStoredCard, but resolves credentials by hotelId directly —
   * for callers (e.g. the auto-charge job) that already have the hotel loaded
   * and would otherwise trigger a redundant getHotelByAssistantPhoneNumber lookup.
   */
  async chargeStoredCardForHotel(params: {
    hotelId: string;
    creditCardId: string;
    amount: number;
    currency: string;
  }): Promise<{ paymentId: string }> {
    const credentials = await this.resolveCredentials(params.hotelId);
    const response = await mewsClient.chargeCreditCard(
      {
        CreditCardId: params.creditCardId,
        Amount: {
          GrossValue: params.amount,
          Currency: params.currency.toUpperCase(),
        },
      },
      credentials,
    );
    logKpi({
      stat: 'mews_charge_success',
      value: 1,
      contextName: 'MewsPaymentProviderService.chargeStoredCardForHotel',
      clientId: params.hotelId,
      contextId: response.PaymentId,
    });
    logKpi({
      stat: 'mews_charge_amount',
      value: params.amount,
      contextName: 'MewsPaymentProviderService.chargeStoredCardForHotel',
      clientId: params.hotelId,
      contextId: response.PaymentId,
    });
    return { paymentId: response.PaymentId };
  }

  /**
   * Resolves the Mews Account (Customer) id that owns a stored credit card.
   * Needed to persist `mews_account_id` on auto-charge payments, since the
   * charge response does not return it and refunds require an AccountId.
   */
  async getAccountIdByCreditCard(params: {
    hotelId: string;
    creditCardId: string;
  }): Promise<string | undefined> {
    const credentials = await this.resolveCredentials(params.hotelId);
    const creditCards = await mewsClient.getCreditCards(
      { CreditCardIds: [params.creditCardId] },
      credentials,
    );
    return creditCards[0]?.CustomerId;
  }

  async refundCardPaymentByHotelId(params: {
    hotelId: string;
    mewsPaymentId: string;
    mewsAccountId: string;
    reason: string;
    amount?: number;
  }): Promise<MewsRefundPaymentResponse> {
    const credentials = await this.resolveCredentials(params.hotelId);
    const response = await mewsClient.refundPayment(
      {
        PaymentId: params.mewsPaymentId,
        AccountId: params.mewsAccountId,
        Reason: params.reason,
        ...(params.amount !== undefined && { ValueToRefund: params.amount }),
      },
      credentials,
    );
    logKpi({
      stat: 'mews_refund_success',
      value: 1,
      contextName: 'MewsPaymentProviderService.refundCardPaymentByHotelId',
      clientId: params.hotelId,
      contextId: params.mewsPaymentId,
    });
    return response;
  }
}

const mewsPaymentProviderService = new MewsPaymentProviderService();
export default mewsPaymentProviderService;
