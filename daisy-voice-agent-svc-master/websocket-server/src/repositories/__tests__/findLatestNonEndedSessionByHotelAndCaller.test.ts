import { Knex } from 'knex';
import { SessionType } from '../../dtos/enum/SessionType';
import { StatusUpdateType } from '../../models/request/StatusUpdate';
import { SessionRepository } from '../SessionRepository';

describe('SessionRepository.findLatestNonEndedSessionByHotelAndCaller', () => {
  let query: {
    where: jest.Mock;
    whereNot: jest.Mock;
    whereRaw: jest.Mock;
    orderBy: jest.Mock;
    first: jest.Mock;
  };
  let db: jest.Mock;
  let repository: SessionRepository;

  beforeEach(() => {
    query = {
      where: jest.fn(),
      whereNot: jest.fn(),
      whereRaw: jest.fn(),
      orderBy: jest.fn(),
      first: jest.fn().mockResolvedValue(null),
    };
    query.where.mockReturnValue(query);
    query.whereNot.mockReturnValue(query);
    query.whereRaw.mockReturnValue(query);
    query.orderBy.mockReturnValue(query);

    db = jest.fn().mockReturnValue(query);
    repository = new SessionRepository(db as unknown as Knex);
  });

  it('orders by last_messaged_at DESC NULLS LAST then created_at DESC', async () => {
    await repository.findLatestNonEndedSessionByHotelAndCaller(
      'hotel-1',
      '+15551234567',
      SessionType.SMS,
    );

    expect(db).toHaveBeenCalledWith('sessions');
    expect(query.where).toHaveBeenCalledWith({
      hotel_id: 'hotel-1',
      session_type: SessionType.SMS,
    });
    expect(query.whereNot).toHaveBeenCalledWith(
      'session_status',
      StatusUpdateType.Ended,
    );
    expect(query.whereRaw).toHaveBeenCalledWith(
      "regexp_replace(caller_phone_number, '[^0-9]', '', 'g') = ?",
      ['15551234567'],
    );
    expect(query.orderBy).toHaveBeenNthCalledWith(1, [
      { column: 'last_messaged_at', order: 'desc', nulls: 'last' },
    ]);
    expect(query.orderBy).toHaveBeenNthCalledWith(2, 'created_at', 'desc');
    expect(query.first).toHaveBeenCalled();
  });

  it('returns the matched session row when present', async () => {
    const session = { id: 'session-1', hotel_id: 'hotel-1' };
    query.first.mockResolvedValue(session);

    const result = await repository.findLatestNonEndedSessionByHotelAndCaller(
      'hotel-1',
      '5551234567',
      SessionType.CHAT,
    );

    expect(result).toBe(session);
    expect(query.where).toHaveBeenCalledWith({
      hotel_id: 'hotel-1',
      session_type: SessionType.CHAT,
    });
  });
});
