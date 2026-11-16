/**
 * Single gate every live Cloudbeds API call resolves credentials through.
 *
 * `propertyID` comes from `hotels.business_id`; `apiToken` comes from
 * `hotel_configurations.external_auth_config.apiToken` (AES-256-GCM encrypted at
 * rest, decrypted here). Before returning it, checks
 * `external_auth_config.disabledAt`: set by
 * `CloudbedsWebhookService.handleAppStateChanged` when Cloudbeds reports the
 * integration disabled, and refused here even if `apiToken` is still set —
 * disabling never clears the token itself, only this marker.
 */
import { Hotel } from '../../dtos/Hotel';
import { NoDataError } from '../../errors/NoDataError';
import { hotelService } from '../../services/hotel/hotelService';
import { hotelConfigurationService } from '../../services/hotelConfiguration/hotelConfigurationService';
import { decrypt } from '../../utils/encryption';
import {
  CloudbedsConfigurationError,
  CloudbedsIntegrationDisabledError,
} from '../errors';

export interface CloudbedsCredentials {
  propertyID: string;
  apiToken: string;
  hotelId: string;
}

export async function resolveCloudbedsCredentials(
  hotelOrId: Hotel | string,
): Promise<CloudbedsCredentials> {
  const hotel =
    typeof hotelOrId === 'string'
      ? await hotelService.getHotelById(hotelOrId)
      : hotelOrId;

  if (!hotel) {
    throw new NoDataError('resolveCloudbedsCredentials: Hotel not found');
  }

  const propertyID = hotel.business_id;
  if (!propertyID) {
    throw new CloudbedsConfigurationError(
      `resolveCloudbedsCredentials: Hotel ${hotel.id} is missing business_id (Cloudbeds propertyID)`,
    );
  }

  const authConfig =
    await hotelConfigurationService.getExternalAuthConfigByHotelId(hotel.id);
  if (!authConfig?.apiToken) {
    throw new CloudbedsConfigurationError(
      `resolveCloudbedsCredentials: Hotel ${hotel.id} is missing external_auth_config`,
    );
  }

  if (authConfig.disabledAt) {
    throw new CloudbedsIntegrationDisabledError(
      `resolveCloudbedsCredentials: Hotel ${hotel.id} has its Cloudbeds integration disabled (since ${authConfig.disabledAt})`,
    );
  }

  return {
    propertyID: String(propertyID),
    apiToken: decrypt(authConfig.apiToken),
    hotelId: hotel.id,
  };
}
