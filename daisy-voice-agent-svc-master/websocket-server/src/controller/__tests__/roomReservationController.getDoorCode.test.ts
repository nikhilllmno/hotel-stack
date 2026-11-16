/* global beforeEach, describe, expect, it, jest */
import { RoomReservationController } from '@/controller/roomReservationController';
import { CustomRequest } from '@/customheaderTypes/express';
import { ReservationLookupSource } from '@/dtos/enum/ReservationLookupSource';
import { NoDataError } from '@/errors/NoDataError';
import { RemoteLockDoorCodeService } from '@/remotelock/services/doorCodeService';
import { HotelService } from '@/services/hotel/hotelService';
import { HotelConfigurationService } from '@/services/hotelConfiguration/hotelConfigurationService';
import { RoomReservationService } from '@/services/roomReservation/roomReservationService';
import { PmsProvider } from '@/types/enums';
import { DoorLockSourceOfTruth } from '@/types/hotelConfiguration';
import { logKpi } from '@/utils/kpiLogger';
import { Response } from 'express';

jest.mock('@/utils/kpiLogger', () => ({
  ...jest.requireActual('@/utils/kpiLogger'),
  logKpi: jest.fn(),
}));

const ASSISTANT_PHONE = '+15550001111';
const CALLER_PHONE = '+15552223333';
const HOTEL_ID = 'hotel-1';

function reservationRow(overrides: Record<string, unknown> = {}) {
  return {
    booking_id: 'BK1',
    check_in: '2026-08-01',
    check_out: '2026-08-05',
    customer: {
      first_name: 'Ann',
      last_name: 'Smith',
      email: 'ann@example.com',
      phone_number: '+15559998888',
    },
    ...overrides,
  };
}

describe('RoomReservationController.getDoorCode', () => {
  let controller: RoomReservationController;
  let getReservationDetails: jest.Mock;
  let resolveDoorCodes: jest.Mock;
  let resolveDoorCodesByGuestName: jest.Mock;
  let getHotelById: jest.Mock;
  let getHotelConfigurationByHotelId: jest.Mock;
  let getCloudbedsDoorCodes: jest.Mock;
  let jsonSpy: jest.Mock;
  let sendSpy: jest.Mock;
  let statusSpy: jest.Mock;
  let mockRes: Response;

  beforeEach(() => {
    jsonSpy = jest.fn();
    sendSpy = jest.fn();
    // NoDataError is re-wrapped as NoContextError and written with send();
    // every other path uses json().
    statusSpy = jest.fn().mockReturnValue({ json: jsonSpy, send: sendSpy });
    mockRes = { status: statusSpy } as unknown as Response;

    getReservationDetails = jest.fn();
    resolveDoorCodes = jest.fn();
    resolveDoorCodesByGuestName = jest.fn();
    // A Cloudbeds hotel with no door_lock_config: the RemoteLock path, as for
    // every hotel before Cloudbeds-sourced codes existed.
    getHotelById = jest
      .fn()
      .mockResolvedValue({ id: HOTEL_ID, pms_provider: PmsProvider.CLOUDBEDS });
    getHotelConfigurationByHotelId = jest.fn().mockResolvedValue(null);
    getCloudbedsDoorCodes = jest.fn();
    (logKpi as jest.Mock).mockClear();

    controller = new RoomReservationController(
      { getReservationDetails } as unknown as RoomReservationService,
      {
        resolveDoorCodes,
        resolveDoorCodesByGuestName,
      } as unknown as RemoteLockDoorCodeService,
      { getHotelById } as unknown as HotelService,
      {
        getHotelConfigurationByHotelId,
      } as unknown as HotelConfigurationService,
      { getDoorCodes: getCloudbedsDoorCodes },
    );
  });

  function request(body: Record<string, unknown>): CustomRequest {
    return {
      body,
      phoneNumber: CALLER_PHONE,
      assistantPhoneNumber: ASSISTANT_PHONE,
      hotelId: HOTEL_ID,
    } as unknown as CustomRequest;
  }

  it('keeps a Cloudbeds hotel on RemoteLock unless its door codes are sourced from Daisy', async () => {
    getHotelConfigurationByHotelId.mockResolvedValue({
      door_lock_config: {
        source_of_truth: DoorLockSourceOfTruth.ALFRED,
        door_lock_custom_field: 'check_in_code',
      },
    });
    getReservationDetails.mockResolvedValue([reservationRow()]);
    resolveDoorCodes.mockResolvedValue([{ booking_id: 'BK1', pin: '4821' }]);

    await controller.getDoorCode(
      request({ booking_id: 'BK1', session_type: 'voice' }) as never,
      mockRes,
    );

    expect(getHotelConfigurationByHotelId).toHaveBeenCalledWith(HOTEL_ID);
    expect(getCloudbedsDoorCodes).not.toHaveBeenCalled();
    expect(jsonSpy).toHaveBeenCalledWith({
      door_codes: [{ booking_id: 'BK1', pin: '4821' }],
    });
  });

  it('does not read door_lock_config for a hotel on another PMS', async () => {
    getHotelById.mockResolvedValue({
      id: HOTEL_ID,
      pms_provider: PmsProvider.HOSTAWAY,
    });
    getHotelConfigurationByHotelId.mockResolvedValue({
      door_lock_config: { source_of_truth: DoorLockSourceOfTruth.DAISY },
    });
    getReservationDetails.mockResolvedValue([reservationRow()]);
    resolveDoorCodes.mockResolvedValue([{ booking_id: 'BK1', pin: '4821' }]);

    await controller.getDoorCode(
      request({ booking_id: 'BK1', session_type: 'voice' }) as never,
      mockRes,
    );

    expect(getHotelConfigurationByHotelId).not.toHaveBeenCalled();
    expect(getCloudbedsDoorCodes).not.toHaveBeenCalled();
    expect(resolveDoorCodes).toHaveBeenCalledTimes(1);
  });

  describe('Cloudbeds hotels with door_lock_config.source_of_truth = daisy', () => {
    const DOOR_LOCK_CONFIG = {
      source_of_truth: DoorLockSourceOfTruth.DAISY,
      door_lock_custom_field: 'check_in_code',
    };
    const HOTEL = {
      id: HOTEL_ID,
      pms_provider: PmsProvider.CLOUDBEDS,
      timezone: 'America/New_York',
    };
    const DOOR_CODES = {
      success: true,
      door_codes: [
        {
          booking_id: '6098484913491',
          room: '202',
          code: '5732',
          door_code_text: 'The 1850 Hotel Room 202: 5732',
          check_in: '2026-08-01',
          check_out: '2026-08-05',
        },
      ],
    };

    function callRequest(body: Record<string, unknown>, sessionType = 'CALL') {
      return {
        ...request({ session_type: sessionType, ...body }),
        sessionType,
      } as unknown as CustomRequest;
    }

    beforeEach(() => {
      getHotelById.mockResolvedValue(HOTEL);
      getHotelConfigurationByHotelId.mockResolvedValue({
        door_lock_config: DOOR_LOCK_CONFIG,
      });
      getCloudbedsDoorCodes.mockResolvedValue(DOOR_CODES);
    });

    it("checks the booking against the caller ID and returns Cloudbeds' answer, never asking RemoteLock", async () => {
      await controller.getDoorCode(
        callRequest({ booking_id: ' 6098484913491 ' }) as never,
        mockRes,
      );

      expect(getCloudbedsDoorCodes).toHaveBeenCalledWith(
        HOTEL,
        DOOR_LOCK_CONFIG,
        { bookingId: '6098484913491', callerPhone: CALLER_PHONE },
      );
      expect(statusSpy).toHaveBeenCalledWith(200);
      expect(jsonSpy).toHaveBeenCalledWith(DOOR_CODES);
      expect(getReservationDetails).not.toHaveBeenCalled();
      expect(resolveDoorCodes).not.toHaveBeenCalled();
      expect(resolveDoorCodesByGuestName).not.toHaveBeenCalled();
    });

    it('accepts a numeric booking_id', async () => {
      await controller.getDoorCode(
        callRequest({ booking_id: 6098484913491 }) as never,
        mockRes,
      );

      expect(getCloudbedsDoorCodes.mock.calls[0][2]).toMatchObject({
        bookingId: '6098484913491',
      });
    });

    it.each([
      ['no booking_id', {}],
      ['a blank booking_id', { booking_id: '  ' }],
      ['a null booking_id', { booking_id: null }],
      [
        'only a guest name and date',
        { guest_name: 'Ann Smith', check_out_date: '2026-08-05' },
      ],
      ['only a guest name', { guest_name: 'Ann Smith' }],
    ])(
      'looks the stay up by the caller ID for a request with %s',
      async (_case, body) => {
        await controller.getDoorCode(callRequest(body) as never, mockRes);

        expect(getCloudbedsDoorCodes).toHaveBeenCalledWith(
          HOTEL,
          DOOR_LOCK_CONFIG,
          { bookingId: undefined, callerPhone: CALLER_PHONE },
        );
        expect(statusSpy).toHaveBeenCalledWith(200);
        expect(resolveDoorCodesByGuestName).not.toHaveBeenCalled();
      },
    );

    it("passes an SMS sender's number as the caller ID", async () => {
      await controller.getDoorCode(callRequest({}, 'SMS') as never, mockRes);

      expect(getCloudbedsDoorCodes.mock.calls[0][2]).toEqual({
        bookingId: undefined,
        callerPhone: CALLER_PHONE,
      });
    });

    it.each(['CHAT', 'WEB', 'EXTERNAL'])(
      'passes no caller ID for a %s session',
      async (sessionType) => {
        await controller.getDoorCode(
          callRequest({ booking_id: '6098484913491' }, sessionType) as never,
          mockRes,
        );

        expect(getCloudbedsDoorCodes.mock.calls[0][2]).toEqual({
          bookingId: '6098484913491',
          callerPhone: '',
        });
      },
    );

    it('answers a refusal with a 200, as the agent reads it', async () => {
      getCloudbedsDoorCodes.mockResolvedValue({
        success: false,
        reason: 'caller_not_on_reservation',
      });

      await controller.getDoorCode(
        callRequest({ booking_id: '6098484913491' }) as never,
        mockRes,
      );

      expect(statusSpy).toHaveBeenCalledWith(200);
      expect(jsonSpy).toHaveBeenCalledWith({
        success: false,
        reason: 'caller_not_on_reservation',
      });
    });

    it('still requires session_type', async () => {
      await controller.getDoorCode(
        {
          body: { booking_id: '6098484913491' },
          phoneNumber: CALLER_PHONE,
          assistantPhoneNumber: ASSISTANT_PHONE,
          hotelId: HOTEL_ID,
          sessionType: 'CALL',
        } as never,
        mockRes,
      );

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(getCloudbedsDoorCodes).not.toHaveBeenCalled();
    });
  });

  it('looks the booking up by booking_id alone and returns the PINs', async () => {
    getReservationDetails.mockResolvedValue([reservationRow()]);
    resolveDoorCodes.mockResolvedValue([{ booking_id: 'BK1', pin: '4821' }]);

    await controller.getDoorCode(
      request({ booking_id: 'BK1', session_type: 'voice' }) as never,
      mockRes,
    );

    // booking_id wins — no last4 is ever forwarded, and guest_name is unused.
    expect(getReservationDetails).toHaveBeenCalledWith(
      CALLER_PHONE,
      ASSISTANT_PHONE,
      'BK1',
      undefined,
      undefined,
      undefined,
      undefined,
      ReservationLookupSource.DOOR_CODE,
    );
    expect(statusSpy).toHaveBeenCalledWith(200);
    expect(jsonSpy).toHaveBeenCalledWith({
      door_codes: [{ booking_id: 'BK1', pin: '4821' }],
    });
  });

  it('shapes the customer record into the identity the matcher needs', async () => {
    getReservationDetails.mockResolvedValue([reservationRow()]);
    resolveDoorCodes.mockResolvedValue([{ booking_id: 'BK1', pin: '4821' }]);

    await controller.getDoorCode(
      request({ booking_id: 'BK1', session_type: 'voice' }) as never,
      mockRes,
    );

    expect(resolveDoorCodes).toHaveBeenCalledWith(HOTEL_ID, [
      {
        booking_id: 'BK1',
        name: 'Ann Smith',
        email: 'ann@example.com',
        phone: '+15559998888',
        check_in: '2026-08-01',
        check_out: '2026-08-05',
      },
    ]);
  });

  it('passes every reservation of a multi-room booking through in one call', async () => {
    getReservationDetails.mockResolvedValue([
      reservationRow(),
      reservationRow({ booking_id: 'BK2' }),
    ]);
    resolveDoorCodes.mockResolvedValue([
      { booking_id: 'BK1', pin: '4821' },
      { booking_id: 'BK2', pin: '9137' },
    ]);

    await controller.getDoorCode(
      request({ booking_id: 'BK1', session_type: 'voice' }) as never,
      mockRes,
    );

    expect(resolveDoorCodes).toHaveBeenCalledTimes(1);
    expect(resolveDoorCodes.mock.calls[0][1]).toHaveLength(2);
    expect(jsonSpy).toHaveBeenCalledWith({
      door_codes: [
        { booking_id: 'BK1', pin: '4821' },
        { booking_id: 'BK2', pin: '9137' },
      ],
    });
  });

  // A missing last/first name must not become the string 'undefined', which
  // would never match a RemoteLock guest but would look like a real name.
  it('tolerates a partial customer record without inventing name text', async () => {
    getReservationDetails.mockResolvedValue([
      reservationRow({
        customer: { first_name: 'Ann', last_name: null, email: null },
      }),
    ]);
    resolveDoorCodes.mockResolvedValue([{ booking_id: 'BK1', pin: '4821' }]);

    await controller.getDoorCode(
      request({ booking_id: 'BK1', session_type: 'voice' }) as never,
      mockRes,
    );

    expect(resolveDoorCodes.mock.calls[0][1][0]).toMatchObject({
      name: 'Ann',
      email: null,
      phone: undefined,
    });
  });

  it('rejects a request with neither booking_id nor guest_name before any lookup runs', async () => {
    await controller.getDoorCode(
      request({ session_type: 'voice' }) as never,
      mockRes,
    );

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(getReservationDetails).not.toHaveBeenCalled();
    expect(resolveDoorCodes).not.toHaveBeenCalled();
  });

  it('400s when the hotel cannot be resolved from the request', async () => {
    getReservationDetails.mockResolvedValue([reservationRow()]);

    const req = request({ booking_id: 'BK1', session_type: 'voice' });
    (req as { hotelId?: string }).hotelId = undefined;

    await controller.getDoorCode(req as never, mockRes);

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'getDoorCode: Unable to determine hotel',
      }),
    );
    expect(resolveDoorCodes).not.toHaveBeenCalled();
  });

  // The service withholds a PIN when several access guests match; that has to
  // reach the agent as a failure it can escalate on, never a 200 with no codes.
  it('surfaces an ambiguous match as an error and never a PIN', async () => {
    getReservationDetails.mockResolvedValue([reservationRow()]);
    resolveDoorCodes.mockRejectedValue(
      new NoDataError(
        'resolveDoorCodes: several RemoteLock access guests matched this reservation, so no PIN can be released without staff confirmation',
      ),
    );

    await controller.getDoorCode(
      request({ booking_id: 'BK1', session_type: 'voice' }) as never,
      mockRes,
    );

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('without staff confirmation'),
      }),
    );
    expect(JSON.stringify(sendSpy.mock.calls[0][0])).not.toContain('pin');
  });

  it('surfaces a booking that resolved to no reservation as an error', async () => {
    getReservationDetails.mockRejectedValue(
      new NoDataError('No reservation found for booking id 4567'),
    );

    await controller.getDoorCode(
      request({ booking_id: '4567', session_type: 'voice' }) as never,
      mockRes,
    );

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('No reservation found for booking id'),
      }),
    );
    expect(resolveDoorCodes).not.toHaveBeenCalled();
  });

  // The guest-name path is answered entirely from RemoteLock: no PMS lookup,
  // no cross-check against a reservation row.
  it('resolves a guest_name + check_out_date lookup off RemoteLock alone', async () => {
    resolveDoorCodesByGuestName.mockResolvedValue([
      {
        pin: '4821',
        guest_name: 'Ann Smith',
        starts_at: '2026-08-01T16:00:00',
        ends_at: '2026-08-05T11:00:00',
      },
    ]);

    await controller.getDoorCode(
      request({
        guest_name: 'Ann Smith',
        check_out_date: '2026-08-05',
        session_type: 'voice',
      }) as never,
      mockRes,
    );

    expect(getReservationDetails).not.toHaveBeenCalled();
    expect(resolveDoorCodesByGuestName).toHaveBeenCalledWith(
      HOTEL_ID,
      'Ann Smith',
      '2026-08-05',
    );
    expect(statusSpy).toHaveBeenCalledWith(200);
    expect(jsonSpy).toHaveBeenCalledWith({
      door_codes: [
        {
          pin: '4821',
          guest_name: 'Ann Smith',
          starts_at: '2026-08-01T16:00:00',
          ends_at: '2026-08-05T11:00:00',
        },
      ],
    });
  });

  // Two guests sharing a first name and a check-out date are handed back
  // together, name and window included, so the agent can tell them apart.
  it('returns every match when the name and date are ambiguous', async () => {
    resolveDoorCodesByGuestName.mockResolvedValue([
      {
        pin: '4821',
        guest_name: 'Ann Smith',
        starts_at: '2026-08-01T16:00:00',
        ends_at: '2026-08-05T11:00:00',
      },
      {
        pin: '9137',
        guest_name: 'Ann Jones',
        starts_at: '2026-08-03T16:00:00',
        ends_at: '2026-08-05T11:00:00',
      },
    ]);

    await controller.getDoorCode(
      request({
        guest_name: 'Ann',
        check_out_date: '2026-08-05',
        session_type: 'voice',
      }) as never,
      mockRes,
    );

    expect(statusSpy).toHaveBeenCalledWith(200);
    expect(jsonSpy.mock.calls[0][0].door_codes).toHaveLength(2);
  });

  it('surfaces a guest-name lookup that matched nothing as an error', async () => {
    resolveDoorCodesByGuestName.mockRejectedValue(
      new NoDataError(
        'resolveDoorCodesByGuestName: no access guest with a readable PIN matched that guest name and check-out date',
      ),
    );

    await controller.getDoorCode(
      request({
        guest_name: 'Ann Smith',
        check_out_date: '2026-08-09',
        session_type: 'voice',
      }) as never,
      mockRes,
    );

    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          'matched that guest name and check-out date',
        ),
      }),
    );
  });

  it('rejects a guest_name with no check_out_date before any lookup runs', async () => {
    await controller.getDoorCode(
      request({ guest_name: 'Ann Smith', session_type: 'voice' }) as never,
      mockRes,
    );

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('check_out_date is required'),
      }),
    );
    expect(getReservationDetails).not.toHaveBeenCalled();
  });

  // booking_id keeps the PMS lookup; every row it returns is passed through.
  it('passes every row through when booking_id was supplied', async () => {
    getReservationDetails.mockResolvedValue([
      reservationRow(),
      reservationRow({ booking_id: 'BK1', check_out: '2026-08-09' }),
    ]);
    resolveDoorCodes.mockResolvedValue([{ booking_id: 'BK1', pin: '4821' }]);

    await controller.getDoorCode(
      request({
        booking_id: 'BK1',
        guest_name: 'Ann Smith',
        session_type: 'voice',
      }) as never,
      mockRes,
    );

    expect(resolveDoorCodes.mock.calls[0][1]).toHaveLength(2);
  });
});
