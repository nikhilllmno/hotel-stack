import { AlfredController } from '@/controller/alfredController';
import { CustomRequest } from '@/customheaderTypes/express';
import { AlfredService } from '@/services/alfred/alfredService';
import { Response } from 'express';

describe('AlfredController.extractLookupParams validation', () => {
  let controller: AlfredController;
  let mockAlfredService: jest.Mocked<
    Pick<AlfredService, 'getDoorCodeByExternalPartner'>
  >;
  let mockRes: Partial<Response>;
  let jsonSpy: jest.Mock;
  let statusSpy: jest.Mock;

  beforeEach(() => {
    jsonSpy = jest.fn();
    statusSpy = jest.fn().mockReturnValue({ json: jsonSpy });
    mockRes = { status: statusSpy } as Partial<Response>;

    mockAlfredService = {
      getDoorCodeByExternalPartner: jest.fn(),
    };

    controller = new AlfredController(
      mockAlfredService as unknown as AlfredService,
    );
  });

  it('rejects a non-string last_name instead of forwarding it to the payment guard', async () => {
    const req = {
      body: {
        tenant_id: 'prop_test',
        last_name: { $ne: null },
        checkout_date: '2026-08-25',
      },
      phoneNumber: '+15551234567',
      assistantPhoneNumber: '+15559876543',
    } as unknown as CustomRequest;

    await controller.getDoorCodeByExternalPartner(req, mockRes as Response);

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'last_name and checkout_date must be strings',
      }),
    );
    expect(
      mockAlfredService.getDoorCodeByExternalPartner,
    ).not.toHaveBeenCalled();
  });

  it('rejects a non-string checkout_date instead of forwarding it to the payment guard', async () => {
    const req = {
      body: {
        tenant_id: 'prop_test',
        last_name: 'Guest',
        checkout_date: ['2026-08-25'],
      },
      phoneNumber: '+15551234567',
      assistantPhoneNumber: '+15559876543',
    } as unknown as CustomRequest;

    await controller.getDoorCodeByExternalPartner(req, mockRes as Response);

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'last_name and checkout_date must be strings',
      }),
    );
    expect(
      mockAlfredService.getDoorCodeByExternalPartner,
    ).not.toHaveBeenCalled();
  });

  it('rejects an external_partner_id that is neither a string nor a number', async () => {
    const req = {
      body: {
        tenant_id: 'prop_test',
        external_partner_id: { toString: () => '4123' },
      },
      phoneNumber: '+15551234567',
      assistantPhoneNumber: '+15559876543',
    } as unknown as CustomRequest;

    await controller.getDoorCodeByExternalPartner(req, mockRes as Response);

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'external_partner_id must be a string or number',
      }),
    );
    expect(
      mockAlfredService.getDoorCodeByExternalPartner,
    ).not.toHaveBeenCalled();
  });

  it('accepts a numeric external_partner_id, coercing it to a string', async () => {
    mockAlfredService.getDoorCodeByExternalPartner.mockResolvedValue({
      doorCode: '1234',
      doorCodeSpoken: 'one two three four',
    });
    const req = {
      body: {
        tenant_id: 'prop_test',
        external_partner_id: 4123,
      },
      phoneNumber: '+15551234567',
      assistantPhoneNumber: '+15559876543',
    } as unknown as CustomRequest;

    await controller.getDoorCodeByExternalPartner(req, mockRes as Response);

    expect(statusSpy).toHaveBeenCalledWith(200);
    expect(mockAlfredService.getDoorCodeByExternalPartner).toHaveBeenCalledWith(
      {
        externalPartnerId: '4123',
        tenantId: 'prop_test',
      },
      {
        assistantPhoneNumber: '+15559876543',
        customerPhoneNumber: '+15551234567',
      },
    );
  });

  it('accepts a well-formed last_name + checkout_date request', async () => {
    mockAlfredService.getDoorCodeByExternalPartner.mockResolvedValue({
      doorCode: '1234',
      doorCodeSpoken: 'one two three four',
    });
    const req = {
      body: {
        tenant_id: 'prop_test',
        last_name: 'Guest',
        checkout_date: '2026-08-25',
      },
      phoneNumber: '+15551234567',
      assistantPhoneNumber: '+15559876543',
    } as unknown as CustomRequest;

    await controller.getDoorCodeByExternalPartner(req, mockRes as Response);

    expect(statusSpy).toHaveBeenCalledWith(200);
    expect(mockAlfredService.getDoorCodeByExternalPartner).toHaveBeenCalledWith(
      {
        lastName: 'Guest',
        checkoutDate: '2026-08-25',
        tenantId: 'prop_test',
      },
      {
        assistantPhoneNumber: '+15559876543',
        customerPhoneNumber: '+15551234567',
      },
    );
  });
});
