import type { Request, Response } from 'express';
import { NoDataError } from '../../errors/NoDataError';
import { RoomReservationService } from '../../services/roomReservation/roomReservationService';
import { WebRoomReservationController } from '../webRoomReservationController';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

function createResponse() {
  const headers: Record<string, string> = {};
  const res = {} as Response & {
    statusCode?: number;
    body?: unknown;
  };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response['status'];
  res.json = jest.fn((payload: unknown) => {
    res.body = payload;
    return res;
  }) as unknown as Response['json'];
  res.set = jest.fn((name: string, value: string) => {
    headers[name] = value;
    return res;
  }) as unknown as Response['set'];
  return { res, headers };
}

function createRequest(query: Record<string, unknown>) {
  return { query } as unknown as Request;
}

const validQuery = {
  business_id: '1001',
  start_date: '2026-11-01',
  end_date: '2026-11-30',
};

describe('WebRoomReservationController.getRateCalendar', () => {
  const mockService = { getRateCalendar: jest.fn() };
  let controller: WebRoomReservationController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new WebRoomReservationController(
      mockService as unknown as RoomReservationService,
    );
  });

  it('returns the calendar with a short public cache header', async () => {
    const calendar = { hotel_name: 'Test Hotel', nights: [] };
    mockService.getRateCalendar.mockResolvedValue(calendar);
    const { res, headers } = createResponse();

    await controller.getRateCalendar(createRequest(validQuery), res);

    expect(mockService.getRateCalendar).toHaveBeenCalledWith(validQuery);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(calendar);
    expect(headers['Cache-Control']).toBe('public, max-age=300');
  });

  it('returns 400 without calling the service when a date is malformed', async () => {
    const { res } = createResponse();

    await controller.getRateCalendar(
      createRequest({ ...validQuery, start_date: '11/01/2026' }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(mockService.getRateCalendar).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown hotel', async () => {
    mockService.getRateCalendar.mockRejectedValue(
      new NoDataError('getRateCalendar: Hotel not found'),
    );
    const { res, headers } = createResponse();

    await controller.getRateCalendar(createRequest(validQuery), res);

    expect(res.statusCode).toBe(404);
    expect(headers['Cache-Control']).toBeUndefined();
  });
});
