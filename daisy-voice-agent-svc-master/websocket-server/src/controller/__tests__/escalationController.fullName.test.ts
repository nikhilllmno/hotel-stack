/* global beforeEach, describe, expect, it, jest */
import { EscalationController } from '@/controller/escalationController';
import { CustomRequest } from '@/customheaderTypes/express';
import { EscalationStatus } from '@/dtos/enum/EscalationStatus';
import { EscalationService } from '@/services/escalation/escalationService';
import { UNKNOWN_CALLER_NAME } from '@/validators/escalationSchema';
import { Response } from 'express';

describe('EscalationController.createEscalation caller name', () => {
  let controller: EscalationController;
  let mockEscalationService: jest.Mocked<
    Pick<EscalationService, 'handleEscalation'>
  >;
  let jsonSpy: jest.Mock;
  let statusSpy: jest.Mock;
  let mockRes: Partial<Response>;

  const buildRequest = (body: Record<string, unknown>) =>
    ({
      body,
      phoneNumber: '+15551234567',
      assistantPhoneNumber: '+15559990000',
      sessionId: 'session-1',
    }) as unknown as CustomRequest;

  beforeEach(() => {
    jsonSpy = jest.fn();
    statusSpy = jest.fn().mockReturnValue({ json: jsonSpy });
    mockRes = { status: statusSpy } as Partial<Response>;
    mockEscalationService = {
      handleEscalation: jest
        .fn()
        .mockResolvedValue({ id: 'escalation-1' } as never),
    };
    controller = new EscalationController(
      mockEscalationService as unknown as EscalationService,
    );
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace only', '   '],
    ['null', null],
  ])(
    'still takes the message when the name is %s, as "Unknown caller"',
    async (_label, fullName) => {
      const body: Record<string, unknown> = {
        message: 'EMERGENCY: water leaking from the ceiling in room 12',
      };
      if (fullName !== undefined) body.full_name = fullName;

      await controller.createEscalation(
        buildRequest(body),
        mockRes as Response,
      );

      expect(statusSpy).toHaveBeenCalledWith(201);
      expect(mockEscalationService.handleEscalation).toHaveBeenCalledWith(
        {
          phone_number: '+15551234567',
          full_name: UNKNOWN_CALLER_NAME,
          message: 'EMERGENCY: water leaking from the ceiling in room 12',
          session_id: 'session-1',
          status: EscalationStatus.OPEN,
        },
        '+15559990000',
      );
    },
  );

  it('passes a real name through unchanged', async () => {
    await controller.createEscalation(
      buildRequest({ message: 'Call me back', full_name: 'Jamie Rivera' }),
      mockRes as Response,
    );

    expect(statusSpy).toHaveBeenCalledWith(201);
    expect(mockEscalationService.handleEscalation).toHaveBeenCalledWith(
      expect.objectContaining({ full_name: 'Jamie Rivera' }),
      '+15559990000',
    );
  });

  it('still returns 400 without calling the service when the message is empty', async () => {
    await controller.createEscalation(
      buildRequest({ message: '  ', full_name: '' }),
      mockRes as Response,
    );

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(jsonSpy).toHaveBeenCalledWith({
      error: 'Validation failed',
      details: ['Message cannot be empty'],
    });
    expect(mockEscalationService.handleEscalation).not.toHaveBeenCalled();
  });
});
