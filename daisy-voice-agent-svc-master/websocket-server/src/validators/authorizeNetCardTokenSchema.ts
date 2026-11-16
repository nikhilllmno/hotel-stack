import Joi from 'joi';
import { BadRequestError } from '../errors/BadRequestError';

export interface AuthorizeNetCardTokenRequest {
  reservation_review_id: string;
  dataDescriptor: string;
  dataValue: string;
  cardNumber?: string;
  expDate?: string;
}

export const authorizeNetCardTokenSchema = Joi.object({
  reservation_review_id: Joi.string().required().messages({
    'any.required': 'Reservation review ID is required',
    'string.empty': 'Reservation review ID cannot be empty',
  }),
  dataDescriptor: Joi.string().required().messages({
    'any.required': 'dataDescriptor is required',
    'string.empty': 'dataDescriptor cannot be empty',
  }),
  dataValue: Joi.string().required().messages({
    'any.required': 'dataValue is required',
    'string.empty': 'dataValue cannot be empty',
  }),
  cardNumber: Joi.string().allow('').optional(),
  expDate: Joi.string().allow('').optional(),
}).required();

export function validateAuthorizeNetCardTokenRequest(
  data: unknown,
): AuthorizeNetCardTokenRequest {
  const { error, value } = authorizeNetCardTokenSchema.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const errorMessages = error.details
      .map((detail) => detail.message)
      .join('; ');
    throw new BadRequestError(errorMessages);
  }

  return value;
}
