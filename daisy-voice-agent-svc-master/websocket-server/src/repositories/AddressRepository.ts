import { Knex } from 'knex';
import { Address, type AddressType } from '../models/Address';
import { BaseRepository } from './BaseRepository';

export class AddressRepository extends BaseRepository {
  private tableName = 'address';

  async create(
    data: Omit<Address, 'id' | 'created_at' | 'updated_at'>,
    transaction?: Knex.Transaction,
  ): Promise<Address> {
    const trxOrDb = transaction || this.db;
    const [result] = await trxOrDb(this.tableName).insert(data).returning('*');
    return result;
  }

  async findById(id: string): Promise<Address | null> {
    const result = await this.db(this.tableName).where({ id }).first();
    return result || null;
  }

  async findAll(): Promise<Address[]> {
    return this.db(this.tableName);
  }

  async update(
    id: string,
    data: Partial<Omit<Address, 'id' | 'created_at' | 'updated_at'>>,
    transaction?: Knex.Transaction,
  ): Promise<Address | null> {
    const trxOrDb = transaction || this.db;
    const [result] = await trxOrDb(this.tableName)
      .where({ id })
      .update(data)
      .returning('*');
    return result || null;
  }

  async delete(id: string): Promise<boolean> {
    const count = await this.db(this.tableName).where({ id }).delete();
    return count > 0;
  }

  async findByCustomerId(
    customerId: string,
    transaction?: Knex.Transaction,
  ): Promise<Address[]> {
    const trxOrDb = transaction || this.db;
    return trxOrDb(this.tableName).where({ customer_id: customerId });
  }

  async findByCustomerIdAndType(
    customerId: string,
    type: AddressType,
    transaction?: Knex.Transaction,
  ): Promise<Address | undefined> {
    const trxOrDb = transaction || this.db;
    return trxOrDb(this.tableName)
      .where({ customer_id: customerId, address_type: type })
      .first();
  }

  async upsertByType(
    customerId: string,
    type: AddressType,
    data: Partial<Omit<Address, 'id' | 'created_at' | 'updated_at'>>,
    transaction?: Knex.Transaction,
  ): Promise<Address> {
    const existing = await this.findByCustomerIdAndType(
      customerId,
      type,
      transaction,
    );
    if (existing) {
      const result = await this.update(existing.id!, data, transaction);
      return result!;
    }
    return this.create(
      { ...data, customer_id: customerId, address_type: type },
      transaction,
    );
  }

  async createMany(
    data: Omit<Address, 'id' | 'created_at' | 'updated_at' | 'customer_id'>[],
    transaction?: Knex.Transaction,
  ): Promise<Address[]> {
    const trxOrDb = transaction || this.db;
    return trxOrDb(this.tableName).insert(data).returning('*');
  }

  async upsertManyByType(
    customerId: string,
    addresses: {
      type: AddressType;
      data: Partial<Omit<Address, 'id' | 'created_at' | 'updated_at'>>;
    }[],
    transaction?: Knex.Transaction,
  ): Promise<void> {
    const trxOrDb = transaction || this.db;
    const types = addresses.map((a) => a.type);

    const existing: Address[] = await trxOrDb(this.tableName)
      .where({ customer_id: customerId })
      .whereIn('address_type', types);

    const toInsert = addresses
      .filter((a) => !existing.find((e) => e.address_type === a.type))
      .map((a) => ({
        ...a.data,
        customer_id: customerId,
        address_type: a.type,
      }));

    if (toInsert.length) {
      await trxOrDb(this.tableName).insert(toInsert);
    }

    for (const a of addresses) {
      const match = existing.find((e) => e.address_type === a.type);
      if (match) await this.update(match.id!, a.data, transaction);
    }
  }

  async deleteByCustomerId(customerId: string): Promise<boolean> {
    const count = await this.db(this.tableName)
      .where({ customer_id: customerId })
      .delete();
    return count > 0;
  }
}
