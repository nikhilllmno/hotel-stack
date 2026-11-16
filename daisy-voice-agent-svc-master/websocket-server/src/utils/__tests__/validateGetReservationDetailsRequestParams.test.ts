import { GetReservationDetailsRequest } from '../../models/request/roomReservation';
import { validateGetReservationDetailsRequestParams } from '../validateReservationRequest';

const PHONE = '+15559876543';
const ASSISTANT_PHONE = '+15550001111';

function params(
  overrides: Partial<GetReservationDetailsRequest> = {},
): GetReservationDetailsRequest {
  return {
    session_type: 'voice',
    ...overrides,
  } as GetReservationDetailsRequest;
}

describe('validateGetReservationDetailsRequestParams', () => {
  it('trims a valid check_out_date', () => {
    const result = validateGetReservationDetailsRequestParams(
      params({ guest_name: 'John Smith', check_out_date: ' 2026-09-01 ' }),
      PHONE,
      ASSISTANT_PHONE,
    );

    expect(result.check_out_date).toBe('2026-09-01');
  });

  it('rejects a check_out_date not in YYYY-MM-DD format', () => {
    expect(() =>
      validateGetReservationDetailsRequestParams(
        params({ guest_name: 'John Smith', check_out_date: '09/01/2026' }),
        PHONE,
        ASSISTANT_PHONE,
      ),
    ).toThrow(/check_out_date must be in YYYY-MM-DD format/);
  });

  it('allows check_out_date to be omitted', () => {
    const result = validateGetReservationDetailsRequestParams(
      params({ guest_name: 'John Smith' }),
      PHONE,
      ASSISTANT_PHONE,
    );

    expect(result.check_out_date).toBeUndefined();
  });

  it('rejects a check_out_date given without guest_name', () => {
    expect(() =>
      validateGetReservationDetailsRequestParams(
        params({ booking_id: 'BK123', check_out_date: '2026-09-01' }),
        PHONE,
        ASSISTANT_PHONE,
      ),
    ).toThrow(
      /Filtering by checkout date is possible only when the guest name is also provided/,
    );
  });

  it('trims a valid reservation_id_last_four', () => {
    const result = validateGetReservationDetailsRequestParams(
      params({ guest_name: 'John Smith', reservation_id_last_four: ' ab12 ' }),
      PHONE,
      ASSISTANT_PHONE,
    );

    expect(result.reservation_id_last_four).toBe('ab12');
  });

  it('rejects a reservation_id_last_four that is not exactly 4 characters', () => {
    expect(() =>
      validateGetReservationDetailsRequestParams(
        params({ guest_name: 'John Smith', reservation_id_last_four: 'ab1' }),
        PHONE,
        ASSISTANT_PHONE,
      ),
    ).toThrow(/reservation_id_last_four must contain exactly 4 characters/);
  });

  it('rejects a reservation_id_last_four given without guest_name', () => {
    expect(() =>
      validateGetReservationDetailsRequestParams(
        params({ booking_id: 'BK123', reservation_id_last_four: 'ab12' }),
        PHONE,
        ASSISTANT_PHONE,
      ),
    ).toThrow(
      /Filtering by reservation id is possible only when the guest name is also provided/,
    );
  });
});
