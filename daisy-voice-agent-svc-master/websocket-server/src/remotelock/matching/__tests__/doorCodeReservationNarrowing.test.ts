import { narrowReservationsForDoorCode } from '@/remotelock/matching/doorCodeReservationNarrowing';

describe('narrowReservationsForDoorCode', () => {
  it('keeps every row of a multi-room booking', () => {
    const rooms = [
      { id: '1', booking_id: 'BK1', check_out: '2026-08-24' },
      { id: '2', booking_id: 'BK1', check_out: '2026-08-24' },
    ];

    expect(narrowReservationsForDoorCode(rooms, '2026-08-24')).toEqual({
      status: 'ok',
      reservations: rooms,
    });
  });

  it('isolates one booking when the check-out date differs', () => {
    const wanted = { id: '1', booking_id: 'BK1', check_out: '2026-08-24' };
    const other = { id: '2', booking_id: 'BK2', check_out: '2026-08-27' };

    expect(
      narrowReservationsForDoorCode([wanted, other], '2026-08-24'),
    ).toEqual({ status: 'ok', reservations: [wanted] });
  });

  it('reports ambiguity when two bookings share the check-out date', () => {
    const result = narrowReservationsForDoorCode(
      [
        { id: '1', booking_id: 'BK1', check_out: '2026-08-24' },
        { id: '2', booking_id: 'BK2', check_out: '2026-08-24' },
      ],
      '2026-08-24',
    );

    expect(result).toEqual({ status: 'ambiguous', bookingCount: 2 });
  });

  it('reports no_match when no row checks out on that date', () => {
    expect(
      narrowReservationsForDoorCode(
        [{ id: '1', booking_id: 'BK1', check_out: '2026-08-24' }],
        '2026-08-25',
      ),
    ).toEqual({ status: 'no_match' });
  });

  it('reports no_match for an empty lookup', () => {
    expect(narrowReservationsForDoorCode([], '2026-08-24')).toEqual({
      status: 'no_match',
    });
  });

  // PMS-sourced rows carry no Daisy booking_id, so the confirmation number is
  // what groups them.
  it('groups PMS rows without a booking_id by external_id', () => {
    const rooms = [
      { id: '1', external_id: 'CONF-1', check_out: '2026-08-24' },
      { id: '2', external_id: 'CONF-1', check_out: '2026-08-24' },
    ];

    expect(narrowReservationsForDoorCode(rooms, '2026-08-24')).toEqual({
      status: 'ok',
      reservations: rooms,
    });

    expect(
      narrowReservationsForDoorCode(
        [rooms[0], { id: '3', external_id: 'CONF-2', check_out: '2026-08-24' }],
        '2026-08-24',
      ),
    ).toEqual({ status: 'ambiguous', bookingCount: 2 });
  });

  it('falls back to external_public_id, then id', () => {
    expect(
      narrowReservationsForDoorCode(
        [
          { id: '1', external_public_id: 'PUB-1', check_out: '2026-08-24' },
          { id: '2', check_out: '2026-08-24' },
        ],
        '2026-08-24',
      ),
    ).toEqual({ status: 'ambiguous', bookingCount: 2 });
  });

  it('compares a local-midnight Date check_out by calendar date', () => {
    const row = {
      id: '1',
      booking_id: 'BK1',
      check_out: new Date(2026, 7, 24),
    };

    expect(narrowReservationsForDoorCode([row], '2026-08-24')).toEqual({
      status: 'ok',
      reservations: [row],
    });
  });

  it('skips rows with no check_out', () => {
    expect(
      narrowReservationsForDoorCode(
        [{ id: '1', booking_id: 'BK1' }],
        '2026-08-24',
      ),
    ).toEqual({ status: 'no_match' });
  });
});
