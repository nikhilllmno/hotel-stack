import Joi from 'joi';
import { BadRequestError } from '../errors/BadRequestError';

export interface CloudbedsCardTokenRequest {
  reservation_review_id: string;
  paymentMethodId: string;
}

export const cloudbedsCardTokenSchema = Joi.object({
  reservation_review_id: Joi.string().required().messages({
    'any.required': 'reservation_review_id is required',
    'string.empty': 'reservation_review_id cannot be empty',
  }),
  paymentMethodId: Joi.string().required().messages({
    'any.required': 'paymentMethodId is required',
    'string.empty': 'paymentMethodId cannot be empty',
  }),
}).required();

export function validateCloudbedsCardTokenRequest(
  data: any,
): CloudbedsCardTokenRequest {
  const { error, value } = cloudbedsCardTokenSchema.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const errorMessages = error.details.map((d) => d.message).join('; ');
    throw new BadRequestError(errorMessages);
  }

  return value;
}
