/* global describe, expect, it */
import { hotelConfigurationSchema } from '@/validators/hotelConfigurationSchema';

function validate(body: Record<string, unknown>, isUpdate: boolean) {
  return hotelConfigurationSchema.validate(body, {
    context: { isUpdate },
    abortEarly: false,
    stripUnknown: true,
  });
}

describe('hotelConfigurationSchema dextr_pms_source_id', () => {
  it.each([['s-3'], ['s-120'], ['ss-12345-0'], ['ss-7-1']])(
    'keeps the Cloudbeds source id %j on an update',
    (sourceId) => {
      const { error, value } = validate(
        { dextr_pms_source_id: sourceId },
        true,
      );

      expect(error).toBeUndefined();
      expect(value).toEqual({ dextr_pms_source_id: sourceId });
    },
  );

  it('keeps it on a create too', () => {
    const { error, value } = validate(
      { hotel_id: 'hotel-1', dextr_pms_source_id: 's-3' },
      false,
    );

    expect(error).toBeUndefined();
    expect(value).toEqual({ hotel_id: 'hotel-1', dextr_pms_source_id: 's-3' });
  });

  it('trims it, and accepts null to clear it', () => {
    expect(validate({ dextr_pms_source_id: ' s-3 ' }, true).value).toEqual({
      dextr_pms_source_id: 's-3',
    });
    const cleared = validate({ dextr_pms_source_id: null }, true);
    expect(cleared.error).toBeUndefined();
    expect(cleared.value).toEqual({ dextr_pms_source_id: null });
  });

  it('leaves it out when not sent', () => {
    expect(validate({}, true).value).toEqual({});
  });

  it.each([
    ['a bare number', '3', 'must be a Cloudbeds source id'],
    ['a prefix without a number', 's-', 'must be a Cloudbeds source id'],
    ['upper case', 'S-3', 'must be a Cloudbeds source id'],
    [
      'a third-party id without its 0/1 suffix',
      'ss-12345',
      'must be a Cloudbeds source id',
    ],
    [
      'a third-party id with another suffix',
      'ss-12345-2',
      'must be a Cloudbeds source id',
    ],
    ['an id with extra text', 's-3 direct', 'must be a Cloudbeds source id'],
    ['a blank value', '  ', 'dextr_pms_source_id cannot be empty'],
    ['a number', 3, 'dextr_pms_source_id must be a string'],
  ])('rejects %s', (_case, sourceId, message) => {
    const { error } = validate({ dextr_pms_source_id: sourceId }, true);

    expect(error?.message).toContain(message);
  });
});
