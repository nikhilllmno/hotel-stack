import Joi from 'joi';
import { BadRequestError } from '../errors/BadRequestError';

export interface MewsCardTokenRequest {
  reservation_review_id: string;
  transactionId: string;
  expiration: string; // yyyy-MM
}

export const mewsCardTokenSchema = Joi.object({
  reservation_review_id: Joi.string().required().messages({
    'any.required': 'reservation_review_id is required',
    'string.empty': 'reservation_review_id cannot be empty',
  }),
  transactionId: Joi.string().required().messages({
    'any.required': 'transactionId is required',
    'string.empty': 'transactionId cannot be empty',
  }),
  expiration: Joi.string()
    .pattern(/^\d{4}-\d{2}$/)
    .required()
    .messages({
      'any.required': 'expiration is required',
      'string.empty': 'expiration cannot be empty',
      'string.pattern.base': 'expiration must be in yyyy-MM format',
    }),
}).required();

export function validateMewsCardTokenRequest(data: any): MewsCardTokenRequest {
  const { error, value } = mewsCardTokenSchema.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const errorMessages = error.details.map((d) => d.message).join('; ');
    throw new BadRequestError(errorMessages);
  }

  return value;
}
