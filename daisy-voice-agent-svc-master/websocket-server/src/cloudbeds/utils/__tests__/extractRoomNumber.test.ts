import { extractRoomNumber } from '../extractRoomNumber';

describe('extractRoomNumber', () => {
  it('returns the name as-is when it is purely numeric', () => {
    expect(extractRoomNumber('001')).toBe('001');
    expect(extractRoomNumber('005')).toBe('005');
  });

  it('extracts the trailing number from a prefixed label', () => {
    expect(extractRoomNumber('King 3')).toBe('3');
    expect(extractRoomNumber('Courtyard King Suite 10')).toBe('10');
    expect(extractRoomNumber('Haven King 23')).toBe('23');
  });

  it('extracts the trailing number and preserves leading zeros', () => {
    expect(extractRoomNumber('Solstice King . 025')).toBe('025');
    expect(extractRoomNumber('Skal Sanctuary King . 12')).toBe('12');
  });

  it('extracts the number when it is wrapped in trailing punctuation', () => {
    expect(extractRoomNumber('DK(3)')).toBe('3');
    expect(extractRoomNumber('DQ(10)')).toBe('10');
  });

  it('returns null when the name has no trailing number', () => {
    expect(extractRoomNumber('Freya Accessible King Retreat')).toBeNull();
  });

  it('returns null for null, undefined, or empty input', () => {
    expect(extractRoomNumber(null)).toBeNull();
    expect(extractRoomNumber(undefined)).toBeNull();
    expect(extractRoomNumber('')).toBeNull();
  });

  it('returns null rather than guessing when the trailing token is alphanumeric', () => {
    expect(extractRoomNumber('Suite 12B')).toBeNull();
  });

  it('returns null rather than throwing when Cloudbeds sends an unexpected non-string value', () => {
    expect(extractRoomNumber(123 as unknown as string)).toBeNull();
    expect(extractRoomNumber({} as unknown as string)).toBeNull();
  });
});
