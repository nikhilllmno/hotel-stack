import { Query } from 'express-serve-static-core';
import Joi from 'joi';
import { SessionType } from '../dtos/enum/SessionType';
import { BadRequestError } from '../errors/BadRequestError';
import {
  GetAvailabilityRequestParams,
  GetRateCalendarRequestParams,
  GetSingleRoomAvailabilityRequestParams,
  GetWebAvailabilityRequestParams,
} from '../models/request/availability';
import {
  CheckSisterPropertyAvailabilityRequest,
  CreateMultiRoomReservationRequest,
  CreateRoomReservationRequest,
  CreateWebRoomReservationRequest,
  GetDoorCodeRequest,
  GetLockboxCodeRequest,
  GetReservationDetailsRequest,
  GetReservationStatusInWordsRequest,
  ModifyRoomReservationRequest,
} from '../models/request/roomReservation';
import { PlatformPricing } from '../types/reservation';
import { roundTaxRate } from './helper';

export interface GetAvailabilityQuery extends Query {
  start_date: string;
  end_date: string;
  num_adults: string;
  num_children: string;
}

export interface GetMultiRoomAvailabilityQuery extends Query {
  start_date: string;
  end_date: string;
  num_pets?: string;
}

export interface GetWebMultiRoomAvailabilityQuery extends Query {
  start_date: string;
  end_date: string;
  business_id?: string;
}

export function validateRoomReservationRequest(
  reservationParams: CreateRoomReservationRequest,
): CreateRoomReservationRequest {
  const schema = Joi.object({
    check_in: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required()
      .messages({
        'any.required': 'validateRoomReservationRequest:: Missing check_in',
        'string.pattern.base':
          'validateRoomReservationRequest:: check_in must be in YYYY-MM-DD format',
      }),
    check_out: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required()
      .messages({
        'any.required': 'validateRoomReservationRequest:: Missing check_out',
        'string.pattern.base':
          'validateRoomReservationRequest:: check_out must be in YYYY-MM-DD format',
      }),
    num_adults: Joi.number()
      .required()
      .min(0)
      .options({ convert: true })
      .messages({
        'any.required': 'validateRoomReservationRequest:: Missing num_adults',
        'number.base':
          'validateRoomReservationRequest:: num_adults must be a number',
        'number.min':
          'validateRoomReservationRequest:: num_adults must be a non-negative number',
      }),
    num_children: Joi.number()
      .optional()
      .default(0)
      .min(0)
      .empty('')
      .empty(null)
      .options({ convert: true })
      .messages({
        'number.base':
          'validateRoomReservationRequest:: num_children must be a number',
        'number.min':
          'validateRoomReservationRequest:: num_children must be a non-negative number',
      }),
    num_pets: Joi.number()
      .optional()
      .default(0)
      .min(0)
      .empty('')
      .empty(null)
      .options({ convert: true })
      .messages({
        'number.base':
          'validateRoomReservationRequest:: num_pets must be a number',
        'number.min':
          'validateRoomReservationRequest:: num_pets must be a non-negative number',
      }),
    room_id: Joi.alternatives()
      .try(Joi.number().options({ convert: true }), Joi.string())
      .optional()
      .messages({
        'alternatives.match':
          'validateRoomReservationRequest:: room_id must be a number or string',
      }),
    unit_group_id: Joi.number().optional().options({ convert: true }).messages({
      'number.base':
        'validateRoomReservationRequest:: unit_group_id must be a number',
    }),
    session_type: Joi.string().required().messages({
      'any.required': 'validateRoomReservationRequest:: Missing session_type',
    }),
    customer_first_name: Joi.string().when('session_type', {
      is: Joi.string().valid(SessionType.CALL),
      then: Joi.optional(),
      otherwise: Joi.required().messages({
        'any.required':
          'validateRoomReservationRequest:: Missing customer first name',
      }),
    }),
    customer_last_name: Joi.string().when('session_type', {
      is: Joi.string().valid(SessionType.CALL),
      then: Joi.optional(),
      otherwise: Joi.required().messages({
        'any.required':
          'validateRoomReservationRequest:: Missing customer last name',
      }),
    }),
    customer_phone_number: Joi.string().required().messages({
      'any.required':
        'validateRoomReservationRequest:: Missing customer phone number',
    }),
    customer_email: Joi.string().email().optional(),
    customer_address_state_or_province: Joi.string().optional(),
    customer_address_postal_code: Joi.string().optional(),
    customer_special_request: Joi.string().optional().allow('', null),
    rate_code: Joi.string().optional(), // mandatory for Stayntouch
  });

  const { error, value } = schema.validate(reservationParams, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) {
    throw new BadRequestError(error.message);
  }

  if (!value.room_id && !value.unit_group_id) {
    throw new BadRequestError(
      'validateRoomReservationRequest:: Missing room_id or unit_group_id',
    );
  }

  if (
    value.room_id &&
    value.unit_group_id &&
    value.room_id !== value.unit_group_id
  ) {
    console.warn(
      `validateRoomReservationRequest:: Both room_id (${value.room_id}) and unit_group_id (${value.unit_group_id}) provided with different values. Using room_id.`,
    );
  }

  value.room_id = value.room_id || value.unit_group_id;
  delete value.unit_group_id;

  return value;
}

export function validateMultiRoomReservationRequest(
  reservationParams: CreateMultiRoomReservationRequest,
): CreateMultiRoomReservationRequest {
  const schema = Joi.object({
    check_in: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required()
      .messages({
        'any.required':
          'validateMultiRoomReservationRequest:: Missing check_in',
        'string.pattern.base':
          'validateMultiRoomReservationRequest:: check_in must be in YYYY-MM-DD format',
      }),
    check_out: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required()
      .messages({
        'any.required':
          'validateMultiRoomReservationRequest:: Missing check_out',
        'string.pattern.base':
          'validateMultiRoomReservationRequest:: check_out must be in YYYY-MM-DD format',
      }),
    room_ids: Joi.array()
      .items(
        Joi.alternatives().try(
          Joi.number().options({ convert: true }),
          Joi.string(),
        ),
      )
      .min(1)
      .optional()
      .messages({
        'array.base':
          'validateMultiRoomReservationRequest:: room_ids must be an array',
        'array.min':
          'validateMultiRoomReservationRequest:: room_ids must have at least one item',
      }),
    unit_group_ids: Joi.array()
      .items(
        Joi.alternatives().try(
          Joi.number().options({ convert: true }),
          Joi.string(),
        ),
      )
      .min(1)
      .optional()
      .messages({
        'array.base':
          'validateMultiRoomReservationRequest:: unit_group_ids must be an array',
        'array.min':
          'validateMultiRoomReservationRequest:: unit_group_ids must have at least one item',
      }),
    session_type: Joi.string().required().messages({
      'any.required':
        'validateMultiRoomReservationRequest:: Missing session_type',
    }),
    customer_first_name: Joi.string().when('session_type', {
      is: Joi.string().valid(SessionType.CALL),
      then: Joi.optional(),
      otherwise: Joi.required().messages({
        'any.required':
          'validateMultiRoomReservationRequest:: Missing customer first name',
      }),
    }),
    customer_last_name: Joi.string().when('session_type', {
      is: Joi.string().valid(SessionType.CALL),
      then: Joi.optional(),
      otherwise: Joi.required().messages({
        'any.required':
          'validateMultiRoomReservationRequest:: Missing customer last name',
      }),
    }),
    customer_phone_number: Joi.string().required().messages({
      'any.required':
        'validateMultiRoomReservationRequest:: Missing customer phone number',
    }),
    people_per_room: Joi.object()
      .pattern(
        Joi.string(),
        Joi.array().items(
          Joi.object({
            num_adults: Joi.number().required().options({ convert: true }),
            num_children: Joi.number()
              .optional()
              .default(0)
              .min(0)
              .empty('')
              .empty(null)
              .options({ convert: true })
              .messages({
                'number.base':
                  'validateMultiRoomReservationRequest:: num_children must be a number',
                'number.min':
                  'validateMultiRoomReservationRequest:: num_children must be a non-negative number',
              }),
            num_pets: Joi.number()
              .optional()
              .default(0)
              .min(0)
              .empty('')
              .empty(null)
              .options({ convert: true })
              .messages({
                'number.base':
                  'validateMultiRoomReservationRequest:: num_pets must be a number',
                'number.min':
                  'validateMultiRoomReservationRequest:: num_pets must be a non-negative number',
              }),
          }),
        ),
      )
      .optional()
      .messages({
        'object.base':
          'validateMultiRoomReservationRequest:: Missing people_per_room',
      }),

    people_per_unit_group: Joi.object()
      .pattern(
        Joi.string(),
        Joi.array().items(
          Joi.object({
            num_adults: Joi.number().required().options({ convert: true }),
            num_children: Joi.number()
              .optional()
              .default(0)
              .min(0)
              .empty('')
              .empty(null)
              .options({ convert: true })
              .messages({
                'number.base':
                  'validateMultiRoomReservationRequest:: num_children must be a number',
                'number.min':
                  'validateMultiRoomReservationRequest:: num_children must be a non-negative number',
              }),
            num_pets: Joi.number()
              .optional()
              .default(0)
              .min(0)
              .empty('')
              .empty(null)
              .options({ convert: true })
              .messages({
                'number.base':
                  'validateMultiRoomReservationRequest:: num_pets must be a number',
                'number.min':
                  'validateMultiRoomReservationRequest:: num_pets must be a non-negative number',
              }),
          }),
        ),
      )
      .optional()
      .messages({
        'object.base':
          'validateMultiRoomReservationRequest:: Missing people_per_unit_group',
      }),
    customer_email: Joi.string().email().optional(),
    customer_address_state_or_province: Joi.string().optional(),
    customer_address_postal_code: Joi.string().optional(),
    customer_special_request: Joi.string().optional().allow('', null),
    rate_code: Joi.string().optional(),
    rate_codes_per_room: Joi.object()
      .pattern(Joi.string(), Joi.string())
      .optional(),
  });

  const { error, value } = schema.validate(reservationParams, {
    abortEarly: true,
    stripUnknown: true,
  });
  if (error) {
    throw new BadRequestError(error.message);
  }

  if (!value.room_ids && !value.unit_group_ids) {
    throw new BadRequestError(
      'validateMultiRoomReservationRequest:: Missing room_ids or unit_group_ids',
    );
  }

  if (value.room_ids && value.unit_group_ids) {
    console.warn(
      `validateMultiRoomReservationRequest:: Both room_ids and unit_group_ids provided. Using room_ids.`,
    );
  }

  value.room_ids = value.room_ids || value.unit_group_ids;
  delete value.unit_group_ids;

  if (!value.people_per_room && !value.people_per_unit_group) {
    throw new BadRequestError(
      'validateMultiRoomReservationRequest:: Missing people_per_room or people_per_unit_group',
    );
  }

  if (value.people_per_room && value.people_per_unit_group) {
    console.warn(
      `validateMultiRoomReservationRequest:: Both people_per_room and people_per_unit_group provided. Using people_per_room.`,
    );
  }

  value.people_per_room = value.people_per_room || value.people_per_unit_group;
  delete value.people_per_unit_group;

  return value;
}

const webRoomReservationSchema = Joi.object({
  business_id: Joi.string().required().messages({
    'any.required': 'validateWebRoomReservationRequest:: Missing business_id',
    'string.empty': 'validateWebRoomReservationRequest:: Missing business_id',
  }),
  check_in: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required()
    .messages({
      'any.required': 'validateWebRoomReservationRequest:: Missing check_in',
      'string.empty': 'validateWebRoomReservationRequest:: Missing check_in',
      'string.pattern.base':
        'validateWebRoomReservationRequest:: check_in must be in YYYY-MM-DD format',
    }),
  check_out: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required()
    .messages({
      'any.required': 'validateWebRoomReservationRequest:: Missing check_out',
      'string.empty': 'validateWebRoomReservationRequest:: Missing check_out',
      'string.pattern.base':
        'validateWebRoomReservationRequest:: check_out must be in YYYY-MM-DD format',
    }),
  room_ids: Joi.array()
    .items(Joi.number())
    .min(1)
    .optional()
    .options({ convert: true })
    .messages({
      'array.base':
        'validateWebRoomReservationRequest:: room_ids must be an array',
      'array.min':
        'validateWebRoomReservationRequest:: room_ids must have at least one item',
    }),
  unit_group_ids: Joi.array()
    .items(Joi.number())
    .min(1)
    .optional()
    .options({ convert: true })
    .messages({
      'array.base':
        'validateWebRoomReservationRequest:: unit_group_ids must be an array',
      'array.min':
        'validateWebRoomReservationRequest:: unit_group_ids must have at least one item',
    }),
  people_per_room: Joi.object()
    .pattern(
      Joi.string(),
      Joi.array().items(
        Joi.object({
          num_adults: Joi.number().required().options({ convert: true }),
          num_children: Joi.number()
            .optional()
            .default(0)
            .min(0)
            .empty('')
            .empty(null)
            .options({ convert: true })
            .messages({
              'number.base':
                'validateWebRoomReservationRequest:: num_children must be a number',
              'number.min':
                'validateWebRoomReservationRequest:: num_children must be a non-negative number',
            }),
          num_pets: Joi.number()
            .optional()
            .default(0)
            .min(0)
            .empty('')
            .empty(null)
            .options({ convert: true })
            .messages({
              'number.base':
                'validateWebRoomReservationRequest:: num_pets must be a number',
              'number.min':
                'validateWebRoomReservationRequest:: num_pets must be a non-negative number',
            }),
        }),
      ),
    )
    .optional()
    .messages({
      'object.base':
        'validateWebRoomReservationRequest:: Missing people_per_room',
    }),
  people_per_unit_group: Joi.object()
    .pattern(
      Joi.string(),
      Joi.array().items(
        Joi.object({
          num_adults: Joi.number().required().options({ convert: true }),
          num_children: Joi.number()
            .optional()
            .default(0)
            .min(0)
            .empty('')
            .empty(null)
            .options({ convert: true })
            .messages({
              'number.base':
                'validateWebRoomReservationRequest:: num_children must be a number',
              'number.min':
                'validateWebRoomReservationRequest:: num_children must be a non-negative number',
            }),
          num_pets: Joi.number()
            .optional()
            .default(0)
            .min(0)
            .empty('')
            .empty(null)
            .options({ convert: true })
            .messages({
              'number.base':
                'validateWebRoomReservationRequest:: num_pets must be a number',
              'number.min':
                'validateWebRoomReservationRequest:: num_pets must be a non-negative number',
            }),
        }),
      ),
    )
    .optional()
    .messages({
      'object.base':
        'validateWebRoomReservationRequest:: Missing people_per_unit_group',
    }),
  customer_first_name: Joi.string().required().messages({
    'any.required':
      'validateWebRoomReservationRequest:: Missing customer first name',
    'string.empty':
      'validateWebRoomReservationRequest:: Missing customer first name',
  }),
  customer_last_name: Joi.string().required().messages({
    'any.required':
      'validateWebRoomReservationRequest:: Missing customer last name',
    'string.empty':
      'validateWebRoomReservationRequest:: Missing customer last name',
  }),
  customer_phone_number: Joi.string().required().messages({
    'any.required':
      'validateWebRoomReservationRequest:: Missing customer phone number',
    'string.empty':
      'validateWebRoomReservationRequest:: Missing customer phone number',
  }),
  customer_email: Joi.string().email().required().messages({
    'any.required':
      'validateWebRoomReservationRequest:: Missing customer email',
    'string.empty':
      'validateWebRoomReservationRequest:: Missing customer email',
    'string.email':
      'validateWebRoomReservationRequest:: Invalid customer email format',
  }),
  customer_address_state_or_province: Joi.string().required().messages({
    'any.required':
      'validateWebRoomReservationRequest:: Missing customer address state or province',
    'string.empty':
      'validateWebRoomReservationRequest:: Missing customer address state or province',
  }),
  customer_address_postal_code: Joi.string().required().messages({
    'any.required':
      'validateWebRoomReservationRequest:: Missing customer address postal code',
    'string.empty':
      'validateWebRoomReservationRequest:: Missing customer address postal code',
  }),
  rate_codes_per_room: Joi.object()
    .pattern(Joi.string(), Joi.string())
    .optional(),
  rate_code: Joi.string().optional(),
});

export function validateWebRoomReservationRequest(
  reservationParams: CreateWebRoomReservationRequest,
): CreateWebRoomReservationRequest {
  const { error, value } = webRoomReservationSchema.validate(
    reservationParams,
    {
      abortEarly: false,
      stripUnknown: true,
    },
  );

  if (error) {
    const errorMessage = error.details
      .map((detail) => detail.message)
      .join('; ');
    throw new BadRequestError(errorMessage);
  }

  if (!value.room_ids && !value.unit_group_ids) {
    throw new BadRequestError(
      'validateWebRoomReservationRequest:: Missing room_ids or unit_group_ids',
    );
  }

  if (value.room_ids && value.unit_group_ids) {
    console.warn(
      `validateWebRoomReservationRequest:: Both room_ids and unit_group_ids provided. Using room_ids.`,
    );
  }

  value.room_ids = value.room_ids || value.unit_group_ids;
  delete value.unit_group_ids;

  if (!value.people_per_room && !value.people_per_unit_group) {
    throw new BadRequestError(
      'validateWebRoomReservationRequest:: Missing people_per_room or people_per_unit_group',
    );
  }

  if (value.people_per_room && value.people_per_unit_group) {
    console.warn(
      `validateWebRoomReservationRequest:: Both people_per_room and people_per_unit_group provided. Using people_per_room.`,
    );
  }

  value.people_per_room = value.people_per_room || value.people_per_unit_group;
  delete value.people_per_unit_group;

  return value;
}

export function validateGetReservationDetailsRequestParams(
  params: GetReservationDetailsRequest,
  phoneNumber: string,
  assistantPhoneNumber: string,
): GetReservationDetailsRequest {
  let bookingId = params.booking_id;
  if (bookingId?.trim().toUpperCase().startsWith('BK')) {
    bookingId = bookingId.trim().toUpperCase();
    params.booking_id = bookingId;
  }
  if (!(bookingId || params.last_digits_phone_number || phoneNumber)) {
    throw new BadRequestError(
      'validateGetReservationDetailsRequestParams:: Missing booking_id or last_digits_phone_number or phone_number',
    );
  }
  if (!assistantPhoneNumber) {
    throw new BadRequestError(
      'validateGetReservationDetailsRequestParams:: Assistant phone number is required',
    );
  }
  if (!params.session_type) {
    throw new BadRequestError(
      'validateGetReservationDetailsRequestParams:: Missing session_type',
    );
  }
  if (params.last_digits_phone_number) {
    params.last_digits_phone_number = params.last_digits_phone_number.trim();
  }
  if (params.guest_name) {
    params.guest_name = params.guest_name.trim();
  }
  if (params.check_out_date) {
    const checkOutDate = params.check_out_date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkOutDate)) {
      throw new BadRequestError(
        'validateGetReservationDetailsRequestParams:: check_out_date must be in YYYY-MM-DD format',
      );
    }
    if (!params.guest_name) {
      throw new BadRequestError(
        'Filtering by checkout date is possible only when the guest name is also provided',
      );
    }
    params.check_out_date = checkOutDate;
  }
  if (params.reservation_id_last_four) {
    const lastFour = params.reservation_id_last_four.trim();
    if (!params.guest_name) {
      throw new BadRequestError(
        'Filtering by reservation id is possible only when the guest name is also provided',
      );
    }
    if (lastFour.length !== 4) {
      throw new BadRequestError(
        'validateGetReservationDetailsRequestParams:: reservation_id_last_four must contain exactly 4 characters',
      );
    }
    params.reservation_id_last_four = lastFour;
  }

  return params;
}

/**
 * A door code is looked up either by booking_id, or by guest_name together with
 * check_out_date — never by name alone. booking_id is the id the guest quotes
 * back — a PMS confirmation number (`external_id`/`external_public_id`) for a
 * PMS-backed hotel, or Daisy's own `BK...` id otherwise; both resolve through
 * `findReservationWithDetails`, scoped to the caller's hotel. A name is a weak
 * key for something that opens a physical door and routinely matches several
 * reservations, so the check-out date is required alongside it; the error thrown
 * here is what tells the agent to ask the guest for that date.
 *
 * booking_id wins when supplied — guest_name/check_out_date are then unused.
 *
 * `callerIdLookup`: the hotel answers a request without booking_id by the
 * caller ID (Cloudbeds hotels with `door_lock_config.source_of_truth = daisy`),
 * so neither key is required and guest_name/check_out_date are never read. A
 * blank booking_id then counts as not sent.
 */
export function validateGetDoorCodeRequestParams(
  params: GetDoorCodeRequest,
  assistantPhoneNumber: string,
  { callerIdLookup = false }: { callerIdLookup?: boolean } = {},
): GetDoorCodeRequest {
  const bookingId = optionalText(params.booking_id)?.trim();
  const guestName = params.guest_name?.trim();
  const checkOutDate = params.check_out_date?.trim();

  if (bookingId) {
    params.booking_id = bookingId.toUpperCase().startsWith('BK')
      ? bookingId.toUpperCase()
      : bookingId;
  } else if (callerIdLookup) {
    params.booking_id = undefined;
  } else if (!guestName) {
    throw new BadRequestError(
      'validateGetDoorCodeRequestParams:: Missing booking_id or guest_name',
    );
  } else if (!checkOutDate) {
    throw new BadRequestError(
      'validateGetDoorCodeRequestParams:: check_out_date is required when looking up by guest_name — ask the guest for their check-out date',
    );
  }

  if (
    !callerIdLookup &&
    checkOutDate &&
    !/^\d{4}-\d{2}-\d{2}$/.test(checkOutDate)
  ) {
    throw new BadRequestError(
      'validateGetDoorCodeRequestParams:: check_out_date must be in YYYY-MM-DD format',
    );
  }

  params.guest_name = guestName;
  params.check_out_date = checkOutDate;

  if (!assistantPhoneNumber) {
    throw new BadRequestError(
      'validateGetDoorCodeRequestParams:: Assistant phone number is required',
    );
  }
  if (!params.session_type) {
    throw new BadRequestError(
      'validateGetDoorCodeRequestParams:: Missing session_type',
    );
  }

  return params;
}

/** A text or number field; blank, null and missing all count as not sent. */
function optionalText(value: unknown): string | undefined {
  return value === null || value === undefined || value === ''
    ? undefined
    : String(value);
}

export type GetLockboxCodeRequestParams = {
  session_type: SessionType;
  room_number?: string;
} & (
  | { booking_id: string; customer_name: string }
  | { booking_id?: undefined; booking_phone?: string; last_name?: string }
);

/**
 * With a `booking_id`, `customer_name` is required as before; without one
 * (missing, blank or null), the request is for a phone lookup, with an
 * optional `booking_phone` and `last_name`.
 */
export function validateGetLockboxCodeRequestParams(
  params: GetLockboxCodeRequest,
): GetLockboxCodeRequestParams {
  const schema = Joi.object({
    booking_id: Joi.alternatives()
      .try(Joi.string().trim().max(64).allow(''), Joi.number().integer().min(0))
      .allow(null)
      .messages({
        'alternatives.types': 'booking_id must be a string or a number',
      }),
    room_number: Joi.alternatives()
      .try(Joi.string().trim().max(20).allow(''), Joi.number().integer().min(0))
      .allow(null)
      .messages({
        'alternatives.types': 'room_number must be a string or a number',
      }),
    customer_name: Joi.string().trim().max(200).allow('', null).messages({
      'string.base': 'customer_name must be a string',
    }),
    booking_phone: Joi.alternatives()
      .try(Joi.string().trim().max(40).allow(''), Joi.number().integer().min(0))
      .allow(null)
      .messages({
        'alternatives.types': 'booking_phone must be a string or a number',
      }),
    last_name: Joi.string().trim().max(100).allow('', null).messages({
      'string.base': 'last_name must be a string',
    }),
    session_type: Joi.string().required().messages({
      'any.required': 'Missing session_type',
    }),
  });

  const { error, value } = schema.validate(params, { stripUnknown: true });
  if (error) {
    throw new BadRequestError(
      `validateGetLockboxCodeRequestParams:: ${error.message}`,
    );
  }

  const roomNumber = optionalText(value.room_number);
  const bookingId = optionalText(value.booking_id);
  if (bookingId === undefined) {
    return {
      session_type: value.session_type,
      room_number: roomNumber,
      booking_phone: optionalText(value.booking_phone),
      last_name: optionalText(value.last_name),
    };
  }

  if (value.customer_name === undefined || value.customer_name === null) {
    throw new BadRequestError(
      'validateGetLockboxCodeRequestParams:: Missing customer_name',
    );
  }
  if (value.customer_name === '') {
    throw new BadRequestError(
      'validateGetLockboxCodeRequestParams:: customer_name cannot be empty',
    );
  }
  return {
    session_type: value.session_type,
    booking_id: bookingId.toUpperCase().startsWith('BK')
      ? bookingId.toUpperCase()
      : bookingId,
    customer_name: value.customer_name,
    room_number: roomNumber,
  };
}

export function validateGetSingleRoomAvailabilityRequestParams(
  params: GetAvailabilityQuery,
): GetSingleRoomAvailabilityRequestParams {
  const schema = Joi.object({
    start_date: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required()
      .messages({
        'string.pattern.base': 'start_date must be in YYYY-MM-DD format',
        'any.required': 'Missing required parameter: start_date',
      }),
    end_date: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required()
      .messages({
        'string.pattern.base': 'end_date must be in YYYY-MM-DD format',
        'any.required': 'Missing required parameter: end_date',
      }),
    num_adults: Joi.number().required().options({ convert: true }).messages({
      'any.required': 'Missing num_adults',
      'number.base': 'num_adults must be a number',
    }),
    num_children: Joi.number()
      .optional()
      .default(0)
      .empty(['', null])
      .options({ convert: true }),
    num_pets: Joi.number()
      .optional()
      .default(0)
      .empty(['', null])
      .options({ convert: true }),
    session_type: Joi.string().required().messages({
      'any.required': 'Missing session_type',
    }),
    booking_link: Joi.boolean().optional().default(false),
  });

  const { error, value } = schema.validate(params, { stripUnknown: true });
  if (error) {
    throw new BadRequestError(
      `validateGetSingleRoomAvailabilityRequestParams:: ${error.message}`,
    );
  }
  return value;
}

export function validateGetAllRatesForRoomTypeRequestParams(
  params: GetAvailabilityQuery & { room_id?: string | number },
): {
  availabilityParams: GetSingleRoomAvailabilityRequestParams;
  roomId: number | string;
} {
  const availabilityParams =
    validateGetSingleRoomAvailabilityRequestParams(params);

  const roomTypeSchema = Joi.object({
    room_id: Joi.alternatives()
      .try(Joi.number().options({ convert: true }), Joi.string())
      .required()
      .messages({
        'any.required': 'Missing required parameter: room_id',
        'alternatives.match': 'room_id must be a number or string',
      }),
  });

  const { error, value } = roomTypeSchema.validate(params, {
    stripUnknown: true,
  });
  if (error) {
    throw new BadRequestError(
      `validateGetAllRatesForRoomTypeRequestParams:: ${error.message}`,
    );
  }

  return { availabilityParams, roomId: value.room_id };
}

export function validateGetMultiRoomAvailabilityRequestParams(
  params: GetMultiRoomAvailabilityQuery,
): GetAvailabilityRequestParams {
  const schema = Joi.object({
    start_date: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required()
      .messages({
        'string.pattern.base': 'start_date must be in YYYY-MM-DD format',
        'any.required': 'Missing required parameter: start_date',
      }),
    end_date: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required()
      .messages({
        'string.pattern.base': 'end_date must be in YYYY-MM-DD format',
        'any.required': 'Missing required parameter: end_date',
      }),
    num_pets: Joi.number()
      .optional()
      .default(0)
      .empty(['', null])
      .options({ convert: true }),
    booking_link: Joi.boolean().optional().default(false),
  });

  const { error, value } = schema.validate(params, {
    abortEarly: true,
    stripUnknown: true,
  });
  if (error) {
    throw new BadRequestError(
      `validateGetMultiRoomAvailabilityRequestParams:: ${error.message}`,
    );
  }
  return value;
}

export function validateGetWebRoomAvailabilityRequestParams(
  params: Query,
): GetWebAvailabilityRequestParams {
  // Convert business_id to string if it is a number
  if (typeof params.business_id === 'number') {
    params.business_id = String(params.business_id);
  }
  const schema = Joi.object({
    start_date: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required()
      .messages({
        'string.pattern.base': 'start_date must be in YYYY-MM-DD format',
        'any.required': 'Missing or invalid required parameter: start_date',
      }),
    end_date: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required()
      .messages({
        'string.pattern.base': 'end_date must be in YYYY-MM-DD format',
        'any.required': 'Missing or invalid required parameter: end_date',
      }),
    business_id: Joi.string().required().messages({
      'any.required': 'Missing or invalid required parameter: business_id',
    }),
    num_adults: Joi.number().required().options({ convert: true }).messages({
      'any.required': 'Missing or invalid required parameter: num_adults',
      'number.base': 'num_adults must be a number',
    }),
    num_children: Joi.number()
      .optional()
      .default(0)
      .empty('')
      .empty(null)
      .options({ convert: true })
      .messages({
        'any.required': 'Missing or invalid required parameter: num_children',
        'number.base': 'num_children must be a number',
      }),
    num_rooms: Joi.number().required().options({ convert: true }).messages({
      'any.required': 'Missing or invalid required parameter: num_rooms',
      'number.base': 'num_rooms must be a number',
    }),
  });

  const { error, value } = schema.validate(params, {
    abortEarly: true,
    stripUnknown: true,
  });
  if (error) {
    throw new BadRequestError(
      `validateGetWebRoomAvailabilityRequestParams:: ${error.message}`,
    );
  }
  return value;
}

export function validateGetRateCalendarRequestParams(
  params: Query,
): GetRateCalendarRequestParams {
  const schema = Joi.object({
    business_id: Joi.string().required().messages({
      'any.required': 'Missing or invalid required parameter: business_id',
    }),
    start_date: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required()
      .messages({
        'string.pattern.base': 'start_date must be in YYYY-MM-DD format',
        'any.required': 'Missing or invalid required parameter: start_date',
      }),
    end_date: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required()
      .messages({
        'string.pattern.base': 'end_date must be in YYYY-MM-DD format',
        'any.required': 'Missing or invalid required parameter: end_date',
      }),
  });

  const { error, value } = schema.validate(params, {
    abortEarly: true,
    stripUnknown: true,
  });
  if (error) {
    throw new BadRequestError(
      `validateGetRateCalendarRequestParams:: ${error.message}`,
    );
  }
  return value;
}

export function validateReservationStatusParams(
  params: GetReservationStatusInWordsRequest,
): GetReservationStatusInWordsRequest {
  const bookingIdParam = params.booking_id;
  if (!bookingIdParam) {
    throw new BadRequestError(
      'validateReservationStatusParams:: Missing booking_id',
    );
  }
  if (bookingIdParam.trim().toUpperCase().startsWith('BK')) {
    params.booking_id = bookingIdParam.trim().toUpperCase();
  }
  return params;
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const modifyReservationSchema = Joi.object({
  booking_id: Joi.string().trim().required().messages({
    'any.required': 'modifyReservation: booking_id is required',
    'string.empty': 'modifyReservation: booking_id cannot be empty',
  }),
  check_in: Joi.string().trim().pattern(datePattern).required().messages({
    'any.required': 'modifyReservation: check_in is required',
    'string.pattern.base':
      'modifyReservation: check_in must be in YYYY-MM-DD format',
  }),
  check_out: Joi.string().trim().pattern(datePattern).required().messages({
    'any.required': 'modifyReservation: check_out is required',
    'string.pattern.base':
      'modifyReservation: check_out must be in YYYY-MM-DD format',
  }),
  new_room_type_id: Joi.alternatives()
    .try(Joi.number().integer().options({ convert: true }), Joi.string())
    .optional()
    .empty(['', null])
    .messages({
      'alternatives.match':
        'modifyReservation: new_room_type_id must be a number or string',
    }),
  new_rate_code: Joi.string().trim().empty('').allow(null).optional().messages({
    'string.base': 'modifyReservation: new_rate_code must be a string',
  }),
  room_changed: Joi.boolean().optional(),
  num_pets_to_add: Joi.number().integer().min(1).empty(0).optional().messages({
    'number.base': 'modifyReservation: num_pets_to_add must be a number',
    'number.min': 'modifyReservation: num_pets_to_add must be at least 1',
  }),
  customer_special_request: Joi.string()
    .trim()
    .empty('')
    .allow(null)
    .optional()
    .messages({
      'string.base':
        'modifyReservation: customer_special_request must be a string',
    }),
}).unknown(true);

export function validateModifyReservationRequest(
  body: unknown,
  callerPhoneNumber: string,
): ModifyRoomReservationRequest {
  const { error, value } = modifyReservationSchema.validate(body, {
    abortEarly: false,
  });
  if (error) {
    throw new BadRequestError(error.details.map((d) => d.message).join(', '));
  }
  let bookingId: string = value.booking_id;
  if (bookingId.trim().toUpperCase().startsWith('BK')) {
    bookingId = bookingId.trim().toUpperCase();
  }
  return {
    booking_id: bookingId,
    check_in: value.check_in,
    check_out: value.check_out,
    caller_phone_number: callerPhoneNumber,
    new_room_type_id: value.new_room_type_id,
    new_rate_code: value.new_rate_code,
    room_changed: value.room_changed,
    num_pets_to_add: value.num_pets_to_add,
    customer_special_request: value.customer_special_request,
  };
}

const checkAvailabilityForModificationLiteSchema = Joi.object({
  booking_id: Joi.string().required().messages({
    'any.required':
      'checkAvailabilityForModificationLite: booking_id is required',
    'string.empty':
      'checkAvailabilityForModificationLite: booking_id cannot be empty',
  }),
  start_date: Joi.string().pattern(datePattern).required().messages({
    'any.required':
      'checkAvailabilityForModificationLite: start_date is required',
    'string.pattern.base':
      'checkAvailabilityForModificationLite: start_date must be in YYYY-MM-DD format',
  }),
  end_date: Joi.string().pattern(datePattern).required().messages({
    'any.required':
      'checkAvailabilityForModificationLite: end_date is required',
    'string.pattern.base':
      'checkAvailabilityForModificationLite: end_date must be in YYYY-MM-DD format',
  }),
  room_changed: Joi.boolean().optional(),
}).unknown(true);

export function validateCheckAvailabilityForModificationRequest(
  body: unknown,
  callerPhoneNumber: string,
): ModifyRoomReservationRequest {
  const { error, value } = checkAvailabilityForModificationLiteSchema.validate(
    body,
    { abortEarly: false },
  );
  if (error) {
    throw new BadRequestError(error.details.map((d) => d.message).join(', '));
  }
  return {
    booking_id: value.booking_id,
    check_in: value.start_date,
    check_out: value.end_date,
    caller_phone_number: callerPhoneNumber,
    room_changed: value.room_changed,
  };
}

/**
 * A YYYY-MM-DD string that is a real day. `new Date` rolls "2099-02-30" over
 * to March 1, so the parts are compared back.
 */
function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const calendarDate = (value: string, helpers: Joi.CustomHelpers) =>
  isCalendarDate(value) ? value : helpers.error('any.invalid');

const checkSisterPropertyAvailabilitySchema = Joi.object({
  start_date: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .custom(calendarDate)
    .required()
    .messages({
      'string.pattern.base': 'start_date must be in YYYY-MM-DD format',
      'any.invalid': 'start_date must be a real calendar date',
      'any.required': 'Missing required parameter: start_date',
    }),
  end_date: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .custom(calendarDate)
    .required()
    .messages({
      'string.pattern.base': 'end_date must be in YYYY-MM-DD format',
      'any.invalid': 'end_date must be a real calendar date',
      'any.required': 'Missing required parameter: end_date',
    }),
  num_adults: Joi.number().required().options({ convert: true }).messages({
    'any.required': 'Missing required parameter: num_adults',
    'number.base': 'num_adults must be a number',
  }),
  num_children: Joi.number()
    .optional()
    .default(0)
    .empty(['', null])
    .options({ convert: true }),
  num_pets: Joi.number()
    .optional()
    .default(0)
    .empty(['', null])
    .options({ convert: true }),
}).unknown(true);

export function validateCheckSisterPropertyAvailabilityRequest(
  body: unknown,
): CheckSisterPropertyAvailabilityRequest {
  const { error, value } = checkSisterPropertyAvailabilitySchema.validate(
    body,
    { abortEarly: true, stripUnknown: true },
  );
  if (error) {
    throw new BadRequestError(
      `validateCheckSisterPropertyAvailabilityRequest:: ${error.message}`,
    );
  }
  return value;
}

const platformPricingSchema = Joi.object({
  tax_rate: Joi.number()
    .min(0)
    .max(1)
    .allow(null)
    .optional()
    .options({ convert: true }),
  pet_fee_incl_tax: Joi.number()
    .min(0)
    .allow(null)
    .optional()
    .options({ convert: true }),
  winback_discount_incl_tax: Joi.number()
    .min(0)
    .allow(null)
    .optional()
    .options({ convert: true }),
}).unknown(true);

/**
 * Validates platform_pricing at entry time (before persist). Returns null for null/undefined.
 * Invalid or out-of-range values throw BadRequestError.
 */
export function validatePlatformPricing(
  value: unknown,
): PlatformPricing | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestError('platform_pricing must be an object or null');
  }
  const { error, value: result } = platformPricingSchema.validate(value, {
    stripUnknown: false,
  });
  if (error) {
    throw new BadRequestError(`platform_pricing: ${error.message}`);
  }
  const out = result as PlatformPricing;
  if (typeof out.tax_rate === 'number') {
    out.tax_rate = roundTaxRate(out.tax_rate);
  }
  return out;
}
