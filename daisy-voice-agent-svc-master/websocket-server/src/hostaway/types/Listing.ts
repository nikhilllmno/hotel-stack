export interface HostawayListing {
  id: number;
  propertyTypeId: number;
  name: string;
  externalListingName: string;
  internalListingName: string;
  description: string;
  thumbnailUrl: string | null;
  country: string;
  countryCode: string;
  state: string;
  city: string;
  street: string | null;
  address: string;
  publicAddress: string;
  zipcode: string;
  price: number;
  personCapacity: number;
  maxChildrenAllowed: number | null;
  maxInfantsAllowed: number | null;
  maxPetsAllowed: number | null;
  lat: number;
  lng: number;
  checkInTimeStart: number;
  checkInTimeEnd: number | null;
  checkOutTime: number;
  bedroomsNumber: number;
  bedsNumber: number;
  bathroomsNumber: number;
  guestBathroomsNumber: number;
  minNights: number;
  maxNights: number;
  guestsIncluded: number;
  cleaningFee: number;
  currencyCode: string;
  timeZoneName: string;
  listingAmenities: HostawayAmenity[];
  [key: string]: any;
}

export interface HostawayAmenity {
  id: number;
  amenityId: number;
  amenityName: string;
}

export interface HostawayListingsResponse {
  status: string;
  result: HostawayListing[];
  count: number;
  limit: number;
  offset: number | null;
}
