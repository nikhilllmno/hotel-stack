import { Knex } from 'knex';
import { Address, AddressType } from '../models/Address';
import { Customer } from '../models/Customer';
import { BaseRepository } from './BaseRepository';

export class CustomerRepository extends BaseRepository {
  private tableName = 'customers';

  async create(
    data: Partial<Customer>,
    transaction?: Knex.Transaction,
  ): Promise<Customer> {
    const trxOrDb = transaction || this.db;
    const [result] = await trxOrDb(this.tableName).insert(data).returning('*');
    return result;
  }

  async findById(id: string): Promise<Customer | null> {
    const result = await this.db(this.tableName).where({ id }).first();
    return result || null;
  }

  async findByIdWithAddresses(
    id: string,
    transaction?: Knex.Transaction,
  ): Promise<{
    customer: Customer;
    address: Address | null;
    billing_address: Address | null;
  } | null> {
    const trxOrDb = transaction || this.db;
    const customer = await trxOrDb(this.tableName).where({ id }).first();
    if (!customer) return null;

    const addresses = await trxOrDb('address').where({ customer_id: id });

    const address =
      addresses.find(
        (address: Address) => address.address_type === AddressType.CONTACT,
      ) ?? null;
    const billing_address =
      addresses.find(
        (address: Address) => address.address_type === AddressType.BILLING,
      ) ?? null;

    return { customer, address, billing_address };
  }

  async findAll(): Promise<Customer[]> {
    return this.db(this.tableName);
  }

  async update(
    id: string,
    data: Partial<Omit<Customer, 'id' | 'created_at' | 'updated_at'>>,
    transaction?: Knex.Transaction,
  ): Promise<Customer | null> {
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

  async findByEmail(email: string): Promise<Customer | null> {
    const result = await this.db(this.tableName).where({ email }).first();
    return result || null;
  }

  async findByPhone(phone_number: string): Promise<Customer | null> {
    const result = await this.db(this.tableName)
      .where({ phone_number })
      .first();
    return result || null;
  }

  async findByPaymentProviderCustomerId(
    payment_provider_customer_id: string,
  ): Promise<Customer | null> {
    const result = await this.db(this.tableName)
      .where({ payment_provider_customer_id })
      .first();
    return result || null;
  }

  async findByStatus(status: 'active' | 'inactive'): Promise<Customer[]> {
    return this.db(this.tableName).where({ status });
  }
}
