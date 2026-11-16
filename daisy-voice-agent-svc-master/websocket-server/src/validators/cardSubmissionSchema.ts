import Joi from 'joi';
import { BadRequestError } from '../errors/BadRequestError';
import { CARD_EXPIRY_YYMM_PATTERN } from '../utils/helper';

/**
 * Card details posted by the review page's card form, shared by Opera and
 * ResNexus. Every message below is overridden because Joi's default
 * `string.pattern.base` text includes the failing value, which would put the
 * PAN in an error response and in the logs.
 */
interface CardSubmissionRequest {
  reservation_review_id: string;
  /** Primary Account Number, digits only. */
  pan: string;
  /** Expiration date in YYMM. */
  expiryDate: string;
  card_holder_name?: string;
}

/** Opera exchanges the PAN for an OPI token and never sees a CVV. */
export type OperaCardTokenRequest = CardSubmissionRequest;

export interface ResNexusCardRequest extends CardSubmissionRequest {
  cvv: string;
}

const cardSubmissionKeys = {
  reservation_review_id: Joi.string().required().messages({
    'any.required': 'reservation_review_id is required',
    'string.empty': 'reservation_review_id cannot be empty',
  }),
  pan: Joi.string()
    .pattern(/^[0-9]{8,19}$/)
    .required()
    .messages({
      'any.required': 'pan is required',
      'string.empty': 'pan cannot be empty',
      'string.pattern.base': 'pan must be 8 to 19 digits',
    }),
  expiryDate: Joi.string()
    .pattern(CARD_EXPIRY_YYMM_PATTERN)
    .required()
    .messages({
      'any.required': 'expiryDate is required',
      'string.empty': 'expiryDate cannot be empty',
      'string.pattern.base': 'expiryDate must be in YYMM format',
    }),
  card_holder_name: Joi.string().max(80).optional().messages({
    'string.max': 'card_holder_name must be at most 80 characters',
  }),
};

export const operaCardTokenSchema = Joi.object(cardSubmissionKeys).required();

export const resNexusCardSchema = Joi.object({
  ...cardSubmissionKeys,
  // Required here because ResNexus does not verify the card.
  cvv: Joi.string()
    .pattern(/^[0-9]{3,4}$/)
    .required()
    .messages({
      'any.required': 'cvv is required',
      'string.empty': 'cvv cannot be empty',
      'string.pattern.base': 'cvv must be 3 or 4 digits',
    }),
}).required();

function validate<T>(schema: Joi.ObjectSchema, data: unknown): T {
  const { error, value } = schema.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const errorMessages = error.details.map((d) => d.message).join('; ');
    throw new BadRequestError(errorMessages);
  }

  return value as T;
}

export function validateOperaCardTokenRequest(
  data: unknown,
): OperaCardTokenRequest {
  return validate<OperaCardTokenRequest>(operaCardTokenSchema, data);
}

export function validateResNexusCardRequest(
  data: unknown,
): ResNexusCardRequest {
  return validate<ResNexusCardRequest>(resNexusCardSchema, data);
}
