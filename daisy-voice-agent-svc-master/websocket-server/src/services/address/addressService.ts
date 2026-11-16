import type { Knex } from 'knex';
import { Address, type AddressType } from '../../models/Address';
import { AddressRepository } from '../../repositories/AddressRepository';

export interface CreateAddressParams {
  customer_id: string;
  address_type: AddressType;
  state_or_province: string;
  postal_code: string;
  country: string;
  address_first_line: string;
}

export class AddressService {
  private addressRepository: AddressRepository;

  constructor(addressRepository: AddressRepository = new AddressRepository()) {
    this.addressRepository = addressRepository;
  }

  async createAddress(
    params: CreateAddressParams,
    transaction?: Knex.Transaction,
  ): Promise<Address> {
    return this.addressRepository.create(
      {
        customer_id: params.customer_id,
        address_type: params.address_type,
        state_or_province: params.state_or_province,
        postal_code: params.postal_code,
        country: params.country,
        address_first_line: params.address_first_line,
      },
      transaction,
    );
  }

  async getAddressByCustomerIdAndType(
    customerId: string,
    type: AddressType,
  ): Promise<Address | undefined> {
    return this.addressRepository.findByCustomerIdAndType(customerId, type);
  }

  async upsertAddress(
    customerId: string,
    type: AddressType,
    data: Partial<Omit<Address, 'id' | 'created_at' | 'updated_at'>>,
    transaction?: Knex.Transaction,
  ): Promise<Address> {
    return this.addressRepository.upsertByType(
      customerId,
      type,
      data,
      transaction,
    );
  }

  async getAddressById(id: string): Promise<Address | null> {
    return this.addressRepository.findById(id);
  }

  async getAddressByCustomerId(customerId: string): Promise<Address[]> {
    return this.addressRepository.findByCustomerId(customerId);
  }

  async updateAddress(
    id: string,
    data: Partial<CreateAddressParams>,
  ): Promise<Address | null> {
    return this.addressRepository.update(id, data);
  }

  async deleteAddress(id: string): Promise<boolean> {
    return this.addressRepository.delete(id);
  }

  async getAllAddresses(): Promise<Address[]> {
    return this.addressRepository.findAll();
  }
}

// Create and export a singleton instance
export const addressService = new AddressService();
export default addressService;
