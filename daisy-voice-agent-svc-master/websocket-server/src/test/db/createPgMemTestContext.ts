import { Knex } from 'knex';
import { seedReservationFlowHotel } from '../fixtures/reservationFlowFixture';
import { bindTestDatabaseKnex } from './bindTestDatabase';
import { applyReservationFlowSchema } from './schemas/reservationFlowSchema';
import { createTestDbPgMem, TestDb } from './testDbPgMem';

export interface PgMemTestContextOptions {
  seedHotel?: boolean;
}

export interface PgMemTestContext {
  knex: Knex;
}

/** One-off setup; caller calls `teardown()` when done. No Jest hooks, no app DB binding. */
export async function createPgMemTestContext(
  options: PgMemTestContextOptions = {},
): Promise<{ knex: Knex; teardown: () => Promise<void> }> {
  const testDb = createTestDbPgMem();
  await applyReservationFlowSchema(testDb.knex);

  if (options.seedHotel !== false) {
    await seedReservationFlowHotel(testDb.knex);
  }

  return {
    knex: testDb.knex,
    teardown: () => testDb.destroy(),
  };
}

/** Registers beforeEach/afterEach: fresh DB per test, binds app knex. Use in `describe`. */
export function installPgMemTestContext(
  options: PgMemTestContextOptions = {},
): PgMemTestContext {
  const ctx = {} as PgMemTestContext;
  let testDb: TestDb;
  let unbindTestDatabase: (() => void) | undefined;

  beforeEach(async () => {
    testDb = createTestDbPgMem();
    ctx.knex = testDb.knex;
    await applyReservationFlowSchema(ctx.knex);

    if (options.seedHotel !== false) {
      await seedReservationFlowHotel(ctx.knex);
    }

    unbindTestDatabase = bindTestDatabaseKnex(ctx.knex);
    // Building the pg-mem schema can pass Jest's 5s default when the full suite runs in parallel.
  }, 30_000);

  afterEach(async () => {
    unbindTestDatabase?.();
    await testDb.destroy();
  });

  return ctx;
}

export function installPgMemTestContextWithoutHotel(): PgMemTestContext {
  return installPgMemTestContext({ seedHotel: false });
}
