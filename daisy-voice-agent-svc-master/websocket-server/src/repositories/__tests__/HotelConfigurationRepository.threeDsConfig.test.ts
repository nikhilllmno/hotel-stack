import { HotelConfigurationRepository } from '@/repositories/HotelConfigurationRepository';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';

describe('HotelConfigurationRepository threeDS_config (pg-mem)', () => {
  const ctx = installPgMemTestContext();
  let repository: HotelConfigurationRepository;

  beforeEach(() => {
    repository = new HotelConfigurationRepository(ctx.knex);
  });

  it('defaults to null for a freshly seeded hotel configuration', async () => {
    const config = await repository.findByHotelId(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
    );

    expect(config?.threeDS_config ?? null).toBeNull();
  });

  it('writes and reads back threeDS_config { enabled: true }', async () => {
    const existing = await repository.findByHotelId(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
    );
    expect(existing).not.toBeNull();

    await repository.update(existing!.id, {
      threeDS_config: { enabled: true },
    });

    const updated = await repository.findByHotelId(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
    );
    expect(updated?.threeDS_config).toEqual({ enabled: true });
  });

  it('can be turned back off (enabled: false)', async () => {
    const existing = await repository.findByHotelId(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
    );

    await repository.update(existing!.id, {
      threeDS_config: { enabled: true },
    });
    await repository.update(existing!.id, {
      threeDS_config: { enabled: false },
    });

    const updated = await repository.findByHotelId(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
    );
    expect(updated?.threeDS_config).toEqual({ enabled: false });
  });
});
