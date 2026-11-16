import config from '../config';
import { convertToPhoneNumber } from './helper';

export const TEST_RESERVATION_LIMIT = 2;

export function phoneNumberMatchesTest(
  testNumbers: string[],
  callerPhoneNumber?: string,
): boolean {
  if (testNumbers.length === 0) {
    return false;
  }

  const candidate = callerPhoneNumber?.trim()
    ? convertToPhoneNumber(callerPhoneNumber)
    : null;
  if (!candidate) {
    return false;
  }

  return testNumbers.some((testNumber) => {
    const testDigits = convertToPhoneNumber(testNumber);
    return testDigits && candidate === testDigits;
  });
}

export function isTestPhone(callerPhoneNumber: string): boolean {
  return phoneNumberMatchesTest(config.TEST_NUMBERS, callerPhoneNumber);
}
