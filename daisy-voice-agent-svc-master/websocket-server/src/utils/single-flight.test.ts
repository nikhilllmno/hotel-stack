/* global describe, expect, setTimeout, test */
import {
  createKeyedSingleFlightRunner,
  createSingleFlightRunner,
} from './single-flight';

describe('createSingleFlightRunner', () => {
  test('concurrent run calls invoke fn once and share the resolved value', async () => {
    let invocations = 0;
    const sf = createSingleFlightRunner();
    const p1 = sf.run(async () => {
      invocations++;
      await new Promise((r) => setTimeout(r, 5));
      return 7;
    });
    const p2 = sf.run(async () => {
      invocations++;
      return 99;
    });
    const [a, b] = await Promise.all([p1, p2]);
    expect(invocations).toBe(1);
    expect(a).toBe(7);
    expect(b).toBe(7);
  });

  test('after settlement, the next run invokes fn again', async () => {
    let invocations = 0;
    const sf = createSingleFlightRunner();
    await sf.run(async () => {
      invocations++;
      return 1;
    });
    await sf.run(async () => {
      invocations++;
      return 2;
    });
    expect(invocations).toBe(2);
  });

  test('rejection is shared by concurrent waiters and the slot clears for a later run', async () => {
    let invocations = 0;
    const sf = createSingleFlightRunner();
    const p1 = sf.run(async () => {
      invocations++;
      await new Promise((r) => setTimeout(r, 2));
      throw new Error('boom');
    });
    const p2 = sf.run(async () => {
      invocations++;
      return 1;
    });
    await expect(Promise.all([p1, p2])).rejects.toThrow('boom');
    expect(invocations).toBe(1);

    const ok = await sf.run(async () => {
      invocations++;
      return 'ok';
    });
    expect(ok).toBe('ok');
    expect(invocations).toBe(2);
  });
});

// A run that fails with nobody else waiting must not also surface as an
// unhandled rejection: the caller already handled it.
describe.each([
  [
    'createSingleFlightRunner',
    (fn: () => Promise<never>) => createSingleFlightRunner().run(fn),
  ],
  [
    'createKeyedSingleFlightRunner',
    (fn: () => Promise<never>) => createKeyedSingleFlightRunner().run('k', fn),
  ],
])('%s with a single caller', (_name, runOnce) => {
  test('a rejection reaches the caller and nothing else', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      await expect(
        runOnce(async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('createKeyedSingleFlightRunner', () => {
  test('same key coalesces; different keys run concurrently', async () => {
    let invocationsA = 0;
    let invocationsB = 0;
    const kf = createKeyedSingleFlightRunner();
    const p1 = kf.run('a', async () => {
      invocationsA++;
      await new Promise((r) => setTimeout(r, 8));
      return 'a1';
    });
    const p2 = kf.run('a', async () => {
      invocationsA++;
      return 'a2';
    });
    const p3 = kf.run('b', async () => {
      invocationsB++;
      await new Promise((r) => setTimeout(r, 4));
      return 'b1';
    });
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(invocationsA).toBe(1);
    expect(invocationsB).toBe(1);
    expect(r1).toBe('a1');
    expect(r2).toBe('a1');
    expect(r3).toBe('b1');
  });
});
