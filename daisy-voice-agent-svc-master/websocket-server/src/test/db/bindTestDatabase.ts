import { Knex } from 'knex';
import { createTestDbPgMem } from './testDbPgMem';

let testKnex: Knex | null = null;
let bootstrapDb: ReturnType<typeof createTestDbPgMem> | null = null;

/**
 * Some production modules (e.g. repository default exports) construct a
 * BaseRepository at import time, which reads the mocked connection before
 * test beforeEach runs. This bootstrap instance satisfies that load-time
 * access only; tests should bind real knex via bindTestDatabaseKnex().
 */
function getBootstrapKnex(): Knex {
  if (!bootstrapDb) {
    bootstrapDb = createTestDbPgMem();
  }

  return bootstrapDb.knex;
}

export function setTestDatabaseKnex(knex: Knex): void {
  testKnex = knex;
}

export function getTestDatabaseKnex(): Knex {
  if (testKnex) {
    return testKnex;
  }

  return getBootstrapKnex();
}

export function clearTestDatabaseKnex(): void {
  testKnex = null;
}

export function bindTestDatabaseKnex(knex: Knex): () => void {
  setTestDatabaseKnex(knex);
  return () => clearTestDatabaseKnex();
}

export async function destroyBootstrapTestDatabase(): Promise<void> {
  if (bootstrapDb) {
    await bootstrapDb.destroy();
    bootstrapDb = null;
  }
}
