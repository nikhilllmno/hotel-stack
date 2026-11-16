import { ConversationMessageRole } from '../../../dtos/enum/ConversationMessageRole';
import { SessionType } from '../../../dtos/enum/SessionType';
import { NoDataError } from '../../../errors/NoDataError';
import { Session } from '../../../models/Session';
import { StatusUpdateType } from '../../../models/request/StatusUpdate';
import { HotelService } from '../../hotel/hotelService';
import { RoomReservationService } from '../../roomReservation/roomReservationService';
import { SessionService } from '../SessionService';

describe('SessionService.getChannelHistoryByCallerPhone', () => {
  const hotelId = 'hotel-1';
  const callerPhone = '+15551234567';
  const sessionId = 'session-1';
  const paginationReq = {
    base_path: '/conversations/channel-history?',
    query_params: { page: '1', limit: '20' },
  };

  let sessionRepository: {
    findLatestNonEndedSessionByHotelAndCaller: jest.Mock;
  };
  let hotelService: { getHotelById: jest.Mock };
  let service: SessionService;
  let listUserAndAiMessagesForSessionSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    sessionRepository = {
      findLatestNonEndedSessionByHotelAndCaller: jest.fn(),
    };
    hotelService = {
      getHotelById: jest.fn().mockResolvedValue({ id: hotelId }),
    };
    service = new SessionService({
      hotelService: hotelService as unknown as HotelService,
      roomReservationService: {} as RoomReservationService,
    });
    (
      service as unknown as { sessionRepository: typeof sessionRepository }
    ).sessionRepository = sessionRepository;
  });

  afterEach(() => {
    listUserAndAiMessagesForSessionSpy?.mockRestore();
  });

  it('throws NoDataError when no non-ended session exists', async () => {
    sessionRepository.findLatestNonEndedSessionByHotelAndCaller.mockResolvedValue(
      null,
    );

    await expect(
      service.getChannelHistoryByCallerPhone(
        hotelId,
        callerPhone,
        SessionType.SMS,
        1,
        20,
        paginationReq,
      ),
    ).rejects.toBeInstanceOf(NoDataError);
  });

  it('defaults includeToolCalls to true and delegates message listing', async () => {
    const foundSession = {
      id: sessionId,
      hotel_id: hotelId,
      session_type: SessionType.SMS,
      session_status: StatusUpdateType.InProgress,
      caller_phone_number: callerPhone,
    } as Session;

    sessionRepository.findLatestNonEndedSessionByHotelAndCaller.mockResolvedValue(
      foundSession,
    );

    const expected = {
      data: [
        {
          id: 'm1',
          role: ConversationMessageRole.USER,
          message: 'hi',
          timestamp: new Date('2026-01-01T00:00:00Z'),
          created_at: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      pagination: {
        current_page: 1,
        limit: 20,
        total: 1,
        total_pages: 1,
        next_page: '',
        prev_page: '',
      },
    };

    listUserAndAiMessagesForSessionSpy = jest
      .spyOn(
        service as unknown as {
          listUserAndAiMessagesForSession: SessionService['listSmsInboxMessages'];
        },
        'listUserAndAiMessagesForSession',
      )
      .mockResolvedValue(expected);

    const result = await service.getChannelHistoryByCallerPhone(
      hotelId,
      callerPhone,
      SessionType.SMS,
      1,
      20,
      paginationReq,
    );

    expect(
      sessionRepository.findLatestNonEndedSessionByHotelAndCaller,
    ).toHaveBeenCalledWith(hotelId, callerPhone, SessionType.SMS);
    expect(hotelService.getHotelById).toHaveBeenCalledWith(hotelId);
    expect(listUserAndAiMessagesForSessionSpy).toHaveBeenCalledWith(
      foundSession,
      1,
      20,
      paginationReq,
      true,
    );
    expect(result).toEqual(expected);
  });

  it('passes includeToolCalls=false through to message listing', async () => {
    const foundSession = {
      id: sessionId,
      hotel_id: hotelId,
      session_type: SessionType.SMS,
      session_status: StatusUpdateType.InProgress,
      caller_phone_number: callerPhone,
    } as Session;

    sessionRepository.findLatestNonEndedSessionByHotelAndCaller.mockResolvedValue(
      foundSession,
    );

    listUserAndAiMessagesForSessionSpy = jest
      .spyOn(
        service as unknown as {
          listUserAndAiMessagesForSession: SessionService['listSmsInboxMessages'];
        },
        'listUserAndAiMessagesForSession',
      )
      .mockResolvedValue({
        data: [],
        pagination: {
          current_page: 1,
          limit: 20,
          total: 0,
          total_pages: 0,
          next_page: '',
          prev_page: '',
        },
      });

    await service.getChannelHistoryByCallerPhone(
      hotelId,
      callerPhone,
      SessionType.SMS,
      1,
      20,
      paginationReq,
      false,
    );

    expect(listUserAndAiMessagesForSessionSpy).toHaveBeenCalledWith(
      foundSession,
      1,
      20,
      paginationReq,
      false,
    );
  });

  it('looks up the requested session type (e.g. CHAT)', async () => {
    sessionRepository.findLatestNonEndedSessionByHotelAndCaller.mockResolvedValue(
      null,
    );

    await expect(
      service.getChannelHistoryByCallerPhone(
        hotelId,
        callerPhone,
        SessionType.CHAT,
        1,
        20,
        paginationReq,
      ),
    ).rejects.toBeInstanceOf(NoDataError);

    expect(
      sessionRepository.findLatestNonEndedSessionByHotelAndCaller,
    ).toHaveBeenCalledWith(hotelId, callerPhone, SessionType.CHAT);
  });
});
