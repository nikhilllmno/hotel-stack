import { Knex } from 'knex';
import dotenv from 'dotenv';

dotenv.config();

const config: Knex.Config = {
  client: process.env.DATABASE_TYPE || 'postgresql',
  connection: process.env.DATABASE_URL,
  migrations: {
    directory: './dist/migrations',
    extension: 'js'
  }
};

export default config; 