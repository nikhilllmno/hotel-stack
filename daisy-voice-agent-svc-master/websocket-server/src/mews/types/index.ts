export interface MewsCredentials {
  clientToken: string;
  accessToken: string;
  client: string;
  enterpriseId?: string;
  chainId?: string;
}

export interface MewsEnterprise {
  Id: string;
  ChainId: string;
  ChainName?: string;
  Name?: string;
  ExternalIdentifier?: string | null;
}

export interface MewsGetEnterprisesResponse {
  Enterprises: MewsEnterprise[];
  Cursor?: string;
}

/**
 * `Data.Value` of a Bookable service. The offsets are ISO 8601 durations measured
 * from the time unit boundary: a reservation on a "Day" service starts at
 * hotel-local midnight + StartOffset, not at midnight.
 */
export interface MewsBookableServiceData {
  StartOffset?: string | null;
  EndOffset?: string | null;
  TimeUnitPeriod?: 'Day' | 'Hour' | 'Month' | string;
  [key: string]: unknown;
}

export interface MewsService {
  Id: string;
  EnterpriseId: string;
  IsActive: boolean;
  Name?: string;
  Names: Record<string, string>;
  StartTime?: string | null;
  EndTime?: string | null;
  Options?: Record<string, unknown>;
  Promotions?: Record<string, unknown> | null;
  Type?: string;
  Ordering?: number;
  ExternalIdentifier?: string | null;
  CreatedUtc?: string;
  UpdatedUtc?: string;
  Data: {
    Discriminator: 'Bookable' | 'Additional' | string;
    Value?: MewsBookableServiceData;
  };
}

export interface MewsGetServicesResponse {
  Services: MewsService[];
  Cursor?: string;
}

export interface MewsResourceCategory {
  Id: string;
  EnterpriseId: string;
  ServiceId: string;
  IsActive: boolean;
  Type: string;
  Names: Record<string, string>;
  ShortNames: Record<string, string>;
  Descriptions: Record<string, string>;
  Ordering: number;
  Capacity: number;
  ExtraCapacity: number;
  ExternalIdentifier: string | null;
  Classification?: string | null;
  AccountingCategoryId?: string | null;
  ParentId?: string | null;
  ImageIds?: string[];
  CreatedUtc?: string;
  UpdatedUtc?: string;
}

export interface MewsGetResourceCategoriesResponse {
  ResourceCategories: MewsResourceCategory[];
  Cursor?: string;
}

export interface MewsRate {
  Id: string;
  ServiceId: string;
  GroupId: string;
  IsActive: boolean;
  IsEnabled: boolean;
  IsPublic: boolean;
  IsDefault: boolean;
  Name?: string | null;
  Names?: Record<string, string>;
  ShortName?: string | null;
  ExternalIdentifier?: string | null;
  ExternalNames?: Record<string, unknown>;
  Description?: Record<string, unknown>;
  Type?: string;
  BaseRateId?: string | null;
  IsBaseRate?: boolean;
  BusinessSegmentId?: string | null;
  Options?: Record<string, unknown>;
  Pricing?: {
    Discriminator: string;
    BaseRatePricing?: Record<string, unknown> | null;
    DependentRatePricing?: Record<string, unknown> | null;
  };
  TaxExemptionReason?: string | null;
  TaxExemptionLegalReference?: string | null;
  UpdatedUtc?: string;
}

export interface MewsRateGroup {
  Id: string;
  ServiceId: string;
  IsActive: boolean;
  Name?: string;
  ExternalIdentifier?: string | null;
}

export interface MewsGetRatesResponse {
  Rates: MewsRate[];
  RateGroups?: MewsRateGroup[];
  RateRestrictions?: unknown;
  AvailabilityBlockAssignments?: unknown;
  Cursor?: string;
}

export interface MewsAmountPriceBreakdownItem {
  TaxRateCode: string;
  NetValue: number;
  TaxValue: number;
}

export interface MewsAmountPrice {
  Currency: string;
  NetValue: number;
  GrossValue: number;
  TaxValues: { Code: string; Value: number }[];
  Breakdown?: { Items: MewsAmountPriceBreakdownItem[] };
}

export interface MewsCategoryPricing {
  CategoryId: string;
  Prices?: number[];
  AmountPrices: MewsAmountPrice[];
}

export interface MewsAgeCategoryAdjustment {
  AgeCategoryId: string;
  AbsoluteValue: number;
  Type: string;
}

export interface MewsGetRatePricingResponse {
  Currency: string;
  DatesUtc?: string[];
  TimeUnitStartsUtc: string[];
  BasePrices?: number[];
  BaseAmountPrices: MewsAmountPrice[];
  CategoryPrices: MewsCategoryPricing[];
  CategoryAdjustments?: unknown[];
  AgeCategoryAdjustments?: MewsAgeCategoryAdjustment[];
  RelativeAdjustment?: number;
  AbsoluteAdjustment?: number;
  EmptyUnitAdjustment?: number;
  ExtraUnitAdjustment?: number;
}

export interface MewsRatePrice {
  rateId: string;
  rateName: string;
  shortName?: string;
  currency: string;
  pricesPerNight: number[];
  totalPrice: number;
  /** Net accommodation charge (totalPrice minus taxes and fees). */
  base_rate?: number;
  /** Tax portion of totalPrice (Mews GrossValue is tax-inclusive). */
  taxes?: number;
  /** Pet fee already included in totalPrice, present only when a pet fee was applied. */
  fees?: number;
  /** Initial deposit to collect now, after applying the hotel's deposit policy. Defaults to totalPrice. */
  amountCharged?: number;
}

export interface MewsRoomAvailability {
  resourceCategoryId: string;
  serviceId: string;
  name: string;
  capacity: number;
  extraCapacity: number;
  availablePerDay: number[];
  minAvailable: number;
  rates: MewsRatePrice[];
}

export interface MewsResourceCategoryAvailability {
  ResourceCategoryId: string;
  Metrics: Partial<Record<MewsAvailabilityMetric, number[]>>;
}

export interface MewsGetAvailabilityResponse {
  TimeUnitStartsUtc: string[];
  ResourceCategoryAvailabilities: MewsResourceCategoryAvailability[];
}

export type MewsAvailabilityMetric =
  | 'OutOfOrderBlocks'
  | 'PublicAvailabilityAdjustment'
  | 'OtherServiceReservationCount'
  | 'Occupied'
  | 'ConfirmedReservations'
  | 'OptionalReservations'
  | 'BlockAvailability'
  | 'AllocatedBlockAvailability'
  | 'UsableResources'
  | 'ActiveResources'
  | 'HouseUse';

export interface MewsGetAvailabilityParams {
  serviceId: string;
  firstTimeUnitStartUtc: string;
  lastTimeUnitStartUtc: string;
  metrics: MewsAvailabilityMetric[];
}

// ── Restriction types ─────────────────────────────────────────────────────────

/**
 * `Stay` — guests can't stay within the dates, `Start` — can't check in,
 * `End` — can't check out.
 */
export type MewsRestrictionType = 'Stay' | 'Start' | 'End';

/**
 * Narrows which reservations a restriction applies to. Every field is optional
 * and an absent field matches everything.
 */
export interface MewsRestrictionCondition {
  Type: MewsRestrictionType;
  ExactRateId?: string | null;
  BaseRateId?: string | null;
  RateGroupId?: string | null;
  ResourceCategoryId?: string | null;
  ResourceCategoryType?: string | null;
  StartUtc?: string | null;
  EndUtc?: string | null;
  Days?: string[] | null;
  Hours?: Record<string, boolean> | null;
}

/**
 * Rules that prevent the restriction from applying even when all conditions
 * match. Durations are ISO 8601; prices are per time unit.
 */
export interface MewsRestrictionException {
  MinAdvance?: string | null;
  MaxAdvance?: string | null;
  MinLength?: string | null;
  MaxLength?: string | null;
  MinPrice?: { Value: number; Currency: string } | null;
  MaxPrice?: { Value: number; Currency: string } | null;
}

export interface MewsRestriction {
  Id: string;
  ServiceId: string;
  ExternalIdentifier?: string | null;
  Origin?: string;
  Conditions: MewsRestrictionCondition;
  Exceptions?: MewsRestrictionException | null;
}

export interface MewsGetRestrictionsResponse {
  Restrictions: MewsRestriction[];
  Cursor?: string | null;
}

export interface MewsGetRestrictionsParams {
  serviceIds: string[];
  /** Only restrictions active within this interval are returned. */
  collidingStartUtc?: string;
  collidingEndUtc?: string;
}

// ── Payment types ─────────────────────────────────────────────────────────────

export interface MewsGetConfigurationResponse {
  PaymentCardStorage: { PublicKey: string } | null;
  Enterprise: {
    Id: string;
    IsPortfolio: boolean;
  };
}

export interface MewsCreateCustomerParams {
  FirstName: string;
  LastName: string;
  Email?: string;
  Phone?: string;
}

export interface MewsCreateCustomerResponse {
  Id: string;
}

export interface MewsCustomer {
  Id: string;
  FirstName: string | null;
  LastName: string | null;
  Email: string | null;
  Phone: string | null;
}

export interface MewsSearchCustomersResponse {
  Customers: MewsCustomer[];
  Cursor?: string;
}

export interface MewsAddTokenizedCardParams {
  CustomerId: string;
  CreditCardData: {
    StorageData: string;
    Expiration: string; // yyyy-MM
  };
}

export interface MewsAddTokenizedCardResponse {
  CreditCardId: string;
}

export interface MewsGetCreditCardsParams {
  CreditCardIds?: string[];
  CustomerIds?: string[];
}

export interface MewsCreditCard {
  Id: string;
  CustomerId: string;
  IsActive: boolean;
}

export interface MewsGetCreditCardsResponse {
  CreditCards: MewsCreditCard[];
  Cursor?: string;
}

export interface MewsChargeCreditCardParams {
  CreditCardId: string;
  Amount: { GrossValue: number; Currency: string };
  ReservationId?: string;
  Notes?: string;
}

export interface MewsChargeCreditCardResponse {
  PaymentId: string;
}

export interface MewsRefundPaymentParams {
  PaymentId: string;
  AccountId: string;
  Reason: string;
  ValueToRefund?: number;
}

export enum MewsPaymentState {
  CHARGED = 'Charged',
  PENDING = 'Pending',
  CANCELED = 'Canceled',
  FAILED = 'Failed',
  VERIFYING = 'Verifying',
}

export interface MewsRefundPaymentResponse {
  PaymentId: string;
  RefundId: string;
  Type: string;
  Amount: { Currency: string; Value: number };
  State: MewsPaymentState;
}

// ── Products ──────────────────────────────────────────────────────────────────

export interface MewsProduct {
  Id: string;
  ServiceId: string;
  IsActive: boolean;
  Names: Record<string, string>;
  ExternalNames?: Record<string, string>;
  ChargingMode: 'Once' | 'PerTimeUnit' | 'PerPersonPerTimeUnit' | 'PerPerson';
  Price: { GrossValue: number; Currency: string };
}

export interface MewsGetProductsResponse {
  Products: MewsProduct[];
  Cursor?: string;
}

export interface MewsAddProductParams {
  ReservationId: string;
  ProductId: string;
  Count: number;
  StartUtc?: string;
  EndUtc?: string;
}

export interface MewsAddProductResponse {
  ItemIds?: string[];
}

// ── Age categories ────────────────────────────────────────────────────────────

export interface MewsAgeCategory {
  Id: string;
  ServiceId: string;
  MinimalAge: number | null;
  MaximalAge: number | null;
  Names: Record<string, string>;
  ShortNames: Record<string, string> | null;
  Classification?: string | null;
  IsActive: boolean;
  ExternalIdentifier?: string | null;
  CreatedUtc: string;
  UpdatedUtc: string;
}

export interface MewsGetAgeCategoriesResponse {
  AgeCategories: MewsAgeCategory[];
  Cursor?: string;
}

// ── Reservation add/cancel ────────────────────────────────────────────────────

export interface MewsAddReservationItem {
  Identifier?: string;
  State?: string;
  StartUtc: string;
  EndUtc: string;
  CustomerId: string;
  RequestedCategoryId: string;
  RateId: string;
  PersonCounts: { AgeCategoryId: string; Count: number }[];
  Notes?: string;
  CreditCardId?: string;
  ProductOrders?: {
    ProductId: string;
    Count?: number;
    StartUtc?: string;
    EndUtc?: string;
  }[];
}

export interface MewsAddReservationsParams {
  ServiceId: string;
  GroupId?: string | null;
  GroupName?: string | null;
  SendConfirmationEmail?: boolean;
  Reservations: MewsAddReservationItem[];
}

export interface MewsAddedReservation {
  Identifier?: string;
  Reservation: {
    Id: string;
    GroupId: string;
    Number: string;
    State: string;
    StartUtc: string;
    EndUtc: string;
    RequestedCategoryId: string;
    RateId: string;
    CustomerId: string;
    [key: string]: unknown;
  };
}

export interface MewsAddReservationsResponse {
  Reservations: MewsAddedReservation[];
}

export interface MewsCancelReservationsParams {
  ReservationIds: string[];
  Notes: string;
  PostCancellationFee?: boolean;
  SendEmail?: boolean;
}

export interface MewsCancelReservationsResponse {
  ReservationIds: string[];
}

// ── Reservation lookup ────────────────────────────────────────────────────────

// Service order origin (reservations/getAll/2023-06-06).
export type MewsReservationOrigin =
  | 'Distributor'
  | 'ChannelManager'
  | 'Commander'
  | 'Import'
  | 'Connector'
  | 'Navigator';

export interface MewsReservation {
  Id: string;
  Number: string;
  State: string;
  ScheduledStartUtc: string;
  ScheduledEndUtc: string;
  AccountId: string;
  RequestedResourceCategoryId: string;
  RateId: string;
  ServiceId: string;
  GroupId: string;
  PersonCounts: { AgeCategoryId: string; Count: number }[];
  CancelledUtc?: string | null;
  Origin?: MewsReservationOrigin;
  [key: string]: unknown;
}

export interface MewsGetReservationsResponse {
  Reservations: MewsReservation[];
  Cursor?: string;
}

// ── Reservation update ────────────────────────────────────────────────────────

export interface MewsUpdateReservationItem {
  ReservationId: string;
  StartUtc?: { Value: string | null };
  EndUtc?: { Value: string | null };
  RequestedCategoryId?: { Value: string | null };
  RateId?: { Value: string | null };
  PersonCounts?: { Value: { AgeCategoryId: string; Count: number }[] };
}

export interface MewsUpdateReservationsParams {
  ReservationUpdates: MewsUpdateReservationItem[];
  Reprice?: boolean;
  ApplyCancellationFee?: boolean;
  Reason?: string;
}

export interface MewsUpdateReservationsResponse {
  Reservations: MewsReservation[];
}

// ── Webhooks ──────────────────────────────────────────────────────────────────

/**
 * General Webhook event discriminators Mews currently supports.
 * https://mews-systems.gitbook.io/connector-api/events/wh-general
 */
export type MewsWebhookEventDiscriminator =
  | 'ServiceOrderUpdated'
  | 'ResourceUpdated'
  | 'MessageAdded'
  | 'ResourceBlockUpdated'
  | 'CustomerAdded'
  | 'CustomerUpdated'
  | 'PaymentUpdated';

export interface MewsWebhookEvent {
  Discriminator: MewsWebhookEventDiscriminator | string;
  Value: { Id: string };
}

export interface MewsWebhookPayload {
  EnterpriseId: string;
  IntegrationId: string;
  Events: MewsWebhookEvent[];
}

export interface MewsWebhookResponse {
  success: boolean;
  message: string;
}
