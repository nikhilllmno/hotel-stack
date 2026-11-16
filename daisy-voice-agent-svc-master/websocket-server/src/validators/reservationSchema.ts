import Joi from 'joi';
import { ReservationPaymentStatus } from '../dtos/enum/ReservationPaymentStatus';
import { ReservationStatus } from '../dtos/enum/ReservationStatus';
import { SessionType } from '../dtos/enum/SessionType';

// Send onboarding SMS schema
export const sendOnboardingSmsSchema = Joi.object({
  days: Joi.number().integer().min(0).required().messages({
    'number.base': 'days must be a number',
    'number.integer': 'days must be an integer',
    'number.min': 'days must be a non-negative number',
    'any.required': 'days parameter is required',
  }),
  timezones: Joi.array().items(Joi.string().trim()).min(1).required().messages({
    'array.base': 'timezones must be an array',
    'array.min': 'timezones must contain at least one timezone',
    'any.required': 'timezones parameter is required',
  }),
});

// Helper to parse comma-separated values and convert to uppercase
const commaSeparatedString = (validValues: string[]) =>
  Joi.string()
    .custom((value, helpers) => {
      const values = value
        .split(',')
        .map((v: string) => v.trim().toUpperCase())
        .filter((v: string) => v.length > 0);

      const invalidValues = values.filter(
        (v: string) => !validValues.includes(v),
      );
      if (invalidValues.length > 0) {
        return helpers.error('any.invalid', {
          invalid: invalidValues.join(', '),
          valid: validValues.join(', '),
        });
      }

      return values;
    })
    .messages({
      'any.invalid':
        'Invalid values: {{#invalid}}. Must be one or more of: {{#valid}}',
    });

// Pagination query schema (reusable)
const paginationQuerySchema = {
  page: Joi.number().integer().min(1).default(1).messages({
    'number.base': 'Page must be a number',
    'number.integer': 'Page must be an integer',
    'number.min': 'Page must be greater than 0',
  }),
  limit: Joi.number().integer().min(1).default(10).messages({
    'number.base': 'Limit must be a number',
    'number.integer': 'Limit must be an integer',
    'number.min': 'Limit must be greater than 0',
  }),
};

// Hotel reservation list query schema
const getHotelReservationListQuerySchema = Joi.object({
  ...paginationQuerySchema,
  search: Joi.string().trim().allow('').optional().messages({
    'string.base': 'Search must be a string',
  }),
  channel: commaSeparatedString(
    Object.values(SessionType).filter((t) => t !== SessionType.EXTERNAL),
  ).optional(),
  status: commaSeparatedString(Object.values(ReservationStatus)).optional(),
  payment_status: commaSeparatedString(
    Object.values(ReservationPaymentStatus),
  ).optional(),
  start_date: Joi.date().iso().optional().messages({
    'date.base': 'start_date must be a valid date',
    'date.format': 'start_date must be in ISO format',
  }),
  end_date: Joi.date().iso().optional().messages({
    'date.base': 'end_date must be a valid date',
    'date.format': 'end_date must be in ISO format',
  }),
})
  .custom((value, helpers) => {
    if (
      value.start_date &&
      value.end_date &&
      new Date(value.start_date) > new Date(value.end_date)
    ) {
      return helpers.error('custom.dateRange');
    }
    return value;
  })
  .messages({
    'custom.dateRange': 'start_date must be less than or equal to end_date',
  })
  .options({ stripUnknown: true });

// Transcripts query schema
const getTranscriptsQuerySchema = Joi.object({
  ...paginationQuerySchema,
}).options({ stripUnknown: true });

// Mark payment collected schema
const markPaymentCollectedSchema = Joi.object({
  amount: Joi.number().positive().optional().messages({
    'number.base': 'Amount must be a number',
    'number.positive': 'Amount must be a positive number',
  }),
  payment_method: Joi.string().trim().max(50).optional().messages({
    'string.base': 'Payment method must be a string',
    'string.max': 'Payment method must not exceed 50 characters',
  }),
  notes: Joi.string().trim().max(500).optional().messages({
    'string.base': 'Notes must be a string',
    'string.max': 'Notes must not exceed 500 characters',
  }),
  collected_at: Joi.date().iso().optional().messages({
    'date.base': 'Collected at must be a valid date',
    'date.format': 'Collected at must be in ISO format',
  }),
}).options({ stripUnknown: true });

// Setup auto-charge schema
const setupAutoChargeSchema = Joi.object({
  finalizes_at: Joi.date().iso().greater('now').optional().messages({
    'date.base': 'Datetime must be a valid date',
    'date.format': 'Datetime must be in ISO format',
    'date.greater': 'Datetime must be in the future',
  }),
  amount: Joi.number().positive().optional().messages({
    'number.base': 'Amount must be a number',
    'number.positive': 'Amount must be a positive number',
  }),
  is_enabled: Joi.boolean().required().messages({
    'boolean.base': 'is_enabled must be a boolean',
    'any.required': 'is_enabled is required',
  }),
}).options({ abortEarly: false, stripUnknown: true });

// Charge reservation schema
const chargeReservationSchema = Joi.object({
  amount: Joi.number().positive().required().messages({
    'number.base': 'Amount must be a number',
    'number.positive': 'Amount must be greater than 0',
    'any.required': 'Amount is required',
  }),
  reason: Joi.string().trim().max(300).optional().messages({
    'string.base': 'Reason must be a string',
    'string.max': 'Reason must not exceed 300 characters',
  }),
  send_guest_notification: Joi.boolean().optional().messages({
    'boolean.base': 'send_guest_notification must be a boolean',
  }),
}).options({ stripUnknown: true });

// Update reservation status schema
const updateReservationStatusSchema = Joi.object({
  status: Joi.string()
    .valid(...Object.values(ReservationStatus))
    .required()
    .messages({
      'any.required': 'Status is required',
      'any.only': `Status must be one of: ${Object.values(ReservationStatus).join(', ')}`,
    }),
}).options({ stripUnknown: true });

export {
  chargeReservationSchema,
  getHotelReservationListQuerySchema,
  getTranscriptsQuerySchema,
  markPaymentCollectedSchema,
  setupAutoChargeSchema,
  updateReservationStatusSchema,
};
