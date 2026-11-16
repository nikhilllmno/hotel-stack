import { TeamsWebhookController } from '@/controller/webhooks/teamsWebhookController';
import { TeamsWebhookService } from '@/services/teams/teamsWebhookService';
import type { CloudAdapter } from '@microsoft/agents-hosting';
import { NextFunction, Request, Response } from 'express';

function createResponse() {
  const res = {
    headersSent: false,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response & typeof res;
}

function createHarness(options: { configured?: boolean } = {}) {
  const handleActivity = jest.fn().mockResolvedValue(undefined);
  const service = { handleActivity } as unknown as TeamsWebhookService;
  const adapter = {
    authorizeRequest: jest.fn().mockResolvedValue(undefined),
    process: jest.fn(async (_req, _res, logic) => {
      await logic({ activity: { type: 'message' } });
    }),
  };
  const controller = new TeamsWebhookController(
    () => service,
    async () => adapter as unknown as CloudAdapter,
    () => options.configured ?? true,
  );
  return { controller, adapter, handleActivity };
}

describe('TeamsWebhookController', () => {
  it('hands the authorized activity to the webhook service', async () => {
    const { controller, adapter, handleActivity } = createHarness();
    const res = createResponse();

    await controller.handleWebhook({ body: {} } as Request, res);

    expect(adapter.process).toHaveBeenCalledTimes(1);
    expect(handleActivity).toHaveBeenCalledWith({ type: 'message' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('does not fail the request when handling the activity throws', async () => {
    const { controller, handleActivity } = createHarness();
    handleActivity.mockRejectedValue(new Error('boom'));
    const res = createResponse();

    await controller.handleWebhook({ body: {} } as Request, res);

    expect(res.status).not.toHaveBeenCalled();
  });

  it('answers 500 when the adapter cannot process the request', async () => {
    const { controller, adapter } = createHarness();
    adapter.process.mockRejectedValue(new Error('bad body'));
    const res = createResponse();

    await controller.handleWebhook({ body: {} } as Request, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('answers 503 when Teams credentials are missing', async () => {
    const { controller, adapter } = createHarness({ configured: false });
    const res = createResponse();
    const next = jest.fn() as NextFunction;
    controller.requireConfigured({} as Request, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
    expect(adapter.process).not.toHaveBeenCalled();
  });
});
