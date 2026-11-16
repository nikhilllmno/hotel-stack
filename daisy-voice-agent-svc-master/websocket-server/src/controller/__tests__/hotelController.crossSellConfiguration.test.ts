/* global beforeEach, describe, expect, it, jest */
import type { Response } from 'express';
import { HotelConfiguration } from '../../models/HotelConfiguration';
import { UserRole } from '../../models/User';
import { HotelConfigurationRepository } from '../../repositories/HotelConfigurationRepository';
import { HotelRepository } from '../../repositories/HotelRepository';
import { HotelService } from '../../services/hotel/hotelService';
import { HotelConfigurationService } from '../../services/hotelConfiguration/hotelConfigurationService';
import { VapiAssistantService } from '../../services/vapi/vapiAssistantService';
import { installPgMemTestContext } from '../../test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '../../test/fixtures/reservationFlowFixture';
import { AuthenticatedRequest } from '../../types/customRequest';
import { HotelController } from '../hotelController';

const HAVEN = {
  hotel_id: '33333333-3333-4333-8333-333333333333',
  name: 'The Haven Hotel',
  website: 'https://havenhotel.co',
};
const MANOR = {
  hotel_id: '44444444-4444-4444-8444-444444444444',
  name: 'The Blowing Rock Manor',
  distance_miles: 0.3,
};

type TestResponse = Response & {
  statusCode?: number;
  body?: { success: boolean; data: HotelConfiguration | null };
};

function createResponse(): TestResponse {
  const res = {} as TestResponse;
  res.status = ((code: number) => {
    res.statusCode = code;
    return res;
  }) as Response['status'];
  res.json = ((payload: TestResponse['body']) => {
    res.body = payload;
    return res;
  }) as Response['json'];
  return res;
}

describe('HotelController cross_sell_configuration (pg-mem)', () => {
  const ctx = installPgMemTestContext();
  const hotelId = RESERVATION_FLOW_FIXTURE_IDS.hotelId;
  let controller: HotelController;
  let hotelConfigurationRepository: HotelConfigurationRepository;

  beforeEach(() => {
    const hotelRepository = new HotelRepository(ctx.knex);
    hotelConfigurationRepository = new HotelConfigurationRepository(ctx.knex);
    const vapiAssistantService = {
      syncStructuredOutputs: jest.fn().mockResolvedValue(undefined),
    } as unknown as VapiAssistantService;
    controller = new HotelController(
      new HotelService(hotelRepository, hotelConfigurationRepository),
      new HotelConfigurationService(
        hotelConfigurationRepository,
        hotelRepository,
        vapiAssistantService,
      ),
    );
  });

  async function putCrossSell(crossSell: unknown) {
    const res = createResponse();
    await controller.updateHotelConfiguration(
      {
        params: { id: hotelId },
        body: { cross_sell_configuration: crossSell },
        user: { id: 'user-1', username: 'admin', role: UserRole.SUPERADMIN },
      } as unknown as AuthenticatedRequest,
      res,
    );
    return res;
  }

  async function stored() {
    return (await hotelConfigurationRepository.findByHotelId(hotelId))
      ?.cross_sell_configuration;
  }

  it('saves the sister hotels sent in a PUT (it used to drop them)', async () => {
    const config = { enabled: true, sister_properties: [HAVEN, MANOR] };

    const res = await putCrossSell(config);

    expect(res.statusCode).toBe(200);
    expect(res.body?.data?.cross_sell_configuration).toEqual(config);
    await expect(stored()).resolves.toEqual(config);
  });

  it('replaces the whole list, so a sister hotel can be removed or reordered', async () => {
    await putCrossSell({ enabled: true, sister_properties: [HAVEN, MANOR] });

    await putCrossSell({ enabled: true, sister_properties: [MANOR] });

    await expect(stored()).resolves.toEqual({
      enabled: true,
      sister_properties: [MANOR],
    });
  });

  it('leaves the sister hotels alone when a PUT does not mention them', async () => {
    await putCrossSell({ enabled: true, sister_properties: [HAVEN] });

    const res = createResponse();
    await controller.updateHotelConfiguration(
      {
        params: { id: hotelId },
        body: { sms_agent_enabled: true },
        user: { id: 'user-1', username: 'admin', role: UserRole.SUPERADMIN },
      } as unknown as AuthenticatedRequest,
      res,
    );

    expect(res.statusCode).toBe(200);
    await expect(stored()).resolves.toEqual({
      enabled: true,
      sister_properties: [HAVEN],
    });
  });

  it('clears cross-sell with null', async () => {
    await putCrossSell({ enabled: true, sister_properties: [HAVEN] });

    await putCrossSell(null);

    await expect(stored()).resolves.toBeNull();
  });

  it('rejects an invalid sister list with a 400 and keeps what was stored', async () => {
    await putCrossSell({ enabled: true, sister_properties: [HAVEN] });

    const res = await putCrossSell({
      enabled: true,
      sister_properties: [{ hotel_id: 'not-a-uuid', name: 'X' }],
    });

    expect(res.statusCode).toBe(400);
    await expect(stored()).resolves.toEqual({
      enabled: true,
      sister_properties: [HAVEN],
    });
  });
});
