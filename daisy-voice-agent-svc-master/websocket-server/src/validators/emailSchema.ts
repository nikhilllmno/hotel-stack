import Joi from 'joi';

const sendEmailSchema = Joi.object({
  to: Joi.string().email().required().messages({
    'string.email': 'to must be a valid email address',
    'any.required': 'to is required',
  }),
  templateName: Joi.string().trim().required().messages({
    'string.base': 'templateName must be a string',
    'string.empty': 'templateName cannot be empty',
    'any.required': 'templateName is required',
  }),
  subject: Joi.string().trim().required().messages({
    'string.base': 'subject must be a string',
    'string.empty': 'subject cannot be empty',
    'any.required': 'subject is required',
  }),
  variables: Joi.object().default({}).messages({
    'object.base': 'variables must be an object',
  }),
  cc: Joi.array().items(Joi.string().email()).optional().messages({
    'array.base': 'cc must be an array of email addresses',
  }),
  bcc: Joi.array().items(Joi.string().email()).optional().messages({
    'array.base': 'bcc must be an array of email addresses',
  }),
}).options({ stripUnknown: true });

export { sendEmailSchema };
