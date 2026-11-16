import { AxiosError } from 'axios';
import logger from '../logger';

// Winston keeps the formatted line under this symbol (triple-beam's MESSAGE).
const MESSAGE = Symbol.for('message');
const PAN = '4111111111111111';
const CVV = '737';

function buildAxiosError(): AxiosError {
  return new AxiosError(
    'Request failed with status code 502',
    'ERR_BAD_RESPONSE',
    { data: JSON.stringify({ card_number: PAN, card_cvv: CVV }) } as any,
    {},
    { status: 502, data: { echoed: PAN } } as any,
  );
}

describe('logger', () => {
  let written: string[];
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    written = [];
    logSpy = jest
      .spyOn(logger.transports[0], 'log' as any)
      .mockImplementation((info: any, next: any) => {
        written.push(info[MESSAGE]);
        next?.();
      });
  });

  afterEach(() => logSpy.mockRestore());

  it('keeps the request and response bodies of an axios error passed as metadata out of the log', () => {
    logger.error('ResNexus call failed', buildAxiosError());

    const line = written.join('\n');
    expect(line).toContain('ResNexus call failed');
    expect(line).toContain('502');
    expect(line).not.toContain(PAN);
    expect(line).not.toContain(CVV);
  });

  it('keeps an axios error nested in metadata out of the log', () => {
    logger.error('ResNexus call failed', { error: buildAxiosError() });

    const line = written.join('\n');
    expect(line).toContain('Request failed with status code 502');
    expect(line).not.toContain(PAN);
    expect(line).not.toContain(CVV);
  });

  it('keeps an axios error deeper in metadata or in an array out of the log', () => {
    logger.error('ResNexus call failed', {
      details: { error: buildAxiosError() },
      attempts: [buildAxiosError()],
    });

    const line = written.join('\n');
    expect(line).toContain('Request failed with status code 502');
    expect(line).not.toContain(PAN);
    expect(line).not.toContain(CVV);
  });
});
