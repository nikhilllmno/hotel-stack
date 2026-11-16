import Joi from 'joi';

// Create PMS Provider schema
export const createPmsProviderSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).required().messages({
    'string.base': 'Name must be a string',
    'string.empty': 'Name cannot be empty',
    'string.min': 'Name must be at least 1 character long',
    'string.max': 'Name cannot exceed 255 characters',
    'any.required': 'Name is required',
  }),
  is_active: Joi.boolean().optional().default(false).messages({
    'boolean.base': 'is_active must be a boolean',
  }),
}).options({
  abortEarly: false,
  stripUnknown: true,
});

// Update PMS Provider schema
export const updatePmsProviderSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).optional().messages({
    'string.base': 'Name must be a string',
    'string.empty': 'Name cannot be empty',
    'string.min': 'Name must be at least 1 character long',
    'string.max': 'Name cannot exceed 255 characters',
  }),
  is_active: Joi.boolean().optional().messages({
    'boolean.base': 'is_active must be a boolean',
  }),
})
  .min(1)
  .messages({
    'object.min': 'At least one field must be provided for update',
  })
  .options({
    abortEarly: false,
    stripUnknown: true,
  });

// ID parameter schema
export const pmsProviderIdSchema = Joi.object({
  id: Joi.string().uuid().required().messages({
    'string.base': 'ID must be a string',
    'string.guid': 'ID must be a valid UUID',
    'any.required': 'ID is required',
  }),
}).options({
  abortEarly: false,
  stripUnknown: true,
});

// Name parameter schema
export const pmsProviderNameSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).required().messages({
    'string.base': 'Name must be a string',
    'string.empty': 'Name cannot be empty',
    'string.min': 'Name must be at least 1 character long',
    'string.max': 'Name cannot exceed 255 characters',
    'any.required': 'Name is required',
  }),
}).options({
  abortEarly: false,
  stripUnknown: true,
});
