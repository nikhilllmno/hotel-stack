import { isTestPhone, phoneNumberMatchesTest } from '../testPhone';

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    TEST_NUMBERS: ['14083205093', '14084048097'],
  },
}));

describe('testPhone', () => {
  const testNumbers = ['14083205093', '14084048097'];

  describe('phoneNumberMatchesTest', () => {
    it('matches full caller numbers with or without formatting', () => {
      expect(phoneNumberMatchesTest(testNumbers, '+14083205093')).toBe(true);
      expect(phoneNumberMatchesTest(testNumbers, '1-408-404-8097')).toBe(true);
    });

    it('does not match unrelated numbers', () => {
      expect(phoneNumberMatchesTest(testNumbers, '+15551234567')).toBe(false);
    });
  });

  describe('isTestPhone', () => {
    it('returns true for configured test numbers', () => {
      expect(isTestPhone('+14083205093')).toBe(true);
    });

    it('returns false for unrelated numbers', () => {
      expect(isTestPhone('+15551234567')).toBe(false);
    });
  });
});
