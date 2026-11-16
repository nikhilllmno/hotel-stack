import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import knex, { Knex } from 'knex';
import path from 'path';
import { throwIntegrationSetupFailure } from './integrationSetupFailure';
import { POSTGRES_INTEGRATION_TIMEOUT_MS } from './integrationTestConstants';

export interface PostgresTestDb {
  knex: Knex;
  destroy: () => Promise<void>;
}

export async function createTestDbPostgresContainer(): Promise<PostgresTestDb> {
  let container: StartedPostgreSqlContainer | undefined;
  let db: Knex | undefined;

  async function destroyPostgresTestResources(): Promise<void> {
    if (db) {
      try {
        await db.destroy();
      } catch (cleanupError) {
        console.error(
          'Failed to close Knex connection during integration test cleanup:',
          cleanupError,
        );
      }
    }

    if (container) {
      try {
        await container.stop();
      } catch (stopError) {
        console.error(
          'Failed to stop Postgres test container during cleanup:',
          stopError,
        );
      }
    }
  }

  try {
    container = await new PostgreSqlContainer('postgres:16')
      .withDatabase('testdb')
      .withUsername('test')
      .withPassword('test')
      .withStartupTimeout(POSTGRES_INTEGRATION_TIMEOUT_MS)
      .start();
  } catch (error) {
    throwIntegrationSetupFailure('postgres container start', error);
  }

  const connectionUri = container.getConnectionUri();
  process.env.DATABASE_URL = connectionUri;

  db = knex({
    client: 'pg',
    connection: connectionUri,
    migrations: {
      directory: path.join(__dirname, '../../migrations'),
      extension: 'ts',
      loadExtensions: ['.ts'],
      tableName: 'knex_migrations',
    },
  });

  try {
    await db.migrate.latest();
  } catch (error) {
    await destroyPostgresTestResources();
    throwIntegrationSetupFailure('knex migrations', error);
  }

  return {
    knex: db,
    destroy: destroyPostgresTestResources,
  };
}
