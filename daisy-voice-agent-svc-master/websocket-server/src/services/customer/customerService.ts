import { Knex } from 'knex';
import { Address, AddressType } from '../../dtos/Address';
import { Customer } from '../../dtos/Customer';
import { BadRequestError } from '../../errors/BadRequestError';
import { NoDataError } from '../../errors/NoDataError';
import { AddressRepository } from '../../repositories/AddressRepository';
import { CustomerRepository } from '../../repositories/CustomerRepository';

export class CustomerService {
  private customerRepository: CustomerRepository;
  private addressRepository: AddressRepository;

  constructor({
    customerRepository,
    addressRepository,
  }: {
    customerRepository: CustomerRepository;
    addressRepository: AddressRepository;
  }) {
    this.customerRepository = customerRepository;
    this.addressRepository = addressRepository;
  }

  public async createCustomer(
    customerData: Partial<Customer>,
    transaction?: Knex.Transaction,
  ): Promise<Customer> {
    // Create customer
    if (!customerData.phone_number?.trim()) {
      throw new BadRequestError(
        'createCustomer: Customer phone number is required',
      );
    }
    const customer = await this.customerRepository.create(
      {
        phone_number: customerData.phone_number.trim(),
        hotel_id: customerData.hotel_id,
        ...(customerData.first_name && {
          first_name: customerData.first_name.trim(),
        }),
        ...(customerData.last_name && {
          last_name: customerData.last_name.trim(),
        }),
        ...(customerData.email && { email: customerData.email.trim() }),
        ...(customerData.payment_provider_customer_id && {
          payment_provider_customer_id:
            customerData.payment_provider_customer_id.trim(),
        }),
      },
      transaction,
    );

    const addressesToCreate = [
      customerData.address && {
        ...customerData.address,
        customer_id: customer.id!,
        address_type: AddressType.CONTACT,
      },
      customerData.billing_address && {
        ...customerData.billing_address,
        customer_id: customer.id!,
        address_type: AddressType.BILLING,
      },
    ].filter(Boolean) as any[];

    const createdAddresses = addressesToCreate.length
      ? await this.addressRepository.createMany(addressesToCreate, transaction)
      : [];

    return {
      ...customer,
      address:
        createdAddresses.find((a) => a.address_type === AddressType.CONTACT) ??
        null,
      billing_address:
        createdAddresses.find((a) => a.address_type === AddressType.BILLING) ??
        null,
    };
  }

  public async findCustomer(id: string): Promise<Customer | null> {
    const customer = await this.customerRepository.findById(id);
    if (!customer) return null;

    const addresses = await this.addressRepository.findByCustomerId(id);
    const address =
      addresses.find((a) => a.address_type === AddressType.CONTACT) ?? null;
    const billing_address =
      addresses.find((a) => a.address_type === AddressType.BILLING) ?? null;
    return {
      ...this.mapToCustomerResponse(customer),
      address,
      billing_address,
    };
  }

  public async findAllCustomers(): Promise<Customer[]> {
    return await this.customerRepository.findAll();
  }

  public async updateCustomer(
    id: string,
    customerData: Partial<Omit<Customer, 'id' | 'created_at' | 'updated_at'>>,
    transaction?: Knex.Transaction,
  ): Promise<Customer> {
    const trx =
      transaction || (await this.customerRepository.startTransaction());
    try {
      const found = await this.customerRepository.findByIdWithAddresses(
        id,
        trx,
      );
      if (!found) {
        throw new NoDataError(`Customer not found for id ${id}`);
      }
      const existingCustomer = found.customer;

      // Update customer
      const newCustomerData: Partial<
        Omit<Customer, 'id' | 'created_at' | 'updated_at'>
      > = {
        first_name: customerData.first_name ?? existingCustomer.first_name,
        last_name: customerData.last_name ?? existingCustomer.last_name,
        email: customerData.email ?? existingCustomer.email,
        phone_number:
          customerData.phone_number ?? existingCustomer.phone_number,
        payment_provider_customer_id:
          customerData.payment_provider_customer_id ??
          existingCustomer.payment_provider_customer_id,
        ...(customerData.signature !== undefined && {
          signature: customerData.signature,
        }),
        ...(customerData.device_details !== undefined && {
          device_details: customerData.device_details,
        }),
        ...(customerData.card_metadata !== undefined && {
          card_metadata: customerData.card_metadata,
        }),
      };
      await this.customerRepository.update(id, newCustomerData, trx);

      const addressesToUpsert = [
        customerData.address && {
          type: AddressType.CONTACT,
          data: customerData.address,
        },
        customerData.billing_address && {
          type: AddressType.BILLING,
          data: customerData.billing_address,
        },
      ].filter(Boolean) as {
        type: AddressType;
        data: Omit<Address, 'id' | 'created_at' | 'updated_at'>;
      }[];

      if (addressesToUpsert.length) {
        await this.addressRepository.upsertManyByType(
          id,
          addressesToUpsert,
          trx,
        );
      }

      // Re-fetch and return updated customer with addresses (within trx)
      const updated = await this.customerRepository.findByIdWithAddresses(
        id,
        trx,
      );
      if (!updated) {
        throw new NoDataError(`Customer not found for id ${id}`);
      }
      if (!transaction && trx) {
        await trx.commit();
      }
      return {
        ...this.mapToCustomerResponse(updated.customer),
        address: updated.address,
        billing_address: updated.billing_address,
      };
    } catch (err) {
      if (!transaction && trx) {
        await trx.rollback();
      }
      throw err;
    }
  }

  public async deleteCustomer(id: string): Promise<boolean> {
    // Delete addresses first
    await this.addressRepository.deleteByCustomerId(id);

    // Then delete customer
    return this.customerRepository.delete(id);
  }

  private mapToCustomerResponse(customer: Customer): Customer {
    return {
      id: customer.id,
      hotel_id: customer.hotel_id,
      first_name: customer.first_name,
      last_name: customer.last_name,
      email: customer.email,
      phone_number: customer.phone_number,
      payment_provider_customer_id: customer.payment_provider_customer_id,
      created_at: customer.created_at,
      updated_at: customer.updated_at,
    };
  }
}

const getCustomerService = () => {
  return new CustomerService({
    customerRepository: new CustomerRepository(),
    addressRepository: new AddressRepository(),
  });
};

export default getCustomerService();
