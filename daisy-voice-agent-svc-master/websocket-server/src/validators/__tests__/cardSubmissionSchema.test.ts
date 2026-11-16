import {
  validateOperaCardTokenRequest,
  validateResNexusCardRequest,
} from '@/validators/cardSubmissionSchema';

const PAN = '4111111111111111';

const VALID_OPERA = {
  reservation_review_id: 'REV-1',
  pan: PAN,
  expiryDate: '3012',
};

const VALID_RESNEXUS = {
  ...VALID_OPERA,
  cvv: '737',
};

describe('validateResNexusCardRequest', () => {
  it('accepts a well formed card', () => {
    expect(validateResNexusCardRequest({ ...VALID_RESNEXUS })).toEqual(
      VALID_RESNEXUS,
    );
  });

  it('drops anything not in the schema, so stray fields cannot reach ResNexus', () => {
    const value = validateResNexusCardRequest({
      ...VALID_RESNEXUS,
      track_data: 'should not survive',
    });
    expect(value).not.toHaveProperty('track_data');
  });

  it.each([
    ['pan', { ...VALID_RESNEXUS, pan: '41111' }],
    ['cvv', { ...VALID_RESNEXUS, cvv: '12' }],
    ['expiryDate', { ...VALID_RESNEXUS, expiryDate: '3013' }],
    ['expiryDate', { ...VALID_RESNEXUS, expiryDate: '2030-12' }],
  ])('rejects a bad %s', (_field, payload) => {
    expect(() => validateResNexusCardRequest(payload)).toThrow();
  });

  it('requires the cvv', () => {
    const { cvv: _cvv, ...withoutCvv } = VALID_RESNEXUS;
    expect(() => validateResNexusCardRequest(withoutCvv)).toThrow(
      'cvv is required',
    );
  });

  it('never echoes the card back in the error message', () => {
    try {
      validateResNexusCardRequest({ ...VALID_RESNEXUS, pan: `${PAN}999999` });
      throw new Error('expected validation to fail');
    } catch (error) {
      expect((error as Error).message).not.toContain(PAN);
      expect((error as Error).message).toContain('pan must be 8 to 19 digits');
    }
  });
});

describe('validateOperaCardTokenRequest', () => {
  it('accepts a well formed card', () => {
    expect(validateOperaCardTokenRequest({ ...VALID_OPERA })).toEqual(
      VALID_OPERA,
    );
  });

  it('strips a cvv, which Opera never receives', () => {
    const value = validateOperaCardTokenRequest({
      ...VALID_OPERA,
      cvv: '737',
    });
    expect(value).not.toHaveProperty('cvv');
  });

  it('never echoes the card back in the error message', () => {
    try {
      validateOperaCardTokenRequest({ ...VALID_OPERA, pan: `${PAN}999999` });
      throw new Error('expected validation to fail');
    } catch (error) {
      expect((error as Error).message).not.toContain(PAN);
      expect((error as Error).message).toContain('pan must be 8 to 19 digits');
    }
  });
});
