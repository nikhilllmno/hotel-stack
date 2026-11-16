import { Knex } from 'knex';
import { randomUUID as uuidv4 } from 'node:crypto';
import { DataType, newDb } from 'pg-mem';

export interface TestDb {
  knex: Knex;
  destroy: () => Promise<void>;
}

export function createTestDbPgMem(): TestDb {
  const mem = newDb({ autoCreateForeignKeyIndices: true });

  mem.public.registerFunction({
    implementation: () => 'test',
    name: 'current_database',
  });

  mem.public.registerFunction({
    implementation: () => '14.0',
    name: 'version',
  });

  mem.public.registerFunction({
    // impure: without this, pg-mem treats gen_random_uuid() as a pure/deterministic
    // function and folds repeated calls within the same prepared statement shape to
    // a single cached value, causing duplicate-key errors on tables that rely on the
    // DB default for id generation across multiple inserts.
    impure: true,
    implementation: () => uuidv4(),
    name: 'gen_random_uuid',
  });

  mem.public.registerFunction({
    args: [DataType.text, DataType.text, DataType.text, DataType.text],
    implementation: (
      value: string,
      pattern: string,
      replacement: string,
      flags?: string,
    ) => {
      const regex = new RegExp(pattern, flags?.includes('g') ? 'g' : '');
      return value?.replace(regex, replacement) ?? value;
    },
    name: 'regexp_replace',
    returns: DataType.text,
  });

  const knex = mem.adapters.createKnex();

  return {
    destroy: async () => {
      await knex.destroy();
    },
    knex,
  };
}
