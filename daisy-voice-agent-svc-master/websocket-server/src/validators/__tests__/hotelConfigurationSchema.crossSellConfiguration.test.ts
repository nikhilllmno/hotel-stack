/* global describe, expect, it */
import { hotelConfigurationSchema } from '@/validators/hotelConfigurationSchema';

const HAVEN_ID = '33333333-3333-4333-8333-333333333333';
const MANOR_ID = '44444444-4444-4444-8444-444444444444';

function validate(crossSell: unknown) {
  return hotelConfigurationSchema.validate(
    { cross_sell_configuration: crossSell },
    { context: { isUpdate: true }, abortEarly: false, stripUnknown: true },
  );
}

function errorsFor(crossSell: unknown): string[] {
  return validate(crossSell).error?.details.map((d) => d.message) ?? [];
}

describe('hotelConfigurationSchema cross_sell_configuration', () => {
  it('accepts sister hotels with a name, website, phone and distance', () => {
    const config = {
      enabled: true,
      timeout_ms: 6000,
      sister_properties: [
        {
          hotel_id: HAVEN_ID,
          name: 'The Haven Hotel',
          distance_miles: 0.4,
          phone_number: '+1 (828) 555-0100',
          website: 'https://havenhotel.co',
        },
        { hotel_id: MANOR_ID, name: 'The Blowing Rock Manor' },
      ],
    };
    const { error, value } = validate(config);
    expect(error).toBeUndefined();
    expect(value.cross_sell_configuration).toEqual(config);
  });

  it.each([true, false])(
    'keeps check_all_sister_properties: %s',
    (checkAll) => {
      const config = {
        enabled: true,
        check_all_sister_properties: checkAll,
        sister_properties: [{ hotel_id: HAVEN_ID, name: 'The Haven Hotel' }],
      };
      const { error, value } = validate(config);
      expect(error).toBeUndefined();
      expect(value.cross_sell_configuration).toEqual(config);
    },
  );

  it('stores sister hotel ids in lowercase, so the same hotel in another case is a duplicate', () => {
    const { value } = validate({
      enabled: true,
      sister_properties: [
        { hotel_id: HAVEN_ID.toUpperCase(), name: 'The Haven Hotel' },
      ],
    });
    expect(value.cross_sell_configuration.sister_properties[0].hotel_id).toBe(
      HAVEN_ID,
    );
    expect(
      errorsFor({
        enabled: true,
        sister_properties: [
          { hotel_id: HAVEN_ID, name: 'The Haven Hotel' },
          { hotel_id: HAVEN_ID.toUpperCase(), name: 'Haven again' },
        ],
      }),
    ).toEqual([
      'cross_sell_configuration.sister_properties lists the same hotel_id more than once',
    ]);
  });

  it('rejects a check_all_sister_properties that is not true or false', () => {
    expect(
      errorsFor({
        enabled: true,
        check_all_sister_properties: 'sometimes',
        sister_properties: [],
      }),
    ).toEqual([
      'cross_sell_configuration.check_all_sister_properties must be true or false',
    ]);
  });

  it('accepts null, to turn cross-sell off', () => {
    const { error, value } = validate(null);
    expect(error).toBeUndefined();
    expect(value.cross_sell_configuration).toBeNull();
  });

  it('drops keys it does not know', () => {
    const { value } = validate({
      enabled: true,
      sister_properties: [
        { hotel_id: HAVEN_ID, name: 'The Haven Hotel', api_token: 'nope' },
      ],
      extra: 1,
    });
    expect(value.cross_sell_configuration).toEqual({
      enabled: true,
      sister_properties: [{ hotel_id: HAVEN_ID, name: 'The Haven Hotel' }],
    });
  });

  it.each([
    [
      'enabled is missing',
      { sister_properties: [] },
      'cross_sell_configuration.enabled is required',
    ],
    [
      'sister_properties is missing',
      { enabled: true },
      'cross_sell_configuration.sister_properties is required',
    ],
    [
      'a hotel_id is not a uuid',
      { enabled: true, sister_properties: [{ hotel_id: '16843', name: 'X' }] },
      'cross_sell_configuration.sister_properties[].hotel_id must be a Daisy hotel id (uuid)',
    ],
    [
      'a name is blank',
      {
        enabled: true,
        sister_properties: [{ hotel_id: HAVEN_ID, name: '  ' }],
      },
      'cross_sell_configuration.sister_properties[].name cannot be empty',
    ],
    [
      'a website is not an http(s) URL',
      {
        enabled: true,
        sister_properties: [
          { hotel_id: HAVEN_ID, name: 'Haven', website: 'havenhotel.co' },
        ],
      },
      'cross_sell_configuration.sister_properties[].website must be an http(s) URL',
    ],
    [
      'a phone number has letters',
      {
        enabled: true,
        sister_properties: [
          { hotel_id: HAVEN_ID, name: 'Haven', phone_number: 'call us' },
        ],
      },
      'cross_sell_configuration.sister_properties[].phone_number must be a phone number',
    ],
    [
      'the same hotel is listed twice',
      {
        enabled: true,
        sister_properties: [
          { hotel_id: HAVEN_ID, name: 'Haven' },
          { hotel_id: HAVEN_ID, name: 'Haven again' },
        ],
      },
      'cross_sell_configuration.sister_properties lists the same hotel_id more than once',
    ],
    [
      'there are more than 10 sister hotels',
      {
        enabled: true,
        sister_properties: Array.from({ length: 11 }, (_, i) => ({
          hotel_id: `33333333-3333-4333-8333-3333333333${String(i).padStart(2, '0')}`,
          name: `Hotel ${i}`,
        })),
      },
      'cross_sell_configuration.sister_properties can have at most 10 hotels',
    ],
    [
      'timeout_ms is too short',
      { enabled: true, sister_properties: [], timeout_ms: 200 },
      'cross_sell_configuration.timeout_ms must be at least 1000',
    ],
    [
      'timeout_ms is too long',
      { enabled: true, sister_properties: [], timeout_ms: 30000 },
      'cross_sell_configuration.timeout_ms must be at most 15000',
    ],
  ])('rejects the config when %s', (_label, config, expected) => {
    expect(errorsFor(config)).toEqual([expected]);
  });
});
