import { HotelRepository } from '@/repositories/HotelRepository';
import { HotelService } from '@/services/hotel/hotelService';
import { installPostgresIntegrationTestContext } from '@/test/db/createPostgresIntegrationTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';

describe('HotelService integration (postgres)', () => {
  const ctx = installPostgresIntegrationTestContext();
  let hotelService: HotelService;

  beforeEach(() => {
    hotelService = new HotelService(new HotelRepository(ctx.knex));
  });

  it('finds seeded hotel by assistant phone number and business id', async () => {
    const byPhone = await hotelService.getHotelByAssistantPhoneNumber(
      RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
    );
    const byBusinessId = await hotelService.getHotelByBusinessId(
      RESERVATION_FLOW_FIXTURE_IDS.businessId,
    );

    expect(byPhone).toMatchObject({
      assistant_phone_number: RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
      business_id: RESERVATION_FLOW_FIXTURE_IDS.businessId,
      id: RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      name: RESERVATION_FLOW_FIXTURE_IDS.hotelName,
    });
    expect(byBusinessId).toMatchObject({
      assistant_phone_number: RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
      business_id: RESERVATION_FLOW_FIXTURE_IDS.businessId,
      id: RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      name: RESERVATION_FLOW_FIXTURE_IDS.hotelName,
    });
  });
});
