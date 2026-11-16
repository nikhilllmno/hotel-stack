import { RemoteLockDoorCodeService } from '@/remotelock/services/doorCodeService';
import { AccessGuest } from '@/remotelock/types';
import { KpiStat, logKpi } from '@/utils/kpiLogger';

jest.mock('@/utils/kpiLogger', () => {
  const actual = jest.requireActual('@/utils/kpiLogger');
  return { ...actual, logKpi: jest.fn() };
});

function makeGuest(
  id: string,
  attributes: Partial<AccessGuest['attributes']> = {},
): AccessGuest {
  return {
    id,
    type: 'access_guest',
    attributes: {
      name: 'Ann Smith',
      email: null,
      phone: null,
      status: 'current',
      starts_at: '2026-08-01T00:00:00',
      ends_at: '2026-08-05T00:00:00',
      pin: '1234',
      department: null,
      ...attributes,
    },
  };
}

function makeService(guests: AccessGuest[], pmsProvider = 'resnexus') {
  const getAllAccessPersons = jest.fn().mockResolvedValue(guests);
  const getHotelById = jest
    .fn()
    .mockResolvedValue({ pms_provider: pmsProvider });
  const service = new RemoteLockDoorCodeService(
    () => ({ getAllAccessPersons }) as any,
    { getHotelById } as any,
  );
  return { service, getAllAccessPersons, getHotelById };
}

describe('RemoteLockDoorCodeService.matchReservation', () => {
  const reservation = {
    name: 'Ann Smith',
    email: null,
    phone: null,
    check_in: '2026-08-01T14:00:00',
    check_out: '2026-08-05T11:00:00',
  };

  beforeEach(() => {
    (logKpi as jest.Mock).mockClear();
  });

  it('returns resolved with the PIN when exactly one guest matches', async () => {
    const { service, getAllAccessPersons } = makeService([
      makeGuest('g1', { pin: '4821' }),
    ]);

    const result = service.matchReservation(
      'hotel-1',
      await service.getCandidates('hotel-1'),
      reservation,
    );

    expect(getAllAccessPersons).toHaveBeenCalledWith({
      type: 'access_guest',
    });
    expect(result).toEqual({
      status: 'resolved',
      matches: [
        {
          pin: '4821',
          guest_name: 'Ann Smith',
          starts_at: '2026-08-01T00:00:00',
          ends_at: '2026-08-05T00:00:00',
        },
      ],
    });
    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({ stat: KpiStat.RemoteLockDoorCodeResolved }),
    );
  });

  it('returns not_found when no guest matches by name', async () => {
    const { service } = makeService([makeGuest('g1', { name: 'Bob Jones' })]);

    const result = service.matchReservation(
      'hotel-1',
      await service.getCandidates('hotel-1'),
      reservation,
    );

    expect(result).toEqual({ status: 'not_found' });
    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({ stat: KpiStat.RemoteLockDoorCodeNotFound }),
    );
  });

  it('returns not_found when the window does not overlap the reservation', async () => {
    const { service } = makeService([
      makeGuest('g1', {
        starts_at: '2026-09-01T00:00:00',
        ends_at: '2026-09-05T00:00:00',
      }),
    ]);

    const result = service.matchReservation(
      'hotel-1',
      await service.getCandidates('hotel-1'),
      reservation,
    );

    expect(result).toEqual({ status: 'not_found' });
  });

  it('returns not_found when the only match has a null PIN (ReadyPIN not yet generated)', async () => {
    const { service } = makeService([makeGuest('g1', { pin: null })]);

    const result = service.matchReservation(
      'hotel-1',
      await service.getCandidates('hotel-1'),
      reservation,
    );

    expect(result).toEqual({ status: 'not_found' });
  });

  it('returns every match when multiple guests match', async () => {
    const { service } = makeService([
      makeGuest('older', { pin: '1111', starts_at: '2026-08-01T00:00:00' }),
      makeGuest('newer', { pin: '2222', starts_at: '2026-08-03T00:00:00' }),
    ]);

    const result = service.matchReservation(
      'hotel-1',
      await service.getCandidates('hotel-1'),
      reservation,
    );

    expect(result).toEqual({
      status: 'ambiguous',
      matches: [
        expect.objectContaining({ pin: '1111' }),
        expect.objectContaining({ pin: '2222' }),
      ],
    });
    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({ stat: KpiStat.RemoteLockDoorCodeAmbiguous }),
    );
  });

  it('drops matches with a null PIN from the returned set', async () => {
    const { service } = makeService([
      makeGuest('older', { pin: '1111', starts_at: '2026-08-01T00:00:00' }),
      makeGuest('newer-no-pin', {
        pin: null,
        starts_at: '2026-08-03T00:00:00',
      }),
    ]);

    const result = service.matchReservation(
      'hotel-1',
      await service.getCandidates('hotel-1'),
      reservation,
    );

    expect(result).toEqual({
      status: 'resolved',
      matches: [expect.objectContaining({ pin: '1111' })],
    });
  });
});

describe('RemoteLockDoorCodeService.getCandidates', () => {
  it('fetches once for concurrent lookups at the same hotel', async () => {
    const { service, getAllAccessPersons } = makeService([makeGuest('g1')]);

    await Promise.all([
      service.getCandidates('hotel-1'),
      service.getCandidates('hotel-1'),
    ]);

    expect(getAllAccessPersons).toHaveBeenCalledTimes(1);
  });

  it('serves the cached list within the TTL and refetches after it expires', async () => {
    const { service, getAllAccessPersons } = makeService([makeGuest('g1')]);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000);

    await service.getCandidates('hotel-1');
    await service.getCandidates('hotel-1');
    expect(getAllAccessPersons).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(1_000 + 15_001);
    await service.getCandidates('hotel-1');
    expect(getAllAccessPersons).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it('caches per hotel', async () => {
    const { service, getAllAccessPersons } = makeService([makeGuest('g1')]);

    await service.getCandidates('hotel-1');
    await service.getCandidates('hotel-2');

    expect(getAllAccessPersons).toHaveBeenCalledTimes(2);
  });
});

describe('RemoteLockDoorCodeService.resolveDoorCodes', () => {
  const bookedReservation = {
    booking_id: 'BK1',
    name: 'Ann Smith',
    email: null,
    phone: '+1 (555) 867-5309',
    check_in: '2026-08-01T14:00:00',
    check_out: '2026-08-05T11:00:00',
  };

  beforeEach(() => {
    (logKpi as jest.Mock).mockClear();
  });

  it('returns the PIN for the booking’s reservation', async () => {
    const { service } = makeService([makeGuest('g1', { pin: '4821' })]);

    const result = await service.resolveDoorCodes('hotel-1', [
      bookedReservation,
    ]);

    expect(result).toEqual([
      {
        booking_id: 'BK1',
        pin: '4821',
        guest_name: 'Ann Smith',
        starts_at: '2026-08-01T00:00:00',
        ends_at: '2026-08-05T00:00:00',
      },
    ]);
  });

  it('throws when the booking resolved to no reservations', async () => {
    const { service, getAllAccessPersons } = makeService([
      makeGuest('g1', { pin: '4821' }),
    ]);

    await expect(service.resolveDoorCodes('hotel-1', [])).rejects.toThrow(
      /no reservation found/,
    );
    expect(getAllAccessPersons).not.toHaveBeenCalled();
  });

  it('returns every access guest that matched, for the caller to tell apart', async () => {
    const { service } = makeService([
      makeGuest('older', { pin: '1111', starts_at: '2026-08-01T00:00:00' }),
      makeGuest('newer', { pin: '2222', starts_at: '2026-08-03T00:00:00' }),
    ]);

    const result = await service.resolveDoorCodes('hotel-1', [
      bookedReservation,
    ]);

    expect(result).toEqual([
      expect.objectContaining({ booking_id: 'BK1', pin: '1111' }),
      expect.objectContaining({ booking_id: 'BK1', pin: '2222' }),
    ]);
    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({ stat: KpiStat.RemoteLockDoorCodeAmbiguous }),
    );
  });

  it('returns the matches for every reservation in the batch', async () => {
    const { service } = makeService([
      makeGuest('ann', { pin: '4821' }),
      makeGuest('bob-1', {
        name: 'Bob Jones',
        pin: '1111',
        starts_at: '2026-08-01T00:00:00',
      }),
      makeGuest('bob-2', {
        name: 'Bob Jones',
        pin: '2222',
        starts_at: '2026-08-03T00:00:00',
      }),
    ]);

    const result = await service.resolveDoorCodes('hotel-1', [
      bookedReservation,
      { ...bookedReservation, booking_id: 'BK2', name: 'Bob Jones' },
    ]);

    expect(result).toEqual([
      expect.objectContaining({ booking_id: 'BK1', pin: '4821' }),
      expect.objectContaining({ booking_id: 'BK2', pin: '1111' }),
      expect.objectContaining({ booking_id: 'BK2', pin: '2222' }),
    ]);
  });

  it('throws when no access guest matches at all', async () => {
    const { service } = makeService([makeGuest('g1', { name: 'Bob Jones' })]);

    await expect(
      service.resolveDoorCodes('hotel-1', [bookedReservation]),
    ).rejects.toThrow(/no door codes found/);
  });

  const subAddressedGuest = () =>
    makeGuest('g1', { email: 'ann+12345@example.com', pin: '4821' });
  const emailOnlyReservation = {
    ...bookedReservation,
    email: 'ann@example.com',
    phone: null,
  };

  it('ignores a differing RemoteLock email whatever the PMS', async () => {
    const { service } = makeService([subAddressedGuest()], 'hostaway');

    await expect(
      service.resolveDoorCodes('hotel-1', [emailOnlyReservation]),
    ).resolves.toEqual([
      expect.objectContaining({ booking_id: 'BK1', pin: '4821' }),
    ]);
  });

  it('ignores a differing RemoteLock email for a non-Hostaway hotel too', async () => {
    const { service } = makeService([subAddressedGuest()]);

    await expect(
      service.resolveDoorCodes('hotel-1', [emailOnlyReservation]),
    ).resolves.toEqual([
      expect.objectContaining({ booking_id: 'BK1', pin: '4821' }),
    ]);
  });

  it('fetches the access-guest list once for several reservations', async () => {
    const { service, getAllAccessPersons } = makeService([
      makeGuest('g1', { pin: '4821' }),
    ]);

    await service.resolveDoorCodes('hotel-1', [
      bookedReservation,
      { ...bookedReservation, booking_id: 'BK2' },
    ]);

    expect(getAllAccessPersons).toHaveBeenCalledTimes(1);
  });
});

describe('RemoteLockDoorCodeService.resolveDoorCodesByGuestName', () => {
  beforeEach(() => {
    (logKpi as jest.Mock).mockClear();
  });

  it('matches on first name and the check-out calendar date alone', async () => {
    const { service } = makeService([
      makeGuest('g1', { pin: '4821' }),
      makeGuest('g2', { name: 'Bob Jones', pin: '9137' }),
    ]);

    await expect(
      service.resolveDoorCodesByGuestName('hotel-1', 'Ann', '2026-08-05'),
    ).resolves.toEqual([
      {
        pin: '4821',
        guest_name: 'Ann Smith',
        starts_at: '2026-08-01T00:00:00',
        ends_at: '2026-08-05T00:00:00',
      },
    ]);
  });

  // ends_at carries a lock-local time, the caller supplies a bare date; only
  // the calendar day is compared.
  it('ignores the time of day on ends_at', async () => {
    const { service } = makeService([
      makeGuest('g1', { pin: '4821', ends_at: '2026-08-05T23:30:00' }),
    ]);

    await expect(
      service.resolveDoorCodesByGuestName('hotel-1', 'Ann Smith', '2026-08-05'),
    ).resolves.toHaveLength(1);
  });

  it('returns every guest sharing the first name and check-out date', async () => {
    const { service } = makeService([
      makeGuest('g1', { pin: '4821' }),
      makeGuest('g2', {
        name: 'Ann Jones',
        pin: '9137',
        starts_at: '2026-08-03T00:00:00',
      }),
    ]);

    const matches = await service.resolveDoorCodesByGuestName(
      'hotel-1',
      'Ann',
      '2026-08-05',
    );

    expect(matches).toEqual([
      expect.objectContaining({ pin: '4821', guest_name: 'Ann Smith' }),
      expect.objectContaining({
        pin: '9137',
        guest_name: 'Ann Jones',
        starts_at: '2026-08-03T00:00:00',
      }),
    ]);
    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({ stat: KpiStat.RemoteLockDoorCodeAmbiguous }),
    );
  });

  it('throws when no guest matches the name', async () => {
    const { service } = makeService([makeGuest('g1', { name: 'Bob Jones' })]);

    await expect(
      service.resolveDoorCodesByGuestName('hotel-1', 'Ann', '2026-08-05'),
    ).rejects.toThrow('no access guest with a readable PIN matched');
  });

  it('throws when the name matches but the check-out date does not', async () => {
    const { service } = makeService([makeGuest('g1', { pin: '4821' })]);

    await expect(
      service.resolveDoorCodesByGuestName('hotel-1', 'Ann', '2026-08-09'),
    ).rejects.toThrow('no access guest with a readable PIN matched');
  });

  it('skips a matching guest whose PIN is not readable', async () => {
    const { service } = makeService([makeGuest('g1', { pin: null })]);

    await expect(
      service.resolveDoorCodesByGuestName('hotel-1', 'Ann', '2026-08-05'),
    ).rejects.toThrow('no access guest with a readable PIN matched');
    expect(logKpi).toHaveBeenCalledWith(
      expect.objectContaining({ stat: KpiStat.RemoteLockDoorCodeNotFound }),
    );
  });
});
