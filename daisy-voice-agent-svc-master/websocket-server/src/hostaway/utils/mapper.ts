import { Customer } from '../../dtos/Customer';
import { ReservationPaymentStatus } from '../../dtos/enum/ReservationPaymentStatus';
import { Quote } from '../../dtos/Quote';
import { Reservation } from '../../dtos/Reservation';
import { BadRequestError } from '../../errors/BadRequestError';
import { CreateReservationResponse } from '../../pms/types/IPMSReservationService';
import { PMSQuote } from '../../pms/types/Quote';
import { formatDateYYYYMMDD } from '../../utils/helper';
import logger from '../../utils/logger';
import { HostawayListing } from '../types/Listing';
import {
  HostawayPriceComponent,
  HostawayPriceDetailsResult,
} from '../types/PriceDetails';
import {
  HostawayReservationRequest,
  HostawayReservationResult,
} from '../types/Reservation';

export interface HostawayRoom {
  room_id: number;
  room_name: string;
  description: string;
  base_price: number;
  max_occupancy: number;
  beds_count: number;
  bathrooms_count: number;
  min_nights: number;
  max_nights: number;
  currency: string;
  amenities: string[];
}

export function mapListingToRoom(listing: HostawayListing): HostawayRoom {
  return {
    room_id: listing.id,
    room_name: listing.name,
    description: listing.description,
    base_price: listing.price,
    max_occupancy: listing.personCapacity,
    beds_count: listing.bedsNumber,
    bathrooms_count: listing.bathroomsNumber,
    // max_children: listing.maxChildrenAllowed, Didn't find any way to set these on the hostaway dashboard
    // max_infants: listing.maxInfantsAllowed,
    // max_pets: listing.maxPetsAllowed,
    min_nights: listing.minNights,
    max_nights: listing.maxNights,
    currency: listing.currencyCode,

    // This tells us things like pet-friendliness, child-friendliness, etc.
    amenities: listing.listingAmenities?.map((a) => a.amenityName) || [],
  };
}

export function mapPriceDetailsToPMSQuote(
  priceDetails: HostawayPriceDetailsResult,
  currency: string,
): PMSQuote {
  if (!priceDetails.components || priceDetails.components.length === 0) {
    logger.warn(
      'mapPriceDetailsToPMSQuote: No components found in price details',
    );
    let quote: PMSQuote = {
      base_rate: 0,
      taxes: 0,
      fees: 0,
      total_amount: priceDetails.totalPrice,
      amountCharged: priceDetails.totalPrice,
      currency: currency,
      raw_response: null, // set this in the parent function
      quote_modified_by_dextr: null, // set this in the parent function
    };
    return quote;
  }

  const base_rate = priceDetails.components
    .filter((c: HostawayPriceComponent) => c.type === 'accommodation')
    .reduce((sum: number, c: HostawayPriceComponent) => sum + c.total, 0);

  const taxes = priceDetails.components
    .filter((c: HostawayPriceComponent) => c.type === 'tax')
    .reduce((sum: number, c: HostawayPriceComponent) => sum + c.total, 0);

  const fees = priceDetails.components
    .filter((c: HostawayPriceComponent) => c.type === 'fee')
    .reduce((sum: number, c: HostawayPriceComponent) => sum + c.total, 0);

  const quote: PMSQuote = {
    base_rate: base_rate,
    taxes: taxes,
    fees: fees,
    total_amount: priceDetails.totalPrice,
    amountCharged: priceDetails.totalPrice,
    currency: currency,
    raw_response: null, // set this in the parent function
    quote_modified_by_dextr: null, // set this in the parent function
  };
  return quote;
}

export function mapReservationToHostawayRequest(
  reservation: Reservation,
  customer: Customer,
  quote: Quote,
  channelId: number,
): HostawayReservationRequest {
  if (!customer.first_name || !customer.email || !customer.phone_number) {
    throw new BadRequestError(
      'mapReservationToHostawayRequest: Missing required customer fields (first_name, email, phone_number)',
    );
  }

  if (!customer.address?.postal_code || !customer.address?.state_or_province) {
    throw new BadRequestError(
      'mapReservationToHostawayRequest: Missing required address fields (postal_code, state_or_province)',
    );
  }

  const guestName = `${customer.first_name} ${customer.last_name || ''}`.trim();
  const checkIn = formatDateYYYYMMDD(reservation.check_in);
  const checkOut = formatDateYYYYMMDD(reservation.check_out);

  // This should be set to true when the entire amount is collected.
  // If multiple payments are made, then create offline charges and send to Hostaway.
  // Once all the payments are collected, Hostaway will automatically set this to true.
  const isPaid =
    reservation.payment_status === ReservationPaymentStatus.FULLY_PAID
      ? true
      : null;

  // Extract components from the quote's finance fields
  const financeFields: HostawayPriceComponent[] =
    quote.quote_object?.quote_modified_by_dextr?.components || [];

  return {
    isPaid,
    channelId,
    listingMapId: Number(reservation.room_id),
    guestName,
    guestFirstName: customer.first_name,
    guestLastName: customer.last_name || '',
    guestZipCode: customer.address.postal_code,
    guestAddress: customer.address.address_first_line || '',
    guestCity: '',
    guestCountry: customer.address.country || 'US',
    guestEmail: customer.email,
    numberOfGuests: reservation.num_adults + (reservation.num_children || 0),
    adults: reservation.num_adults,
    children: reservation.num_children || null,
    infants: null,
    pets: reservation.num_pets || null,
    arrivalDate: checkIn,
    departureDate: checkOut,
    checkInTime: null,
    checkOutTime: null,
    phone: customer.phone_number,
    totalPrice: quote.amount_charged,
    taxAmount: quote.taxes || null,
    currency: 'USD',
    financeFields,
  };
}

export function mapHostawayReservationToResponse(
  hostawayReservation: HostawayReservationResult,
): CreateReservationResponse {
  return {
    reservation_id:
      hostawayReservation.hostawayReservationId ||
      hostawayReservation.id.toString(),
    notes_from_partner: undefined,
    channelReservationId: hostawayReservation.channelReservationId,
    guestAuthHash: hostawayReservation.guestAuthHash,
    guestPortalUrl: hostawayReservation.guestPortalUrl,
  };
}
