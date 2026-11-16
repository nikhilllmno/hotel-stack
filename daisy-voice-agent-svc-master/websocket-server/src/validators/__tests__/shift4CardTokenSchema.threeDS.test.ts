import { BadRequestError } from '@/errors/BadRequestError';
import { validateShift4CardTokenRequest } from '@/validators/shift4CardTokenSchema';

const baseCardToken = {
  payment_id: 'pay-1',
  i4go_response: 'ok',
  i4go_responsecode: '00',
  i4go_maskedcard: '411111******1111',
  i4go_uniqueid: 'unique-token-1',
  i4go_expirationmonth: '12',
  i4go_expirationyear: '2030',
  i4go_cardtype: 'VISA',
  i4go_utoken: 'utoken-1',
};

const validThreeDSecure = {
  programProtocol: '1',
  ecommIndicator: '5',
  trxId: 'trx-1',
  directoryServerTranId: 'ds-1',
  cryptogram: 'crypto-1',
  xid: 'xid-1',
};

describe('validateShift4CardTokenRequest 3DS block', () => {
  it('accepts a request without threeDSecure (3DS off)', () => {
    const result = validateShift4CardTokenRequest(baseCardToken);

    expect(result.threeDSecure).toBeUndefined();
    expect(result.i4go_uniqueid).toBe('unique-token-1');
  });

  it('accepts and preserves a full threeDSecure block (3DS on)', () => {
    const result = validateShift4CardTokenRequest({
      ...baseCardToken,
      threeDSecure: validThreeDSecure,
    });

    expect(result.threeDSecure).toEqual(validThreeDSecure);
  });

  it('rejects a threeDSecure block missing required fields', () => {
    expect(() =>
      validateShift4CardTokenRequest({
        ...baseCardToken,
        threeDSecure: { programProtocol: '1' },
      }),
    ).toThrow(BadRequestError);
  });
});
