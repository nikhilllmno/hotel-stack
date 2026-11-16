import { NotificationController } from '@/controller/notificationController';
import { CustomRequest } from '@/customheaderTypes/express';
import { GuestCheckinSummaryService } from '@/services/guestCheckinSummaryService/GuestCheckinSummaryService';
import { Response } from 'express';

describe('NotificationController error mapping', () => {
  let controller: NotificationController;
  let mockGuestCheckinSummaryService: jest.Mocked<
    Pick<GuestCheckinSummaryService, 'sendSummaryToHotels'>
  >;
  let mockRes: Partial<Response>;
  let jsonSpy: jest.Mock;
  let statusSpy: jest.Mock;

  beforeEach(() => {
    jsonSpy = jest.fn();
    statusSpy = jest.fn().mockReturnValue({ json: jsonSpy });
    mockRes = { status: statusSpy } as Partial<Response>;

    mockGuestCheckinSummaryService = {
      sendSummaryToHotels: jest.fn(),
    };

    controller = new NotificationController(
      mockGuestCheckinSummaryService as unknown as GuestCheckinSummaryService,
    );
  });

  it('maps its own BadRequestError for a missing timezones array to 400 instead of a hardcoded 500', async () => {
    const req = { body: {} } as unknown as CustomRequest;

    await controller.sendGuestCheckinSummary(req, mockRes as Response);

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'sendGuestCheckinSummary: timezones array is missing in the request',
      }),
    );
    expect(
      mockGuestCheckinSummaryService.sendSummaryToHotels,
    ).not.toHaveBeenCalled();
  });
});
