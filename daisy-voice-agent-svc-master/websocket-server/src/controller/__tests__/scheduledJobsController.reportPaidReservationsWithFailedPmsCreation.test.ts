import { ScheduledJobsController } from '@/controller/scheduledJobsController';
import { EscalationService } from '@/services/escalation/escalationService';
import { HotelService } from '@/services/hotel/hotelService';
import { MonitoringService } from '@/services/monitoring/monitoringService';
import { Request, Response } from 'express';

describe('ScheduledJobsController.reportPaidReservationsWithFailedPmsCreation', () => {
  let controller: ScheduledJobsController;
  let mockService: jest.Mocked<
    Pick<
      MonitoringService,
      'findAndReportPaidReservationsWithFailedPmsCreation'
    >
  >;
  let mockRes: Partial<Response>;
  let jsonSpy: jest.Mock;
  let statusSpy: jest.Mock;

  beforeEach(() => {
    jsonSpy = jest.fn();
    statusSpy = jest.fn().mockReturnValue({ json: jsonSpy });
    mockRes = { status: statusSpy } as Partial<Response>;

    mockService = {
      findAndReportPaidReservationsWithFailedPmsCreation: jest.fn(),
    };

    controller = new ScheduledJobsController(
      {} as HotelService,
      {} as EscalationService,
      mockService as unknown as MonitoringService,
    );
  });

  it('returns a 200 with the mismatch report', async () => {
    mockService.findAndReportPaidReservationsWithFailedPmsCreation.mockResolvedValue(
      {
        count: 1,
        results: [
          {
            payment_id: 'payment-1',
            reservation_id: 'reservation-1',
            hotel_id: 'hotel-1',
            status: 'alerted',
          },
        ],
      },
    );

    await controller.reportPaidReservationsWithFailedPmsCreation(
      {} as Request,
      mockRes as Response,
    );

    expect(statusSpy).toHaveBeenCalledWith(200);
    expect(jsonSpy).toHaveBeenCalledWith({
      success: true,
      message: 'Found 1 paid reservation(s) with failed PMS creation.',
      count: 1,
      results: [
        {
          payment_id: 'payment-1',
          reservation_id: 'reservation-1',
          hotel_id: 'hotel-1',
          status: 'alerted',
        },
      ],
    });
  });

  it('returns a 500 when the service throws', async () => {
    mockService.findAndReportPaidReservationsWithFailedPmsCreation.mockRejectedValue(
      new Error('DB unavailable'),
    );

    await controller.reportPaidReservationsWithFailedPmsCreation(
      {} as Request,
      mockRes as Response,
    );

    expect(statusSpy).toHaveBeenCalledWith(500);
  });
});
