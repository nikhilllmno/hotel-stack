import {
  candidateRatePlans,
  resolveOperaRoomTypeCode,
} from '@/calry/services/operaAvailability';
import { OperaRatePlan, OperaRoomTypeLov } from '@/calry/types';

const OPERA_ROOM_TYPES: OperaRoomTypeLov[] = [
  {
    code: 'ECO',
    name: 'Economy Room ECO Test',
    description: 'Economy Room ECO Test',
  },
  { code: 'STA', name: 'Standard Room', description: 'Standard Room' },
  { code: 'DEL', name: 'Deluxe Room', description: 'Deluxe Room' },
  { code: 'SUI', name: 'Suite', description: 'Suite' },
];

const RATE_PLANS: OperaRatePlan[] = [
  { ratePlanCode: 'BAR', roomTypeList: [{ code: 'ECO' }, { code: 'STA' }] },
  { ratePlanCode: 'SUM2026', roomTypeList: [{ code: 'STA' }] },
  {
    ratePlanCode: 'EURORATE',
    roomTypeList: [{ code: 'STA' }, { code: 'SUI' }],
  },
  { ratePlanCode: 'NOROOMS' },
];

describe('resolveOperaRoomTypeCode', () => {
  it('prefers the configured map over any description matching', () => {
    const code = resolveOperaRoomTypeCode({
      calryRoomTypeId: '1000',
      description: 'Standard Room',
      operaRoomTypes: OPERA_ROOM_TYPES,
      roomTypeMap: { '1000': 'DEL' },
    });

    expect(code).toBe('DEL');
  });

  it('matches an exact description', () => {
    expect(
      resolveOperaRoomTypeCode({
        calryRoomTypeId: '1001',
        description: 'Standard Room',
        operaRoomTypes: OPERA_ROOM_TYPES,
      }),
    ).toBe('STA');
  });

  it('matches when Opera holds a longer description than Calry reports', () => {
    expect(
      resolveOperaRoomTypeCode({
        calryRoomTypeId: '1002',
        description: 'Economy Room',
        operaRoomTypes: OPERA_ROOM_TYPES,
      }),
    ).toBe('ECO');
  });

  it('falls back to the room name when there is no description', () => {
    expect(
      resolveOperaRoomTypeCode({
        calryRoomTypeId: '1003',
        name: 'Suite',
        operaRoomTypes: OPERA_ROOM_TYPES,
      }),
    ).toBe('SUI');
  });

  it('refuses to guess when a description matches several room types', () => {
    const code = resolveOperaRoomTypeCode({
      calryRoomTypeId: '1004',
      description: 'Deluxe',
      operaRoomTypes: [
        ...OPERA_ROOM_TYPES,
        { code: 'DLXK', description: 'Deluxe King' },
      ],
    });

    expect(code).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(
      resolveOperaRoomTypeCode({
        calryRoomTypeId: '1005',
        description: 'Treehouse',
        operaRoomTypes: OPERA_ROOM_TYPES,
      }),
    ).toBeNull();
  });
});

describe('candidateRatePlans', () => {
  it('returns only the configured codes that sell the room type', () => {
    const codes = candidateRatePlans({
      ratePlans: RATE_PLANS,
      roomType: 'STA',
      rateCodeConfig: { allowed: ['eurorate', 'BAR'] },
    });

    expect(codes).toEqual(['BAR', 'EURORATE']);
  });

  it('ignores configured codes that do not sell the room type', () => {
    const codes = candidateRatePlans({
      ratePlans: RATE_PLANS,
      roomType: 'SUI',
      rateCodeConfig: { allowed: ['BAR', 'EURORATE'] },
    });

    expect(codes).toEqual(['EURORATE']);
  });

  it('falls back to every plan selling the room type when unconfigured', () => {
    const codes = candidateRatePlans({
      ratePlans: RATE_PLANS,
      roomType: 'STA',
      rateCodeConfig: null,
    });

    expect(codes).toEqual(['BAR', 'SUM2026', 'EURORATE']);
  });

  it('returns nothing when no plan sells the room type', () => {
    expect(
      candidateRatePlans({
        ratePlans: RATE_PLANS,
        roomType: 'PRE',
        rateCodeConfig: null,
      }),
    ).toEqual([]);
  });
});
