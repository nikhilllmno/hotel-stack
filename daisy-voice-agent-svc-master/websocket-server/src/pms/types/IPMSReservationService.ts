// Base interface that all PMS reservation services must implement

import { Customer } from '../../dtos/Customer';
import { Quote } from '../../dtos/Quote';
import { Reservation } from '../../dtos/Reservation';
import { Discount } from '../../models/Discount';
import { Hotel } from '../../models/Hotel';
import { PeoplePerRoom } from '../../models/request/roomReservation';
import { RateCalendar } from '../../models/response/rateCalendar';
import { AddReservationNotesRequest } from '../../stayntouch/types/ReservationNoteRequest';
import { PMSQuote } from './Quote';
import { PMSQuoteRequest } from './QuoteRequest';

/**
 * Context passed to buildPartnerNotes so each PMS service can format
 * notes according to its own conventions.
 */
export interface ReservationNotesContext {
  numPets?: number;
  discountNote?: string | null;
}

/**
 * A raw card for a PMS that takes payment in its create call. It is held in
 * memory for one request and never persisted, logged or returned.
 */
export interface PmsCardDetails {
  pan: string;
  cvv: string;
  expiryMonth: number;
  expiryYear: number;
  cardHolderName?: string;
}

/**
 * Parameters for creating a reservation in the PMS
 */
export interface CreateReservationParams {
  reservation: Reservation;
  customer: Customer;
  quote: Quote;
  discount?: Discount | null;
  notes_from_partner?: string;
  card?: PmsCardDetails;
}

/**
 * Response from creating a reservation in the PMS
 */
export interface CreateReservationResponse {
  reservation_id: string;
  notes_from_partner?: string;
  external_public_id?: string;
  [key: string]: any; // Allow PMS-specific fields
}

export interface IPMSReservationService {
  // ========== AVAILABILITY METHODS ==========

  /**
   * Validate room availability
   */
  validateRoomAvailability(...args: any[]): Promise<void>;

  /**
   * Get single room availability with full quote details
   */
  getRoomAvailabilityWithQuote(...args: any[]): Promise<any>;

  /**
   * Get single room availability with lite quote details (faster)
   */
  getRoomAvailabilityWithQuoteLite(...args: any[]): Promise<any>;

  /**
   * Get single room availability with lite quote details, sourced from an
   * alternate PMS availability endpoint. Currently Cloudbeds-only — a
   * workaround for a Cloudbeds bug where `getRoomTypes` intermittently
   * errors for same-day check-ins. Other PMS services throw "not supported".
   */
  getRoomAvailabilityWithQuoteLiteV2(...args: any[]): Promise<any>;

  /**
   * Get multi-room availability with full quote details
   */
  getMultiRoomAvailabilityWithQuote(...args: any[]): Promise<any>;

  /**
   * Get multi-room availability with lite quote details (faster)
   */
  getMultiRoomAvailabilityWithQuoteLite(...args: any[]): Promise<any>;

  /**
   * Get multi-room availability with lite quote details, sourced from an
   * alternate PMS availability endpoint. Currently Cloudbeds-only — a
   * workaround for a Cloudbeds bug where `getRoomTypes` intermittently
   * errors for same-day check-ins. Other PMS services throw "not supported".
   */
  getMultiRoomAvailabilityWithQuoteLiteV2(...args: any[]): Promise<any>;

  /**
   * Get all available rates for a specific room type, ignoring allowed-rate-code restrictions.
   */
  getAllRatesForRoomType(...args: any[]): Promise<any>;

  /**
   * Get web room availability with full quote details
   */
  getWebRoomAvailabilityV2(...args: any[]): Promise<any>;

  /**
   * Nightly rate and availability per room type for each night from startDate to
   * endDate (both inclusive), for the public rate calendar widget.
   *
   * Optional — only PMS services with a calendar or rate-grid API implement this.
   */
  getRateCalendar?(
    businessId: string,
    startDate: string,
    endDate: string,
  ): Promise<RateCalendar>;

  // ========== RESERVATION CRUD METHODS ==========

  /**
   * Create a reservation in the PMS
   * @param params - Object containing reservation, customer, quote, discount, and notes data
   * @returns PMS-specific response with reservation_id and optional notes
   */
  createReservation(
    params: CreateReservationParams,
  ): Promise<CreateReservationResponse>;

  /**
   * Cancel a reservation
   */
  cancelReservation(...args: any[]): Promise<any>;

  /**
   * Modify an existing reservation
   */
  modifyReservation(...args: any[]): Promise<any>;

  /**
   * Check availability and compute pricing delta for an external direct reservation modification.
   * Does not require a stored quote in the database.
   */
  getExternalModificationInfo(...args: any[]): Promise<any>;

  /**
   * Modify an external direct reservation (Hotel Website / Property source) in the PMS.
   * Does not persist the modification to the local database.
   */
  modifyExternalDirectReservation(...args: any[]): Promise<any>;

  /**
   * Cancel an external direct reservation (Hotel Website / Property source) in the PMS.
   */
  cancelExternalDirectReservation(...args: any[]): Promise<any>;

  /**
   * Given a rate code string (e.g. "BAR"), return the corresponding PMS rate ID
   * (numeric for most providers, UUID string for Mews), or undefined if no match is found.
   * Used to resolve rate IDs when only the code is known.
   * hotelId is the PMS-facing id: numeric business_id for most providers, hotel.id UUID for Mews.
   */
  getRateIdByCode(
    hotelId: number | string,
    rateCode: string,
  ): Promise<number | string | undefined>;

  /**
   * Look up reservations in the PMS by external / confirmation id when no local row exists.
   */
  lookupReservationsById(
    hotel: Hotel,
    bookingId: string,
  ): Promise<Reservation[]>;

  /**
   * Look up reservations in the PMS by guest phone when no local row exists.
   */
  lookupReservationsByPhone(
    hotel: Hotel,
    phoneNumber: string,
    maxResults?: number,
  ): Promise<Reservation[]>;

  // ========== ROOM INFO METHODS ==========

  /**
   * Get rooms information (unit groups, room types, etc.)
   * Renamed from getUnitGroups to be PMS-agnostic
   */
  getRoomsInfo(businessId: string): Promise<any>;

  /**
   * Get a map of room IDs to room type names
   * @param businessId - Business/property ID
   * @param roomIds - Array of room IDs to get names for
   * @param roomsInfo - Optional cached rooms info to avoid extra API call
   * @returns Map of room ID to room type name
   */
  getRoomTypeMap(...args: any[]): Promise<Map<string, string>>;

  /**
   * Validate that the requested occupancy per room doesn't exceed
   * PMS-specific capacity limits.  Each PMS has its own room-info shape
   * and capacity rules so the validation lives here, not in the orchestrator.
   *
   * @param peoplePerRoom - requested occupancy keyed by room ID
   * @param roomsInfo     - the result of getRoomsInfo() for the same hotel
   * @param hotelId       - hotel UUID (for hotel-specific overrides)
   */
  validateMultiRoomOccupancy(
    peoplePerRoom: PeoplePerRoom,
    roomsInfo: any,
    hotelId: string,
  ): Promise<void>;

  // ========== QUOTE METHODS ==========

  /**
   * Get quote for a reservation with pet fees and discounts applied
   * Uses PMS-agnostic parameters (room_id instead of unit_group_id/room_type_id)
   * Each PMS service should:
   * - Map room_id to their PMS-specific field (unit_group_id for ResNexus, room_type_id for Cloudbeds, etc.)
   * - Fetch the base quote from their PMS API
   * - Apply hotel-specific pet fees (if applicable)
   * - Apply customer discounts (if applicable)
   * - Apply payment configuration (force full payment if configured)
   * - Calculate final total amount
   */
  getQuote(params: PMSQuoteRequest): Promise<PMSQuote>;

  /**
   * Get quote for a reservation modification with pet fees, discounts, and payment config applied
   * Handles date extensions, shortenings, and complete date changes
   * Uses PMS-agnostic parameters (room_id instead of unit_group_id/room_type_id)
   * Each PMS service should:
   * - Map room_id to their PMS-specific field (unit_group_id for ResNexus, room_type_id for Cloudbeds, etc.)
   * - Calculate quote changes based on date modifications
   * - Apply hotel-specific pet fees (if applicable)
   * - Apply customer discounts (if applicable)
   * - Apply payment configuration (force full payment if configured)
   * - Calculate final total amount
   */
  getQuoteForModification(...args: any[]): Promise<PMSQuote>;

  // ========== PMS-SPECIFIC RESERVATION ENRICHMENT ==========

  /**
   * Whether this PMS supports fetching and applying a discount during reservation creation.
   * When false, the orchestrator skips the discount lookup and linking entirely.
   */
  shouldFetchDiscount(): boolean;

  /**
   * Build the partner notes string to attach to a reservation before it is created.
   * Each PMS encodes reservation context (pets, discounts, etc.) according to its own
   * conventions. Return null if this PMS does not use text-based partner notes.
   */
  buildPartnerNotes(context: ReservationNotesContext): string | null;

  // ========== RESERVATION NOTES ==========

  /**
   * Attach guest notes (special requests) to an existing PMS reservation.
   * Called after create or modify when the guest provides notes.
   *
   * Optional — only PMS services that support reservation notes implement this.
   */
  addReservationNotes?(
    externalId: string,
    noteData: AddReservationNotesRequest,
  ): Promise<void>;
}
