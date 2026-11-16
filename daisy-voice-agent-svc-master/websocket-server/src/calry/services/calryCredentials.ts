/**
 * Single gate every live Calry API call resolves credentials through.
 *
 * Calry needs three values where other providers need one:
 * - `propertyId` from `hotels.business_id`
 * - `apiToken` from `hotel_configurations.external_auth_config.apiToken`
 *   (AES-256-GCM encrypted at rest, decrypted here)
 * - `integrationAccountId` from the same JSON blob, stored plain — it is a
 *   routing key, not a secret. It selects which upstream PMS connection
 *   (configured manually in the Calry dashboard) the call reaches.
 *
 * `workspaceId` is global to Dextr and comes from env rather than per-hotel
 * config, since every hotel is an integration account inside one workspace.
 */
import config from '../../config';
import { Hotel } from '../../dtos/Hotel';
import { NoDataError } from '../../errors/NoDataError';
import { hotelService } from '../../services/hotel/hotelService';
import { hotelConfigurationService } from '../../services/hotelConfiguration/hotelConfigurationService';
import { decrypt } from '../../utils/encryption';
import {
  CalryConfigurationError,
  CalryIntegrationDisabledError,
} from '../errors';
import { CalryCredentials } from '../types';

export async function resolveCalryCredentials(
  hotelOrId: Hotel | string,
): Promise<CalryCredentials> {
  const hotel =
    typeof hotelOrId === 'string'
      ? await hotelService.getHotelById(hotelOrId)
      : hotelOrId;

  if (!hotel) {
    throw new NoDataError('resolveCalryCredentials: Hotel not found');
  }

  const propertyId = hotel.business_id;
  if (!propertyId) {
    throw new CalryConfigurationError(
      `resolveCalryCredentials: Hotel ${hotel.id} is missing business_id (Calry propertyId)`,
    );
  }

  if (!config.CALRY_WORKSPACE_ID) {
    throw new CalryConfigurationError(
      'resolveCalryCredentials: CALRY_WORKSPACE_ID is not configured',
    );
  }

  const authConfig =
    await hotelConfigurationService.getExternalAuthConfigByHotelId(hotel.id);

  if (!authConfig?.apiToken) {
    throw new CalryConfigurationError(
      `resolveCalryCredentials: Hotel ${hotel.id} is missing external_auth_config`,
    );
  }

  if (!authConfig.integrationAccountId) {
    throw new CalryConfigurationError(
      `resolveCalryCredentials: Hotel ${hotel.id} is missing external_auth_config.integrationAccountId`,
    );
  }

  if (authConfig.disabledAt) {
    throw new CalryIntegrationDisabledError(
      `resolveCalryCredentials: Hotel ${hotel.id} has its Calry integration disabled (since ${authConfig.disabledAt})`,
    );
  }

  return {
    propertyId: String(propertyId),
    apiToken: decrypt(authConfig.apiToken),
    workspaceId: config.CALRY_WORKSPACE_ID,
    integrationAccountId: authConfig.integrationAccountId,
    hotelId: hotel.id,
  };
}
