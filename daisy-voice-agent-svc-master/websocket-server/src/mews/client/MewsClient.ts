import { AxiosInstance } from 'axios';
import config from '../../config';
import { createHttpClient } from '../../utils/httpClient';
import {
  MewsAddProductParams,
  MewsAddProductResponse,
  MewsAddReservationsParams,
  MewsAddReservationsResponse,
  MewsAddTokenizedCardParams,
  MewsAddTokenizedCardResponse,
  MewsAgeCategory,
  MewsCancelReservationsParams,
  MewsCancelReservationsResponse,
  MewsChargeCreditCardParams,
  MewsChargeCreditCardResponse,
  MewsCreateCustomerParams,
  MewsCreateCustomerResponse,
  MewsCredentials,
  MewsCreditCard,
  MewsCustomer,
  MewsEnterprise,
  MewsGetAgeCategoriesResponse,
  MewsGetAvailabilityParams,
  MewsGetAvailabilityResponse,
  MewsGetConfigurationResponse,
  MewsGetCreditCardsParams,
  MewsGetCreditCardsResponse,
  MewsGetEnterprisesResponse,
  MewsGetProductsResponse,
  MewsGetRatePricingResponse,
  MewsGetRatesResponse,
  MewsGetReservationsResponse,
  MewsGetResourceCategoriesResponse,
  MewsGetRestrictionsParams,
  MewsGetRestrictionsResponse,
  MewsGetServicesResponse,
  MewsProduct,
  MewsRate,
  MewsRefundPaymentParams,
  MewsRefundPaymentResponse,
  MewsReservation,
  MewsResourceCategory,
  MewsRestriction,
  MewsSearchCustomersResponse,
  MewsService,
  MewsUpdateReservationsParams,
  MewsUpdateReservationsResponse,
} from '../types';

export class MewsClient {
  private axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = createHttpClient('mews', {
      baseURL: config.MEWS_BASE_URL,
      timeout: config.API_TIMEOUT,
    });
  }

  private baseBody(credentials: MewsCredentials): object {
    return {
      ClientToken: credentials.clientToken,
      AccessToken: credentials.accessToken,
      Client: credentials.client,
    };
  }

  // Multi-property scoping. These are no-ops for single-property tokens
  // (enterpriseId/chainId undefined) and Mews ignores them there, so callers
  // can always spread them. Under a Portfolio Access Token they scope the
  // operation to the correct enterprise/chain.
  private enterpriseScope(c: MewsCredentials): object {
    return c.enterpriseId ? { EnterpriseId: c.enterpriseId } : {};
  }

  private enterpriseFilter(c: MewsCredentials): object {
    return c.enterpriseId ? { EnterpriseIds: [c.enterpriseId] } : {};
  }

  private chainScope(c: MewsCredentials): object {
    return c.chainId ? { ChainId: c.chainId } : {};
  }

  private chainFilter(c: MewsCredentials): object {
    return c.chainId ? { ChainIds: [c.chainId] } : {};
  }

  async getEnterprises(
    credentials: MewsCredentials,
  ): Promise<MewsEnterprise[]> {
    const response = await this.axiosInstance.post<MewsGetEnterprisesResponse>(
      '/api/connector/v1/enterprises/getAll',
      {
        ...this.baseBody(credentials),
        Limitation: { Count: 1000 },
      },
    );
    return response.data.Enterprises ?? [];
  }

  async getAllServices(credentials: MewsCredentials): Promise<MewsService[]> {
    const response = await this.axiosInstance.post<MewsGetServicesResponse>(
      '/api/connector/v1/services/getAll',
      {
        ...this.baseBody(credentials),
        ...this.enterpriseFilter(credentials),
        Limitation: { Count: 100 },
      },
    );
    return response.data.Services;
  }

  async getResourceCategories(
    serviceIds: string[],
    credentials: MewsCredentials,
  ): Promise<MewsResourceCategory[]> {
    const response =
      await this.axiosInstance.post<MewsGetResourceCategoriesResponse>(
        '/api/connector/v1/resourceCategories/getAll',
        {
          ...this.baseBody(credentials),
          ...this.enterpriseFilter(credentials),
          ServiceIds: serviceIds,
          Limitation: { Count: 100 },
        },
      );
    return response.data.ResourceCategories;
  }

  async getAvailability(
    params: MewsGetAvailabilityParams,
    credentials: MewsCredentials,
  ): Promise<MewsGetAvailabilityResponse> {
    const response = await this.axiosInstance.post<MewsGetAvailabilityResponse>(
      '/api/connector/v1/services/getAvailability/2024-01-22',
      {
        ...this.baseBody(credentials),
        ServiceId: params.serviceId,
        FirstTimeUnitStartUtc: params.firstTimeUnitStartUtc,
        LastTimeUnitStartUtc: params.lastTimeUnitStartUtc,
        Metrics: params.metrics,
      },
    );
    return response.data;
  }

  // Paginated: a property with per-day restrictions can exceed a single page
  // even for a short stay, and a truncated page reads as "no restriction".
  async getRestrictions(
    params: MewsGetRestrictionsParams,
    credentials: MewsCredentials,
  ): Promise<MewsRestriction[]> {
    const restrictions: MewsRestriction[] = [];
    let cursor: string | undefined;

    // Page cap is a runaway guard, not a real limit — 10 pages is 10x more
    // restrictions than a stay-length interval has ever returned.
    for (let page = 0; page < 10; page++) {
      const response =
        await this.axiosInstance.post<MewsGetRestrictionsResponse>(
          '/api/connector/v1/restrictions/getAll',
          {
            ...this.baseBody(credentials),
            ...this.enterpriseFilter(credentials),
            ServiceIds: params.serviceIds,
            ...(params.collidingStartUtc &&
              params.collidingEndUtc && {
                CollidingUtc: {
                  StartUtc: params.collidingStartUtc,
                  EndUtc: params.collidingEndUtc,
                },
              }),
            Limitation: {
              Count: 1000,
              ...(cursor && { Cursor: cursor }),
            },
          },
        );
      const pageItems = response.data.Restrictions ?? [];
      restrictions.push(...pageItems);
      cursor = response.data.Cursor ?? undefined;
      if (!cursor || pageItems.length < 1000) break;
    }

    return restrictions;
  }

  async getRates(
    serviceIds: string[],
    credentials: MewsCredentials,
  ): Promise<MewsRate[]> {
    const response = await this.axiosInstance.post<MewsGetRatesResponse>(
      '/api/connector/v1/rates/getAll',
      {
        ...this.baseBody(credentials),
        ...this.enterpriseFilter(credentials),
        ServiceIds: serviceIds,
        ActivityStates: ['Active'],
        Extent: { Rates: true, AvailabilityBlockAssignments: false },
        Limitation: { Count: 100 },
      },
    );
    return response.data.Rates;
  }

  async getProducts(
    serviceIds: string[],
    credentials: MewsCredentials,
  ): Promise<MewsProduct[]> {
    const response = await this.axiosInstance.post<MewsGetProductsResponse>(
      '/api/connector/v1/products/getAll',
      {
        ...this.baseBody(credentials),
        ...this.enterpriseFilter(credentials),
        ServiceIds: serviceIds,
        Limitation: { Count: 100 },
      },
    );
    return response.data.Products;
  }

  async addProduct(
    params: MewsAddProductParams,
    credentials: MewsCredentials,
  ): Promise<MewsAddProductResponse> {
    const response = await this.axiosInstance.post<MewsAddProductResponse>(
      '/api/connector/v1/reservations/addProduct',
      {
        ...this.baseBody(credentials),
        ReservationId: params.ReservationId,
        ProductId: params.ProductId,
        Count: params.Count,
        ...(params.StartUtc && { StartUtc: params.StartUtc }),
        ...(params.EndUtc && { EndUtc: params.EndUtc }),
      },
    );
    return response.data;
  }

  async getRatePricing(
    params: {
      rateId: string;
      firstTimeUnitStartUtc: string;
      lastTimeUnitStartUtc: string;
    },
    credentials: MewsCredentials,
  ): Promise<MewsGetRatePricingResponse> {
    const response = await this.axiosInstance.post<MewsGetRatePricingResponse>(
      '/api/connector/v1/rates/getPricing',
      {
        ...this.baseBody(credentials),
        RateId: params.rateId,
        FirstTimeUnitStartUtc: params.firstTimeUnitStartUtc,
        LastTimeUnitStartUtc: params.lastTimeUnitStartUtc,
      },
    );
    return response.data;
  }

  async getConfiguration(
    credentials: MewsCredentials,
  ): Promise<MewsGetConfigurationResponse> {
    const response =
      await this.axiosInstance.post<MewsGetConfigurationResponse>(
        '/api/connector/v1/configuration/get',
        {
          ...this.baseBody(credentials),
          ...this.enterpriseScope(credentials),
        },
      );
    return response.data;
  }

  async searchCustomers(
    params: {
      customerIds?: string[];
      emails?: string[];
      phoneNumbers?: string[];
      firstNames?: string[];
      lastNames?: string[];
    },
    credentials: MewsCredentials,
  ): Promise<MewsCustomer[]> {
    const response = await this.axiosInstance.post<MewsSearchCustomersResponse>(
      '/api/connector/v1/customers/getAll',
      {
        ...this.baseBody(credentials),
        ...this.chainFilter(credentials),
        Extent: { Customers: true },
        ...(params.customerIds?.length && { CustomerIds: params.customerIds }),
        ...(params.emails?.length && { Emails: params.emails }),
        ...(params.phoneNumbers?.length && {
          PhoneNumbers: params.phoneNumbers,
        }),
        ...(params.firstNames?.length && { FirstNames: params.firstNames }),
        ...(params.lastNames?.length && { LastNames: params.lastNames }),
        Limitation: { Count: 100 },
      },
    );
    return response.data.Customers ?? [];
  }

  async createCustomer(
    params: MewsCreateCustomerParams,
    credentials: MewsCredentials,
  ): Promise<MewsCreateCustomerResponse> {
    const response = await this.axiosInstance.post<MewsCreateCustomerResponse>(
      '/api/connector/v1/customers/add',
      {
        ...this.baseBody(credentials),
        ...this.chainScope(credentials),
        FirstName: params.FirstName,
        LastName: params.LastName,
        ...(params.Email && { Email: params.Email }),
        ...(params.Phone && { Phone: params.Phone }),
      },
    );
    return response.data;
  }

  async addTokenizedCreditCard(
    params: MewsAddTokenizedCardParams,
    credentials: MewsCredentials,
  ): Promise<MewsAddTokenizedCardResponse> {
    const response =
      await this.axiosInstance.post<MewsAddTokenizedCardResponse>(
        '/api/connector/v1/creditCards/addTokenized',
        {
          ...this.baseBody(credentials),
          ...this.enterpriseScope(credentials),
          CustomerId: params.CustomerId,
          CreditCardData: params.CreditCardData,
        },
      );
    return response.data;
  }

  async chargeCreditCard(
    params: MewsChargeCreditCardParams,
    credentials: MewsCredentials,
  ): Promise<MewsChargeCreditCardResponse> {
    const response =
      await this.axiosInstance.post<MewsChargeCreditCardResponse>(
        '/api/connector/v1/creditCards/charge',
        {
          ...this.baseBody(credentials),
          CreditCardId: params.CreditCardId,
          Amount: params.Amount,
          ...(params.ReservationId && { ReservationId: params.ReservationId }),
          ...(params.Notes && { Notes: params.Notes }),
        },
      );
    return response.data;
  }

  async getCreditCards(
    params: MewsGetCreditCardsParams,
    credentials: MewsCredentials,
  ): Promise<MewsCreditCard[]> {
    const response = await this.axiosInstance.post<MewsGetCreditCardsResponse>(
      '/api/connector/v1/creditCards/getAll',
      {
        ...this.baseBody(credentials),
        ...this.enterpriseFilter(credentials),
        ...(params.CreditCardIds && { CreditCardIds: params.CreditCardIds }),
        ...(params.CustomerIds && { CustomerIds: params.CustomerIds }),
        Limitation: { Count: 100 },
      },
    );
    return response.data.CreditCards ?? [];
  }

  async refundPayment(
    params: MewsRefundPaymentParams,
    credentials: MewsCredentials,
  ): Promise<MewsRefundPaymentResponse> {
    const response = await this.axiosInstance.post<MewsRefundPaymentResponse>(
      '/api/connector/v1/payments/refund',
      {
        ...this.baseBody(credentials),
        ...this.enterpriseScope(credentials),
        PaymentId: params.PaymentId,
        AccountId: params.AccountId,
        Reason: params.Reason,
        ...(params.ValueToRefund !== undefined && {
          ValueToRefund: params.ValueToRefund,
        }),
      },
    );
    return response.data;
  }

  async getAgeCategories(
    serviceIds: string[],
    credentials: MewsCredentials,
  ): Promise<MewsAgeCategory[]> {
    const response =
      await this.axiosInstance.post<MewsGetAgeCategoriesResponse>(
        '/api/connector/v1/ageCategories/getAll',
        {
          ...this.baseBody(credentials),
          ...this.enterpriseFilter(credentials),
          ServiceIds: serviceIds,
          ActivityStates: ['Active'],
          Limitation: { Count: 1000 },
        },
      );
    return response.data.AgeCategories;
  }

  async addReservations(
    params: MewsAddReservationsParams,
    credentials: MewsCredentials,
  ): Promise<MewsAddReservationsResponse> {
    const response = await this.axiosInstance.post<MewsAddReservationsResponse>(
      '/api/connector/v1/reservations/add',
      {
        ...this.baseBody(credentials),
        ...this.enterpriseScope(credentials),
        ServiceId: params.ServiceId,
        ...(params.GroupId !== undefined && { GroupId: params.GroupId }),
        ...(params.GroupName !== undefined && { GroupName: params.GroupName }),
        ...(params.SendConfirmationEmail !== undefined && {
          SendConfirmationEmail: params.SendConfirmationEmail,
        }),
        Reservations: params.Reservations,
      },
    );
    return response.data;
  }

  async cancelReservations(
    params: MewsCancelReservationsParams,
    credentials: MewsCredentials,
  ): Promise<MewsCancelReservationsResponse> {
    const response =
      await this.axiosInstance.post<MewsCancelReservationsResponse>(
        '/api/connector/v1/reservations/cancel',
        {
          ...this.baseBody(credentials),
          ...this.enterpriseScope(credentials),
          ReservationIds: params.ReservationIds,
          Notes: params.Notes,
          ...(params.PostCancellationFee !== undefined && {
            PostCancellationFee: params.PostCancellationFee,
          }),
          ...(params.SendEmail !== undefined && {
            SendEmail: params.SendEmail,
          }),
        },
      );
    return response.data;
  }

  async getReservations(
    params: {
      ReservationIds?: string[];
      Numbers?: string[];
      ChannelNumbers?: string[];
      AccountIds?: string[];
      ServiceIds: string[];
    },
    credentials: MewsCredentials,
  ): Promise<MewsReservation[]> {
    const response = await this.axiosInstance.post<MewsGetReservationsResponse>(
      '/api/connector/v1/reservations/getAll/2023-06-06',
      {
        ...this.baseBody(credentials),
        ...this.enterpriseFilter(credentials),
        ServiceIds: params.ServiceIds,
        ...(params.ReservationIds?.length && {
          ReservationIds: params.ReservationIds,
        }),
        ...(params.Numbers?.length && { Numbers: params.Numbers }),
        ...(params.ChannelNumbers?.length && {
          ChannelNumbers: params.ChannelNumbers,
        }),
        ...(params.AccountIds?.length && { AccountIds: params.AccountIds }),
        Limitation: { Count: 100 },
      },
    );
    return response.data.Reservations ?? [];
  }

  async updateReservations(
    params: MewsUpdateReservationsParams,
    credentials: MewsCredentials,
  ): Promise<MewsUpdateReservationsResponse> {
    const response =
      await this.axiosInstance.post<MewsUpdateReservationsResponse>(
        '/api/connector/v1/reservations/update',
        {
          ...this.baseBody(credentials),
          ...this.enterpriseScope(credentials),
          ReservationUpdates: params.ReservationUpdates,
          ...(params.Reprice !== undefined && { Reprice: params.Reprice }),
          ...(params.ApplyCancellationFee !== undefined && {
            ApplyCancellationFee: params.ApplyCancellationFee,
          }),
          ...(params.Reason !== undefined && { Reason: params.Reason }),
        },
      );
    return response.data;
  }
}

export const mewsClient = new MewsClient();
