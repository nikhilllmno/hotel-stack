import { CalryRatePlan } from '@/calry/types';
import {
  describeRatePlans,
  selectRatePlan,
} from '@/calry/utils/ratePlanSelection';

const BAR: CalryRatePlan = {
  ratePlanId: 'BAR',
  name: 'Best Available Rate',
  totalPrice: 412.5,
};
const AAA: CalryRatePlan = {
  ratePlanId: 'AAA',
  name: 'AAA Member',
  totalPrice: 380,
};

describe('selectRatePlan', () => {
  it('returns null when the PMS returned no rate plans', () => {
    expect(selectRatePlan([], { allowed: ['BAR'] }, {})).toBeNull();
    expect(selectRatePlan(undefined, { allowed: ['BAR'] }, {})).toBeNull();
  });

  it('matches the configured code against ratePlanId', () => {
    const selected = selectRatePlan([BAR, AAA], { allowed: ['AAA'] }, {});

    expect(selected).toEqual({ plan: AAA, rateCode: 'AAA', isFallback: false });
  });

  it('matches on name when the plan carries no ratePlanId', () => {
    const unlabelled: CalryRatePlan = {
      name: 'AAA Member',
      totalPrice: 380,
    };

    const selected = selectRatePlan(
      [BAR, unlabelled],
      { allowed: ['aaa member'] },
      {},
    );

    expect(selected?.plan).toBe(unlabelled);
    expect(selected?.rateCode).toBe('AAA MEMBER');
    expect(selected?.isFallback).toBe(false);
  });

  it('honours the order of the configured codes', () => {
    const selected = selectRatePlan(
      [BAR, AAA],
      { allowed: ['AAA', 'BAR'] },
      {},
    );

    expect(selected?.plan).toBe(AAA);
  });

  it('falls back to the first plan when no code is configured', () => {
    const selected = selectRatePlan([BAR, AAA], null, {});

    expect(selected).toEqual({ plan: BAR, rateCode: null, isFallback: true });
  });

  it('falls back to the first plan when nothing matches the configured code', () => {
    const selected = selectRatePlan([BAR, AAA], { allowed: ['GOVT'] }, {});

    expect(selected).toEqual({ plan: BAR, rateCode: null, isFallback: true });
  });

  it('falls back when Calry omits both ratePlanId and name, as its sample responses do', () => {
    const anonymous: CalryRatePlan = { totalPrice: 500 };

    const selected = selectRatePlan([anonymous], { allowed: ['BAR'] }, {});

    expect(selected?.plan).toBe(anonymous);
    expect(selected?.isFallback).toBe(true);
  });
});

describe('describeRatePlans', () => {
  it('lists every plan, ignoring the allow-list', () => {
    expect(describeRatePlans([BAR, AAA])).toEqual([
      { name: 'Best Available Rate', totalPrice: 412.5 },
      { name: 'AAA Member', totalPrice: 380 },
    ]);
  });

  it('falls back to a positional label for unnamed plans', () => {
    expect(describeRatePlans([{ totalPrice: 100 }])).toEqual([
      { name: 'Rate 1', totalPrice: 100 },
    ]);
  });

  it('returns an empty list when there are no plans', () => {
    expect(describeRatePlans(undefined)).toEqual([]);
  });
});
