import { withTimeoutWithFallback } from '../async';

describe('withTimeoutWithFallback', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the asyncFn result when it completes before the timeout', async () => {
    const resultPromise = withTimeoutWithFallback(
      () => Promise.resolve(42),
      1000,
      0,
    );

    await expect(resultPromise).resolves.toBe(42);
  });

  it('returns fallback when asyncFn exceeds maxDurationMs', async () => {
    const onTimeout = jest.fn();

    const resultPromise = withTimeoutWithFallback(
      () => new Promise<number>(() => {}),
      100,
      -1,
      onTimeout,
    );

    jest.advanceTimersByTime(100);

    await expect(resultPromise).resolves.toBe(-1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not call onTimeout when asyncFn completes before the limit', async () => {
    const onTimeout = jest.fn();

    await withTimeoutWithFallback(
      () => Promise.resolve(42),
      1000,
      0,
      onTimeout,
    );

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('propagates errors thrown by asyncFn', async () => {
    const resultPromise = withTimeoutWithFallback(
      () => Promise.reject(new Error('lookup failed')),
      1000,
      [],
    );

    await expect(resultPromise).rejects.toThrow('lookup failed');
  });

  it('clears the timeout timer when asyncFn completes first', async () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

    await withTimeoutWithFallback(
      () => Promise.resolve('done'),
      1000,
      'fallback',
    );

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
