import Joi from 'joi';
import { CHAT_NOTIFICATION_TYPES } from '../services/notification/notificationType';
import { Country, PaymentProvider } from '../types/enums';

const countryValues = Object.values(Country) as string[];

const notificationTypeSchema = Joi.string()
  .valid(...CHAT_NOTIFICATION_TYPES)
  .optional()
  .messages({
    'any.only': `notification_type must be one of: ${CHAT_NOTIFICATION_TYPES.join(', ')}`,
  });

const createHotelSchema = Joi.object({
  name: Joi.string().trim().required().messages({
    'string.base': 'name must be a string',
    'string.empty': 'name cannot be empty',
    'any.required': 'name is required',
  }),
  pms_provider: Joi.string().trim().required().messages({
    'string.base': 'pms_provider must be a string',
    'string.empty': 'pms_provider cannot be empty',
    'any.required': 'pms_provider is required',
  }),
  telegram_check_in_group_id: Joi.string().trim().required().messages({
    'string.base': 'telegram_check_in_group_id must be a string',
    'string.empty': 'telegram_check_in_group_id cannot be empty',
    'any.required': 'telegram_check_in_group_id is required',
  }),
  telegram_alerts_group_id: Joi.string().trim().required().messages({
    'string.base': 'telegram_alerts_group_id must be a string',
    'string.empty': 'telegram_alerts_group_id cannot be empty',
    'any.required': 'telegram_alerts_group_id is required',
  }),
  telegram_transcript_group_id: Joi.string()
    .trim()
    .optional()
    .allow('', null)
    .messages({
      'string.base': 'telegram_transcript_group_id must be a string',
    }),
  notification_type: notificationTypeSchema,
  assistant_phone_number: Joi.string().trim().required().messages({
    'string.base': 'assistant_phone_number must be a string',
    'string.empty': 'assistant_phone_number cannot be empty',
    'any.required': 'assistant_phone_number is required',
  }),
  business_id: Joi.alternatives()
    .try(Joi.number().integer(), Joi.string().trim().min(1))
    .required()
    .messages({
      'alternatives.match':
        'business_id must be an integer or a non-empty string (e.g. UUID, GUID)',
      'any.required': 'business_id is required',
    }),
  country: Joi.string()
    .valid(...countryValues)
    .required()
    .messages({
      'any.only': `country must be one of: ${countryValues.join(', ')}`,
      'any.required': 'country is required',
    }),
  timezone: Joi.string().trim().required().messages({
    'string.base': 'timezone must be a string',
    'string.empty': 'timezone cannot be empty',
    'any.required': 'timezone is required',
  }),
  sms_number: Joi.string().trim().required().messages({
    'string.base': 'sms_number must be a string',
    'string.empty': 'sms_number cannot be empty',
    'any.required': 'sms_number is required',
  }),
  internal_phone_number: Joi.string().trim().required().messages({
    'string.base': 'internal_phone_number must be a string',
    'string.empty': 'internal_phone_number cannot be empty',
    'any.required': 'internal_phone_number is required',
  }),
  url: Joi.string().trim().required().messages({
    'string.base': 'url must be a string',
    'string.empty': 'url cannot be empty',
    'any.required': 'url is required',
  }),
  address: Joi.string().trim().required().messages({
    'string.base': 'address must be a string',
    'string.empty': 'address cannot be empty',
    'any.required': 'address is required',
  }),
  image_url: Joi.string().trim().required().messages({
    'string.base': 'image_url must be a string',
    'string.empty': 'image_url cannot be empty',
    'any.required': 'image_url is required',
  }),
  currency: Joi.string().trim().required().messages({
    'string.base': 'currency must be a string',
    'string.empty': 'currency cannot be empty',
    'any.required': 'currency is required',
  }),
  payment_provider: Joi.string()
    .valid(...Object.values(PaymentProvider))
    .required()
    .messages({
      'any.only': `payment_provider must be one of: ${Object.values(PaymentProvider).join(', ')}`,
      'any.required': 'payment_provider is required',
    }),
}).options({ stripUnknown: true });

const updateHotelSchema = Joi.object({
  name: Joi.string().trim().optional().messages({
    'string.base': 'name must be a string',
    'string.empty': 'name cannot be empty',
  }),
  pms_provider: Joi.string().trim().optional().messages({
    'string.base': 'pms_provider must be a string',
    'string.empty': 'pms_provider cannot be empty',
  }),
  telegram_check_in_group_id: Joi.string().trim().optional().messages({
    'string.base': 'telegram_check_in_group_id must be a string',
    'string.empty': 'telegram_check_in_group_id cannot be empty',
  }),
  telegram_alerts_group_id: Joi.string().trim().optional().messages({
    'string.base': 'telegram_alerts_group_id must be a string',
    'string.empty': 'telegram_alerts_group_id cannot be empty',
  }),
  telegram_transcript_group_id: Joi.string()
    .trim()
    .optional()
    .allow('', null)
    .messages({
      'string.base': 'telegram_transcript_group_id must be a string',
    }),
  notification_type: notificationTypeSchema,
  assistant_phone_number: Joi.string().trim().optional().messages({
    'string.base': 'assistant_phone_number must be a string',
    'string.empty': 'assistant_phone_number cannot be empty',
  }),
  business_id: Joi.alternatives()
    .try(Joi.number().integer(), Joi.string().trim().min(1))
    .optional()
    .messages({
      'alternatives.match':
        'business_id must be an integer or a non-empty string (e.g. UUID, GUID)',
    }),
  country: Joi.string()
    .valid(...countryValues)
    .optional()
    .messages({
      'any.only': `country must be one of: ${countryValues.join(', ')}`,
    }),
  timezone: Joi.string().trim().optional().messages({
    'string.base': 'timezone must be a string',
    'string.empty': 'timezone cannot be empty',
  }),
  sms_number: Joi.string().trim().optional().messages({
    'string.base': 'sms_number must be a string',
    'string.empty': 'sms_number cannot be empty',
  }),
  internal_phone_number: Joi.string().trim().optional().messages({
    'string.base': 'internal_phone_number must be a string',
    'string.empty': 'internal_phone_number cannot be empty',
  }),
  url: Joi.string().trim().optional().messages({
    'string.base': 'url must be a string',
    'string.empty': 'url cannot be empty',
  }),
  address: Joi.string().trim().optional().messages({
    'string.base': 'address must be a string',
    'string.empty': 'address cannot be empty',
  }),
  image_url: Joi.string().trim().optional().messages({
    'string.base': 'image_url must be a string',
    'string.empty': 'image_url cannot be empty',
  }),
  currency: Joi.string().trim().optional().messages({
    'string.base': 'currency must be a string',
    'string.empty': 'currency cannot be empty',
  }),
  payment_provider: Joi.string()
    .valid(...Object.values(PaymentProvider))
    .optional()
    .messages({
      'any.only': `payment_provider must be one of: ${Object.values(PaymentProvider).join(', ')}`,
    }),
}).options({ stripUnknown: true });

const adminUpdateHotelPhoneSchema = Joi.object({
  hotel_id: Joi.string().uuid().required().messages({
    'string.base': 'hotel_id must be a string',
    'string.guid': 'hotel_id must be a valid UUID',
    'any.required': 'hotel_id is required',
  }),
  current_phone: Joi.alternatives()
    .try(Joi.string().trim().allow(''), Joi.valid(null))
    .optional()
    .messages({
      'alternatives.match': 'current_phone must be a string or null',
    }),
  new_phone: Joi.string().trim().min(1).required().messages({
    'string.base': 'new_phone must be a string',
    'string.empty': 'new_phone cannot be empty',
    'any.required': 'new_phone is required',
  }),
}).options({ stripUnknown: true });

export { adminUpdateHotelPhoneSchema, createHotelSchema, updateHotelSchema };
