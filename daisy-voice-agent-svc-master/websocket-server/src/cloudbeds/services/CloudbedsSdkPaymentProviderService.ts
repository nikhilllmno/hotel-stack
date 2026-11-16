import axios from 'axios';
import { randomUUID as uuidv4 } from 'node:crypto';
import config from '../../config';
import { Currency } from '../../dtos/enum/Currency';
import { BadRequestError } from '../../errors/BadRequestError';
import { hotelService } from '../../services/hotel/hotelService';
import {
  HotelConfigurationService,
  hotelConfigurationService as defaultHotelConfigurationService,
} from '../../services/hotelConfiguration/hotelConfigurationService';
import {
  IPaymentProviderService,
  PaymentLinkParams,
  PaymentLinkResponse,
} from '../../services/payment/IPaymentProviderService';
import { decrypt, encrypt } from '../../utils/encryption';
import { roundCurrency } from '../../utils/helper';
import { KpiStat, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import cloudbedsClient from '../client/CloudbedsClient';
import { CloudbedsConfigurationError } from '../errors';
import { CloudbedsChargeStatus } from '../types';
import { generateSdkApiKey } from '../utils/generateSdkApiKey';
import { resolveCloudbedsCredentials } from './cloudbedsCredentials';

/** Outcome of charging a reservation's Cloudbeds balance to a stored card. */
export interface CloudbedsBalanceCharge {
  /** Cloudbeds paymentStatus, or `nothing_due` when the balance was already zero. */
  status: CloudbedsChargeStatus | 'nothing_due';
  amount: number;
  paymentId: string | null;
  /** Set when the card needs 3DS: send the guest here to finish the charge. */
  redirectUrl: string | null;
}

interface CloudbedsSdkCredentials {
  propertyID: string;
  apiToken: string;
  hotelId: string;
}

interface CloudbedsSdkKeyIssueResponse {
  identity: string;
  secret: string;
  property_ids: string[];
  status: string;
  created_at: string;
}

export class CloudbedsSdkPaymentProviderService implements IPaymentProviderService {
  constructor(
    private readonly hotelConfigurationService: HotelConfigurationService = defaultHotelConfigurationService,
  ) {}

  private async resolveSdkCredentialsByHotelId(hotelId: string): Promise<{
    identity: string;
    secret: string;
    propertyId: string;
  }> {
    try {
      const authConfig =
        await this.hotelConfigurationService.getExternalAuthConfigByHotelId(
          hotelId,
        );
      const sdkConfig = authConfig?.cloudbedsPaymentSdk;
      if (!sdkConfig?.identity || !sdkConfig?.secret) {
        throw new CloudbedsConfigurationError(
          `CloudbedsSdkPaymentProviderService: Hotel ${hotelId} is missing cloudbedsPaymentSdk in external_auth_config`,
        );
      }

      const hotel = await hotelService.getHotelById(hotelId);
      if (!hotel?.business_id) {
        throw new CloudbedsConfigurationError(
          `CloudbedsSdkPaymentProviderService: Hotel ${hotelId} is missing business_id (Cloudbeds propertyID)`,
        );
      }

      return {
        identity: sdkConfig.identity,
        secret: decrypt(sdkConfig.secret),
        propertyId: String(hotel.business_id),
      };
    } catch (error) {
      logger.error(
        'CloudbedsSdkPaymentProviderService.resolveSdkCredentialsByHotelId: Failed',
        { hotelId, error },
      );
      throw error;
    }
  }

  private async resolvePmsCredentials(
    hotelId: string,
  ): Promise<CloudbedsSdkCredentials> {
    try {
      const creds = await resolveCloudbedsCredentials(hotelId);
      return creds;
    } catch (error) {
      logger.error(
        'CloudbedsSdkPaymentProviderService.resolvePmsCredentials: Failed',
        { hotelId, error },
      );
      throw error;
    }
  }

  async createPaymentLink(
    params: PaymentLinkParams,
  ): Promise<PaymentLinkResponse> {
    try {
      const hotelPath = (params.metadata.hotel_name || 'hotel')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
      const linkId = uuidv4();
      const url = `${config.SECURE_URL}/${hotelPath}/${linkId}`;
      return { id: linkId, url };
    } catch (error) {
      logger.error(
        'CloudbedsSdkPaymentProviderService.createPaymentLink: Failed',
        { error },
      );
      throw error;
    }
  }

  async disablePaymentLink(_paymentLinkId: string): Promise<void> {
    // Cloudbeds SDK payment links are review page URLs — nothing to disable externally
  }

  async getSdkApiKey(hotelId: string): Promise<string> {
    try {
      const { identity, secret, propertyId } =
        await this.resolveSdkCredentialsByHotelId(hotelId);
      return generateSdkApiKey(identity, secret, propertyId);
    } catch (error) {
      logger.error('CloudbedsSdkPaymentProviderService.getSdkApiKey: Failed', {
        hotelId,
        error,
      });
      throw error;
    }
  }

  async getSdkPropertyId(hotelId: string): Promise<string> {
    try {
      const { propertyId } = await this.resolveSdkCredentialsByHotelId(hotelId);
      return propertyId;
    } catch (error) {
      logger.error(
        'CloudbedsSdkPaymentProviderService.getSdkPropertyId: Failed',
        { hotelId, error },
      );
      throw error;
    }
  }

  async processCardPayment(params: {
    hotelId: string;
    cloudbedsReservationId: string;
    paymentMethodId: string;
    returnUrl?: string;
  }): Promise<{
    cardId: string;
    storedPaymentMethodId: string | null;
    redirectUrl: string | null;
  }> {
    try {
      const creds = await this.resolvePmsCredentials(params.hotelId);
      const ctx = { apiToken: creds.apiToken, hotelId: creds.hotelId };

      const cardResult = await cloudbedsClient.postCreditCard(
        {
          propertyID: creds.propertyID,
          reservationID: params.cloudbedsReservationId,
          paymentMethodId: params.paymentMethodId,
          ...(params.returnUrl && { returnUrl: params.returnUrl }),
        },
        ctx,
      );

      return {
        cardId: cardResult.cardID,
        storedPaymentMethodId: cardResult.paymentMethodId ?? null,
        redirectUrl: cardResult.redirectUrl ?? null,
      };
    } catch (error) {
      logger.error(
        'CloudbedsSdkPaymentProviderService.processCardPayment: Error',
        { hotelId: params.hotelId, error },
      );
      throw error;
    }
  }

  /**
   * Charges a Cloudbeds reservation's current balance, up to `maxAmount`, to a
   * card already stored on it. Reading the balance from Cloudbeds lets a full
   * payment leave the folio at zero.
   */
  async chargeReservationBalance(params: {
    hotelId: string;
    cloudbedsReservationId: string;
    paymentMethodId: string;
    description: string;
    returnUrl: string;
    /** The most the guest agreed to pay now; the charge never goes above it. */
    maxAmount: number;
  }): Promise<CloudbedsBalanceCharge> {
    const creds = await this.resolvePmsCredentials(params.hotelId);
    const ctx = { apiToken: creds.apiToken, hotelId: creds.hotelId };
    const reservation = await cloudbedsClient.getReservation(
      {
        propertyID: creds.propertyID,
        reservationID: params.cloudbedsReservationId,
      },
      ctx,
    );
    const balance = Number(reservation.balance);
    if (reservation.balance == null || !Number.isFinite(balance)) {
      throw new CloudbedsConfigurationError(
        `CloudbedsSdkPaymentProviderService.chargeReservationBalance: Cloudbeds returned no usable balance for reservation ${params.cloudbedsReservationId}`,
      );
    }
    const amount = roundCurrency(Math.min(balance, params.maxAmount));
    if (amount <= 0) {
      return {
        status: 'nothing_due',
        amount: 0,
        paymentId: null,
        redirectUrl: null,
      };
    }
    const hotel = await hotelService.getHotelById(params.hotelId);
    const currency = Currency[hotel?.currency as keyof typeof Currency];
    if (!currency) {
      throw new CloudbedsConfigurationError(
        `CloudbedsSdkPaymentProviderService.chargeReservationBalance: Hotel ${params.hotelId} currency "${hotel?.currency}" has no currency code`,
      );
    }
    const charge = await cloudbedsClient.postCharge(
      {
        propertyID: creds.propertyID,
        reservationID: params.cloudbedsReservationId,
        paymentMethodId: params.paymentMethodId,
        amount: amount.toFixed(2),
        currency: currency.toLowerCase(),
        description: params.description,
        isDeposit: true,
        redirectUrl: params.returnUrl,
      },
      ctx,
    );
    return {
      status: charge.paymentStatus,
      amount,
      paymentId: charge.paymentID ?? null,
      redirectUrl: charge.nextAction?.details?.url ?? null,
    };
  }

  /**
   * Calls the Cloudbeds Payments SDK API to issue a new key pair scoped to
   * the hotel's property, encrypts the secret, and persists both in
   * `external_auth_config.cloudbedsPaymentSdk`.
   */
  async issueAndStoreSdkKey(
    hotelId: string,
    apiToken: string,
    propertyId: string,
    assistantPhoneNumber?: string,
  ): Promise<void> {
    const logPrefix = 'CloudbedsSdkPaymentProviderService.issueAndStoreSdkKey';
    try {
      if (!config.CLOUDBEDS_SDK_API_BASE_URL) {
        throw new Error(
          `${logPrefix}: CLOUDBEDS_SDK_API_BASE_URL is not configured`,
        );
      }

      logger.info(`${logPrefix}: Issuing Cloudbeds Payment SDK key`, {
        hotelId,
        propertyId,
      });

      const response = await axios.post<CloudbedsSdkKeyIssueResponse>(
        `${config.CLOUDBEDS_SDK_API_BASE_URL}/v1/keys`,
        { property_ids: [propertyId] },
        {
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          timeout: config.API_TIMEOUT,
        },
      );

      const { identity, secret } = response.data;
      if (!identity || !secret) {
        throw new Error(
          `${logPrefix}: Cloudbeds SDK API returned incomplete response — missing identity or secret`,
        );
      }

      const encryptedSecret = encrypt(secret);

      await this.hotelConfigurationService.updateExternalAuthConfigCloudbedsPaymentSdkByHotelId(
        hotelId,
        {
          identity,
          secret: encryptedSecret,
          issuedAt: new Date().toISOString(),
        },
      );

      logKpi({
        stat: KpiStat.CloudbedsSdkApiKeyIssued,
        value: 1,
        contextName: logPrefix,
        clientId: assistantPhoneNumber,
        contextId: hotelId,
      });

      logger.info(`${logPrefix}: Cloudbeds Payment SDK key stored`, {
        hotelId,
        identity,
      });
    } catch (error) {
      logger.error(`${logPrefix}: Failed`, {
        hotelId,
        propertyId,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  async refundCardPayment(): Promise<never> {
    throw new BadRequestError(
      'Refunds are not supported via the Cloudbeds SDK. Refunds must be processed manually in the Cloudbeds dashboard by the hotel staff.',
    );
  }
}

const cloudbedsSdkPaymentProviderService =
  new CloudbedsSdkPaymentProviderService();
export default cloudbedsSdkPaymentProviderService;
