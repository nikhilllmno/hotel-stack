/* global describe, expect, it */
import {
  createEscalationSchema,
  UNKNOWN_CALLER_NAME,
} from '@/validators/escalationSchema';

const validate = (body: Record<string, unknown>) =>
  createEscalationSchema.validate(body, {
    abortEarly: false,
    stripUnknown: true,
  });

describe('createEscalationSchema', () => {
  it('keeps a real name, trimmed', () => {
    const { error, value } = validate({
      message: 'Please call me back',
      full_name: '  Jamie Rivera  ',
    });
    expect(error).toBeUndefined();
    expect(value).toEqual({
      message: 'Please call me back',
      full_name: 'Jamie Rivera',
    });
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace only', '   '],
    ['tabs and newlines', '\t\n'],
    ['null', null],
  ])(
    'falls back to "Unknown caller" when the name is %s',
    (_label, fullName) => {
      const body: Record<string, unknown> = { message: 'EMERGENCY: flooding' };
      if (fullName !== undefined) body.full_name = fullName;

      const { error, value } = validate(body);

      expect(error).toBeUndefined();
      expect(value).toEqual({
        message: 'EMERGENCY: flooding',
        full_name: UNKNOWN_CALLER_NAME,
      });
    },
  );

  it('still rejects a name that is not a string', () => {
    const { error } = validate({ message: 'Hi', full_name: 42 });
    expect(error?.details.map((d) => d.message)).toEqual([
      'full_name must be a string',
    ]);
  });

  it.each([
    ['missing', undefined, 'Message is required'],
    ['empty', '', 'Message cannot be empty'],
    ['whitespace only', '   ', 'Message cannot be empty'],
    ['not a string', 7, 'Message must be a string'],
  ])('still rejects a message that is %s', (_label, message, expectedError) => {
    const body: Record<string, unknown> = { full_name: 'Jamie Rivera' };
    if (message !== undefined) body.message = message;

    const { error } = validate(body);

    expect(error?.details.map((d) => d.message)).toEqual([expectedError]);
  });

  it('drops fields that are not part of the schema', () => {
    const { value } = validate({
      message: 'Hi',
      full_name: 'Jamie Rivera',
      session_type: 'CALL',
    });
    expect(value).toEqual({ message: 'Hi', full_name: 'Jamie Rivera' });
  });
});
