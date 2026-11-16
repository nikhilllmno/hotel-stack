import { MewsService } from '@/mews/types';
import {
  getMewsServiceTimeOffsets,
  isUnusableStartOffset,
  parseMewsOffsetToMinutes,
} from '@/mews/utils/serviceTimeOffsets';

function buildService(
  value: Record<string, unknown> | undefined,
  discriminator = 'Bookable',
): MewsService {
  return {
    Id: 'service-1',
    EnterpriseId: 'enterprise-1',
    IsActive: true,
    Names: { 'en-US': 'Stay' },
    Data: { Discriminator: discriminator, Value: value },
  };
}

describe('parseMewsOffsetToMinutes', () => {
  it('parses the offsets seen in production', () => {
    expect(parseMewsOffsetToMinutes('P0M0DT15H0M0S')).toBe(900);
    expect(parseMewsOffsetToMinutes('P0M0DT11H0M0S')).toBe(660);
    expect(parseMewsOffsetToMinutes('P0M0DT12H0M0S')).toBe(720);
  });

  it('treats zero-length durations as no offset', () => {
    expect(parseMewsOffsetToMinutes('P0M0DT0H0M0S')).toBe(0);
    expect(parseMewsOffsetToMinutes('PT0S')).toBe(0);
  });

  // M before T is months, M after T is minutes. Getting this wrong turns a
  // one-month offset into a one-minute one.
  it('distinguishes months from minutes', () => {
    expect(parseMewsOffsetToMinutes('P1M')).toBeNull();
    expect(parseMewsOffsetToMinutes('PT1M')).toBe(1);
    expect(parseMewsOffsetToMinutes('P1MT30M')).toBeNull();
    expect(parseMewsOffsetToMinutes('P0MT30M')).toBe(30);
  });

  it('rejects offsets that would move the start off the day', () => {
    expect(parseMewsOffsetToMinutes('P1D')).toBeNull();
    expect(parseMewsOffsetToMinutes('P1W')).toBeNull();
    expect(parseMewsOffsetToMinutes('P1Y')).toBeNull();
    expect(parseMewsOffsetToMinutes('PT24H')).toBeNull();
    expect(parseMewsOffsetToMinutes('PT25H')).toBeNull();
  });

  it('returns null for anything unparseable', () => {
    expect(parseMewsOffsetToMinutes('')).toBeNull();
    expect(parseMewsOffsetToMinutes('garbage')).toBeNull();
    expect(parseMewsOffsetToMinutes('15:00')).toBeNull();
    expect(parseMewsOffsetToMinutes(null)).toBeNull();
    expect(parseMewsOffsetToMinutes(undefined)).toBeNull();
    expect(parseMewsOffsetToMinutes(900)).toBeNull();
  });

  it('floors seconds to whole minutes', () => {
    expect(parseMewsOffsetToMinutes('PT1H30M59S')).toBe(90);
  });
});

describe('getMewsServiceTimeOffsets', () => {
  it('reads both offsets off a bookable Day service', () => {
    const offsets = getMewsServiceTimeOffsets(
      buildService({
        StartOffset: 'P0M0DT15H0M0S',
        EndOffset: 'P0M0DT11H0M0S',
        TimeUnitPeriod: 'Day',
      }),
    );
    expect(offsets.startOffsetMinutes).toBe(900);
    expect(offsets.endOffsetMinutes).toBe(660);
    expect(offsets.timeUnitPeriod).toBe('Day');
  });

  it('ignores offsets on non-Day time units', () => {
    const offsets = getMewsServiceTimeOffsets(
      buildService({ StartOffset: 'P0M0DT15H0M0S', TimeUnitPeriod: 'Hour' }),
    );
    expect(offsets.startOffsetMinutes).toBeNull();
    expect(offsets.rawStartOffset).toBe('P0M0DT15H0M0S');
  });

  it('ignores non-bookable services', () => {
    const offsets = getMewsServiceTimeOffsets(
      buildService({ StartOffset: 'P0M0DT15H0M0S' }, 'Additional'),
    );
    expect(offsets.startOffsetMinutes).toBeNull();
    expect(offsets.rawStartOffset).toBeNull();
  });

  it('handles a missing service and a missing Value', () => {
    expect(getMewsServiceTimeOffsets(undefined).startOffsetMinutes).toBeNull();
    expect(
      getMewsServiceTimeOffsets(buildService(undefined)).startOffsetMinutes,
    ).toBeNull();
  });
});

describe('isUnusableStartOffset', () => {
  it('flags only a configured-but-unparseable offset', () => {
    expect(
      isUnusableStartOffset(
        getMewsServiceTimeOffsets(buildService({ StartOffset: 'nonsense' })),
      ),
    ).toBe(true);
    expect(
      isUnusableStartOffset(getMewsServiceTimeOffsets(buildService({}))),
    ).toBe(false);
    expect(
      isUnusableStartOffset(
        getMewsServiceTimeOffsets(
          buildService({ StartOffset: 'P0M0DT15H0M0S' }),
        ),
      ),
    ).toBe(false);
  });
});
