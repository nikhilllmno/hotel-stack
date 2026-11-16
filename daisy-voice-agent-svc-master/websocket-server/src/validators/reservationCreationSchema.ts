import Joi from 'joi';
import { Reservation as ReservationDTO } from '../dtos/Reservation';
import { NoDataError } from '../errors/NoDataError';

export const requiredString = Joi.string().trim().required();

/**
 * Provider-agnostic required-field checks for creating a reservation in any PMS.
 * If a PMS needs extra required fields, `.concat()` a PMS-specific schema on
 * top of this one rather than duplicating these checks.
 */
export const reservationCreationSchema = Joi.object({
  hotel: Joi.object().required().messages({
    'any.required': 'No hotel found for booking ID',
  }),
  quote: Joi.object().required().messages({
    'any.required': 'No quote found for booking ID',
  }),
  customer: Joi.object({
    first_name: requiredString.messages({
      'any.required': 'No first name found for booking ID',
      'string.empty': 'No first name found for booking ID',
    }),
    phone_number: requiredString.messages({
      'any.required': 'No phone number found for booking ID',
      'string.empty': 'No phone number found for booking ID',
    }),
    email: requiredString.messages({
      'any.required': 'No email found for booking ID',
      'string.empty': 'No email found for booking ID',
    }),
    address: Joi.object({
      postal_code: requiredString.messages({
        'any.required': 'No state or postal code found for booking ID',
        'string.empty': 'No state or postal code found for booking ID',
      }),
      state_or_province: requiredString.messages({
        'any.required': 'No state or postal code found for booking ID',
        'string.empty': 'No state or postal code found for booking ID',
      }),
    })
      .required()
      .unknown(true)
      .messages({
        'any.required': 'No address found for booking ID',
      }),
  })
    .required()
    .unknown(true)
    .messages({
      'any.required': 'No customer found for booking ID',
    }),
})
  .required()
  .unknown(true);

/**
 * Validates a single reservation's provider-agnostic required fields, throwing
 * NoDataError with the offending booking ID for parity with the pre-existing
 * manual checks.
 */
export function validateReservationForCreation(
  reservation: ReservationDTO,
): void {
  const bookingId = reservation.booking_id.toUpperCase();
  const { error } = reservationCreationSchema.validate(reservation, {
    abortEarly: true,
    stripUnknown: false,
  });

  if (error) {
    throw new NoDataError(
      `finalizePmsReservations:: ${error.details[0].message}: ${bookingId}`,
    );
  }
}
