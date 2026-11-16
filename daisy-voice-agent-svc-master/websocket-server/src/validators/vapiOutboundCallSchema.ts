import Joi from 'joi';

/**
 * Body for POST /vapi/outbound-call — maps to Vapi POST /call.
 * @see https://docs.vapi.ai/calls/outbound-calling
 */
export const vapiOutboundCallSchema = Joi.object({
  /** Empty string from tools is treated as missing (use assistant or a non-empty id). */
  assistant_id: Joi.string().trim().empty('').optional(),
  assistant: Joi.object().unknown(true).optional(),
  phone_number_id: Joi.string()
    .trim()
    .required()
    .custom((value, helpers) => {
      const v = value.replace(/\u200c|\u200b/g, '').trim();
      // Vapi expects the Phone Number resource id (UUID), not E.164
      if (/^\+\d{8,20}$/.test(v)) {
        return helpers.error('any.invalid');
      }
      return v;
    })
    .messages({
      'any.required': 'phone_number_id is required',
      'string.empty': 'phone_number_id cannot be empty',
      'any.invalid':
        'phone_number_id must be the Vapi Phone Number ID (UUID from Dashboard → Phone Numbers), not a +1… number. List IDs: GET https://api.vapi.ai/phone-number with your private API key.',
    }),
  customer_number: Joi.string().trim().required().messages({
    'any.required': 'customer_number is required (E.164, e.g. +15551234567)',
    'string.empty': 'customer_number cannot be empty',
  }),
  /** Sets assistantOverrides.firstMessage on the Vapi call */
  message: Joi.string().allow('').optional(),
  schedule_plan: Joi.object({
    earliestAt: Joi.string().optional(),
    latestAt: Joi.string().optional(),
  })
    .optional()
    .unknown(true),
  /** Merged into Vapi assistantOverrides (message still sets firstMessage when provided) */
  assistant_overrides: Joi.object().unknown(true).optional(),
})
  .or('assistant_id', 'assistant')
  .messages({
    'object.missing': 'Either assistant_id or assistant is required',
  })
  .options({ stripUnknown: true });

export type VapiOutboundCallBody = {
  assistant_id?: string;
  assistant?: Record<string, unknown>;
  phone_number_id: string;
  customer_number: string;
  message?: string;
  schedule_plan?: { earliestAt?: string; latestAt?: string };
  assistant_overrides?: Record<string, unknown>;
};
