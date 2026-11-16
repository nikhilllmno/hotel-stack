import Joi from 'joi';

const requiredString = Joi.string().trim().required();
const reservationReviewQuerySchema = Joi.object({
  reservation_review_id: requiredString,
}).options({ stripUnknown: true });

const reservationReviewBodySchema = Joi.object({
  customer: Joi.object({
    first_name: requiredString,
    last_name: requiredString,
    email: Joi.string().trim().email().required(),
    phone_number: requiredString,
  }).required(),
  address: Joi.object({
    state_or_province: requiredString,
    postal_code: requiredString,
    city: requiredString,
    address_first_line: requiredString,
    country: requiredString,
  }).required(),
  billing_address: Joi.object({
    state_or_province: requiredString,
    postal_code: requiredString,
    city: requiredString,
    address_first_line: requiredString,
    country: requiredString,
  }).optional(),
  /** Optional inline image: { image: base64 string, contentType } — uploaded to S3 and saved on reservation */
  policy_signature: Joi.object({
    image: Joi.string()
      .required()
      .messages({ 'any.required': 'image is required' }),
    contentType: Joi.string()
      .valid('image/png', 'image/jpeg', 'image/jpg', 'image/webp')
      .required()
      .messages({
        'any.only':
          'contentType must be one of image/png, image/jpeg, image/jpg, image/webp',
        'any.required': 'contentType is required',
      }),
  })
    .options({ stripUnknown: true })
    .optional(),
})
  .required()
  .options({ abortEarly: false, stripUnknown: true });

export { reservationReviewBodySchema, reservationReviewQuerySchema };
