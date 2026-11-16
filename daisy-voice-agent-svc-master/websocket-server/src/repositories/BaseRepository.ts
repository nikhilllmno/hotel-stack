import { Knex } from 'knex';
import db from '../database/connection';

export abstract class BaseRepository {
  protected db: Knex;

  constructor(dbInstance?: Knex) {
    this.db = dbInstance ?? db;
  }

  async startTransaction() {
    return this.db.transaction();
  }
}
