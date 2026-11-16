import dayjs from 'dayjs';
import _ from 'lodash';
import config from '../../../config';
import { SessionType } from '../../../dtos/enum/SessionType';
import { Reservation } from '../../../dtos/Reservation';
import { BadRequestError } from '../../../errors/BadRequestError';
import { BaseError } from '../../../errors/BaseError';
import { NoDataError } from '../../../errors/NoDataError';
import { Hotel } from '../../../models/Hotel';
import { GetSingleRoomAvailabilityRequestParams } from '../../../models/request/availability';
import { PeoplePerRoom } from '../../../models/request/roomReservation';
import {
  CreateReservationParams,
  CreateReservationResponse,
  IPMSReservationService,
  ReservationNotesContext,
} from '../../../pms/types/IPMSReservationService';
import { PMSQuote } from '../../../pms/types/Quote';
import { PMSQuoteRequest } from '../../../pms/types/QuoteRequest';
import {
  HotelService,
  hotelService,
} from '../../../services/hotel/hotelService';
import { PaymentProvider } from '../../../types/enums';
import {
  DepositType,
  InitialDepositPolicy,
} from '../../../types/hotelConfiguration';
import { formatCurrencyAmount, roundCurrency } from '../../../utils/helper';
import logger from '../../../utils/logger';
import hostawayClient, { HostawayClient } from '../../client/hostawayClient';
import { HostawayApiError } from '../../errors/HostawayApiError';
import { HostawayListing, HostawayListingsResponse } from '../../types/Listing';
import {
  HostawayFeesResponse,
  HostawayPriceDetailsRequest,
  HostawayPriceDetailsResponse,
} from '../../types/PriceDetails';
import {
  HostawayCancelReservationResponse,
  HostawayModifyReservationResponse,
  HostawayReservationResponse,
} from '../../types/Reservation';
import {
  HostawayRoom,
  mapHostawayReservationToResponse,
  mapListingToRoom,
  mapPriceDetailsToPMSQuote,
  mapReservationToHostawayRequest,
} from '../../utils/mapper';
export class HostawayReservationService implements IPMSReservationService {
  private readonly providerId = config.HOSTAWAY_PROVIDER_ID;
  private readonly channelId = config.HOSTAWAY_CHANNEL_ID;
  constructor(
    private hostawayClient: HostawayClient,
    private hotelService: HotelService,
  ) {}

  async getRoomsInfo(
    businessId: string,
  ): Promise<{ rooms: HostawayRoom[]; note: string }> {
    try {
      logger.info(
        `HostawayReservationService.getRoomsInfo: Fetching listings for business ${businessId}`,
      );

      const url = `/listings?parentId=${businessId}&provider=${this.providerId}`;
      const response =
        await this.hostawayClient.get<HostawayListingsResponse>(url);
      const note =
        'This is static room type information only. To check if rooms are available for specific dates, you must call the availability tool.';
      // Check for Hostaway API error response
      if (response.status === 'fail') {
        const errorMsg =
          (response as any).message || 'Unknown error from Hostaway API';
        logger.error(
          `HostawayReservationService.getRoomsInfo: Hostaway API returned error: ${errorMsg}`,
        );
        throw new HostawayApiError(
          `Failed to fetch listings: ${errorMsg}`,
          400,
          errorMsg,
        );
      }

      // Handle empty result array
      if (!response.result || response.result.length === 0) {
        logger.warn(
          `HostawayReservationService.getRoomsInfo: No listings found for business ${businessId}`,
        );
        return { rooms: [], note };
      }

      const rooms = response.result.map((listing: HostawayListing) =>
        mapListingToRoom(listing),
      );
      logger.info(
        `HostawayReservationService.getRoomsInfo: Found ${rooms.length} listings for business ${businessId}`,
      );

      return { rooms, note };
    } catch (error) {
      logger.error(
        `HostawayReservationService.getRoomsInfo: Error fetching listings for business ${businessId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get quote from Hostaway priceDetails API
   * Returns a PMSQuote with mapped fields (base_rate, taxes, fees, total_amount, currency, amountCharged)
   * and the complete raw Hostaway response in raw_response field for data preservation
   *
   * @param params - PMS-agnostic quote request parameters
   * @returns Quote object with mapped PMSQuote fields at top level and raw Hostaway response nested
   */
  async getQuote(
    params: PMSQuoteRequest,
  ): Promise<PMSQuote & Record<string, any>> {
    try {
      const {
        business_id,
        room_id,
        check_in,
        check_out,
        num_adults,
        num_children,
        hotel_id,
        num_pets,
      } = params;

      logger.info(
        `HostawayReservationService.getQuote: Getting quote for listing ${room_id}`,
        {
          business_id,
          check_in,
          check_out,
          num_adults,
          num_children,
        },
      );

      const feesForRoomUrl = `/listingFeeSettings/${room_id}?provider=${this.providerId}`;
      const feesForRoom =
        await this.hostawayClient.get<HostawayFeesResponse>(feesForRoomUrl);
      const components =
        feesForRoom?.result?.map((fee) => ({
          listingFeeSettingId: fee.id,
          name: fee.feeType,
        })) || [];

      const priceRequest: HostawayPriceDetailsRequest = {
        startingDate: check_in,
        endingDate: check_out,
        numberOfGuests: num_adults + (num_children || 0),
        markup: 1,
        version: 2,
        ...(components.length > 0 && { components }),
      };

      const priceUrl = `/listings/${room_id}/calendar/priceDetails?provider=${this.providerId}`;
      const response =
        await this.hostawayClient.post<HostawayPriceDetailsResponse>(
          priceUrl,
          priceRequest,
        );

      // Check for Hostaway API error response
      if (response.status === 'fail') {
        const errorMsg =
          (response as any).message || 'Unknown error from Hostaway API';
        logger.error(
          `HostawayReservationService.getQuote: Hostaway API returned error: ${errorMsg}`,
        );
        throw new HostawayApiError(
          `Failed to get quote: ${errorMsg}`,
          400,
          errorMsg,
        );
      }

      // Handle missing result
      if (!response.result) {
        throw new HostawayApiError(
          `No price details returned for listing ${room_id}`,
        );
      }

      const rawResponse = _.cloneDeep(response.result);

      const hotelWithConfig =
        await this.hotelService.getHotelWithConfigurationsAndChannels(hotel_id);
      const hotelConfig = hotelWithConfig?.configuration;
      const hotel = hotelWithConfig?.hotel;
      if (!hotel) {
        throw new NoDataError(
          `getQuote: Hotel not found for hotel ID ${hotel_id}`,
        );
      }

      const nonPetFeeComponents =
        response.result.components?.filter(
          (component) => component.name !== 'petFee',
        ) || [];
      const petFeeComponent = response.result.components?.find(
        (component) => component.name === 'petFee',
      );
      if (num_pets) {
        if (petFeeComponent) {
          const totalPetFee = petFeeComponent.value * num_pets;
          petFeeComponent.total = totalPetFee;
          petFeeComponent.isQuantitySelectable = 1;
          petFeeComponent.quantity = num_pets;
          petFeeComponent.isOverriddenByUser = 1; // This should be set to 1 for any property whose value we override.
        }
      }

      response.result.components =
        num_pets && petFeeComponent
          ? [...nonPetFeeComponents, petFeeComponent]
          : nonPetFeeComponents;

      // Recalculate total price by adding the price of only the relevant components.
      response.result.totalPrice = response.result.components
        ?.filter((c) => c.isIncludedInTotalPrice)
        .reduce((sum, component) => sum + component.total, 0);

      let quote: PMSQuote = mapPriceDetailsToPMSQuote(
        response.result,
        hotel.currency,
      );

      quote = this.applyInitialDepositPolicy(
        quote,
        check_in,
        check_out,
        hotelConfig?.initial_deposit_policy,
        hotel.payment_provider,
      );

      // These will be needed during reservation creation
      const quoteModifiedByDextr = _.cloneDeep(response.result);
      quote.quote_modified_by_dextr = quoteModifiedByDextr;

      // Attach raw Hostaway priceDetails response for complete data preservation
      quote.raw_response = rawResponse;

      logger.info(
        `HostawayReservationService.getQuote: Quote calculated successfully: ${JSON.stringify(quote)}`,
      );

      return quote;
    } catch (error) {
      logger.error(
        `HostawayReservationService.getQuote: Error getting quote`,
        error,
      );
      throw error;
    }
  }

  private applyInitialDepositPolicy(
    quote: PMSQuote,
    checkIn: string,
    checkOut: string,
    policy: InitialDepositPolicy | null | undefined,
    paymentProvider: PaymentProvider,
  ): PMSQuote {
    if (paymentProvider === PaymentProvider.NOT_APPLICABLE) {
      quote.amountCharged = 0;
      logger.info(
        'HostawayReservationService.applyInitialDepositPolicy: Payment provider is NOT_APPLICABLE, setting amountCharged to 0',
      );
      return quote;
    }

    if (!policy?.enabled || !policy.tiers?.length) {
      return quote;
    }

    const nights = dayjs(checkOut).diff(dayjs(checkIn), 'day');
    const matchedTier = policy.tiers.find((tier) => {
      const meetsMin = nights >= tier.min_nights;
      const meetsMax = tier.max_nights == null || nights <= tier.max_nights;
      return meetsMin && meetsMax;
    });

    if (!matchedTier) {
      return quote;
    }

    let depositAmount: number | undefined;

    switch (matchedTier.deposit_type) {
      case DepositType.PERCENTAGE: {
        const pct = matchedTier.value;
        if (pct == null) return quote;
        depositAmount = roundCurrency((quote.total_amount * pct) / 100);
        break;
      }
      case DepositType.FLAT: {
        const flat = matchedTier.value;
        if (flat == null) return quote;
        depositAmount = roundCurrency(flat);
        break;
      }
      default:
        return quote;
    }

    if (depositAmount == null) return quote;

    quote.amountCharged = roundCurrency(
      Math.min(depositAmount, quote.total_amount),
    );
    return quote;
  }

  async createReservation(
    params: CreateReservationParams,
  ): Promise<CreateReservationResponse> {
    try {
      const { reservation, customer, quote } = params;

      logger.info(
        `HostawayReservationService.createReservation: Creating reservation for booking ${reservation.booking_id}`,
      );

      const hostawayRequest = mapReservationToHostawayRequest(
        reservation,
        customer,
        quote,
        this.channelId,
      );

      const url = `/reservations?provider=${this.providerId}`;
      const response =
        await this.hostawayClient.post<HostawayReservationResponse>(
          url,
          hostawayRequest,
        );

      // Check for Hostaway API error response
      if (response.status === 'fail') {
        const errorMsg =
          (response as any).message || 'Unknown error from Hostaway API';
        logger.error(
          `HostawayReservationService.createReservation: Hostaway API returned error: ${errorMsg}`,
        );
        throw new HostawayApiError(
          `Failed to create reservation: ${errorMsg}`,
          400,
          errorMsg,
        );
      }

      // Handle missing result
      if (!response.result) {
        throw new BaseError(
          'No result returned from Hostaway reservation creation',
        );
      }

      const result = mapHostawayReservationToResponse(response.result);

      logger.info(
        `HostawayReservationService.createReservation: Reservation created successfully`,
        {
          booking_id: reservation.booking_id,
          hostaway_reservation_id: result.reservation_id,
        },
      );

      return result;
    } catch (error) {
      logger.error(
        `HostawayReservationService.createReservation: Error creating reservation`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get room availability with full quote details
   * Uses existing getQuote logic - successful price = available dates
   */
  async getRoomAvailabilityWithQuote(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionType: SessionType,
  ): Promise<any> {
    const {
      start_date,
      end_date,
      num_adults,
      num_children = 0,
      num_pets = 0,
    } = availabilityParams;

    try {
      logger.info(
        `HostawayReservationService.getRoomAvailabilityWithQuote: Checking availability`,
        {
          start_date,
          end_date,
          num_adults,
          num_children,
          num_pets,
        },
      );

      const hotel =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          hotelPhoneNumber,
        );
      if (!hotel) {
        throw new NoDataError(
          `HostawayReservationService.getRoomAvailabilityWithQuote: Hotel not found for phone ${hotelPhoneNumber}`,
        );
      }

      const businessId = hotel.business_id;
      const roomsInfo = await this.getRoomsInfo(businessId.toString());
      const listings = roomsInfo.rooms;
      if (!listings || listings.length === 0) {
        logger.warn(
          `HostawayReservationService.getRoomAvailabilityWithQuote: No listings found for business ${businessId}`,
        );
        return { groups: [], discount: null };
      }

      const groupsWithQuotes = await Promise.all(
        listings.map(async (listing: HostawayRoom) => {
          try {
            const quote = await this.getQuote({
              business_id: businessId,
              room_id: listing.room_id,
              check_in: start_date,
              check_out: end_date,
              num_adults,
              num_children,
              num_pets,
              hotel_id: hotel.id,
              caller_phone_num: phoneNumber,
            });

            return {
              room_id: listing.room_id,
              room_name: listing.room_name,
              room_description: listing.description,
              base_rate: quote.base_rate,
              taxes: quote.taxes,
              fees: quote.fees,
              total_amount: quote.total_amount,
              amount_charged: quote.amountCharged,
              currency: quote.currency,
              max_occupancy: listing.max_occupancy,
            };
          } catch (error: any) {
            logger.info(
              `HostawayReservationService.getRoomAvailabilityWithQuote: Listing ${listing.room_id} unavailable - treating as no availability`,
              { error: error.message },
            );
            return null;
          }
        }),
      );

      const availableGroups = groupsWithQuotes.filter(
        (group) => group !== null,
      );

      if (availableGroups.length === 0) {
        logger.info(
          `HostawayReservationService.getRoomAvailabilityWithQuote: No availability for dates ${start_date} to ${end_date}`,
        );
        return {
          groups: listings.map((listing: HostawayRoom) => ({
            room_id: listing.room_id,
            room_name: listing.room_name,
            room_description: listing.description,
            availability_in_requested_period: `For check-in ${start_date} to check-out ${end_date}, no rooms are available. Try different dates.`,
          })),
          discount: null,
        };
      }

      logger.info(
        `HostawayReservationService.getRoomAvailabilityWithQuote: Found ${availableGroups.length} available listings`,
      );

      return {
        groups: availableGroups,
        discount: null,
      };
    } catch (error) {
      logger.error(
        `HostawayReservationService.getRoomAvailabilityWithQuote: Error getting availability`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get room availability with lite quote details (simplified response)
   * Uses same logic as full version but returns simplified format
   */
  async getRoomAvailabilityWithQuoteLite(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionType: SessionType,
  ): Promise<any> {
    const {
      start_date,
      end_date,
      num_adults,
      num_children = 0,
      num_pets = 0,
    } = availabilityParams;

    try {
      logger.info(
        `HostawayReservationService.getRoomAvailabilityWithQuoteLite: Checking availability`,
        {
          start_date,
          end_date,
          num_adults,
          num_children,
          num_pets,
        },
      );

      const hotel =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          hotelPhoneNumber,
        );
      if (!hotel) {
        throw new NoDataError(
          `HostawayReservationService.getRoomAvailabilityWithQuoteLite: Hotel not found for phone ${hotelPhoneNumber}`,
        );
      }

      const businessId = hotel.business_id;
      const roomsInfo = await this.getRoomsInfo(businessId.toString());
      const listings = roomsInfo.rooms;

      if (!listings || listings.length === 0) {
        logger.warn(
          `HostawayReservationService.getRoomAvailabilityWithQuoteLite: No listings found for business ${businessId}`,
        );
        return { available_rooms: [] };
      }

      const groupsWithQuotes: Array<{ [key: string]: string }> = [];

      const quotePromises = listings.map(async (listing: HostawayRoom) => {
        try {
          const quote = await this.getQuote({
            business_id: businessId,
            room_id: listing.room_id,
            check_in: start_date,
            check_out: end_date,
            num_adults,
            num_children,
            num_pets,
            hotel_id: hotel.id,
            caller_phone_num: phoneNumber,
          });

          // Format guest count text
          const adultsText =
            num_adults === 1 ? '1 adult' : `${num_adults} adults`;
          const childrenText =
            num_children === 0
              ? '0 children'
              : num_children === 1
                ? '1 child'
                : `${num_children} children`;

          const isNoPayment =
            hotel.payment_provider === PaymentProvider.NOT_APPLICABLE;
          let description = `For ${adultsText} and ${childrenText}, with check-in on ${start_date} and check-out on ${end_date}, the base rate of the ${listing.room_name} (room_id: ${listing.room_id}) is ${formatCurrencyAmount(hotel.currency, quote.base_rate)}, with taxes of ${formatCurrencyAmount(hotel.currency, quote.taxes)} and fees of ${formatCurrencyAmount(hotel.currency, quote.fees)}. The total price is ${formatCurrencyAmount(hotel.currency, quote.total_amount)}.`;
          if (!isNoPayment) {
            description += ` The initial deposit to be paid now to secure the reservation is ${formatCurrencyAmount(hotel.currency, quote.amountCharged)}.`;
          } else {
            description += ` No payment is required to secure this reservation.`;
          }

          groupsWithQuotes.push({
            [listing.room_name]: description,
          });
        } catch (error: any) {
          logger.info(
            `HostawayReservationService.getRoomAvailabilityWithQuoteLite: Listing ${listing.room_id} unavailable`,
            { error: error.message },
          );
        }
      });

      await Promise.all(quotePromises);

      if (groupsWithQuotes.length === 0) {
        logger.info(
          `HostawayReservationService.getRoomAvailabilityWithQuoteLite: No availability for dates ${start_date} to ${end_date}`,
        );
        const adultsKeyword = num_adults === 1 ? 'adult' : 'adults';
        const childrenKeyword = num_children === 1 ? 'child' : 'children';
        return {
          groups: listings.map((listing: HostawayRoom) => ({
            room_id: listing.room_id,
            room_name: listing.room_name,
            room_description: listing.description,
            availability_in_requested_period: `For check-in ${start_date} to check-out ${end_date}, no rooms are available for ${num_adults} ${adultsKeyword} and ${num_children} ${childrenKeyword}. Try different dates or occupancy.`,
          })),
          discount: null,
        };
      }

      logger.info(
        `HostawayReservationService.getRoomAvailabilityWithQuoteLite: Found ${groupsWithQuotes.length} available rooms`,
      );

      return {
        groups: groupsWithQuotes,
        discount: null,
      };
    } catch (error) {
      logger.error(
        `HostawayReservationService.getRoomAvailabilityWithQuoteLite: Error getting availability`,
        error,
      );
      throw error;
    }
  }

  async getRoomAvailabilityWithQuoteLiteV2(..._args: any[]): Promise<any> {
    throw new Error(
      'HostawayReservationService: getRoomAvailabilityWithQuoteLiteV2 not supported',
    );
  }

  async getMultiRoomAvailabilityWithQuoteLiteV2(..._args: any[]): Promise<any> {
    throw new Error(
      'HostawayReservationService: getMultiRoomAvailabilityWithQuoteLiteV2 not supported',
    );
  }

  async getMultiRoomAvailabilityWithQuote(...args: any[]): Promise<any> {
    throw new Error(
      'HostawayReservationService.getMultiRoomAvailabilityWithQuote: Not implemented',
    );
  }

  async getMultiRoomAvailabilityWithQuoteLite(...args: any[]): Promise<any> {
    throw new Error(
      'HostawayReservationService.getMultiRoomAvailabilityWithQuoteLite: Not implemented',
    );
  }

  async getAllRatesForRoomType(...args: any[]): Promise<any> {
    throw new Error(
      'HostawayReservationService.getAllRatesForRoomType: Not implemented',
    );
  }

  async getWebRoomAvailabilityV2(...args: any[]): Promise<any> {
    throw new Error(
      'HostawayReservationService.getWebRoomAvailabilityV2: Not implemented',
    );
  }

  async validateRoomAvailability(...args: any[]): Promise<void> {
    throw new Error(
      'HostawayReservationService.validateRoomAvailability: Not implemented',
    );
  }

  /**
   * Cancel a reservation in Hostaway
   * @param params - Object containing external_id (Hostaway reservation ID) and optional cancelledBy
   * @returns The response from Hostaway API
   */
  async cancelReservation(params: {
    business_id: string;
    external_id: string;
    cancelledBy?: string;
  }): Promise<HostawayCancelReservationResponse> {
    try {
      const { external_id, cancelledBy = 'host' } = params;
      if (!external_id) {
        throw new BadRequestError(
          `cancelReservation: Hostaway reservation cannot be cancelled since externalId is not provided`,
        );
      }
      logger.info(
        `HostawayReservationService.cancelReservation: Cancelling reservation ${external_id}`,
      );

      const url = `/reservations/${external_id}/statuses/cancelled?provider=${this.providerId}`;
      const requestBody = {
        cancelledBy,
      };

      const response =
        await this.hostawayClient.put<HostawayCancelReservationResponse>(
          url,
          requestBody,
        );

      // Check for Hostaway API error response
      if (response.status === 'fail') {
        const errorMsg =
          (response as any).message || 'Unknown error from Hostaway API';
        logger.error(
          `HostawayReservationService.cancelReservation: Hostaway API returned error: ${errorMsg}`,
        );
        throw new HostawayApiError(
          `Failed to cancel reservation: ${errorMsg}`,
          400,
          errorMsg,
        );
      }

      logger.info(
        `HostawayReservationService.cancelReservation: Reservation ${external_id} cancelled successfully`,
      );
      return response;
    } catch (error) {
      logger.error(
        `HostawayReservationService.cancelReservation: Error cancelling reservation ${params.external_id}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Modify a reservation in Hostaway
   * Only allows updating check-in and check-out dates
   * @param reservationId - The Hostaway reservation ID to modify
   * @param arrivalDate - New check-in date in YYYY-MM-DD format
   * @param departureDate - New check-out date in YYYY-MM-DD format
   * @returns The response from Hostaway API
   */
  async modifyReservation(
    reservationId: string,
    arrivalDate: string,
    departureDate: string,
  ): Promise<HostawayModifyReservationResponse> {
    try {
      throw new BadRequestError(
        'HostawayReservationService.modifyReservation: Not implemented',
      );
      // logger.info(`HostawayReservationService.modifyReservation: Modifying reservation ${reservationId}`, {
      //   arrivalDate,
      //   departureDate,
      // });

      // const url = `/reservations/${reservationId}?provider=${this.providerId}`;
      // const requestBody = {
      //   arrivalDate,
      //   departureDate,
      // };

      // const response = await this.hostawayClient.put<HostawayModifyReservationResponse>(url, requestBody);

      // // Check for Hostaway API error response
      // if (response.status === 'fail') {
      //   const errorMsg = (response as any).message || 'Unknown error from Hostaway API';
      //   logger.error(`HostawayReservationService.modifyReservation: Hostaway API returned error: ${errorMsg}`);
      //   throw new HostawayApiError(`Failed to modify reservation: ${errorMsg}`, 400, errorMsg);
      // }

      // logger.info(`HostawayReservationService.modifyReservation: Reservation ${reservationId} modified successfully`);
      // return response;
    } catch (error) {
      logger.error(
        `HostawayReservationService.modifyReservation: Error modifying reservation ${reservationId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get a map of room IDs to room type names
   * @param args - Variable arguments, expects businessId as first parameter
   * @returns Map of room_id to room_name for all Hostaway listings
   */
  async getRoomTypeMap(...args: any[]): Promise<Map<string, string>> {
    const businessId = args[0];
    const roomsInfo = await this.getRoomsInfo(String(businessId));
    const rooms = roomsInfo.rooms;

    const roomTypeMap = new Map<string, string>();
    rooms.forEach((room: any) => {
      roomTypeMap.set(String(room.room_id), room.room_name);
    });

    return roomTypeMap;
  }

  async getQuoteForModification(
    ...args: any[]
  ): Promise<PMSQuote & Record<string, any>> {
    throw new Error(
      'HostawayReservationService.getQuoteForModification: Not implemented',
    );
  }

  async lookupReservationsById(
    _hotel: Hotel,
    _bookingId: string,
  ): Promise<Reservation[]> {
    throw new Error('hostaway: lookupReservationsByAnyId not implemented ');
  }

  async lookupReservationsByPhone(
    _hotel: Hotel,
    _phoneNumber: string,
    _maxResults?: number,
  ): Promise<Reservation[]> {
    throw new Error('hostaway: lookupReservationsByPhone not implemented ');
  }

  async getExternalModificationInfo(..._args: any[]): Promise<any> {
    throw new Error(
      'HostawayReservationService: getExternalModificationInfo not supported',
    );
  }

  async modifyExternalDirectReservation(..._args: any[]): Promise<any> {
    throw new Error(
      'HostawayReservationService: modifyExternalDirectReservation not supported',
    );
  }

  async cancelExternalDirectReservation(..._args: any[]): Promise<any> {
    throw new Error(
      'HostawayReservationService: cancelExternalDirectReservation not supported',
    );
  }

  async getRateIdByCode(..._args: any[]): Promise<undefined> {
    return undefined;
  }

  // TODO: Implement multi-room occupancy validation for Hostaway when required.
  async validateMultiRoomOccupancy(
    _peoplePerRoom: PeoplePerRoom,
    _roomsInfo: any,
    _hotelId: string,
  ): Promise<void> {
    throw new Error(
      'HostawayReservationService: validateMultiRoomOccupancy not supported',
    );
  }

  // TODO: Implement discount support for Hostaway when required.
  shouldFetchDiscount(): boolean {
    return false;
  }

  // TODO: Implement PMS-specific partner notes for Hostaway when required.
  buildPartnerNotes(_context: ReservationNotesContext): string | null {
    return null;
  }
}

const hostawayReservationService = new HostawayReservationService(
  hostawayClient,
  hotelService,
);

export default hostawayReservationService;
