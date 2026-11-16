/* global describe, expect, it */
import { GetDoorCodeRequest } from '../../models/request/roomReservation';
import { validateGetDoorCodeRequestParams } from '../validateReservationRequest';

const ASSISTANT_PHONE = '+15550001111';

function params(
  overrides: Partial<GetDoorCodeRequest> = {},
): GetDoorCodeRequest {
  return {
    session_type: 'voice',
    ...overrides,
  } as GetDoorCodeRequest;
}

describe('validateGetDoorCodeRequestParams', () => {
  it('trims booking_id and uppercases a Daisy BK id', () => {
    const result = validateGetDoorCodeRequestParams(
      params({ booking_id: '  bk123  ' }),
      ASSISTANT_PHONE,
    );

    expect(result.booking_id).toBe('BK123');
  });

  // PMS confirmation numbers are the common case and are case-sensitive, so
  // only the BK-prefixed Daisy ids get uppercased.
  it('leaves a PMS confirmation number’s case alone', () => {
    const result = validateGetDoorCodeRequestParams(
      params({ booking_id: ' aBc-9182 ' }),
      ASSISTANT_PHONE,
    );

    expect(result.booking_id).toBe('aBc-9182');
  });

  it('requires booking_id or guest_name', () => {
    expect(() =>
      validateGetDoorCodeRequestParams(params(), ASSISTANT_PHONE),
    ).toThrow(/Missing booking_id or guest_name/);
  });

  it('rejects a whitespace-only booking_id with no guest_name', () => {
    expect(() =>
      validateGetDoorCodeRequestParams(
        params({ booking_id: '   ' }),
        ASSISTANT_PHONE,
      ),
    ).toThrow(/Missing booking_id or guest_name/);
  });

  it('rejects a check_out_date with no guest_name', () => {
    expect(() =>
      validateGetDoorCodeRequestParams(
        params({ check_out_date: '2026-08-24' }),
        ASSISTANT_PHONE,
      ),
    ).toThrow(/Missing booking_id or guest_name/);
  });

  it('accepts guest_name together with check_out_date', () => {
    const result = validateGetDoorCodeRequestParams(
      params({ guest_name: '  Jane Doe  ', check_out_date: ' 2026-08-24 ' }),
      ASSISTANT_PHONE,
    );

    expect(result.guest_name).toBe('Jane Doe');
    expect(result.check_out_date).toBe('2026-08-24');
  });

  // The message is what the agent reads back to the guest.
  it('rejects guest_name without a check_out_date', () => {
    expect(() =>
      validateGetDoorCodeRequestParams(
        params({ guest_name: 'Jane Doe' }),
        ASSISTANT_PHONE,
      ),
    ).toThrow(/check_out_date is required when looking up by guest_name/);
  });

  it('rejects a check_out_date that is not YYYY-MM-DD', () => {
    expect(() =>
      validateGetDoorCodeRequestParams(
        params({ guest_name: 'Jane Doe', check_out_date: '24/08/2026' }),
        ASSISTANT_PHONE,
      ),
    ).toThrow(/check_out_date must be in YYYY-MM-DD format/);
  });

  it('keeps booking_id when a guest_name is also supplied', () => {
    const result = validateGetDoorCodeRequestParams(
      params({ booking_id: 'BK123', guest_name: 'Jane Doe' }),
      ASSISTANT_PHONE,
    );

    expect(result.booking_id).toBe('BK123');
  });

  // booking_id is sufficient on its own, so the date rule must not fire.
  it('does not require check_out_date when booking_id is supplied', () => {
    expect(() =>
      validateGetDoorCodeRequestParams(
        params({ booking_id: 'BK123', guest_name: 'Jane Doe' }),
        ASSISTANT_PHONE,
      ),
    ).not.toThrow();
  });

  it('requires the assistant phone number', () => {
    expect(() =>
      validateGetDoorCodeRequestParams(params({ booking_id: 'BK123' }), ''),
    ).toThrow(/Assistant phone number is required/);
  });

  it('requires session_type', () => {
    expect(() =>
      validateGetDoorCodeRequestParams(
        { booking_id: 'BK123' } as GetDoorCodeRequest,
        ASSISTANT_PHONE,
      ),
    ).toThrow(/Missing session_type/);
  });

  it('reads a numeric booking_id as text', () => {
    const result = validateGetDoorCodeRequestParams(
      params({ booking_id: 6098484913491 as unknown as string }),
      ASSISTANT_PHONE,
    );

    expect(result.booking_id).toBe('6098484913491');
  });

  // Cloudbeds hotels with source_of_truth = daisy look a request without a
  // booking_id up by the caller ID.
  describe('with callerIdLookup', () => {
    const callerIdLookup = { callerIdLookup: true };

    it.each([
      ['no key', {}],
      ['a blank booking_id', { booking_id: '   ' }],
      ['a guest_name with no check_out_date', { guest_name: 'Jane Doe' }],
      [
        'a check_out_date that is not YYYY-MM-DD',
        { guest_name: 'Jane Doe', check_out_date: '24/08/2026' },
      ],
    ])(
      'accepts a request with %s, as a lookup without booking_id',
      (_case, body) => {
        const result = validateGetDoorCodeRequestParams(
          params(body),
          ASSISTANT_PHONE,
          callerIdLookup,
        );

        expect(result.booking_id).toBeUndefined();
      },
    );

    it('still normalizes a booking_id', () => {
      expect(
        validateGetDoorCodeRequestParams(
          params({ booking_id: ' bk123 ' }),
          ASSISTANT_PHONE,
          callerIdLookup,
        ).booking_id,
      ).toBe('BK123');
    });

    it('still requires session_type and the assistant phone number', () => {
      expect(() =>
        validateGetDoorCodeRequestParams(
          {} as GetDoorCodeRequest,
          ASSISTANT_PHONE,
          callerIdLookup,
        ),
      ).toThrow(/Missing session_type/);
      expect(() =>
        validateGetDoorCodeRequestParams(params(), '', callerIdLookup),
      ).toThrow(/Assistant phone number is required/);
    });
  });
});
