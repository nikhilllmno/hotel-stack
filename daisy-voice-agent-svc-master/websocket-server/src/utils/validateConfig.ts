import config from '../config';
import { validateDaisyJwtPemAndWarmCache } from './jwtIssuer';
import logger from './logger';

/**
 * Validates the structure of HOTEL_SHIFT4_CONFIG environment variable
 * Expected format: {"hotel_id": {"authToken": "...", "accessToken": "..."}}
 */
export function validateHotelShift4Config(): void {
  const hotelShift4Config = config.HOTEL_SHIFT4_CONFIG;

  if (!hotelShift4Config || typeof hotelShift4Config !== 'object') {
    logger.warn(
      'HOTEL_SHIFT4_CONFIG is not configured or is not a valid object',
    );
    return;
  }

  const hotelIds = Object.keys(hotelShift4Config);

  if (hotelIds.length === 0) {
    logger.warn(
      'HOTEL_SHIFT4_CONFIG is empty - no hotels configured for Shift4',
    );
    return;
  }

  const errors: string[] = [];

  hotelIds.forEach((hotelId) => {
    const hotelConfig = hotelShift4Config[hotelId];

    if (!hotelConfig || typeof hotelConfig !== 'object') {
      errors.push(`Hotel ${hotelId}: Configuration is not a valid object`);
      return;
    }

    if (!hotelConfig.authToken || typeof hotelConfig.authToken !== 'string') {
      errors.push(
        `Hotel ${hotelId}: Missing or invalid 'authToken' (must be a string)`,
      );
    }

    if (
      !hotelConfig.accessToken ||
      typeof hotelConfig.accessToken !== 'string'
    ) {
      errors.push(
        `Hotel ${hotelId}: Missing or invalid 'accessToken' (must be a string)`,
      );
    }
  });

  if (errors.length > 0) {
    const errorMessage = `HOTEL_SHIFT4_CONFIG validation failed:\n${errors.join('\n')}`;
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }

  logger.info(
    `HOTEL_SHIFT4_CONFIG validated successfully for ${hotelIds.length} hotel(s): ${hotelIds.join(', ')}`,
  );
}

/**
 * Validates all configuration at application startup
 */
export function validateAllConfig(): void {
  logger.info('Validating application configuration...');

  try {
    validateDaisyJwtPemAndWarmCache();
    validateHotelShift4Config();
    logger.info('Configuration validation completed successfully');
  } catch (error) {
    logger.error('Configuration validation failed:', error);
    throw error;
  }
}
