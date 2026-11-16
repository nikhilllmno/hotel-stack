import Joi from 'joi';
import { SortOrder } from '../types/enums';

export const getDebugConversationsQuerySchema = Joi.object({
  phone_number: Joi.string().optional(),
  hotel_id: Joi.string().uuid().optional(),
  limit: Joi.number().integer().positive().default(100),
  sort_order: Joi.string()
    .valid(SortOrder.ASC, SortOrder.DESC)
    .default(SortOrder.DESC),
  start_time: Joi.date().optional(),
  end_time: Joi.date().optional(),
}).options({ stripUnknown: true, abortEarly: false });
