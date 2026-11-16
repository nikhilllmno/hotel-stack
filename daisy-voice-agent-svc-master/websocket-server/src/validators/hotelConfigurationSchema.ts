import Joi from 'joi';
import { DiscountType } from '../types/discount';
import {
  DepositType,
  DoorLockSourceOfTruth,
  LockboxBalancePolicy,
  LockboxLogProvider,
  MAX_SISTER_PROPERTIES,
  MAX_SISTER_PROPERTY_TIMEOUT_MS,
  MIN_SISTER_PROPERTY_TIMEOUT_MS,
  ReservationDatePolicyType,
  ROOM_NUMBER_OVERRIDE_NAME_MAX,
  ROOM_NUMBER_OVERRIDE_VALUE_MAX,
  ROOM_NUMBER_OVERRIDES_MAX,
} from '../types/hotelConfiguration';
import { PetFeeStrategyType } from '../types/petFeeStrategy';

const initialDepositTierSchema = Joi.object({
  min_nights: Joi.number().integer().min(1).required(),
  max_nights: Joi.number().integer().min(1).optional().allow(null),
  deposit_type: Joi.string()
    .valid(
      DepositType.FIRST_NIGHT_PLUS_TAX,
      DepositType.FIRST_NIGHT_PLUS_TAX_PLUS_FEE,
      DepositType.PERCENTAGE,
      DepositType.FLAT,
    )
    .required(),
  value: Joi.when('deposit_type', {
    switch: [
      {
        is: DepositType.PERCENTAGE,
        then: Joi.number().min(0).max(100).required(),
      },
      {
        is: DepositType.FLAT,
        then: Joi.number().min(0).required(),
      },
    ],
    otherwise: Joi.optional(),
  }),
}).options({ stripUnknown: true });

// Payment configuration schema
const createPaymentConfigurationSchema = Joi.object({
  auto_charge_days_before: Joi.number()
    .integer()
    .min(0)
    .optional()
    .allow(null)
    .messages({
      'number.base': 'auto_charge_days_before must be a number',
      'number.integer': 'auto_charge_days_before must be an integer',
      'number.min': 'auto_charge_days_before must be a non-negative number',
    }),
  auto_charge_time: Joi.string()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/)
    .optional()
    .allow(null)
    .messages({
      'string.base': 'auto_charge_time must be a string',
      'string.pattern.base':
        'auto_charge_time must be in HH:MM:SS format (24-hour)',
    }),
  charge_at_booking: Joi.boolean().optional().allow(null).messages({
    'boolean.base': 'charge_at_booking must be a boolean',
  }),
}).options({ stripUnknown: true });

const updatePaymentConfigurationSchema = Joi.object({
  auto_charge_days_before: Joi.number()
    .integer()
    .min(0)
    .optional()
    .allow(null)
    .messages({
      'number.base': 'auto_charge_days_before must be a number',
      'number.integer': 'auto_charge_days_before must be an integer',
      'number.min': 'auto_charge_days_before must be a non-negative number',
    }),
  auto_charge_time: Joi.string()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/)
    .optional()
    .allow(null)
    .messages({
      'string.base': 'auto_charge_time must be a string',
      'string.pattern.base':
        'auto_charge_time must be in HH:MM:SS format (24-hour)',
    }),
  charge_at_booking: Joi.boolean().optional().allow(null).messages({
    'boolean.base': 'charge_at_booking must be a boolean',
  }),
}).options({ stripUnknown: true });

const createSameDayBookingConfigurationSchema = Joi.object({
  cutoff_time: Joi.string()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional()
    .allow(null)
    .messages({
      'string.base': 'cutoff_time must be a string',
      'string.pattern.base': 'cutoff_time must be in HH:MM format (24-hour)',
    }),
  allow_same_day_checkin: Joi.boolean().optional().allow(null).messages({
    'boolean.base': 'allow_same_day_checkin must be a boolean',
  }),
  transfer_to_manager_for_same_day: Joi.boolean()
    .optional()
    .allow(null)
    .messages({
      'boolean.base': 'transfer_to_manager_for_same_day must be a boolean',
    }),
}).options({ stripUnknown: true });

const updateSameDayBookingConfigurationSchema = Joi.object({
  cutoff_time: Joi.string()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional()
    .allow(null)
    .messages({
      'string.base': 'cutoff_time must be a string',
      'string.pattern.base': 'cutoff_time must be in HH:MM format (24-hour)',
    }),
  allow_same_day_checkin: Joi.boolean().optional().allow(null).messages({
    'boolean.base': 'allow_same_day_checkin must be a boolean',
  }),
  transfer_to_manager_for_same_day: Joi.boolean()
    .optional()
    .allow(null)
    .messages({
      'boolean.base': 'transfer_to_manager_for_same_day must be a boolean',
    }),
}).options({ stripUnknown: true });

// Room configuration schema
const roomConfigSchema = Joi.object().pattern(
  Joi.string(),
  Joi.object({
    room_number: Joi.string().required().messages({
      'string.base': 'room_number must be a string',
      'any.required': 'room_number is required',
    }),
    door_code: Joi.string().required().messages({
      'string.base': 'door_code must be a string',
      'any.required': 'door_code is required',
    }),
  }),
);

// Onboarding SMS configuration schema for create
const createOnboardingSmsConfigurationSchema = Joi.object({
  enabled: Joi.boolean().required().messages({
    'boolean.base': 'enabled must be a boolean',
    'any.required': 'enabled is required',
  }),
  message_template: Joi.string().required().messages({
    'string.base': 'message_template must be a string',
    'string.empty': 'message_template cannot be empty',
    'any.required': 'message_template is required',
  }),
  check_in_time: Joi.string()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional()
    .allow(null)
    .messages({
      'string.base': 'check_in_time must be a string',
      'string.pattern.base': 'check_in_time must be in HH:MM format (24-hour)',
    }),
  check_out_time: Joi.string()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional()
    .allow(null)
    .messages({
      'string.base': 'check_out_time must be a string',
      'string.pattern.base': 'check_out_time must be in HH:MM format (24-hour)',
    }),
  contact_phone: Joi.string().optional().allow(null).messages({
    'string.base': 'contact_phone must be a string',
  }),
  urgent_contact_phone: Joi.string().optional().allow(null).messages({
    'string.base': 'urgent_contact_phone must be a string',
  }),
  room_config: roomConfigSchema.required().messages({
    'object.base': 'room_config must be an object',
    'any.required': 'room_config is required',
  }),
}).options({ stripUnknown: true });

// Onboarding SMS configuration schema for update
const updateOnboardingSmsConfigurationSchema = Joi.object({
  enabled: Joi.boolean().optional().messages({
    'boolean.base': 'enabled must be a boolean',
  }),
  message_template: Joi.string().optional().messages({
    'string.base': 'message_template must be a string',
    'string.empty': 'message_template cannot be empty',
  }),
  check_in_time: Joi.string()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional()
    .allow(null)
    .messages({
      'string.base': 'check_in_time must be a string',
      'string.pattern.base': 'check_in_time must be in HH:MM format (24-hour)',
    }),
  check_out_time: Joi.string()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional()
    .allow(null)
    .messages({
      'string.base': 'check_out_time must be a string',
      'string.pattern.base': 'check_out_time must be in HH:MM format (24-hour)',
    }),
  contact_phone: Joi.string().optional().allow(null).messages({
    'string.base': 'contact_phone must be a string',
  }),
  urgent_contact_phone: Joi.string().optional().allow(null).messages({
    'string.base': 'urgent_contact_phone must be a string',
  }),
  room_config: roomConfigSchema.optional().messages({
    'object.base': 'room_config must be an object',
  }),
}).options({ stripUnknown: true });

const lengthOfStayDiscountRuleSchema = Joi.object({
  unit_group_ids: Joi.array()
    .items(
      Joi.number().integer().messages({
        'number.base': 'each unit_group_id must be a number',
        'number.integer': 'each unit_group_id must be an integer',
      }),
    )
    .optional()
    .messages({
      'array.base': 'unit_group_ids must be an array',
    }),
  min_occupancy: Joi.number().integer().min(1).optional().messages({
    'number.base': 'min_occupancy must be a number',
    'number.integer': 'min_occupancy must be an integer',
    'number.min': 'min_occupancy must be at least 1',
  }),
  max_occupancy: Joi.number().integer().min(1).optional().allow(null).messages({
    'number.base': 'max_occupancy must be a number',
    'number.integer': 'max_occupancy must be an integer',
    'number.min': 'max_occupancy must be at least 1',
  }),
  min_nights: Joi.number().integer().required().min(1).messages({
    'number.base': 'min_nights must be a number',
    'number.integer': 'min_nights must be an integer',
    'any.required': 'min_nights is required',
    'number.min': 'min_nights must be at least 1',
  }),
  max_nights: Joi.number().integer().required().min(1).allow(null).messages({
    'number.base': 'max_nights must be a number',
    'number.integer': 'max_nights must be an integer',
    'any.required': 'max_nights is required',
    'number.min': 'max_nights must be at least 1',
  }),
  discount_type: Joi.string()
    .valid(DiscountType.FLAT, DiscountType.PERCENTAGE)
    .required()
    .messages({
      'any.only': 'discount_type must be either flat or percentage',
      'any.required': 'discount_type is required',
    }),
  discount_value: Joi.number()
    .min(0)
    .when('discount_type', {
      is: DiscountType.PERCENTAGE,
      then: Joi.number().max(100).messages({
        'number.max':
          'discount_value must be at most 100 for percentage discounts',
      }),
    })
    .required()
    .messages({
      'number.base': 'discount_value must be a number',
      'number.min': 'discount_value must be at least 0',
      'any.required': 'discount_value is required',
    }),
});

const createLengthOfStayDiscountPolicySchema = Joi.object({
  enabled: Joi.boolean().required().messages({
    'boolean.base': 'enabled must be a boolean',
    'any.required': 'enabled is required',
  }),
  rules: Joi.array()
    .items(lengthOfStayDiscountRuleSchema)
    .required()
    .min(1)
    .messages({
      'array.base': 'rules must be an array',
      'array.min': 'rules must have at least one item',
      'object.base': 'rules must be an array of objects',
      'array.required': 'rules is required',
    }),
}).options({ stripUnknown: true });

const updateLengthOfStayDiscountPolicySchema = Joi.object({
  enabled: Joi.boolean().optional().messages({
    'boolean.base': 'enabled must be a boolean',
  }),
  rules: Joi.array()
    .items(lengthOfStayDiscountRuleSchema)
    .optional()
    .allow(null)
    .messages({
      'array.base': 'rules must be an array',
      'array.min': 'rules must have at least one item',
      'object.base': 'rules must be an array of objects',
    }),
}).options({ stripUnknown: true });

const petFeeRoomTypeRuleSchema = Joi.object({
  room_type_ids: Joi.array().items(Joi.string()).min(1).required().messages({
    'array.base': 'room_type_ids must be an array',
    'array.min': 'room_type_ids must have at least one item',
    'any.required': 'room_type_ids is required',
  }),
  strategy: Joi.string()
    .valid(
      PetFeeStrategyType.PerNightPerPet,
      PetFeeStrategyType.PerNight,
      PetFeeStrategyType.FlatFee,
      PetFeeStrategyType.PerNightPerPetWithDiscountedUnits,
      PetFeeStrategyType.PerPetFlatFee,
    )
    .required()
    .messages({
      'string.base': 'strategy must be a string',
      'any.only':
        'strategy must be per_night_per_pet, per_night, flat_fee, per_night_per_pet_with_discounted_units or per_pet_flat_fee',
      'any.required': 'strategy is required',
    }),
  fee_amount: Joi.number().min(0).required().messages({
    'number.base': 'fee_amount must be a number',
    'number.min': 'fee_amount must be non-negative',
    'any.required': 'fee_amount is required',
  }),
  max_pets_per_room: Joi.number()
    .integer()
    .min(1)
    .optional()
    .allow(null)
    .messages({
      'number.base': 'max_pets_per_room must be a number',
      'number.integer': 'max_pets_per_room must be an integer',
      'number.min': 'max_pets_per_room must be at least 1',
    }),
}).options({ stripUnknown: true });

const createPetFeeConfigurationSchema = Joi.object({
  strategy: Joi.string()
    .valid(
      PetFeeStrategyType.PerNightPerPet,
      PetFeeStrategyType.FlatFee,
      PetFeeStrategyType.PerNightPerPetWithDiscountedUnits,
      PetFeeStrategyType.PerPetFlatFee,
    )
    .required()
    .messages({
      'string.base': 'strategy must be a string',
      'any.only':
        'strategy must be per_night_per_pet, flat_fee, per_night_per_pet_with_discounted_units or per_pet_flat_fee',
      'any.required': 'strategy is required',
    }),
  fee_amount: Joi.number().min(0).required().messages({
    'number.base': 'fee_amount must be a number',
    'number.min': 'fee_amount must be non-negative',
    'any.required': 'fee_amount is required',
  }),
  max_pets_per_room: Joi.number()
    .integer()
    .min(1)
    .optional()
    .allow(null)
    .messages({
      'number.base': 'max_pets_per_room must be a number',
      'number.integer': 'max_pets_per_room must be an integer',
      'number.min': 'max_pets_per_room must be at least 1',
    }),
  discounted_fee_amount: Joi.number().min(0).optional().allow(null).messages({
    'number.base': 'discounted_fee_amount must be a number',
    'number.min': 'discounted_fee_amount must be non-negative',
  }),
  discounted_unit_group_ids: Joi.array()
    .items(
      Joi.number().integer().messages({
        'number.base': 'each discounted_unit_group_id must be a number',
        'number.integer': 'each discounted_unit_group_id must be an integer',
      }),
    )
    .optional()
    .messages({
      'array.base': 'discounted_unit_group_ids must be an array',
    }),
  room_type_overrides: Joi.array()
    .items(petFeeRoomTypeRuleSchema)
    .optional()
    .messages({
      'array.base': 'room_type_overrides must be an array',
    }),
  mews_pet_product_id: Joi.string().optional().allow(null).messages({
    'string.base': 'mews_pet_product_id must be a string',
  }),
}).options({ stripUnknown: true });

const updatePetFeeConfigurationSchema = Joi.object({
  strategy: Joi.string()
    .valid(
      PetFeeStrategyType.PerNightPerPet,
      PetFeeStrategyType.FlatFee,
      PetFeeStrategyType.PerNightPerPetWithDiscountedUnits,
      PetFeeStrategyType.PerPetFlatFee,
    )
    .optional()
    .messages({
      'string.base': 'strategy must be a string',
      'any.only':
        'strategy must be per_night_per_pet, flat_fee, per_night_per_pet_with_discounted_units or per_pet_flat_fee',
    }),
  fee_amount: Joi.number().min(0).optional().messages({
    'number.base': 'fee_amount must be a number',
    'number.min': 'fee_amount must be non-negative',
  }),
  max_pets_per_room: Joi.number()
    .integer()
    .min(1)
    .optional()
    .allow(null)
    .messages({
      'number.base': 'max_pets_per_room must be a number',
      'number.integer': 'max_pets_per_room must be an integer',
      'number.min': 'max_pets_per_room must be at least 1',
    }),
  discounted_fee_amount: Joi.number().min(0).optional().allow(null).messages({
    'number.base': 'discounted_fee_amount must be a number',
    'number.min': 'discounted_fee_amount must be non-negative',
  }),
  discounted_unit_group_ids: Joi.array()
    .items(
      Joi.number().integer().messages({
        'number.base': 'each discounted_unit_group_id must be a number',
        'number.integer': 'each discounted_unit_group_id must be an integer',
      }),
    )
    .optional()
    .messages({
      'array.base': 'discounted_unit_group_ids must be an array',
    }),
  room_type_overrides: Joi.array()
    .items(petFeeRoomTypeRuleSchema)
    .optional()
    .messages({
      'array.base': 'room_type_overrides must be an array',
    }),
  mews_pet_product_id: Joi.string().optional().allow(null).messages({
    'string.base': 'mews_pet_product_id must be a string',
  }),
}).options({ stripUnknown: true });

// Call forwarding rule schema
const callForwardingRuleSchema = Joi.object({
  priority: Joi.number().integer().min(0).required().messages({
    'number.base': 'priority must be a number',
    'number.integer': 'priority must be an integer',
    'number.min': 'priority must be at least 0',
    'any.required': 'priority is required',
  }),
  phone_number: Joi.string()
    .trim()
    .pattern(/^\+[1-9]\d{1,14}$/)
    .required()
    .messages({
      'string.base': 'phone_number must be a string',
      'string.empty': 'phone_number cannot be empty',
      'string.pattern.base':
        'phone_number must be in E.164 format (e.g. +14155551234)',
      'any.required': 'phone_number is required',
    }),
  label: Joi.string().trim().optional().allow(null, '').messages({
    'string.base': 'label must be a string',
  }),
  conditions: Joi.object({
    days_of_week: Joi.array()
      .items(
        Joi.number().integer().min(0).max(6).messages({
          'number.base': 'each day_of_week must be a number',
          'number.integer': 'each day_of_week must be an integer',
          'number.min':
            'day_of_week must be between 0 (Sunday) and 6 (Saturday)',
          'number.max':
            'day_of_week must be between 0 (Sunday) and 6 (Saturday)',
        }),
      )
      .optional()
      .messages({
        'array.base': 'days_of_week must be an array',
      }),
    specific_dates: Joi.array()
      .items(
        Joi.string()
          .pattern(/^\d{4}-\d{2}-\d{2}$/)
          .messages({
            'string.pattern.base':
              'each specific_date must be in YYYY-MM-DD format',
          }),
      )
      .optional()
      .messages({
        'array.base': 'specific_dates must be an array',
      }),
    time_range: Joi.object({
      start: Joi.string()
        .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
        .required()
        .messages({
          'string.base': 'time_range.start must be a string',
          'string.pattern.base':
            'time_range.start must be in HH:MM format (24-hour)',
          'any.required': 'time_range.start is required',
        }),
      end: Joi.string()
        .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
        .required()
        .messages({
          'string.base': 'time_range.end must be a string',
          'string.pattern.base':
            'time_range.end must be in HH:MM format (24-hour)',
          'any.required': 'time_range.end is required',
        }),
    })
      .optional()
      .messages({
        'object.base': 'time_range must be an object',
      }),
  })
    .required()
    .messages({
      'object.base': 'conditions must be an object',
      'any.required': 'conditions is required',
    }),
  enabled: Joi.boolean().required().messages({
    'boolean.base': 'enabled must be a boolean',
    'any.required': 'enabled is required',
  }),
}).options({ stripUnknown: true });

const createCallForwardingConfigurationSchema = Joi.object({
  enabled: Joi.boolean().required().messages({
    'boolean.base': 'enabled must be a boolean',
    'any.required': 'enabled is required',
  }),
  default_phone_number: Joi.string()
    .trim()
    .pattern(/^\+[1-9]\d{1,14}$/)
    .required()
    .messages({
      'string.base': 'default_phone_number must be a string',
      'string.empty': 'default_phone_number cannot be empty',
      'string.pattern.base':
        'default_phone_number must be in E.164 format (e.g. +14155551234)',
      'any.required': 'default_phone_number is required',
    }),
  rules: Joi.array().items(callForwardingRuleSchema).required().messages({
    'array.base': 'rules must be an array',
    'any.required': 'rules is required',
  }),
}).options({ stripUnknown: true });

const updateCallForwardingConfigurationSchema = Joi.object({
  enabled: Joi.boolean().optional().messages({
    'boolean.base': 'enabled must be a boolean',
  }),
  default_phone_number: Joi.string()
    .trim()
    .pattern(/^\+[1-9]\d{1,14}$/)
    .optional()
    .messages({
      'string.base': 'default_phone_number must be a string',
      'string.empty': 'default_phone_number cannot be empty',
      'string.pattern.base':
        'default_phone_number must be in E.164 format (e.g. +14155551234)',
    }),
  rules: Joi.array().items(callForwardingRuleSchema).optional().messages({
    'array.base': 'rules must be an array',
  }),
}).options({ stripUnknown: true });

// Hotel configuration schema for both create and update requests
const hotelConfigurationSchema = Joi.object({
  hotel_id: Joi.string()
    .trim()
    .when('$isUpdate', {
      is: true,
      then: Joi.forbidden().messages({
        'any.unknown': 'hotel_id cannot be updated',
      }),
      otherwise: Joi.required().messages({
        'string.base': 'hotel_id must be a string',
        'string.empty': 'hotel_id cannot be empty',
        'any.required': 'hotel_id is required',
      }),
    }),
  payment_configuration: Joi.when('$isUpdate', {
    is: true,
    then: updatePaymentConfigurationSchema.optional().allow(null),
    otherwise: createPaymentConfigurationSchema.optional().allow(null),
  }).messages({
    'object.base': 'payment_configuration must be an object',
  }),
  same_day_booking_configuration: Joi.when('$isUpdate', {
    is: true,
    then: updateSameDayBookingConfigurationSchema.optional().allow(null),
    otherwise: createSameDayBookingConfigurationSchema.optional().allow(null),
  }).messages({
    'object.base': 'same_day_booking_configuration must be an object',
  }),
  reservation_date_policy: Joi.object({
    date_offset_days: Joi.number().integer().min(1).required().messages({
      'number.base': 'date_offset_days must be a number',
      'number.integer': 'date_offset_days must be an integer',
      'number.min': 'date_offset_days must be at least 1',
      'any.required': 'date_offset_days is required',
    }),
    reservation_policy: Joi.string()
      .valid(
        ReservationDatePolicyType.ESCALATE_TO_MANAGER,
        ReservationDatePolicyType.NOT_ALLOWED,
      )
      .required()
      .messages({
        'any.only':
          'reservation_policy must be escalate_to_manager or not_allowed',
        'any.required': 'reservation_policy is required',
      }),
  })
    .optional()
    .allow(null)
    .messages({
      'object.base': 'reservation_date_policy must be an object',
    }),
  onboarding_sms_configuration: Joi.when('$isUpdate', {
    is: true,
    then: updateOnboardingSmsConfigurationSchema.optional().allow(null),
    otherwise: createOnboardingSmsConfigurationSchema.optional().allow(null),
  }).messages({
    'object.base': 'onboarding_sms_configuration must be an object',
  }),
  last_daily_message: Joi.object({
    message_id: Joi.alternatives()
      .try(Joi.number().integer(), Joi.string())
      .required()
      .messages({
        'alternatives.match': 'message_id must be an integer or a string',
        'any.required': 'message_id is required',
      }),
    date: Joi.string().required().messages({
      'string.base': 'date must be a string',
      'string.empty': 'date cannot be empty',
      'any.required': 'date is required',
    }),
  })
    .optional()
    .allow(null)
    .messages({
      'object.base': 'last_daily_message must be a JSON object',
    }),
  discount_settings: Joi.object({
    expiry_days: Joi.number().integer().required().messages({
      'number.base': 'expiry_days must be a number',
      'number.integer': 'expiry_days must be an integer',
      'any.required': 'expiry_days is required',
    }),
    note: Joi.string().required().messages({
      'string.base': 'note must be a string',
      'string.empty': 'note cannot be empty',
      'any.required': 'note is required',
    }),
    discount_type: Joi.string()
      .valid(DiscountType.FLAT, DiscountType.PERCENTAGE)
      .required()
      .messages({
        'any.only': 'discount_type must be either flat or percentage',
        'any.required': 'discount_type is required',
      }),
    discount_value: Joi.number().required().messages({
      'number.base': 'discount_value must be a number',
      'number.integer': 'discount_value must be an integer',
      'any.required': 'discount_value is required',
    }),
  })
    .optional()
    .allow(null)
    .messages({
      'object.base': 'discount_settings must be a JSON object',
    }),
  cancellation_policy: Joi.object({
    cancellation_deadline_days: Joi.number().integer().required().messages({
      'number.base': 'cancellation_deadline_days must be a number',
      'number.integer': 'cancellation_deadline_days must be an integer',
      'any.required': 'cancellation_deadline_days is required',
    }),
  })
    .optional()
    .allow(null)
    .messages({
      'object.base': 'cancellation_policy must be a JSON object',
    }),
  platform_fee_settings: Joi.object({
    active: Joi.boolean().required().messages({
      'boolean.base': 'active must be a boolean',
      'any.required': 'active is required',
    }),
    value: Joi.number().required().messages({
      'number.base': 'value must be a number',
      'number.integer': 'value must be an integer',
      'any.required': 'value is required',
    }),
    type: Joi.string().required().messages({
      'string.base': 'type must be a string',
      'string.empty': 'type cannot be empty',
      'any.required': 'type is required',
    }),
  })
    .optional()
    .allow(null)
    .messages({
      'object.base': 'platform_fee_settings must be a JSON object',
    }),
  sms_agent_enabled: Joi.boolean().optional().messages({
    'boolean.base': 'sms_agent_enabled must be a boolean',
  }),
  negative_sentiment_followup_enabled: Joi.boolean().optional().messages({
    'boolean.base': 'negative_sentiment_followup_enabled must be a boolean',
  }),
  enable_manager_barge_in: Joi.boolean().optional().allow(null).messages({
    'boolean.base': 'enable_manager_barge_in must be a boolean',
  }),
  manager_routing_timeout_seconds: Joi.number()
    .integer()
    .min(1)
    .optional()
    .allow(null)
    .messages({
      'number.base': 'manager_routing_timeout_seconds must be a number',
      'number.integer': 'manager_routing_timeout_seconds must be an integer',
      'number.min': 'manager_routing_timeout_seconds must be at least 1',
    }),
  transcript_agent_url: Joi.string().uri().optional().allow(null, '').messages({
    'string.base': 'transcript_agent_url must be a string',
    'string.uri': 'transcript_agent_url must be a valid URL',
  }),
  escalation_agent_url: Joi.string().uri().optional().allow(null, '').messages({
    'string.base': 'escalation_agent_url must be a string',
    'string.uri': 'escalation_agent_url must be a valid URL',
  }),
  terms_and_policy_config: Joi.alternatives()
    .try(Joi.object().unknown(true), Joi.array().items(Joi.any()))
    .optional()
    .allow(null)
    .messages({
      'alternatives.match':
        'terms_and_policy_config must be a JSON object or array',
    }),
  length_of_stay_discount_policy: Joi.when('$isUpdate', {
    is: true,
    then: updateLengthOfStayDiscountPolicySchema.optional().allow(null),
    otherwise: createLengthOfStayDiscountPolicySchema.optional().allow(null),
  }).messages({
    'object.base': 'length_of_stay_discount_policy must be a JSON object',
  }),
  pet_fee_configuration: Joi.when('$isUpdate', {
    is: true,
    then: updatePetFeeConfigurationSchema.optional().allow(null),
    otherwise: createPetFeeConfigurationSchema.optional().allow(null),
  }).messages({
    'object.base': 'pet_fee_configuration must be a JSON object',
  }),
  pet_policy_configuration: Joi.object({
    pet_friendly_unit_group_ids: Joi.array()
      .items(
        Joi.number().integer().min(1).messages({
          'number.base': 'each pet_friendly_unit_group_id must be a number',
          'number.integer':
            'each pet_friendly_unit_group_id must be an integer',
          'number.min': 'each pet_friendly_unit_group_id must be at least 1',
        }),
      )
      .required()
      .messages({
        'array.base': 'pet_friendly_unit_group_ids must be an array',
        'any.required': 'pet_friendly_unit_group_ids is required',
      }),
  })
    .optional()
    .allow(null)
    .messages({
      'object.base': 'pet_policy_configuration must be a JSON object',
    }),
  processing_fee_percentage: Joi.number()
    .min(0)
    .max(100)
    .optional()
    .allow(null)
    .messages({
      'number.base': 'processing_fee_percentage must be a number',
      'number.min': 'processing_fee_percentage must be at least 0',
      'number.max': 'processing_fee_percentage must be at most 100',
    }),
  initial_deposit_policy: Joi.when('$isUpdate', {
    is: true,
    then: Joi.object({
      enabled: Joi.boolean().optional(),
      tiers: Joi.array().items(initialDepositTierSchema).optional().allow(null),
    })
      .optional()
      .allow(null),
    otherwise: Joi.object({
      enabled: Joi.boolean().required(),
      tiers: Joi.array().items(initialDepositTierSchema).required().min(1),
    })
      .optional()
      .allow(null),
  }).messages({
    'object.base': 'initial_deposit_policy must be a JSON object',
  }),
  rate_code_config: Joi.object({
    allowed: Joi.array()
      .items(Joi.string().trim().uppercase())
      .required()
      .messages({
        'array.base': 'rate_code_config.allowed must be an array of strings',
        'any.required': 'rate_code_config.allowed is required',
      }),
    full_deposit: Joi.array()
      .items(Joi.string().trim().uppercase())
      .optional()
      .messages({
        'array.base':
          'rate_code_config.full_deposit must be an array of strings',
      }),
  })
    .optional()
    .allow(null)
    .messages({
      'object.base': 'rate_code_config must be a JSON object',
    }),
  call_forwarding_configuration: Joi.when('$isUpdate', {
    is: true,
    then: updateCallForwardingConfigurationSchema.optional().allow(null),
    otherwise: createCallForwardingConfigurationSchema.optional().allow(null),
  }).messages({
    'object.base': 'call_forwarding_configuration must be a JSON object',
  }),
  followup_payment_link_configuration: Joi.object({
    enabled: Joi.boolean().required().messages({
      'boolean.base':
        'followup_payment_link_configuration.enabled must be a boolean',
      'any.required': 'followup_payment_link_configuration.enabled is required',
    }),
    threshold_check_enabled: Joi.boolean().required().messages({
      'boolean.base':
        'followup_payment_link_configuration.threshold_check_enabled must be a boolean',
      'any.required':
        'followup_payment_link_configuration.threshold_check_enabled is required',
    }),
    min_available_rooms_threshold: Joi.number()
      .integer()
      .min(0)
      .required()
      .messages({
        'number.base':
          'followup_payment_link_configuration.min_available_rooms_threshold must be a number',
        'number.integer':
          'followup_payment_link_configuration.min_available_rooms_threshold must be an integer',
        'number.min':
          'followup_payment_link_configuration.min_available_rooms_threshold must be at least 0',
        'any.required':
          'followup_payment_link_configuration.min_available_rooms_threshold is required',
      }),
    threshold_occupancy_mode: Joi.string()
      .valid('requested', 'default')
      .required()
      .messages({
        'any.only':
          'followup_payment_link_configuration.threshold_occupancy_mode must be requested or default',
        'any.required':
          'followup_payment_link_configuration.threshold_occupancy_mode is required',
      }),
  })
    .optional()
    .allow(null)
    .messages({
      'object.base':
        'followup_payment_link_configuration must be a JSON object',
    }),
  escalation_report_configuration: Joi.object({
    period_hours: Joi.number().integer().min(1).required().messages({
      'number.base': 'period_hours must be a number',
      'number.min': 'period_hours must be at least 1',
      'any.required': 'period_hours is required',
    }),
    reporting_time: Joi.string()
      .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
      .required()
      .messages({
        'string.pattern.base': 'reporting_time must be in HH:mm format (24h)',
        'any.required': 'reporting_time is required',
      }),
    cron_window_minutes: Joi.number().integer().min(1).required().messages({
      'number.base': 'cron_window_minutes must be a number',
      'number.min': 'cron_window_minutes must be at least 1',
      'any.required': 'cron_window_minutes is required',
    }),
    reminder_delay_minutes: Joi.number().integer().min(1).required().messages({
      'number.base': 'reminder_delay_minutes must be a number',
      'number.min': 'reminder_delay_minutes must be at least 1',
      'any.required': 'reminder_delay_minutes is required',
    }),
    reminder_resend_count: Joi.number().integer().min(0).required().messages({
      'number.base': 'reminder_resend_count must be a number',
      'number.min': 'reminder_resend_count must be at least 0',
      'any.required': 'reminder_resend_count is required',
    }),
    allowed_emojis: Joi.array()
      .items(Joi.string().trim())
      .min(1)
      .required()
      .messages({
        'array.base': 'allowed_emojis must be an array of emoji strings',
        'array.min': 'allowed_emojis must contain at least one emoji',
        'any.required': 'allowed_emojis is required',
      }),
  })
    .optional()
    .allow(null)
    .messages({
      'object.base': 'escalation_report_configuration must be a JSON object',
    }),
  payment_account_id: Joi.string().trim().optional().allow(null).messages({
    'string.base': 'payment_account_id must be a string',
    'string.empty': 'payment_account_id cannot be empty',
  }),
  // Cloudbeds `sourceID` marking Dextr as the booking source:
  // s-<id> (primary source) or ss-<id>-<0|1> (third-party source).
  dextr_pms_source_id: Joi.string()
    .trim()
    .pattern(/^(s-\d+|ss-\d+-[01])$/)
    .optional()
    .allow(null)
    .messages({
      'string.base': 'dextr_pms_source_id must be a string',
      'string.empty': 'dextr_pms_source_id cannot be empty',
      'string.pattern.base':
        'dextr_pms_source_id must be a Cloudbeds source id: s-<id> or ss-<id>-<0|1>',
    }),
  door_lock_config: Joi.object({
    source_of_truth: Joi.string()
      .valid(...Object.values(DoorLockSourceOfTruth))
      .optional()
      .messages({
        'any.only': 'door_lock_config.source_of_truth must be daisy or alfred',
      }),
    door_lock_custom_field: Joi.string().trim().optional().messages({
      'string.base': 'door_lock_config.door_lock_custom_field must be a string',
    }),
    lockbox_log: Joi.object({
      provider: Joi.string()
        .valid(LockboxLogProvider.DROPBOX_EXCEL)
        .required()
        .messages({
          'any.only':
            'door_lock_config.lockbox_log.provider must be dropbox_excel',
          'any.required': 'door_lock_config.lockbox_log.provider is required',
        }),
      shared_link: Joi.string()
        .trim()
        .pattern(/^https:\/\/([a-z0-9-]+\.)*dropbox\.com\//i)
        .required()
        .messages({
          'string.pattern.base':
            'door_lock_config.lockbox_log.shared_link must be a Dropbox shared link (https://www.dropbox.com/...)',
          'any.required':
            'door_lock_config.lockbox_log.shared_link is required',
        }),
    })
      .optional()
      .allow(null)
      .messages({
        'object.base': 'door_lock_config.lockbox_log must be a JSON object',
      }),
    room_number_overrides: Joi.object()
      .pattern(
        Joi.string(),
        Joi.string()
          .trim()
          .min(1)
          .max(ROOM_NUMBER_OVERRIDE_VALUE_MAX)
          .required()
          .messages({
            'string.base':
              'door_lock_config.room_number_overrides values must be strings',
            'string.empty':
              'door_lock_config.room_number_overrides values cannot be blank',
            'string.max': `door_lock_config.room_number_overrides values must be at most ${ROOM_NUMBER_OVERRIDE_VALUE_MAX} characters`,
          }),
      )
      .max(ROOM_NUMBER_OVERRIDES_MAX)
      // Every key matches the pattern, so key rules live here rather than
      // being silently stripped as unknown keys by stripUnknown.
      .custom((value: Record<string, string>, helpers) => {
        const seen = new Set<string>();
        for (const roomName of Object.keys(value)) {
          const normalized = roomName.trim().toLowerCase();
          if (!normalized) {
            return helpers.message({
              custom:
                'door_lock_config.room_number_overrides room names cannot be blank',
            });
          }
          if (normalized.length > ROOM_NUMBER_OVERRIDE_NAME_MAX) {
            return helpers.message({
              custom: `door_lock_config.room_number_overrides room names must be at most ${ROOM_NUMBER_OVERRIDE_NAME_MAX} characters`,
            });
          }
          if (seen.has(normalized)) {
            return helpers.message({
              custom: `door_lock_config.room_number_overrides lists "${roomName.trim()}" more than once (names ignore case and surrounding spaces)`,
            });
          }
          seen.add(normalized);
        }
        return value;
      })
      .optional()
      .allow(null)
      .messages({
        'object.base':
          'door_lock_config.room_number_overrides must be a JSON object of room name to room number',
        'object.max': `door_lock_config.room_number_overrides can have at most ${ROOM_NUMBER_OVERRIDES_MAX} rooms`,
      }),
    lockbox_balance_policy: Joi.string()
      .valid(...Object.values(LockboxBalancePolicy))
      .optional()
      .allow(null)
      .messages({
        'any.only':
          'door_lock_config.lockbox_balance_policy must be refuse or allow_with_note',
        'string.base':
          'door_lock_config.lockbox_balance_policy must be refuse or allow_with_note',
      }),
  })
    .optional()
    .allow(null)
    .messages({
      'object.base': 'door_lock_config must be a JSON object',
    }),
  cross_sell_configuration: Joi.object({
    enabled: Joi.boolean().required().messages({
      'boolean.base': 'cross_sell_configuration.enabled must be true or false',
      'any.required': 'cross_sell_configuration.enabled is required',
    }),
    sister_properties: Joi.array()
      .items(
        Joi.object({
          // Lowercase so the unique check and the "is it the calling hotel"
          // check compare like Postgres ids.
          hotel_id: Joi.string().trim().lowercase().guid().required().messages({
            'string.guid':
              'cross_sell_configuration.sister_properties[].hotel_id must be a Daisy hotel id (uuid)',
            'any.required':
              'cross_sell_configuration.sister_properties[].hotel_id is required',
          }),
          name: Joi.string().trim().max(100).required().messages({
            'string.empty':
              'cross_sell_configuration.sister_properties[].name cannot be empty',
            'any.required':
              'cross_sell_configuration.sister_properties[].name is required',
          }),
          distance_miles: Joi.number().min(0).optional().messages({
            'number.base':
              'cross_sell_configuration.sister_properties[].distance_miles must be a number',
            'number.min':
              'cross_sell_configuration.sister_properties[].distance_miles cannot be negative',
          }),
          phone_number: Joi.string()
            .trim()
            .pattern(/^\+?[0-9 ().-]{7,25}$/)
            .optional()
            .messages({
              'string.pattern.base':
                'cross_sell_configuration.sister_properties[].phone_number must be a phone number',
            }),
          website: Joi.string()
            .trim()
            .uri({ scheme: ['http', 'https'] })
            .max(500)
            .optional()
            .messages({
              'string.uri':
                'cross_sell_configuration.sister_properties[].website must be an http(s) URL',
              'string.uriCustomScheme':
                'cross_sell_configuration.sister_properties[].website must be an http(s) URL',
            }),
        }),
      )
      .max(MAX_SISTER_PROPERTIES)
      .unique('hotel_id')
      .required()
      .messages({
        'array.base':
          'cross_sell_configuration.sister_properties must be a list',
        'array.max': `cross_sell_configuration.sister_properties can have at most ${MAX_SISTER_PROPERTIES} hotels`,
        'array.unique':
          'cross_sell_configuration.sister_properties lists the same hotel_id more than once',
        'any.required':
          'cross_sell_configuration.sister_properties is required',
      }),
    check_all_sister_properties: Joi.boolean().optional().messages({
      'boolean.base':
        'cross_sell_configuration.check_all_sister_properties must be true or false',
    }),
    timeout_ms: Joi.number()
      .integer()
      .min(MIN_SISTER_PROPERTY_TIMEOUT_MS)
      .max(MAX_SISTER_PROPERTY_TIMEOUT_MS)
      .optional()
      .messages({
        'number.base': 'cross_sell_configuration.timeout_ms must be a number',
        'number.min': `cross_sell_configuration.timeout_ms must be at least ${MIN_SISTER_PROPERTY_TIMEOUT_MS}`,
        'number.max': `cross_sell_configuration.timeout_ms must be at most ${MAX_SISTER_PROPERTY_TIMEOUT_MS}`,
      }),
  })
    .optional()
    .allow(null)
    .messages({
      'object.base': 'cross_sell_configuration must be a JSON object',
    }),
  twilio_configuration: Joi.object({
    twilioAccountSid: Joi.string().trim().required().messages({
      'string.empty': 'twilioAccountSid is required',
      'any.required': 'twilioAccountSid is required',
    }),
    twilioAuthToken: Joi.string().trim().required().messages({
      'string.empty': 'twilioAuthToken is required',
      'any.required': 'twilioAuthToken is required',
    }),
  })
    .optional()
    .allow(null)
    .messages({
      'object.base': 'twilio_configuration must be a JSON object',
    }),
}).options({ stripUnknown: true });

export {
  createOnboardingSmsConfigurationSchema,
  createPaymentConfigurationSchema,
  createSameDayBookingConfigurationSchema,
  hotelConfigurationSchema,
  updateOnboardingSmsConfigurationSchema,
  updatePaymentConfigurationSchema,
  updateSameDayBookingConfigurationSchema,
};
