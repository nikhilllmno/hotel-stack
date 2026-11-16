import Joi from 'joi';

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB

export const createUploadSchema = Joi.object({
  fileName: Joi.string().required().messages({
    'string.base': 'fileName must be a string',
    'any.required': 'fileName is required',
  }),
  contentType: Joi.string().required().messages({
    'string.base': 'contentType must be a string',
    'any.required': 'contentType is required',
  }),
  folder: Joi.string().optional().messages({
    'string.base': 'folder must be a string',
  }),
  fileSize: Joi.number()
    .integer()
    .min(1)
    .max(MAX_FILE_SIZE)
    .optional()
    .messages({
      'number.base': 'fileSize must be a number',
      'number.integer': 'fileSize must be an integer',
      'number.min': 'fileSize must be at least 1 byte',
      'number.max': 'fileSize must not exceed 5GB',
    }),
}).options({ stripUnknown: true });
