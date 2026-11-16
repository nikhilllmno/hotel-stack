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
import {
  DoorLockSourceOfTruth,
  LockboxLogProvider,
} from '../../types/hotelConfiguration';
import { HotelController } from '../hotelController';

const LOCKBOX_LOG = {
  provider: LockboxLogProvider.DROPBOX_EXCEL,
  shared_link:
    'https://www.dropbox.com/scl/fi/abc123/Lockbox%20Log.xlsm?rlkey=k&dl=0',
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

describe('HotelController door_lock_config (pg-mem)', () => {
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

  async function putDoorLockConfig(doorLockConfig: unknown) {
    const res = createResponse();
    await controller.updateHotelConfiguration(
      {
        params: { id: hotelId },
        body: { door_lock_config: doorLockConfig },
        user: { id: 'user-1', username: 'admin', role: UserRole.SUPERADMIN },
      } as unknown as AuthenticatedRequest,
      res,
    );
    expect(res.statusCode).toBe(200);
    const stored = await hotelConfigurationRepository.findByHotelId(hotelId);
    return stored?.door_lock_config;
  }

  it('adds a lockbox log without dropping the door-code settings already there', async () => {
    const existing = await hotelConfigurationRepository.findByHotelId(hotelId);
    await hotelConfigurationRepository.update(existing!.id, {
      door_lock_config: {
        source_of_truth: DoorLockSourceOfTruth.DAISY,
        door_lock_custom_field: 'door_code',
      },
    });

    await expect(
      putDoorLockConfig({ lockbox_log: LOCKBOX_LOG }),
    ).resolves.toEqual({
      source_of_truth: DoorLockSourceOfTruth.DAISY,
      door_lock_custom_field: 'door_code',
      lockbox_log: LOCKBOX_LOG,
    });
  });

  it('clears just the lockbox log, or the whole door_lock_config', async () => {
    await putDoorLockConfig({
      source_of_truth: DoorLockSourceOfTruth.ALFRED,
      lockbox_log: LOCKBOX_LOG,
    });

    await expect(putDoorLockConfig({ lockbox_log: null })).resolves.toEqual({
      source_of_truth: DoorLockSourceOfTruth.ALFRED,
      lockbox_log: null,
    });
    await expect(putDoorLockConfig(null)).resolves.toBeNull();
  });
});
