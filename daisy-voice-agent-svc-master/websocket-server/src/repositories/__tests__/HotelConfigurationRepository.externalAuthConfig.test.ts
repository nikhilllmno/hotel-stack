import { HotelConfigurationRepository } from '@/repositories/HotelConfigurationRepository';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import { encrypt } from '@/utils/encryption';

describe('HotelConfigurationRepository external_auth_config (pg-mem)', () => {
  const ctx = installPgMemTestContext();
  let repository: HotelConfigurationRepository;

  beforeEach(() => {
    repository = new HotelConfigurationRepository(ctx.knex);
  });

  it('is null for a freshly seeded hotel configuration', async () => {
    const config = await repository.findExternalAuthConfigByHotelId(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
    );

    expect(config).toBeNull();
  });

  it('writes and reads back an apiToken (e.g. Stayntouch token refresh)', async () => {
    const encrypted = encrypt('stayntouch-bearer-token');

    await repository.updateExternalAuthConfigApiTokenByHotelId(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      encrypted,
    );

    const config = await repository.findExternalAuthConfigByHotelId(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
    );

    expect(config).toEqual({ apiToken: encrypted, disabledAt: null });
  });

  it('clears disabledAt when the apiToken is refreshed (re-enables the integration)', async () => {
    const disabledAt = new Date('2026-08-01T00:00:00.000Z');
    await repository.updateExternalAuthConfigApiTokenByHotelId(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      encrypt('old-token'),
    );
    await repository.setExternalAuthConfigDisabledAt(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      disabledAt,
    );

    const refreshed = encrypt('refreshed-token');
    await repository.updateExternalAuthConfigApiTokenByHotelId(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      refreshed,
    );

    const config = await repository.findExternalAuthConfigByHotelId(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
    );

    expect(config).toEqual({
      apiToken: refreshed,
      disabledAt: null,
    });
  });

  it('sets and clears disabledAt while preserving apiToken (Cloudbeds appstate_changed)', async () => {
    const encrypted = encrypt('cbat_token');
    await repository.updateExternalAuthConfigApiTokenByHotelId(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      encrypted,
    );

    await repository.setExternalAuthConfigDisabledAt(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      new Date('2026-08-01T00:00:00.000Z'),
    );
    const disabled = await repository.findExternalAuthConfigByHotelId(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
    );
    expect(disabled?.disabledAt).toBe('2026-08-01T00:00:00.000Z');
    expect(disabled?.apiToken).toBe(encrypted);

    await repository.setExternalAuthConfigDisabledAt(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      null,
    );
    const reEnabled = await repository.findExternalAuthConfigByHotelId(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
    );
    expect(reEnabled?.disabledAt).toBeNull();
    expect(reEnabled?.apiToken).toBe(encrypted);
  });

  it('no-ops when disabling a hotel with no external_auth_config yet', async () => {
    const updatedCount = await repository.setExternalAuthConfigDisabledAt(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      new Date(),
    );

    expect(updatedCount).toBe(0);
    const config = await repository.findExternalAuthConfigByHotelId(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
    );
    expect(config).toBeNull();
  });
});
