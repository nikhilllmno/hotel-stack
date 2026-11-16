import Joi from 'joi';

export const UNKNOWN_CALLER_NAME = 'Unknown caller';

const trimmedRequiredString = Joi.string().trim().required();
const createEscalationSchema = Joi.object({
  message: trimmedRequiredString.messages({
    'string.base': 'Message must be a string',
    'string.empty': 'Message cannot be empty',
    'any.required': 'Message is required',
  }),
  // Callers in a hurry (emergencies especially) often never give a name; the
  // message must still reach staff, so a missing name is not a reason to drop it.
  full_name: Joi.string()
    .trim()
    .empty(['', null])
    .default(UNKNOWN_CALLER_NAME)
    .messages({
      'string.base': 'full_name must be a string',
    }),
}).options({ stripUnknown: true });

export { createEscalationSchema };
