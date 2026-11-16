/* global describe, expect, it */
import { BadRequestError } from '../../errors/BadRequestError';
import { validateCheckSisterPropertyAvailabilityRequest } from '../validateReservationRequest';

const BODY = {
  start_date: '2026-11-20',
  end_date: '2026-11-22',
  num_adults: '4',
};

describe('validateCheckSisterPropertyAvailabilityRequest', () => {
  it('keeps real dates as YYYY-MM-DD strings and defaults children and pets to 0', () => {
    expect(validateCheckSisterPropertyAvailabilityRequest(BODY)).toEqual({
      start_date: '2026-11-20',
      end_date: '2026-11-22',
      num_adults: 4,
      num_children: 0,
      num_pets: 0,
    });
  });

  it('accepts February 29 in a leap year', () => {
    expect(
      validateCheckSisterPropertyAvailabilityRequest({
        ...BODY,
        start_date: '2028-02-29',
        end_date: '2028-03-01',
      }).start_date,
    ).toBe('2028-02-29');
  });

  it.each([
    ['start_date', '2099-02-30', 'start_date must be a real calendar date'],
    ['start_date', '2027-02-29', 'start_date must be a real calendar date'],
    ['end_date', '2026-11-31', 'end_date must be a real calendar date'],
    ['end_date', '2026-13-01', 'end_date must be a real calendar date'],
    ['start_date', '2026-11-00', 'start_date must be a real calendar date'],
    ['start_date', '20/11/2026', 'start_date must be in YYYY-MM-DD format'],
  ])('rejects %s %j', (field, value, message) => {
    expect(() =>
      validateCheckSisterPropertyAvailabilityRequest({
        ...BODY,
        [field]: value,
      }),
    ).toThrow(
      new BadRequestError(
        `validateCheckSisterPropertyAvailabilityRequest:: ${message}`,
      ),
    );
  });
});
