import Joi from 'joi';
import { DAISY_SESSION_TYPES } from '../dtos/enum/SessionType';
import { StatusUpdateType } from '../models/request/StatusUpdate';
import { SortOrder } from '../types/enums';

const daisySessionTypeValues = Object.values(DAISY_SESSION_TYPES);

const createSessionSchema = Joi.object({
  caller_phone_number: Joi.string().required().messages({
    'string.base': 'Caller phone number must be a string',
    'any.required': 'Caller phone number is required',
  }),
  session_type: Joi.string()
    .valid(...daisySessionTypeValues)
    .required()
    .messages({
      'string.base': 'Session type must be a string',
      'any.only': `Invalid session type. Must be one of: ${daisySessionTypeValues.join(', ')}`,
      'any.required': 'Session type is required',
    }),
  assistant_phone_number: Joi.string().required().messages({
    'string.base': 'Assistant phone number must be a string',
    'any.required': 'Assistant phone number is required',
  }),
  session_status: Joi.string()
    .valid(StatusUpdateType.InProgress)
    .required()
    .messages({
      'string.base': 'Session status must be a string',
      'any.only': 'Invalid session status',
      'any.required': 'Session status is required',
    }),
}).options({ stripUnknown: true });

const paginationQuerySchema = Joi.object({
  limit: Joi.number().integer().positive().default(20).messages({
    'number.base': 'Limit must be a number',
    'number.integer': 'Limit must be an integer',
    'number.positive': 'Limit must be a positive integer',
  }),
  sort_order: Joi.string()
    .valid(SortOrder.ASC, SortOrder.DESC)
    .default(SortOrder.DESC)
    .messages({
      'string.base': 'Sort order must be a string',
      'any.only': 'Sort order must be either "asc" or "desc"',
    }),
}).options({ stripUnknown: true });

const getConversationMessagesQuerySchema = paginationQuerySchema;
const getConversationHistoryQuerySchema = paginationQuerySchema.options({
  abortEarly: false,
});

const smsInboxPaginationQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().trim().max(32).optional().allow(''),
});

const channelHistoryQuerySchema = Joi.object({
  business_id: Joi.string().trim().min(1).optional(),
  assistant_phone_number: Joi.string().trim().min(1).optional(),
  session_type: Joi.string()
    .valid(...daisySessionTypeValues)
    .default(DAISY_SESSION_TYPES.SMS)
    .messages({
      'string.base': 'Session type must be a string',
      'any.only': `Invalid session type. Must be one of: ${daisySessionTypeValues.join(', ')}`,
    }),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  include_tool_calls: Joi.boolean().default(true),
})
  .or('business_id', 'assistant_phone_number')
  .messages({
    'object.missing':
      'Either business_id or assistant_phone_number is required',
  })
  .options({ abortEarly: false, stripUnknown: true });

const smsInboxSendBodySchema = Joi.object({
  body: Joi.string().trim().min(1).max(3200).required(),
});

const kpiQuerySchema = Joi.object({
  start_date: Joi.string().isoDate().required().messages({
    'string.isoDate': 'start_date must be a valid ISO 8601 date',
    'any.required': 'start_date is required',
  }),
  end_date: Joi.string().isoDate().required().messages({
    'string.isoDate': 'end_date must be a valid ISO 8601 date',
    'any.required': 'end_date is required',
  }),
  reservation_statuses: Joi.string().optional(),
})
  .custom((value, helpers) => {
    if (new Date(value.end_date) < new Date(value.start_date)) {
      return helpers.error('any.invalid', {
        message: 'end_date must be >= start_date',
      });
    }
    return value;
  })
  .messages({
    'any.invalid': 'end_date must be >= start_date',
  });

const analyticsSummarySchema = Joi.object({
  hotel_ids: Joi.array().items(Joi.string().uuid()).optional(),
  start_date: Joi.string().isoDate().optional(),
  end_date: Joi.string().isoDate().optional(),
  notification_time: Joi.string()
    .pattern(/^\d{2}:\d{2}$/)
    .default('21:00')
    .messages({
      'string.pattern.base': 'notification_time must be in HH:mm format',
    }),
  cron_window_minutes: Joi.number().integer().min(1).max(1440).default(30),
}).options({ stripUnknown: true });

export {
  analyticsSummarySchema,
  channelHistoryQuerySchema,
  createSessionSchema,
  getConversationHistoryQuerySchema,
  getConversationMessagesQuerySchema,
  kpiQuerySchema,
  smsInboxPaginationQuerySchema,
  smsInboxSendBodySchema,
};
