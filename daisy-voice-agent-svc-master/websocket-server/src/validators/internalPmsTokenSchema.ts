import Joi from 'joi';
import { BadRequestError } from '../errors/BadRequestError';
import { PmsProvider } from '../types/enums';

export interface StoreTokenRequest {
  hotel_id: string;
  pms_provider: PmsProvider;
  token: string;
  cloudbeds_sdk_enabled: boolean;
}

export const storeTokenSchema = Joi.object({
  hotel_id: Joi.string().required().trim(),
  pms_provider: Joi.string()
    .required()
    .trim()
    .valid(...Object.values(PmsProvider)),
  token: Joi.string().required().trim(),
  cloudbeds_sdk_enabled: Joi.boolean()
    .optional()
    .default(false)
    .when('pms_provider', {
      not: PmsProvider.CLOUDBEDS,
      then: Joi.boolean().valid(false).messages({
        'any.only':
          'cloudbeds_sdk_enabled can only be true when pms_provider is cloudbeds',
      }),
    }),
}).required();

export function validateStoreTokenRequest(data: unknown): StoreTokenRequest {
  const { error, value } = storeTokenSchema.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const errorMessages = error.details.map((d) => d.message).join('; ');
    throw new BadRequestError(errorMessages);
  }

  return value;
}
