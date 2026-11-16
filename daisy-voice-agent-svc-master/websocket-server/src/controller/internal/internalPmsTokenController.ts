import { Request, Response } from 'express';
import cloudbedsSdkPaymentProviderService, {
  CloudbedsSdkPaymentProviderService,
} from '../../cloudbeds/services/CloudbedsSdkPaymentProviderService';
import { NoDataError } from '../../errors/NoDataError';
import { HotelRepository } from '../../repositories/HotelRepository';
import {
  HotelConfigurationService,
  hotelConfigurationService,
} from '../../services/hotelConfiguration/hotelConfigurationService';
import { PmsProvider } from '../../types/enums';
import { encrypt } from '../../utils/encryption';
import { KpiStat, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import { validateStoreTokenRequest } from '../../validators/internalPmsTokenSchema';
import { handleCoreApiErrorAndSendResponse } from '../util/helper';

export class InternalPmsTokenController {
  constructor(
    private readonly hotelConfigurationService: HotelConfigurationService,
    private readonly hotelRepository: HotelRepository = new HotelRepository(),
    private readonly cloudbedsPaymentSdkService: CloudbedsSdkPaymentProviderService = cloudbedsSdkPaymentProviderService,
  ) {}

  /**
   * POST /internal/pms/token
   * Body: { hotel_id, pms_provider, token, cloudbeds_sdk_enabled? }
   *
   * Encrypts the given PMS token and stores it as `external_auth_config.apiToken`
   * on the hotel's `hotel_configurations` row. `pms_provider` is not stored — the
   * column is flat and identity is already carried by `hotels.pms_provider` — it
   * is only checked here so a token can't be written against the wrong provider.
   *
   * When `pms_provider` is `cloudbeds` and `cloudbeds_sdk_enabled` is `true`,
   * additionally calls the Cloudbeds Payments SDK API to issue a key pair and
   * stores the encrypted SDK credentials in `external_auth_config.cloudbedsPaymentSdk`.
   */
  async storeToken(req: Request, res: Response): Promise<void> {
    try {
      const { hotel_id, pms_provider, token, cloudbeds_sdk_enabled } =
        validateStoreTokenRequest(req.body);

      const hotel = await this.hotelRepository.findById(hotel_id);
      if (!hotel) {
        throw new NoDataError(`No hotel found with ID: ${hotel_id}`);
      }

      if (hotel.pms_provider !== pms_provider) {
        res.status(400).json({
          error: `pms_provider "${pms_provider}" does not match hotel's configured provider "${hotel.pms_provider}"`,
        });
        return;
      }

      const encryptedToken = encrypt(token);
      const updatedRowCount =
        await this.hotelConfigurationService.updateExternalAuthConfigApiTokenByHotelId(
          hotel_id,
          encryptedToken,
        );

      if (updatedRowCount === 0) {
        throw new NoDataError(
          `No active hotel_configurations row found for hotel ID: ${hotel_id}`,
        );
      }

      logKpi({
        stat: KpiStat.PmsExternalAuthTokenStored,
        value: 1,
        contextName: 'InternalPmsTokenController.storeToken',
        clientId: hotel.assistant_phone_number,
        contextId: hotel_id,
      });

      if (
        pms_provider === PmsProvider.CLOUDBEDS &&
        cloudbeds_sdk_enabled === true
      ) {
        await this.cloudbedsPaymentSdkService.issueAndStoreSdkKey(
          hotel_id,
          token,
          hotel.business_id,
          hotel.assistant_phone_number,
        );
      }

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error(`storeToken: Error: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  /**
   * POST /internal/pms/client-credentials
   * Body: { hotel_id, pms_provider, client_id, client_secret }
   *
   * Encrypts the given OAuth client credentials and stores them as
   * `external_auth_config.oauth_client_id` / `oauth_client_secret` on the
   * hotel's `hotel_configurations` row. Reusable for any OAuth PMS —
   * `pms_provider` is validated against `hotels.pms_provider`.
   */
  async storeClientCredentials(req: Request, res: Response): Promise<void> {
    try {
      const { hotel_id, pms_provider, client_id, client_secret } = (req.body ??
        {}) as {
        hotel_id?: string;
        pms_provider?: string;
        client_id?: string;
        client_secret?: string;
      };

      if (
        typeof hotel_id !== 'string' ||
        typeof pms_provider !== 'string' ||
        typeof client_id !== 'string' ||
        typeof client_secret !== 'string' ||
        !hotel_id.trim() ||
        !pms_provider.trim() ||
        !client_id.trim() ||
        !client_secret.trim()
      ) {
        res.status(400).json({
          error:
            'hotel_id, pms_provider, client_id, and client_secret are required',
        });
        return;
      }

      if (!Object.values(PmsProvider).includes(pms_provider as PmsProvider)) {
        res.status(400).json({
          error: `pms_provider must be one of: ${Object.values(PmsProvider).join(', ')}`,
        });
        return;
      }

      const hotel = await this.hotelRepository.findById(hotel_id);
      if (!hotel) {
        throw new NoDataError(`No hotel found with ID: ${hotel_id}`);
      }

      if (hotel.pms_provider !== pms_provider) {
        res.status(400).json({
          error: `pms_provider "${pms_provider}" does not match hotel's configured provider "${hotel.pms_provider}"`,
        });
        return;
      }

      const encryptedClientId = encrypt(client_id);
      const encryptedClientSecret = encrypt(client_secret);
      const updatedRowCount =
        await this.hotelConfigurationService.updateExternalAuthConfigOAuthCredentialsByHotelId(
          hotel_id,
          encryptedClientId,
          encryptedClientSecret,
        );

      if (updatedRowCount === 0) {
        throw new NoDataError(
          `No active hotel_configurations row found for hotel ID: ${hotel_id}`,
        );
      }

      logKpi({
        stat: KpiStat.PmsOAuthClientCredentialsStored,
        value: 1,
        contextName: 'InternalPmsTokenController.storeClientCredentials',
        clientId: hotel.assistant_phone_number,
        contextId: hotel_id,
      });

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error(`storeClientCredentials: Error: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }
}

export const internalPmsTokenController = new InternalPmsTokenController(
  hotelConfigurationService,
);
