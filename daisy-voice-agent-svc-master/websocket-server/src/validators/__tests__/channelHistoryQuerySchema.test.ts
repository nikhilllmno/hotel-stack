import { DAISY_SESSION_TYPES } from '../../dtos/enum/SessionType';
import { channelHistoryQuerySchema } from '../sessionSchema';

describe('channelHistoryQuerySchema', () => {
  it('accepts business_id and defaults session_type to SMS', () => {
    const { error, value } = channelHistoryQuerySchema.validate({
      business_id: 'biz-1',
    });

    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      business_id: 'biz-1',
      session_type: DAISY_SESSION_TYPES.SMS,
      page: 1,
      limit: 20,
      include_tool_calls: true,
    });
  });

  it('accepts assistant_phone_number alone', () => {
    const { error, value } = channelHistoryQuerySchema.validate({
      assistant_phone_number: '+15551234567',
      session_type: DAISY_SESSION_TYPES.CHAT,
      page: '2',
      limit: '10',
    });

    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      assistant_phone_number: '+15551234567',
      session_type: DAISY_SESSION_TYPES.CHAT,
      page: 2,
      limit: 10,
      include_tool_calls: true,
    });
  });

  it('coerces include_tool_calls query string to boolean', () => {
    const { error: trueError, value: trueValue } =
      channelHistoryQuerySchema.validate({
        business_id: 'biz-1',
        include_tool_calls: 'true',
      });
    const { error: falseError, value: falseValue } =
      channelHistoryQuerySchema.validate({
        business_id: 'biz-1',
        include_tool_calls: 'false',
      });

    expect(trueError).toBeUndefined();
    expect(trueValue.include_tool_calls).toBe(true);
    expect(falseError).toBeUndefined();
    expect(falseValue.include_tool_calls).toBe(false);
  });

  it('rejects when neither hotel identifier is provided', () => {
    const { error } = channelHistoryQuerySchema.validate({ page: 1 });

    expect(error).toBeDefined();
    expect(error?.details.some((d) => d.type === 'object.missing')).toBe(true);
  });

  it('rejects empty business_id', () => {
    const { error } = channelHistoryQuerySchema.validate({
      business_id: '   ',
    });

    expect(error).toBeDefined();
    expect(error?.details.some((d) => d.path.includes('business_id'))).toBe(
      true,
    );
  });

  it('rejects empty assistant_phone_number', () => {
    const { error } = channelHistoryQuerySchema.validate({
      assistant_phone_number: '',
    });

    expect(error).toBeDefined();
    expect(
      error?.details.some((d) => d.path.includes('assistant_phone_number')),
    ).toBe(true);
  });

  it('rejects invalid session_type', () => {
    const { error } = channelHistoryQuerySchema.validate({
      business_id: 'biz-1',
      session_type: 'EXTERNAL',
    });

    expect(error).toBeDefined();
    expect(error?.details.some((d) => d.path.includes('session_type'))).toBe(
      true,
    );
  });
});
