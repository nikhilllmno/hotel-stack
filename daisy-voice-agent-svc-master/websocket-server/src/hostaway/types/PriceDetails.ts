export interface HostawayPriceComponent {
  id: number | null;
  listingFeeSettingId: number | null;
  type: string;
  name: string;
  title: string;
  alias: string | null;
  quantity: number | null;
  units: number;
  value: number;
  total: number;
  isIncludedInTotalPrice: number;
  isOverriddenByUser: number;
  isQuantitySelectable: number;
  isMandatory: number | null;
  isDeleted: number;
  displayInRent: number;
}

export interface HostawayPriceDetailsResult {
  totalPrice: number;
  originalTotalPrice: number;
  selectedComponentsAmount: number;
  components: HostawayPriceComponent[];
  extraComponents: HostawayPriceComponent[];
  selectedComponents: HostawayPriceComponent[];
}

export interface HostawayPriceDetailsResponse {
  status: string;
  result: HostawayPriceDetailsResult;
}

export interface HostawayPriceDetailsRequest {
  startingDate: string;
  endingDate: string;
  numberOfGuests: number;
  markup?: number;
  version?: number;
  components?: Array<{
    listingFeeSettingId: number;
    name: string;
  }>;
}

export interface HostawayFee {
  id: number;
  accountId: number;
  listingMapId: number;
  feeType: string;
  feeTitle: string;
  feeDescription: string | null;
  feeAppliedPer: string;
  amount: number;
  amountType: string;
  isMandatory: number;
  isQuantitySelectable: number;
  appearsIn: string[];
  channelId: number;
  displayInRent: number;
  parentId: number | null;
  isCustomFee: number;
  insertedOn: string;
  updatedOn: string;
  attachments: any[];
}

export interface HostawayFeesResponse {
  status: string;
  result: HostawayFee[];
}
