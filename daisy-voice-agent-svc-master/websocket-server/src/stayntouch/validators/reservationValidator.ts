import Joi from 'joi';
import { BadRequestError } from '../../errors/BadRequestError';
import { CreateReservationParams } from '../../pms/types/IPMSReservationService';
import logger from '../../utils/logger';

/**
 * Joi schema for validating Stayntouch reservation creation parameters
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
        city: Joi.string().required(),
        state_or_province: Joi.string().required(),
        postal_code: Joi.string().required(),
        country: Joi.string().required(),
      }).required(),
    }).required(),
    quote: Joi.object().required(),
    discount: Joi.object().optional().allow(null),
  }).options({ allowUnknown: true, abortEarly: false });

/**
 * Validates Stayntouch reservation creation parameters
 * @param params Parameters to validate
 * @throws BadRequestError if validation fails
 * @returns Validated parameters
 */
export function validateCreateReservationParams(
  params: CreateReservationParams,
): CreateReservationParams {
  const { error, value } = createReservationParamsSchema.validate(params);

  if (error) {
    const errorMessage = error.details
      .map((detail) => detail.message)
      .join('; ');
    logger.error('Stayntouch createReservation validation failed', {
      error: errorMessage,
      details: error.details,
    });
    throw new BadRequestError(
      `Stayntouch reservation creation validation failed: ${errorMessage}`,
    );
  }

  return value;
}
