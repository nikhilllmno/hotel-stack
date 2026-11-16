import { EscalationController } from '@/controller/escalationController';
import { CustomRequest } from '@/customheaderTypes/express';
import { BadRequestError } from '@/errors/BadRequestError';
import { EscalationService } from '@/services/escalation/escalationService';
import { Response } from 'express';

describe('EscalationController error mapping', () => {
  let controller: EscalationController;
  let mockEscalationService: jest.Mocked<
    Pick<EscalationService, 'handleEscalation'>
  >;
  let mockRes: Partial<Response>;
  let jsonSpy: jest.Mock;
  let statusSpy: jest.Mock;

  beforeEach(() => {
    jsonSpy = jest.fn();
    statusSpy = jest.fn().mockReturnValue({ json: jsonSpy });
    mockRes = { status: statusSpy } as Partial<Response>;

    mockEscalationService = {
      handleEscalation: jest.fn(),
    };

    controller = new EscalationController(
      mockEscalationService as unknown as EscalationService,
    );
  });

  it('maps a BadRequestError from handleEscalation to 400 instead of a hardcoded 500', async () => {
    mockEscalationService.handleEscalation.mockRejectedValue(
      new BadRequestError(
        'handleEscalation: Hotel is not configured for the phone number +15559990000',
      ),
    );

    const req = {
      body: { message: 'Need help', full_name: 'Jamie Rivera' },
      phoneNumber: '+15551234567',
      assistantPhoneNumber: '+15559990000',
      sessionId: 'session-1',
    } as unknown as CustomRequest;

    await controller.createEscalation(req, mockRes as Response);

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'handleEscalation: Hotel is not configured for the phone number +15559990000',
      }),
    );
  });
});
