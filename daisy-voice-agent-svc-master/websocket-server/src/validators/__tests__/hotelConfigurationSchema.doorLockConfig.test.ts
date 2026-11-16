/* global describe, expect, it */
import { hotelConfigurationSchema } from '@/validators/hotelConfigurationSchema';

const SHARED_LINK =
  'https://www.dropbox.com/scl/fi/abc123/Lockbox%20Log.xlsm?rlkey=k&dl=0';

function validateUpdate(body: Record<string, unknown>) {
  return hotelConfigurationSchema.validate(body, {
    context: { isUpdate: true },
    abortEarly: false,
    stripUnknown: true,
  });
}

describe('hotelConfigurationSchema door_lock_config', () => {
  it('accepts a Dropbox lockbox log and keeps the existing door-lock keys', () => {
    const doorLockConfig = {
      source_of_truth: 'daisy',
      door_lock_custom_field: 'door_code',
      lockbox_log: { provider: 'dropbox_excel', shared_link: SHARED_LINK },
    };

    const { error, value } = validateUpdate({
      door_lock_config: doorLockConfig,
    });

    expect(error).toBeUndefined();
    expect(value.door_lock_config).toEqual(doorLockConfig);
  });

  it('allows clearing the lockbox log or the whole door_lock_config', () => {
    expect(
      validateUpdate({ door_lock_config: { lockbox_log: null } }).error,
    ).toBeUndefined();
    expect(validateUpdate({ door_lock_config: null }).error).toBeUndefined();
  });

  it.each([
    [
      'an unknown provider',
      { provider: 'onedrive', shared_link: SHARED_LINK },
      'door_lock_config.lockbox_log.provider must be dropbox_excel',
    ],
    [
      'a link that is not on Dropbox',
      {
        provider: 'dropbox_excel',
        shared_link: 'https://example.com/www.dropbox.com/log.xlsm',
      },
      'must be a Dropbox shared link',
    ],
    [
      'a plain-http link',
      {
        provider: 'dropbox_excel',
        shared_link: 'http://www.dropbox.com/scl/fi/abc123/log.xlsm',
      },
      'must be a Dropbox shared link',
    ],
    [
      'no shared_link',
      { provider: 'dropbox_excel' },
      'door_lock_config.lockbox_log.shared_link is required',
    ],
  ])('rejects %s', (_case, lockboxLog, message) => {
    const { error } = validateUpdate({
      door_lock_config: { lockbox_log: lockboxLog },
    });

    expect(
      error?.details.map((detail) => detail.message).join(' | '),
    ).toContain(message);
  });

  describe('room_number_overrides', () => {
    function overridesError(overrides: unknown): string | undefined {
      return validateUpdate({
        door_lock_config: { room_number_overrides: overrides },
      })
        .error?.details.map((detail) => detail.message)
        .join(' | ');
    }

    it('accepts room names mapped to room numbers, trimming the numbers', () => {
      const { error, value } = validateUpdate({
        door_lock_config: {
          lockbox_log: { provider: 'dropbox_excel', shared_link: SHARED_LINK },
          room_number_overrides: {
            'Freya Accessible King Retreat': ' 19 ',
            'Garden Cottage': 'C2',
          },
        },
      });

      expect(error).toBeUndefined();
      expect(value.door_lock_config).toEqual({
        lockbox_log: { provider: 'dropbox_excel', shared_link: SHARED_LINK },
        room_number_overrides: {
          'Freya Accessible King Retreat': '19',
          'Garden Cottage': 'C2',
        },
      });
    });

    it('accepts an empty map, null to clear it, and the most rooms allowed', () => {
      expect(overridesError({})).toBeUndefined();
      expect(overridesError(null)).toBeUndefined();
      expect(
        overridesError(
          Object.fromEntries(
            Array.from({ length: 200 }, (_, i) => [`Room ${i}`, String(i)]),
          ),
        ),
      ).toBeUndefined();
    });

    it.each([
      ['an array', ['Freya Accessible King Retreat'], 'must be a JSON object'],
      ['a string', 'Freya=19', 'must be a JSON object'],
      ['a number as the room number', { Freya: 19 }, 'values must be strings'],
      ['a blank room number', { Freya: '   ' }, 'values cannot be blank'],
      ['a null room number', { Freya: null }, 'values must be strings'],
      [
        'a room number over 20 characters',
        { Freya: 'x'.repeat(21) },
        'values must be at most 20 characters',
      ],
      ['a blank room name', { '  ': '19' }, 'room names cannot be blank'],
      [
        'a room name over 100 characters',
        { ['x'.repeat(101)]: '19' },
        'room names must be at most 100 characters',
      ],
      [
        'the same room name twice, ignoring case and spaces',
        {
          'Freya Accessible King Retreat': '19',
          ' FREYA accessible king retreat': '20',
        },
        'lists "FREYA accessible king retreat" more than once',
      ],
      [
        'more than 200 rooms',
        Object.fromEntries(
          Array.from({ length: 201 }, (_, i) => [`Room ${i}`, String(i)]),
        ),
        'can have at most 200 rooms',
      ],
    ])('rejects %s', (_case, overrides, message) => {
      expect(overridesError(overrides)).toContain(message);
    });
  });

  it('rejects an unknown source_of_truth', () => {
    const { error } = validateUpdate({
      door_lock_config: { source_of_truth: 'remotelock' },
    });

    expect(error?.message).toContain(
      'door_lock_config.source_of_truth must be daisy or alfred',
    );
  });

  describe('lockbox_balance_policy', () => {
    it.each([['refuse'], ['allow_with_note'], [null]])(
      'accepts %j and keeps it',
      (policy) => {
        const { error, value } = validateUpdate({
          door_lock_config: { lockbox_balance_policy: policy },
        });

        expect(error).toBeUndefined();
        expect(value.door_lock_config).toEqual({
          lockbox_balance_policy: policy,
        });
      },
    );

    it.each([['allow'], [''], [true]])('rejects %j', (policy) => {
      const { error } = validateUpdate({
        door_lock_config: { lockbox_balance_policy: policy },
      });

      expect(error?.message).toContain(
        'door_lock_config.lockbox_balance_policy must be refuse or allow_with_note',
      );
    });
  });
});
