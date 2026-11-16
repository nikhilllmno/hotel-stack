jest.mock('../../utils/helper', () => {
  const actual = jest.requireActual('../../utils/helper');
  const { mockValidatePhoneWithTwilio } = require('./mockTwilio');

  return {
    ...actual,
    validatePhoneWithTwilio: mockValidatePhoneWithTwilio,
  };
});

jest.mock('../../utils/aws', () => {
  const actual = jest.requireActual('../../utils/aws');
  const { mockGeneratePresignedUrl } = require('./mockAws');

  return {
    ...actual,
    generatePresignedUrl: mockGeneratePresignedUrl,
  };
});
