import type { Response } from 'express';
import config from '../../config';
import { UpdateHotelConfigurationRequest } from '../../dtos/HotelConfiguration';
import { HotelConfiguration } from '../../models/HotelConfiguration';
import { UserRole } from '../../models/User';
import { HotelConfigurationRepository } from '../../repositories/HotelConfigurationRepository';
import { HotelRepository } from '../../repositories/HotelRepository';
import { HotelService } from '../../services/hotel/hotelService';
import { HotelConfigurationService } from '../../services/hotelConfiguration/hotelConfigurationService';
import { resolveManagerRoutingTimeoutSeconds } from '../../services/session/SessionService';
import { VapiAssistantService } from '../../services/vapi/vapiAssistantService';
import { installPgMemTestContext } from '../../test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '../../test/fixtures/reservationFlowFixture';
import { AuthenticatedRequest } from '../../types/customRequest';
import { HotelController } from '../hotelController';

/**
 * Distinctive non-timeout values so a timeout-only PUT is checked against
 * populated columns, not fixture defaults.
 *
 * payment / same-day / onboarding SMS are always re-merged on update; if they
 * stay null, a partial PUT writes `{}` and the "other fields unchanged"
 * assertion fails. Scalars use non-default values so undefined→false/null
 * would also fail.
 */
const exampleHotelConfiguration: UpdateHotelConfigurationRequest = {
  sms_agent_enabled: true,
  enable_manager_barge_in: true,
  processing_fee_percentage: 4.5,
  transcript_agent_url: 'https://n8n.example.com/transcript',
  payment_configuration: { auto_charge_days_before: 2 },
  same_day_booking_configuration: {
    allow_same_day_checkin: true,
    cutoff_time: '15:00',
    transfer_to_manager_for_same_day: false,
  },
  onboarding_sms_configuration: {
    enabled: false,
    message_template: 'welcome',
    room_config: {},
  },
};

interface HotelConfigurationApiBody {
  success: boolean;
  data: HotelConfiguration | null;
  message?: string;
}

type HotelConfigurationTestResponse = Response & {
  statusCode?: number;
  body?: HotelConfigurationApiBody;
};

function createResponse(): HotelConfigurationTestResponse {
  const res = {} as HotelConfigurationTestResponse;
  res.status = ((code: number) => {
    res.statusCode = code;
    return res;
  }) as Response['status'];
  res.json = ((payload: HotelConfigurationApiBody) => {
    res.body = payload;
    return res;
  }) as Response['json'];
  return res;
}

function expectResSuccess(
  res: HotelConfigurationTestResponse,
): HotelConfiguration {
  expect(res.statusCode).toBe(200);
  expect(res.body?.success).toBe(true);
  const data = res.body?.data;
  if (!data) {
    throw new Error('expected hotel configuration data');
  }
  return data;
}

function createAuthenticatedRequest(
  hotelId: string,
  body: Record<string, unknown> = {},
): AuthenticatedRequest {
  const req = {
    params: { id: hotelId },
    body,
    user: {
      id: 'user-1',
      username: 'superadmin',
      role: UserRole.SUPERADMIN,
    },
  };
  return req as unknown as AuthenticatedRequest;
}

function omitRoutingTimeoutAndUpdatedAt(
  configuration: HotelConfiguration,
): Record<string, unknown> {
  const fields = { ...configuration } as Record<string, unknown>;
  delete fields.manager_routing_timeout_seconds;
  delete fields.updated_at;
  return fields;
}

describe('HotelController manager_routing_timeout_seconds (pg-mem)', () => {
  const ctx = installPgMemTestContext();
  const hotelId = RESERVATION_FLOW_FIXTURE_IDS.hotelId;
  let controller: HotelController;
  let hotelConfigurationRepository: HotelConfigurationRepository;

  beforeEach(() => {
    const hotelRepository = new HotelRepository(ctx.knex);
    hotelConfigurationRepository = new HotelConfigurationRepository(ctx.knex);
    const hotelService = new HotelService(
      hotelRepository,
      hotelConfigurationRepository,
    );
    const vapiAssistantService = {
      syncStructuredOutputs: jest.fn().mockResolvedValue(undefined),
    } as unknown as VapiAssistantService;
    const hotelConfigurationService = new HotelConfigurationService(
      hotelConfigurationRepository,
      hotelRepository,
      vapiAssistantService,
    );
    controller = new HotelController(hotelService, hotelConfigurationService);
  });

  async function getHotelConfig(): Promise<HotelConfiguration> {
    const res = createResponse();
    await controller.getHotelConfiguration(
      createAuthenticatedRequest(hotelId),
      res,
    );
    return expectResSuccess(res);
  }

  async function putHotelConfig(
    body: Record<string, unknown>,
  ): Promise<HotelConfiguration> {
    const res = createResponse();
    await controller.updateHotelConfiguration(
      createAuthenticatedRequest(hotelId, body),
      res,
    );
    return expectResSuccess(res);
  }

  it('uses the global default until a partial PUT overrides only the timeout', async () => {
    // check the resolveManagerRoutingTimeoutSeconds without the manager_routing_timeout_seconds config
    // update the manager_routing_timeout_seconds with a value
    // check the resolveManagerRoutingTimeoutSeconds returns the set value
    // double check updating the manager_routing_timeout_seconds did not update anything else

    const existing = await hotelConfigurationRepository.findByHotelId(hotelId);
    if (!existing) {
      throw new Error('expected seeded hotel configuration');
    }
    await hotelConfigurationRepository.update(
      existing.id,
      exampleHotelConfiguration,
    );

    const before = await getHotelConfig();
    expect(before.manager_routing_timeout_seconds ?? null).toBeNull();
    expect(resolveManagerRoutingTimeoutSeconds(before)).toBe(
      config.MANAGER_ROUTING_TIMEOUT_SECONDS,
    );
    const fieldsBefore = omitRoutingTimeoutAndUpdatedAt(before);

    await putHotelConfig({ manager_routing_timeout_seconds: 90 });

    const after = await getHotelConfig();
    expect(after.manager_routing_timeout_seconds).toBe(90);
    expect(resolveManagerRoutingTimeoutSeconds(after)).toBe(90);
    expect(omitRoutingTimeoutAndUpdatedAt(after)).toEqual(fieldsBefore);
  });
});
