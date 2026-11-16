export const mockValidatePhoneWithTwilio = jest
  .fn()
  .mockResolvedValue(undefined);

export function resetTwilioValidationMock(): void {
  mockValidatePhoneWithTwilio.mockReset();
  mockValidatePhoneWithTwilio.mockResolvedValue(undefined);
}
