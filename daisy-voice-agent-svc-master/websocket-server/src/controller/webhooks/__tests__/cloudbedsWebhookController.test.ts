import type { Request, Response } from 'express';
import type { CloudbedsWebhookService } from '../../../cloudbeds/services/cloudbedsWebhookService';
import type { CloudbedsWebhookResponse } from '../../../cloudbeds/types/WebhookPayload';
import { CloudbedsWebhookController } from '../cloudbedsWebhookController';

jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Minimal Express req/res doubles. res.status/json are chainable and record calls.
function createResponse() {
  const res = {} as Response & { statusCode?: number; body?: unknown };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response['status'];
  res.json = jest.fn((payload: unknown) => {
    res.body = payload;
    return res;
  }) as unknown as Response['json'];
  return res;
}

function createRequest(body: unknown) {
  return { body } as Request;
}

describe('CloudbedsWebhookController', () => {
  const mockWebhookService = {
    handleWebhookEvent: jest.fn(),
  };

  let controller: CloudbedsWebhookController;
  let res: ReturnType<typeof createResponse>;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new CloudbedsWebhookController(
      mockWebhookService as unknown as CloudbedsWebhookService,
    );
    res = createResponse();
  });

  it('returns 200 with the service result on success', async () => {
    const serviceResult: CloudbedsWebhookResponse = {
      success: true,
      message: 'Reservation created',
      reservation_id: 'res-uuid-1',
    };
    mockWebhookService.handleWebhookEvent.mockResolvedValue(serviceResult);

    const payload = {
      version: '1.0',
      timestamp: 1611758157.431234,
      event: 'reservation/created',
    };
    const req = createRequest(payload);

    await controller.handleWebhook(req, res);

    expect(mockWebhookService.handleWebhookEvent).toHaveBeenCalledWith(payload);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(serviceResult);
  });

  it('returns 200 for intentionally skipped events', async () => {
    const serviceResult: CloudbedsWebhookResponse = {
      success: true,
      message: 'Event type reservation/unknown not handled',
    };
    mockWebhookService.handleWebhookEvent.mockResolvedValue(serviceResult);

    const req = createRequest({
      version: '1.0',
      timestamp: 1611758157.431234,
      event: 'reservation/unknown',
    });

    await controller.handleWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(serviceResult);
  });

  it('returns 400 when the event field is missing', async () => {
    const req = createRequest({
      version: '1.0',
      timestamp: 1611758157.431234,
    });

    await controller.handleWebhook(req, res);

    expect(mockWebhookService.handleWebhookEvent).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Missing required field: event',
    });
  });

  it('returns 400 when the request body is empty', async () => {
    const req = createRequest(undefined);

    await controller.handleWebhook(req, res);

    expect(mockWebhookService.handleWebhookEvent).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Missing required field: event',
    });
  });

  it('returns 500 when the service throws', async () => {
    mockWebhookService.handleWebhookEvent.mockRejectedValue(
      new Error('No Cloudbeds credentials configured for hotel hotel-uuid-1'),
    );

    const req = createRequest({
      version: '1.0',
      timestamp: 1611758157.431234,
      event: 'reservation/created',
    });

    await controller.handleWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Internal error processing webhook',
    });
  });
});
