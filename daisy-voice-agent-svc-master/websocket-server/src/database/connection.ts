import knex, { Knex } from 'knex';
import config from '../config';
import logger from '../utils/logger';

if (!config.DATABASE_URL) {
  throw new Error('Missing required database configuration: DATABASE_URL');
}

// Create the database connection configuration
const dbConfig: Knex.Config = {
  client: 'pg',
  connection: config.DATABASE_URL,
  pool: {
    min: 2,
    max: 10,
    createTimeoutMillis: 3000,
    acquireTimeoutMillis: 30000,
    idleTimeoutMillis: 30000,
    reapIntervalMillis: 1000,
    createRetryIntervalMillis: 100,
    propagateCreateError: false,
  },
  migrations: {
    tableName: 'knex_migrations',
    directory: '../migrations',
  },
};

// Create the database connection
const db = knex(dbConfig);

// Test the connection
const testConnection = async () => {
  try {
    await db.raw('SELECT 1');
    logger.info('✅ Database connection established successfully');
  } catch (error) {
    logger.error(
      `❌ Failed to establish database connection: ${JSON.stringify(error)}`,
    );
    process.exit(1);
  }
};

const closeDatabaseConnection = async () => {
  try {
    await db.destroy();
    logger.info('Database connection closed');
    process.exit(0);
  } catch (error) {
    logger.error('Error closing database connection', error);
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== 'test') {
  // Handle process termination (Ctrl+C locally, SIGTERM from Docker/K8s)
  process.on('SIGINT', closeDatabaseConnection);
  process.on('SIGTERM', closeDatabaseConnection);

  // Initialize connection
  testConnection();
}

export default db;
