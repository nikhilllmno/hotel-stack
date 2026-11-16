import Joi from 'joi';
import { BadRequestError } from '../../errors/BadRequestError';
import logger from '../../utils/logger';
import {
  CloudbedsGetRateQuery,
  CloudbedsGetRoomTypesQuery,
  CloudbedsGetRoomsQuery,
} from '../types';

const dateString = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .message('"{{#label}}" must be in YYYY-MM-DD format');

export const getRoomsQuerySchema = Joi.object<CloudbedsGetRoomsQuery>({
  propertyIDs: Joi.string().required(),
});

export const getRoomTypesQuerySchema = Joi.object<CloudbedsGetRoomTypesQuery>({
  propertyIDs: Joi.string().required(),
  startDate: dateString.required(),
  endDate: dateString.required(),
  adults: Joi.number().integer().min(1).required(),
  children: Joi.number().integer().min(0).required(),
});

export const getRateQuerySchema = Joi.object<CloudbedsGetRateQuery>({
  propertyID: Joi.string().required(),
  roomTypeID: Joi.string().required(),
  startDate: dateString.required(),
  endDate: dateString.required(),
  adults: Joi.number().integer().min(1).required(),
  children: Joi.number().integer().min(0).required(),
  detailedRates: Joi.boolean().required(),
});

function runValidation<T>(
  schema: Joi.ObjectSchema<T>,
  value: T,
  label: string,
): T {
  const result = schema.validate(value, { abortEarly: false });
  if (result.error) {
    const message = result.error.details.map((d) => d.message).join('; ');
    logger.error(`Cloudbeds ${label} validation failed`, {
      error: message,
      details: result.error.details,
    });
    throw new BadRequestError(
      `Cloudbeds ${label} validation failed: ${message}`,
    );
  }
  return result.value;
}

export function validateGetRoomsQuery(
  value: CloudbedsGetRoomsQuery,
): CloudbedsGetRoomsQuery {
  return runValidation(getRoomsQuerySchema, value, 'getRooms');
}

export function validateGetRoomTypesQuery(
  value: CloudbedsGetRoomTypesQuery,
): CloudbedsGetRoomTypesQuery {
  return runValidation(getRoomTypesQuerySchema, value, 'getRoomTypes');
}

/** Same query shape as `getRoomTypes` — `getAvailableRoomTypes` takes identical params. */
export function validateGetAvailableRoomTypesQuery(
  value: CloudbedsGetRoomTypesQuery,
): CloudbedsGetRoomTypesQuery {
  return runValidation(getRoomTypesQuerySchema, value, 'getAvailableRoomTypes');
}

export function validateGetRateQuery(
  value: CloudbedsGetRateQuery,
): CloudbedsGetRateQuery {
  return runValidation(getRateQuerySchema, value, 'getRate');
}
