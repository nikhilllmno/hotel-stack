import Joi from 'joi';

export const refundRequestSchema = Joi.object({
  refundAmount: Joi.number().positive().precision(2).required().messages({
    'number.base': 'Refund amount must be a number',
    'number.positive': 'Refund amount must be positive',
    'any.required': 'Refund amount is required',
  }),
  reason: Joi.string().max(500).optional().messages({
    'string.max': 'Reason cannot exceed 500 characters',
  }),
  initiatedBy: Joi.string().optional(),
  sendGuestNotification: Joi.boolean().optional(),
});
