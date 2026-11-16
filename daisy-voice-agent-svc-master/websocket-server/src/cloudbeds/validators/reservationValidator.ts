import Joi from 'joi';
import { BadRequestError } from '../../errors/BadRequestError';
import { CreateReservationParams } from '../../pms/types/IPMSReservationService';
import logger from '../../utils/logger';

/**
 * Joi schema for validating Cloudbeds reservation creation parameters.
 *
 * Keeps the same guest-field requirements as the other PMS integrations
 * (first name, last name, email) so multi-PMS flows stay consistent.
 */
export const createReservationParamsSchema =
  Joi.object<CreateReservationParams>({
    reservation: Joi.object({
      id: Joi.string().required(),
      hotel_id: Joi.string().required(),
      check_in: Joi.date().required(),
      check_out: Joi.date().required(),
      status: Joi.string().required(),
    }).required(),
    customer: Joi.object({
      id: Joi.string().required(),
      first_name: Joi.string().required(),
      last_name: Joi.string().required(),
      email: Joi.string().email().required(),
      phone_number: Joi.string().required(),
      address: Joi.object({
        postal_code: Joi.string().required(),
        country: Joi.string().default('US'),
      })
        .required()
        .unknown(true),
    }).required(),
    quote: Joi.object().required(),
    discount: Joi.object().optional().allow(null),
  }).options({ allowUnknown: true, abortEarly: false });

export function validateCreateReservationParams(
  params: CreateReservationParams,
): CreateReservationParams {
  const { error, value } = createReservationParamsSchema.validate(params);
  if (error) {
    const message = error.details.map((d) => d.message).join('; ');
    logger.error('Cloudbeds createReservation validation failed', {
      error: message,
      details: error.details,
    });
    throw new BadRequestError(
      `Cloudbeds reservation creation validation failed: ${message}`,
    );
  }
  return value;
}

export const cancelReservationParamsSchema = Joi.object({
  business_id: Joi.string().required(),
  external_id: Joi.string().required(),
  internal_id: Joi.string().required(),
  reason: Joi.string().optional().allow(''),
}).options({ allowUnknown: true, abortEarly: false });

export function validateCancelReservationParams<
  T extends { business_id: string; external_id: string; internal_id: string },
>(params: T): T {
  const { error, value } = cancelReservationParamsSchema.validate(params);
  if (error) {
    const message = error.details.map((d) => d.message).join('; ');
    logger.error('Cloudbeds cancelReservation validation failed', {
      error: message,
      details: error.details,
    });
    throw new BadRequestError(
      `Cloudbeds reservation cancellation validation failed: ${message}`,
    );
  }
  return value as T;
}
