import Joi from 'joi';
import { BadRequestError } from '../../errors/BadRequestError';
import logger from '../../utils/logger';
import { CloudbedsGetRoomTypesCatalogQuery } from '../types';

const getRoomTypesCatalogQuerySchema =
  Joi.object<CloudbedsGetRoomTypesCatalogQuery>({
    propertyIDs: Joi.string().required(),
  });

export function validateGetRoomTypesCatalogQuery(
  value: CloudbedsGetRoomTypesCatalogQuery,
): CloudbedsGetRoomTypesCatalogQuery {
  const result = getRoomTypesCatalogQuerySchema.validate(value, {
    abortEarly: false,
  });
  if (result.error) {
    const message = result.error.details.map((d) => d.message).join('; ');
    logger.error('Cloudbeds getRoomTypesCatalog validation failed', {
      error: message,
      details: result.error.details,
    });
    throw new BadRequestError(
      `Cloudbeds getRoomTypesCatalog validation failed: ${message}`,
    );
  }
  return result.value;
}
