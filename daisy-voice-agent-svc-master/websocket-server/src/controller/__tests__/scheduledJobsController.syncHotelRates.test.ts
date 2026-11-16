import { ScheduledJobsController } from '@/controller/scheduledJobsController';
import { EscalationService } from '@/services/escalation/escalationService';
import { HotelService } from '@/services/hotel/hotelService';
import { Request, Response } from 'express';

describe('ScheduledJobsController.syncHotelRates', () => {
  let controller: ScheduledJobsController;
  let mockHotelService: jest.Mocked<
    Pick<HotelService, 'syncHotelRatesForStayntouchHotels'>
  >;
  let mockRes: Partial<Response>;
  let jsonSpy: jest.Mock;
  let statusSpy: jest.Mock;

  beforeEach(() => {
    jsonSpy = jest.fn();
    statusSpy = jest.fn().mockReturnValue({ json: jsonSpy });
    mockRes = { status: statusSpy } as Partial<Response>;

    mockHotelService = {
      syncHotelRatesForStayntouchHotels: jest.fn(),
    };

    controller = new ScheduledJobsController(
      mockHotelService as unknown as HotelService,
      {} as EscalationService,
    );
  });

  it('returns 202 immediately without awaiting the sync', async () => {
    let resolveSync!: (value: any) => void;
    mockHotelService.syncHotelRatesForStayntouchHotels.mockReturnValue(
      new Promise((resolve) => {
        resolveSync = resolve;
      }),
    );

    await controller.syncHotelRates({} as Request, mockRes as Response);

    expect(statusSpy).toHaveBeenCalledWith(202);
    expect(jsonSpy).toHaveBeenCalledWith({
      success: true,
      message: 'Hotel rates sync started in background',
    });

    expect(
      mockHotelService.syncHotelRatesForStayntouchHotels,
    ).toHaveBeenCalled();

    resolveSync([]);
  });

  it('does not throw when the background sync rejects', async () => {
    mockHotelService.syncHotelRatesForStayntouchHotels.mockRejectedValue(
      new Error('PMS down'),
    );

    await controller.syncHotelRates({} as Request, mockRes as Response);

    expect(statusSpy).toHaveBeenCalledWith(202);

    // Flush the microtask queue so the .catch() handler runs without failing the test
    await new Promise((r) => setImmediate(r));
  });
});
