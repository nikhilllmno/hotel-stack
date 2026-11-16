import Joi from 'joi';
import { BadRequestError } from '../errors/BadRequestError';
import {
  Shift4CardTokenRequest,
  ThreeDSecureAuthenticationSource,
  ThreeDSecureEcommIndicator,
  ThreeDSecureProgramProtocol,
} from '../types/shift4';

/**
 * Joi schema for validating Shift4 card token submission request
 */
export const shift4CardTokenSchema = Joi.object({
  payment_id: Joi.string().required().messages({
    'any.required': 'Payment ID is required',
    'string.empty': 'Payment ID cannot be empty',
  }),
  i4go_response: Joi.string().required().messages({
    'any.required': 'i4go_response is required',
    'string.empty': 'i4go_response cannot be empty',
  }),
  i4go_responsecode: Joi.string().required().messages({
    'any.required': 'i4go_responsecode is required',
    'string.empty': 'i4go_responsecode cannot be empty',
  }),
  i4go_responsetext: Joi.string().allow('').optional(),
  i4go_maskedcard: Joi.string().required().messages({
    'any.required': 'i4go_maskedcard is required',
    'string.empty': 'i4go_maskedcard cannot be empty',
  }),
  i4go_uniqueid: Joi.string().required().messages({
    'any.required': 'i4go_uniqueid is required',
    'string.empty': 'i4go_uniqueid cannot be empty',
  }),
  i4go_expirationmonth: Joi.string().required().messages({
    'any.required': 'i4go_expirationmonth is required',
    'string.empty': 'i4go_expirationmonth cannot be empty',
  }),
  i4go_expirationyear: Joi.string().required().messages({
    'any.required': 'i4go_expirationyear is required',
    'string.empty': 'i4go_expirationyear cannot be empty',
  }),
  i4go_cardholdername: Joi.string().allow('').optional(),
  i4go_streetaddress: Joi.string().allow('').optional(),
  i4go_postalcode: Joi.string().allow('').optional(),
  i4go_extendedcarddata: Joi.string().allow('').optional(),
  i4go_cardtype: Joi.string().required().messages({
    'any.required': 'i4go_cardtype is required',
    'string.empty': 'i4go_cardtype cannot be empty',
  }),
  i4go_metatoken: Joi.string().allow('').optional(),
  i4go_utoken: Joi.string().required().messages({
    'any.required': 'i4go_utoken is required',
    'string.empty': 'i4go_utoken cannot be empty',
  }),
  i4go_applepaytoken: Joi.string().allow('').optional(),
  i4go_googlepaytoken: Joi.string().allow('').optional(),
  i4go_signeddata: Joi.string().allow('').optional(),
  // 3DS is per-hotel toggle-able; the frontend only returns this block when 3DS
  // ran during pre-authorization, so the object itself is optional here.
  threeDSecure: Joi.object({
    programProtocol: Joi.string()
      .valid(...Object.values(ThreeDSecureProgramProtocol))
      .optional()
      .messages({
        'string.empty': 'threeDSecure.programProtocol cannot be empty',
        'any.only':
          'threeDSecure.programProtocol must be one of: 1 (EMV 3DS v2.1), 2 (v2.2), 3 (v2.3), 4 (v2.4), 5 (v2.5), 6 (v2.6), 7 (v2.7), 8 (v2.8), 9 (v2.9)',
      }),
    ecommIndicator: Joi.string()
      .valid(...Object.values(ThreeDSecureEcommIndicator))
      .required()
      .messages({
        'any.required': 'threeDSecure.ecommIndicator is required',
        'string.empty': 'threeDSecure.ecommIndicator cannot be empty',
        'any.only':
          'threeDSecure.ecommIndicator must be one of: 5 (Secure electronic commerce), 6 (Authentication attempted), 7 (Non-authenticated security)',
      }),
    trxId: Joi.string().required().messages({
      'any.required': 'threeDSecure.trxId is required',
      'string.empty': 'threeDSecure.trxId cannot be empty',
    }),
    directoryServerTranId: Joi.string().required().messages({
      'any.required': 'threeDSecure.directoryServerTranId is required',
      'string.empty': 'threeDSecure.directoryServerTranId cannot be empty',
    }),
    version: Joi.string().optional().messages({
      'string.empty': 'threeDSecure.version cannot be empty',
    }),
    cryptogram: Joi.string().required().messages({
      'any.required': 'threeDSecure.cryptogram is required',
      'string.empty': 'threeDSecure.cryptogram cannot be empty',
    }),
    xid: Joi.string().required().messages({
      'any.required': 'threeDSecure.xid is required',
      'string.empty': 'threeDSecure.xid cannot be empty',
    }),
    securityLevelIndicator: Joi.string().max(3).optional().messages({
      'string.max':
        'threeDSecure.securityLevelIndicator must be at most 3 characters',
    }),
    authenticationSource: Joi.string()
      .length(1)
      .valid(...Object.values(ThreeDSecureAuthenticationSource))
      .optional()
      .messages({
        'string.length':
          'threeDSecure.authenticationSource must be exactly 1 character',
        'any.only': 'threeDSecure.authenticationSource must be "2" (ACS)',
      }),
  })
    .or('programProtocol', 'version')
    .optional()
    .messages({
      'object.missing':
        'threeDSecure must have at least one of: programProtocol or version',
    }),
}).required();

/**
 * Validates Shift4 card token request data
 * @param data Card token data to validate
 * @throws BadRequestError if validation fails
 */
export function validateShift4CardTokenRequest(
  data: any,
): Shift4CardTokenRequest {
  const { error, value } = shift4CardTokenSchema.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const errorMessages = error.details
      .map((detail) => detail.message)
      .join('; ');
    throw new BadRequestError(errorMessages);
  }

  return value;
}
