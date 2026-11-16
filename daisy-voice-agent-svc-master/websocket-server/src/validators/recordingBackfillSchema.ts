import Joi from 'joi';

export const recordingBackfillSchema = Joi.object({
  date: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required()
    .messages({
      'any.required': 'date is required (YYYY-MM-DD in each hotel timezone)',
      'string.pattern.base': 'date must be YYYY-MM-DD',
    }),
}).options({ stripUnknown: true, abortEarly: false });

export type RecordingBackfillBody = {
  date: string;
};

export const recordingBackfillConversationSchema = Joi.object({
  conversation_id: Joi.string().uuid().required().messages({
    'any.required': 'conversation_id is required',
    'string.guid': 'conversation_id must be a valid UUID',
  }),
}).options({ stripUnknown: true, abortEarly: false });

export type RecordingBackfillConversationBody = {
  conversation_id: string;
};
