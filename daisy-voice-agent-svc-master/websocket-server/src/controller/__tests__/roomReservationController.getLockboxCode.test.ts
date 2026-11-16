/* global beforeEach, describe, expect, it, jest */
import { RoomReservationController } from '@/controller/roomReservationController';
import { CustomRequest } from '@/customheaderTypes/express';
import { LockboxCodeService } from '@/lockbox/services/lockboxCodeService';
import { LockboxCodeFailureReason } from '@/lockbox/types';
import { RemoteLockDoorCodeService } from '@/remotelock/services/doorCodeService';
import { RoomReservationService } from '@/services/roomReservation/roomReservationService';
import { Response } from 'express';

const HOTEL_ID = 'hotel-1';

describe('RoomReservationController.getLockboxCode', () => {
  let controller: RoomReservationController;
  let getLockboxCode: jest.Mock;
  let jsonSpy: jest.Mock;
  let statusSpy: jest.Mock;
  let mockRes: Response;

  beforeEach(() => {
    jsonSpy = jest.fn();
    statusSpy = jest.fn().mockReturnValue({ json: jsonSpy });
    mockRes = { status: statusSpy } as unknown as Response;
    getLockboxCode = jest.fn();

    controller = new RoomReservationController(
      {} as RoomReservationService,
      {} as RemoteLockDoorCodeService,
      undefined,
      undefined,
      undefined,
      { getLockboxCode } as unknown as LockboxCodeService,
    );
  });

  function request(
    body: Record<string, unknown>,
    overrides: Partial<CustomRequest> = {},
  ): CustomRequest {
    return {
      body,
      phoneNumber: '15552223333',
      assistantPhoneNumber: '15550001111',
      hotelId: HOTEL_ID,
      sessionType: 'CALL',
      ...overrides,
    } as unknown as CustomRequest;
  }

  it("looks the code up for the session's hotel and booking, and returns the result as-is", async () => {
    const result = {
      success: true,
      lockbox_number: '4',
      code: '*4821',
      lockboxes: [{ lockbox_number: '4', room_number: '8', code: '*4821' }],
    };
    getLockboxCode.mockResolvedValue(result);

    await controller.getLockboxCode(
      request({
        booking_id: ' 6098484913491 ',
        room_number: ' 8 ',
        customer_name: ' Ada Lovelace ',
        session_type: 'CALL',
        assistant_phone_number: '15550001111',
      }) as never,
      mockRes,
    );

    expect(getLockboxCode).toHaveBeenCalledWith(HOTEL_ID, {
      bookingId: '6098484913491',
      roomNumber: '8',
      customerName: 'Ada Lovelace',
    });
    expect(statusSpy).toHaveBeenCalledWith(200);
    expect(jsonSpy).toHaveBeenCalledWith(result);
  });

  it.each([['  '], [null]])(
    'needs only booking_id and customer_name, and drops a room_number of %j',
    async (roomNumber) => {
      getLockboxCode.mockResolvedValue({
        success: false,
        reason: LockboxCodeFailureReason.RESERVATION_NOT_ACTIVE,
      });

      await controller.getLockboxCode(
        request({
          booking_id: 'bk20640',
          customer_name: 'Ada Lovelace',
          room_number: roomNumber,
          session_type: 'CALL',
        }) as never,
        mockRes,
      );

      expect(getLockboxCode).toHaveBeenCalledWith(HOTEL_ID, {
        bookingId: 'BK20640',
        customerName: 'Ada Lovelace',
        roomNumber: undefined,
      });
      // A refusal is still a 200 the agent can act on.
      expect(statusSpy).toHaveBeenCalledWith(200);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        reason: 'reservation_not_active',
      });
    },
  );

  it('accepts a numeric booking_id and room_number, as voice tools may send them', async () => {
    getLockboxCode.mockResolvedValue({
      success: false,
      reason: LockboxCodeFailureReason.NOT_FOUND,
    });

    await controller.getLockboxCode(
      request({
        booking_id: 6098484913491,
        customer_name: 'Ada Lovelace',
        room_number: 8,
        session_type: 'CALL',
      }) as never,
      mockRes,
    );

    expect(getLockboxCode).toHaveBeenCalledWith(HOTEL_ID, {
      bookingId: '6098484913491',
      customerName: 'Ada Lovelace',
      roomNumber: '8',
    });
    expect(statusSpy).toHaveBeenCalledWith(200);
  });

  it.each([
    [
      'with a booking_id that is neither text nor a number',
      { booking_id: true, customer_name: 'Ada Lovelace', session_type: 'CALL' },
      'booking_id must be a string or a number',
    ],
    [
      'without customer_name',
      { booking_id: '6098484913491', room_number: '8', session_type: 'CALL' },
      'Missing customer_name',
    ],
    [
      'with an empty customer_name',
      { booking_id: '6098484913491', customer_name: '', session_type: 'CALL' },
      'customer_name cannot be empty',
    ],
    [
      'with a blank customer_name',
      {
        booking_id: '6098484913491',
        customer_name: '  ',
        session_type: 'CALL',
      },
      'customer_name cannot be empty',
    ],
    [
      'without session_type',
      { booking_id: '6098484913491', customer_name: 'Ada Lovelace' },
      'Missing session_type',
    ],
    [
      'with a room_number that is neither text nor a number',
      {
        booking_id: '6098484913491',
        customer_name: 'Ada Lovelace',
        room_number: true,
        session_type: 'CALL',
      },
      'room_number must be a string or a number',
    ],
    [
      'with a booking_phone that is neither text nor a number',
      { booking_phone: { number: '5552223333' }, session_type: 'CALL' },
      'booking_phone must be a string or a number',
    ],
    [
      'with a booking_phone over 40 characters',
      { booking_phone: '5'.repeat(41), session_type: 'CALL' },
      'booking_phone',
    ],
    [
      'with a last_name that is not text',
      { booking_phone: '5552223333', last_name: 7, session_type: 'CALL' },
      'last_name must be a string',
    ],
    [
      'with a last_name over 100 characters',
      {
        booking_phone: '5552223333',
        last_name: 'L'.repeat(101),
        session_type: 'CALL',
      },
      'last_name',
    ],
    [
      'without session_type, and no booking_id',
      { booking_phone: '5552223333', last_name: 'Lovelace' },
      'Missing session_type',
    ],
  ])('rejects a request %s', async (_case, body, message) => {
    await controller.getLockboxCode(request(body) as never, mockRes);

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(jsonSpy.mock.calls[0][0].message).toContain(message);
    expect(getLockboxCode).not.toHaveBeenCalled();
  });

  describe('without a booking_id: a phone lookup', () => {
    beforeEach(() => {
      getLockboxCode.mockResolvedValue({
        success: false,
        reason: LockboxCodeFailureReason.RESERVATION_NOT_FOUND,
      });
    });

    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['blank', '   '],
      ['null', null],
    ])(
      "uses the call's caller ID when booking_id is %s, and needs no name",
      async (_case, bookingId) => {
        await controller.getLockboxCode(
          request({ booking_id: bookingId, session_type: 'CALL' }) as never,
          mockRes,
        );

        expect(getLockboxCode).toHaveBeenCalledWith(HOTEL_ID, {
          callerPhone: '15552223333',
          bookingPhone: undefined,
          lastName: undefined,
          roomNumber: undefined,
        });
        expect(statusSpy).toHaveBeenCalledWith(200);
        expect(jsonSpy).toHaveBeenCalledWith({
          success: false,
          reason: 'reservation_not_found',
        });
      },
    );

    it('passes the number on the booking and the last name the caller gave, trimmed', async () => {
      await controller.getLockboxCode(
        request({
          booking_phone: ' +1 (555) 777-8888 ',
          last_name: ' Lovelace ',
          room_number: ' 8 ',
          customer_name: 'Ada Lovelace',
          session_type: 'CALL',
        }) as never,
        mockRes,
      );

      expect(getLockboxCode).toHaveBeenCalledWith(HOTEL_ID, {
        callerPhone: '15552223333',
        bookingPhone: '+1 (555) 777-8888',
        lastName: 'Lovelace',
        roomNumber: '8',
      });
    });

    it('accepts a booking_phone sent as a number', async () => {
      await controller.getLockboxCode(
        request({ booking_phone: 15557778888, session_type: 'CALL' }) as never,
        mockRes,
      );

      expect(getLockboxCode).toHaveBeenCalledWith(
        HOTEL_ID,
        expect.objectContaining({ bookingPhone: '15557778888' }),
      );
    });

    it.each([[''], ['  '], [null]])(
      'drops a booking_phone and last_name of %j',
      async (blank) => {
        await controller.getLockboxCode(
          request({
            booking_phone: blank,
            last_name: blank,
            session_type: 'CALL',
          }) as never,
          mockRes,
        );

        expect(getLockboxCode).toHaveBeenCalledWith(
          HOTEL_ID,
          expect.objectContaining({
            bookingPhone: undefined,
            lastName: undefined,
          }),
        );
      },
    );

    it('uses the sender of an SMS session as the caller ID', async () => {
      await controller.getLockboxCode(
        request({ session_type: 'SMS' }, { sessionType: 'SMS' }) as never,
        mockRes,
      );

      expect(getLockboxCode).toHaveBeenCalledWith(
        HOTEL_ID,
        expect.objectContaining({ callerPhone: '15552223333' }),
      );
    });

    it.each([['CHAT'], ['WEB'], ['EXTERNAL'], [undefined]])(
      'never takes the caller number of a %s session as a caller ID',
      async (sessionType) => {
        await controller.getLockboxCode(
          request(
            {
              booking_phone: '5557778888',
              session_type: sessionType ?? 'CALL',
            },
            { sessionType, phoneNumber: '5557778888' },
          ) as never,
          mockRes,
        );

        expect(getLockboxCode).toHaveBeenCalledWith(
          HOTEL_ID,
          expect.objectContaining({
            callerPhone: '',
            bookingPhone: '5557778888',
          }),
        );
      },
    );
  });

  it('rejects a request whose hotel was not resolved', async () => {
    await controller.getLockboxCode(
      request(
        {
          booking_id: '6098484913491',
          customer_name: 'Ada Lovelace',
          session_type: 'CALL',
        },
        { hotelId: undefined },
      ) as never,
      mockRes,
    );

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(getLockboxCode).not.toHaveBeenCalled();
  });

  it('answers 500 when the lookup throws unexpectedly', async () => {
    getLockboxCode.mockRejectedValue(new Error('database is down'));

    await controller.getLockboxCode(
      request({
        booking_id: '6098484913491',
        customer_name: 'Ada Lovelace',
        session_type: 'CALL',
      }) as never,
      mockRes,
    );

    expect(statusSpy).toHaveBeenCalledWith(500);
  });
});
