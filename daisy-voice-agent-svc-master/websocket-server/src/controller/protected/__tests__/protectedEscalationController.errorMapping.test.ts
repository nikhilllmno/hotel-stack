import { ProtectedEscalationController } from '@/controller/protected/protectedEscalationController';
import { NoDataError } from '@/errors/NoDataError';
import { UserRole } from '@/models/User';
import { EscalationService } from '@/services/escalation/escalationService';
import { AuthenticatedRequest } from '@/types/customRequest';
import { Response } from 'express';

describe('ProtectedEscalationController error mapping', () => {
  let controller: ProtectedEscalationController;
  let mockEscalationService: jest.Mocked<
    Pick<
      EscalationService,
      'findEscalationById' | 'updateEscalation' | 'deleteEscalation'
    >
  >;
  let mockRes: Partial<Response>;
  let jsonSpy: jest.Mock;
  let statusSpy: jest.Mock;
  let sendSpy: jest.Mock;

  beforeEach(() => {
    jsonSpy = jest.fn();
    sendSpy = jest.fn();
    statusSpy = jest.fn().mockReturnValue({ json: jsonSpy, send: sendSpy });
    mockRes = {
      status: statusSpy,
      json: jsonSpy,
      send: sendSpy,
    } as unknown as Partial<Response>;

    mockEscalationService = {
      findEscalationById: jest.fn(),
      updateEscalation: jest.fn(),
      deleteEscalation: jest.fn(),
    };

    controller = new ProtectedEscalationController(
      mockEscalationService as unknown as EscalationService,
    );
  });

  it('maps a BaseError subclass thrown by the service to its own statusCode instead of a hardcoded 500', async () => {
    mockEscalationService.findEscalationById.mockRejectedValue(
      new NoDataError('Escalation lookup failed: connection reset'),
    );

    const req = {
      params: { id: 'esc-1' },
      user: { role: UserRole.ADMIN, hotel_id: 'hotel-a' },
    } as unknown as AuthenticatedRequest;

    await controller.getEscalationById(req, mockRes as Response);

    expect(statusSpy).toHaveBeenCalledWith(404);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Escalation lookup failed: connection reset',
      }),
    );
  });

  it('returns 404 when escalation belongs to another hotel', async () => {
    mockEscalationService.findEscalationById.mockResolvedValue({
      id: 'esc-1',
      hotel_id: 'hotel-b',
    } as Awaited<ReturnType<EscalationService['findEscalationById']>>);

    const req = {
      params: { id: 'esc-1' },
      user: { role: UserRole.ADMIN, hotel_id: 'hotel-a' },
    } as unknown as AuthenticatedRequest;

    await controller.getEscalationById(req, mockRes as Response);

    expect(statusSpy).toHaveBeenCalledWith(404);
    expect(jsonSpy).toHaveBeenCalledWith({ error: 'Escalation not found' });
  });

  it('blocks update when escalation belongs to another hotel', async () => {
    mockEscalationService.findEscalationById.mockResolvedValue({
      id: 'esc-1',
      hotel_id: 'hotel-b',
    } as Awaited<ReturnType<EscalationService['findEscalationById']>>);

    const req = {
      params: { id: 'esc-1' },
      body: { status: 'CLOSED' },
      user: { role: UserRole.ADMIN, hotel_id: 'hotel-a' },
    } as unknown as AuthenticatedRequest;

    await controller.updateEscalation(req, mockRes as Response);

    expect(mockEscalationService.updateEscalation).not.toHaveBeenCalled();
    expect(statusSpy).toHaveBeenCalledWith(404);
  });
});
