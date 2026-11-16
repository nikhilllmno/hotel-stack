import { HostawayPriceComponent } from './PriceDetails';

export interface HostawayReservationRequest {
  channelId: number;
  listingMapId: number;
  guestName: string;
  guestFirstName: string;
  guestLastName: string;
  guestZipCode?: string;
  guestAddress?: string;
  guestCity?: string;
  guestCountry?: string;
  guestEmail: string;
  numberOfGuests: number;
  adults: number;
  children?: number | null;
  infants?: number | null;
  pets?: number | null;
  arrivalDate: string;
  departureDate: string;
  checkInTime?: number | null;
  checkOutTime?: number | null;
  phone: string;
  totalPrice: number;
  taxAmount?: number | null;
  isPaid: boolean | null;
  currency: string;
  financeFields?: HostawayPriceComponent[];
}

export interface HostawayReservationResult {
  id: number;
  listingMapId: number;
  listingName: string;
  channelId: number;
  source: string;
  channelName: string;
  reservationId: string;
  hostawayReservationId: string;
  channelReservationId: string;
  guestName: string;
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  guestAuthHash: string;
  guestPortalUrl: string;
  numberOfGuests: number;
  adults: number;
  children: number | null;
  infants: number | null;
  pets: number | null;
  arrivalDate: string;
  departureDate: string;
  checkInTime: number;
  checkOutTime: number;
  nights: number;
  phone: string;
  totalPrice: number;
  remainingBalance: number;
  taxAmount: number | null;
  isPaid: boolean | null;
  currency: string;
  [key: string]: any;
}

export interface HostawayReservationResponse {
  status: string;
  result: HostawayReservationResult;
}

export interface HostawayCancelReservationResult {
  id: number;
  listingMapId: number;
  listingName: string;
  channelId: number;
  source: string;
  channelName: string;
  reservationId: string;
  hostawayReservationId: string;
  channelReservationId: string;
  status: string;
  cancellationDate: string;
  cancelledBy: string;
}

export interface HostawayCancelReservationResponse {
  status: string;
  result: HostawayCancelReservationResult;
}

export interface HostawayModifyReservationResult {
  id: number;
  listingMapId: number;
  listingName: string;
  channelId: number;
  source: string;
  channelName: string;
  reservationId: string;
  hostawayReservationId: string;
  channelReservationId: string;
  arrivalDate: string;
  departureDate: string;
  status: string;
}

export interface HostawayModifyReservationResponse {
  status: string;
  result: HostawayModifyReservationResult;
}
