import Joi from 'joi';
import { UpdateCustomerDataBeforePayment } from '../dtos/Customer';
import { BadRequestError } from '../errors/BadRequestError';

const requiredString = Joi.string().trim().required();

/**
 * Joi schema for validating customer data required for Shift4 payment processing
 * All fields are mandatory for Shift4 pre-authorization
 */
export const shift4CustomerDataSchema = Joi.object({
  first_name: requiredString.messages({
    'any.required': 'First name is required for Shift4 payment',
    'string.empty': 'First name cannot be empty',
  }),
  last_name: requiredString.messages({
    'any.required': 'Last name is required for Shift4 payment',
    'string.empty': 'Last name cannot be empty',
  }),
  email: Joi.string().trim().email().required().messages({
    'any.required': 'Email is required for Shift4 payment',
    'string.email': 'Email must be a valid email address',
    'string.empty': 'Email cannot be empty',
  }),
  phone_number: requiredString.messages({
    'any.required': 'Phone number is required for Shift4 payment',
    'string.empty': 'Phone number cannot be empty',
  }),
  address: Joi.object({
    address_first_line: requiredString.messages({
      'any.required': 'Address line 1 is required for Shift4 payment',
      'string.empty': 'Address line 1 cannot be empty',
    }),
    city: requiredString.messages({
      'any.required': 'City is required for Shift4 payment',
      'string.empty': 'City cannot be empty',
    }),
    state_or_province: requiredString.messages({
      'any.required': 'State/Province is required for Shift4 payment',
      'string.empty': 'State/Province cannot be empty',
    }),
    postal_code: requiredString.messages({
      'any.required': 'Postal code is required for Shift4 payment',
      'string.empty': 'Postal code cannot be empty',
    }),
    country: requiredString.messages({
      'any.required': 'Country is required for Shift4 payment',
      'string.empty': 'Country cannot be empty',
    }),
  })
    .required()
    .messages({
      'any.required': 'Address is required for Shift4 payment',
    }),
  billing_address: Joi.object({
    address_first_line: requiredString.messages({
      'any.required': 'Billing Address line 1 is required for Shift4 payment',
      'string.empty': 'Billing Address line 1 cannot be empty',
    }),
    city: requiredString.messages({
      'any.required': 'Billing City is required for Shift4 payment',
      'string.empty': 'Billing City cannot be empty',
    }),
    state_or_province: requiredString.messages({
      'any.required': 'Billing State/Province is required for Shift4 payment',
      'string.empty': 'Billing State/Province cannot be empty',
    }),
    postal_code: requiredString.messages({
      'any.required': 'Billing Postal code is required for Shift4 payment',
      'string.empty': 'Billing Postal code cannot be empty',
    }),
    country: requiredString.messages({
      'any.required': 'Billing Country is required for Shift4 payment',
      'string.empty': 'Billing Country cannot be empty',
    }),
  })
    .required()
    .messages({
      'any.required': 'Billing Address is required for Shift4 payment',
    }),
})
  .required()
  .unknown(true);

/**
 * Validates customer data for Shift4 payment processing
 * @param customerData Customer data to validate
 * @throws BadRequestError if validation fails
 */
export function validateShift4CustomerData(
  customerData: UpdateCustomerDataBeforePayment,
): void {
  const { error } = shift4CustomerDataSchema.validate(customerData, {
    abortEarly: false,
    stripUnknown: false,
  });

  if (error) {
    const errorMessages = error.details
      .map((detail) => detail.message)
      .join('; ');
    throw new BadRequestError(errorMessages);
  }
}
