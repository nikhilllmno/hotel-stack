import { Knex } from 'knex';
import { seedReservationFlowHotel } from '../fixtures/reservationFlowFixture';
import { bindTestDatabaseKnex } from './bindTestDatabase';
import { POSTGRES_INTEGRATION_TIMEOUT_MS } from './integrationTestConstants';
import {
  createTestDbPostgresContainer,
  PostgresTestDb,
} from './testDbPostgresContainer';
import { truncateReservationFlowTables } from './truncateReservationFlowTables';

export interface PostgresIntegrationTestContextOptions {
  seedHotel?: boolean;
}

export interface PostgresIntegrationTestContext {
  knex: Knex;
}

export function installPostgresIntegrationTestContext(
  options: PostgresIntegrationTestContextOptions = {},
): PostgresIntegrationTestContext {
  const ctx = {} as PostgresIntegrationTestContext;
  let testDb: PostgresTestDb;
  let unbindTestDatabase: (() => void) | undefined;

  beforeAll(async () => {
    testDb = await createTestDbPostgresContainer();
    ctx.knex = testDb.knex;
  }, POSTGRES_INTEGRATION_TIMEOUT_MS);

  afterAll(async () => {
    if (testDb) {
      await testDb.destroy();
    }
  });

  beforeEach(async () => {
    await truncateReservationFlowTables(ctx.knex);

    if (options.seedHotel !== false) {
      await seedReservationFlowHotel(ctx.knex);
    }

    unbindTestDatabase = bindTestDatabaseKnex(ctx.knex);
  });

  afterEach(() => {
    unbindTestDatabase?.();
  });

  return ctx;
}
