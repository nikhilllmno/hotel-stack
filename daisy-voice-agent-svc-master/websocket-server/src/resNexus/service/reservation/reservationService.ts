import { AxiosInstance, isAxiosError } from 'axios';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { cloneDeep } from 'lodash';
import config from '../../../config';
import { ReservationStatus } from '../../../dtos/enum/ReservationStatus';
import { SessionType } from '../../../dtos/enum/SessionType';
import { HotelConfiguration } from '../../../dtos/HotelConfiguration';
import { Reservation as ReservationDTO } from '../../../dtos/Reservation';
import { BadRequestError } from '../../../errors/BadRequestError';
import { BaseError } from '../../../errors/BaseError';
import ResNexusError from '../../../errors/extenal/ResNexusError';
import { NoDataError } from '../../../errors/NoDataError';
import { PmsBookingOutcomeUnknownError } from '../../../errors/PmsBookingOutcomeUnknownError';
import { Discount } from '../../../models/Discount';
import { Hotel } from '../../../models/Hotel';
import {
  GetAvailabilityRequestParams,
  GetSingleRoomAvailabilityRequestParams,
  GetWebAvailabilityRequestParams,
} from '../../../models/request/availability';
import { PeoplePerRoom } from '../../../models/request/roomReservation';
import { RateCalendar } from '../../../models/response/rateCalendar';
import { GroupWithQuote } from '../../../models/response/roomReservation';
import {
  CreateReservationParams,
  IPMSReservationService,
  CreateReservationResponse as PMSCreateReservationResponse,
  ReservationNotesContext,
} from '../../../pms/types/IPMSReservationService';
import { PMSQuote } from '../../../pms/types/Quote';
import { PMSQuoteRequest } from '../../../pms/types/QuoteRequest';
import {
  discountService,
  DiscountService,
} from '../../../services/discount/discountService';
import {
  hotelService,
  HotelService,
} from '../../../services/hotel/hotelService';
import {
  hotelConfigurationService,
  HotelConfigurationService,
} from '../../../services/hotelConfiguration/hotelConfigurationService';
import {
  applyDiscountToQuote,
  applyLengthOfStayDiscountPolicyToQuote,
  applyPetFeeToQuote,
  EXTENSION_CONDITIONS,
  getDateModificationCategory,
  getExclusiveDates,
  sanitizeDiscount,
  SHORTEN_QUOTE_CONDITIONS,
  validateAndCorrectDates,
} from '../../../services/roomReservation/helper';
import { DiscountType } from '../../../types/discount';
import { PaymentProvider } from '../../../types/enums';
import { ReservationDetails } from '../../../types/reservation';
import {
  adjustEndDateIfSameAsStartDate,
  computeQuoteTotal,
  convertToPhoneNumber,
  formatCurrencyAmount,
  formatDateYYYYMMDD,
  mergeConsecutiveDateRanges,
  numberToWords,
  roundCurrency,
  roundTaxRate,
  validateReservationDates,
} from '../../../utils/helper';
import logger from '../../../utils/logger';
import { GetResNexusSingleRoomAvailabilityRequestParams } from '../../model/request/availability';
import { GetQuoteRequestParams } from '../../model/request/quote';
import {
  CancelReservationRequest,
  CancelReservationRequestDto,
  CreateReservationRequest,
  CreateReservationWithCardRequest,
  ModifyReservationRequest,
} from '../../model/request/reservation';
import {
  GetAvailabilityResponse,
  Group,
} from '../../model/response/availability';
import { GetQuoteResponse } from '../../model/response/quote';
import {
  CalendarResponse,
  CancelReservationResponse,
  CreateReservationResponse,
  ModifyReservationResponse,
} from '../../model/response/reservation';
import {
  ExtendedUnitGroup,
  GetRoomsInfoResponse,
  GetUnitGroupsResponse,
} from '../../model/response/unitGroups';
import {
  applyInitialDepositPolicyToResnexusQuote,
  combineQuotes,
  convertToModifyReservationRequest,
  generateResNexusPartnerNotes,
  generateResNexusPetNotes,
  generateUnitGroupMetadata,
  shortenQuote,
  stripCardFields,
} from '../../utils/helper';
import { buildResNexusRateCalendar } from '../../utils/rateCalendar';
import resNexusInstance from '../../utils/resNexusInterceptor';

dayjs.extend(utc);
dayjs.extend(timezone);

export class ResNexusService implements IPMSReservationService {
  private addReservationURI = 'addreservation';
  private cancelReservationURI = 'cancelreservation';
  private modifyReservationURI = 'modifyreservation';
  private getCalendarURI = 'getcalendar';
  private getQuoteURI = 'getquote';
  private getAvailabilityURI = 'getAllAvailability';
  private getUnitGroupsURI = 'getunitgroups';

  constructor(
    private resNexusInstance: AxiosInstance,
    private hotelService: HotelService,
    private hotelConfigurationService: HotelConfigurationService,
    private discountService: DiscountService,
  ) {}

  /**
   * Creates a reservation in ResNexus (IPMSReservationService interface implementation)
   * @param params Object containing reservation, customer, quote, discount, and notes data
   * @returns the response from ResNexus with reservation_id and notes_from_partner
   */
  async createReservation(
    params: CreateReservationParams,
  ): Promise<PMSCreateReservationResponse> {
    const { reservation, customer, quote, discount, notes_from_partner, card } =
      params;
    const hotel =
      reservation.hotel ??
      (await this.hotelService.getHotelById(reservation.hotel_id));
    if (!hotel) {
      throw new NoDataError(
        `ResNexusService.createReservation: Hotel not found with ID ${reservation.hotel_id}`,
      );
    }

    // ResNexus has no pets field and ignores our pet fee, so when it takes the payment the property must collect it.
    const notes =
      hotel.payment_provider === PaymentProvider.RESNEXUS
        ? generateResNexusPetNotes({
            currency: hotel.currency,
            numPets: reservation.num_pets,
            petFeeToCollect: quote.platform_pricing?.pet_fee_incl_tax,
            existingNotes: notes_from_partner,
          })
        : generateResNexusPartnerNotes({
            currency: hotel.currency,
            baseRate: quote.base_rate ?? 0,
            taxes: quote.taxes ?? 0,
            fees: quote.fees ?? 0,
            amountPaid: quote.amount_charged ?? 0,
            existingNotes: notes_from_partner,
          });

    // quote_object's top-level fields already carry pet-fee/discount adjustments;
    // raw_response is the pre-adjustment PMS snapshot and must not be sent to ResNexus.
    const {
      raw_response: _rawResponse,
      platform_pricing: _platformPricing,
      ...adjustedQuote
    } = quote.quote_object ?? {};

    // Construct ResNexus-specific request body
    const requestBody: CreateReservationRequest = {
      business_id: Number(reservation.business_id),
      check_in: formatDateYYYYMMDD(reservation.check_in),
      check_out: formatDateYYYYMMDD(reservation.check_out),
      unit_group_id: Number(reservation.room_id),
      num_adults: reservation.num_adults.toString(),
      num_children: reservation.num_children?.toString() || '0',
      external_id: reservation.booking_id.toUpperCase(),
      customer: {
        first_name: customer.first_name || '',
        last_name: customer.last_name || '',
        phone_number: customer.phone_number,
        email: customer.email || '',
        address: {
          address_line: customer.address?.address_first_line || '',
          city: customer.address?.city || '',
          postal_code: customer.address?.postal_code || '',
          state_or_province: customer.address?.state_or_province || '',
          country: customer.address?.country || '',
        },
      },
      // Only send the modified quote when it diverges from ResNexus's own pricing:
      // a discount or a pet fee (surfaced via num_pets) are the cases we adjust.
      ...((discount || reservation.num_pets) &&
        quote.quote_object && {
          quote: {
            ...adjustedQuote,
            check_in: formatDateYYYYMMDD(reservation.check_in),
            check_out: formatDateYYYYMMDD(reservation.check_out),
            unit_group_id: Number(reservation.room_id),
          },
        }),
      notes_from_partner: notes || undefined,
    };

    const requestWithCard: CreateReservationWithCardRequest | undefined = card
      ? {
          ...requestBody,
          card_name: card.cardHolderName,
          card_number: card.pan,
          card_cvv: card.cvv,
          expire_month: card.expiryMonth,
          expire_year: card.expiryYear,
        }
      : undefined;

    // Call ResNexus API
    const response = await this.createReservationUtil(
      requestWithCard ?? requestBody,
    );

    if (!response.reservation_id) {
      throw new Error('ResNexus did not return a reservation_id');
    }

    return {
      reservation_id: response.reservation_id,
      notes_from_partner: notes, // Return notes so they can be stored in DB
    };
  }

  /**
   * Utility function to make the actual ResNexus API call for creating a reservation
   * @param requestParams ResNexus-specific request body
   * @returns the response from ResNexus
   */
  private async createReservationUtil(
    requestParams: CreateReservationRequest | CreateReservationWithCardRequest,
  ): Promise<CreateReservationResponse> {
    try {
      logger.info(
        `Creating resnexus reservation: ${JSON.stringify(stripCardFields(requestParams))}`,
      );
      const { data } = await this.resNexusInstance.post(
        this.addReservationURI,
        {
          ...requestParams,
        },
      );

      if (data.response_errors?.length > 0) {
        throw new Error(
          `Error creating resnexus reservation: ${JSON.stringify(
            data.response_errors,
          )}`,
        );
      }

      return data as CreateReservationResponse;
    } catch (error) {
      logger.error(`Error creating resnexus reservation: ${error}`);
      // The axios error carries the request body, which holds the guest's card.
      if (isAxiosError(error)) {
        const status = error.response?.status;
        // With no answer or a server error ResNexus may still have booked the room and taken the deposit.
        if (status === undefined || status >= 500) {
          throw new PmsBookingOutcomeUnknownError();
        }
        throw new Error(
          `Error creating resnexus reservation: ${status} ${error.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Sends a request to ResNexus to cancel a reservation
   * @param dto data needed to cancel a reservation
   * @returns the response from ResNexus
   */
  async cancelReservation(
    dto: CancelReservationRequestDto,
  ): Promise<CancelReservationResponse> {
    try {
      const cancelRequestParams: CancelReservationRequest = {
        business_id: dto.business_id,
        external_id: dto.internal_id,
      };
      logger.info(
        `Cancelling resnexus reservation: ${JSON.stringify(cancelRequestParams)}`,
      );
      const { data } = await this.resNexusInstance.post(
        this.cancelReservationURI,
        cancelRequestParams,
      );

      if (data.response_errors?.length > 0) {
        throw new Error(
          `Error cancelling resnexus reservation: ${JSON.stringify(
            data.response_errors,
          )}`,
        );
      }

      return data as CancelReservationResponse;
    } catch (error) {
      logger.error(`Error cancelling resnexus reservation: ${error}`);
      throw error;
    }
  }

  /**
   * Sends a raw API request to ResNexus to modify a reservation.
   * Use `modifyReservation` for the full orchestrated flow (quote + deposit + PMS update).
   */
  async callModifyReservationAPI(
    requestParams: ModifyReservationRequest,
  ): Promise<ModifyReservationResponse> {
    try {
      logger.info(
        `Modifying resnexus reservation: ${JSON.stringify(stripCardFields(requestParams))}`,
      );
      const { data } = await this.resNexusInstance.post(
        this.modifyReservationURI,
        requestParams,
      );

      if (data.response_errors?.length > 0) {
        throw new ResNexusError(data.response_errors);
      }

      return data as ModifyReservationResponse;
    } catch (error) {
      logger.error(`Error modifying resnexus reservation: ${error}`);
      throw error;
    }
  }

  /**
   * Modifies a ResNexus reservation: recalculates the quote for the new dates
   * (via getQuoteForModification, which applies the deposit policy) and
   * (when the reservation is ACTIVE) sends the update to the ResNexus API.
   * Returns the updated PMSQuote so the caller can persist it to the database.
   */
  async modifyReservation(
    reservationDetails: ReservationDTO,
    newCheckIn: string,
    newCheckOut: string,
    discount: Discount | null,
  ): Promise<PMSQuote> {
    try {
      const mergedQuoteWithRaw = await this.getQuoteForModification(
        reservationDetails,
        newCheckIn,
        newCheckOut,
        discount,
      );

      const hotel =
        reservationDetails.hotel ??
        (await this.hotelService.getHotelById(reservationDetails.hotel_id));

      if (reservationDetails.status === ReservationStatus.ACTIVE) {
        // mergedQuoteWithRaw's top-level fields already carry pet-fee/discount adjustments;
        // raw_response is the pre-adjustment PMS snapshot and must not be sent to ResNexus.
        const {
          raw_response: _rawResponse,
          platform_pricing: _platformPricing,
          ...adjustedQuote
        } = mergedQuoteWithRaw;

        const updatedReservationDetails: ReservationDetails = {
          ...reservationDetails,
          quote: adjustedQuote,
          external_id: reservationDetails.booking_id.toUpperCase(),
          business_id: reservationDetails.business_id.toString(),
          check_in: newCheckIn,
          check_out: newCheckOut,
        };

        const modifiedReservation = await this.callModifyReservationAPI(
          convertToModifyReservationRequest(updatedReservationDetails),
        );
        logger.info(
          `ResNexusService.modifyReservation: Modified reservation: ${modifiedReservation.status_value}`,
        );
      }

      return mergedQuoteWithRaw;
    } catch (error) {
      logger.error(
        'ResNexusService.modifyReservation: Error modifying reservation',
        { error },
      );
      throw error;
    }
  }

  /**
   * Utility method: Sends a raw request to ResNexus API to get a quote
   * This is the base PMS API call without any business logic
   * @param requestParams data needed to get a quote
   * @returns the raw response from ResNexus
   */
  private async getQuoteUtil(
    requestParams: GetQuoteRequestParams,
  ): Promise<GetQuoteResponse> {
    try {
      if (
        Number(requestParams.business_id) === config.RESNEXUS_TEST_BUSINESS_ID
      ) {
        if (
          ['EVALUATE_1', 'EVALUATE_2', 'ATTEST_1', 'ATTEST_2'].includes(
            config.RESNEXUS_TEST_MODE || '',
          )
        ) {
          let testResponse: any;
          switch (config.RESNEXUS_TEST_MODE) {
            case 'EVALUATE_1':
              testResponse = config.RESNEXUS_QUOTE_EVALUATE_1_RESPONSE;
              break;
            case 'EVALUATE_2':
              testResponse = config.RESNEXUS_QUOTE_EVALUATE_2_RESPONSE;
              break;
            case 'ATTEST_1':
              testResponse = config.RESNEXUS_QUOTE_ATTEST_1_RESPONSE;
              break;
            case 'ATTEST_2':
              testResponse = config.RESNEXUS_QUOTE_ATTEST_2_RESPONSE;
              break;
          }
          const roomId = requestParams.unit_group_id.toString();
          const result = testResponse[roomId];

          if (result) {
            result.total_amount = roundCurrency(
              result.rate + result.taxes + result.fees,
            );
            result.base_rate = result.rate;
            return result;
          }
        }
      }

      const { data } = await this.resNexusInstance.get(this.getQuoteURI, {
        params: requestParams,
      });

      if (data.response_errors?.length > 0) {
        throw new ResNexusError(data.response_errors);
      }

      data.total_amount = roundCurrency(
        data.base_rate + data.taxes + data.fees,
      );

      return data as GetQuoteResponse;
    } catch (error) {
      logger.error(`Error getting quote from resnexus: ${error}`);
      throw error;
    }
  }

  /**
   * Applies all quote modifications in order: pet fees → discount → length-of-stay
   * discount policy → force-full-payment. Mirrors the sequencing used everywhere
   * in this service so callers don't have to repeat the pipeline.
   *
   * @param quote       - Quote to modify (mutated in place, matching helper behaviour)
   * @param hotelId     - Hotel ID used by the pet-fee strategy
   * @param hotelConfig - Hotel configuration (null/undefined → skips those steps)
   * @param discount    - Caller's unused discount (null → skipped)
   * @param numPets     - Number of pets (0 → skipped)
   */
  private _applyQuoteModifications(
    quote: GetQuoteResponse,
    hotelId: string,
    hotelConfig: HotelConfiguration | null,
    discount: Discount | null = null,
    numPets = 0,
    paymentProvider: PaymentProvider,
    existingAmountCharged?: number,
  ): GetQuoteResponse & { raw_response: GetQuoteResponse } {
    // Raw quote is the original quote from the PMS before any modifications (saved inside quote_object.raw_response)
    const raw_response = cloneDeep(quote);

    // Capture PMS tax rate from quote before any modifications (for platform_pricing snapshot)
    const rawTaxRate = roundTaxRate(
      quote.base_rate > 0 ? quote.taxes / quote.base_rate : 0,
    );
    quote = applyPetFeeToQuote(
      hotelId,
      quote,
      numPets,
      hotelConfig?.pet_fee_configuration,
    );
    const { discountBase } = this.getWinbackSnapshotInputs(quote, discount);
    quote = applyDiscountToQuote(quote, discount);
    this.setWinbackDiscountInclTaxOnQuote(quote, discountBase, rawTaxRate);
    if (hotelConfig?.length_of_stay_discount_policy) {
      quote = applyLengthOfStayDiscountPolicyToQuote(
        quote,
        hotelConfig.length_of_stay_discount_policy,
      );
    }
    if (hotelConfig?.initial_deposit_policy) {
      quote = applyInitialDepositPolicyToResnexusQuote(
        quote,
        hotelConfig.initial_deposit_policy,
        paymentProvider,
      );
    }

    // If an initial amount was already collected, preserve it in the quote.
    // The modification flow in RoomReservationService handles charging/refunding the delta.
    if (existingAmountCharged != null && existingAmountCharged > 0) {
      quote.amountCharged = existingAmountCharged;
    }

    return { ...quote, raw_response };
  }

  /**
   * Gets a quote with pet fees, discounts, and payment configuration applied
   * This is the public method that implements the IPMSReservationService interface
   * @param params - PMS-agnostic quote request parameters with room_id, dates, occupancy, hotel context
   * @returns Quote with all business logic applied
   */
  async getQuote(params: PMSQuoteRequest): Promise<PMSQuote> {
    try {
      // 1. Map PMS-agnostic params to ResNexus-specific params
      const resNexusParams: GetQuoteRequestParams = {
        business_id: Number(params.business_id),
        unit_group_id: Number(params.room_id), // Map room_id to unit_group_id for ResNexus
        check_in: params.check_in,
        check_out: params.check_out,
        num_adults: params.num_adults,
        num_children: params.num_children,
      };
      // 2. Get raw quote and supporting data in parallel
      const [resNexusQuoteResponse, discount, hotelConfig, hotel] =
        await Promise.all([
          this.getQuoteUtil(resNexusParams),
          this.discountService.getUnusedDiscountByPhoneNumberAndHotelId(
            params.caller_phone_num,
            params.hotel_id,
          ),
          this.hotelConfigurationService.getHotelConfigurationByHotelId(
            params.hotel_id,
          ),
          this.hotelService.getHotelById(params.hotel_id),
        ]);

      // 3. Validate base_rate
      if (resNexusQuoteResponse.base_rate <= 0) {
        throw new BadRequestError(
          `Invalid quote: base rate must be greater than zero`,
        );
      }
      // 4. Apply all quote modifications (pet fee, discount, platform_pricing snapshot, length-of-stay, initial deposit policy)

      return this._applyQuoteModifications(
        resNexusQuoteResponse,
        params.hotel_id,
        hotelConfig,
        discount,
        params.num_pets,
        hotel.payment_provider,
      );
    } catch (error) {
      logger.error(`Error getting quote with business logic: ${error}`);
      throw error;
    }
  }

  /**
   * Computes rawTaxRate and discountBase from a quote (before discount is applied).
   * Use with applyDiscountToQuote then setWinbackDiscountInclTaxOnQuote.
   */
  private getWinbackSnapshotInputs(
    quoteBeforeDiscount: GetQuoteResponse,
    discount: Discount | null,
  ): { rawTaxRate: number; discountBase: number | null } {
    const rawTaxRate = roundTaxRate(
      quoteBeforeDiscount.base_rate > 0
        ? quoteBeforeDiscount.taxes / quoteBeforeDiscount.base_rate
        : 0,
    );
    const discountBase = discount
      ? discount.type === DiscountType.FLAT
        ? discount.value
        : roundCurrency((quoteBeforeDiscount.base_rate * discount.value) / 100)
      : null;
    return { rawTaxRate: roundTaxRate(rawTaxRate), discountBase };
  }

  /**
   * Sets winback_discount_incl_tax on a quote after discount has been applied.
   * Use when building a quote via getQuoteUtil + applyDiscountToQuote (e.g. multi-room, modification).
   */
  private setWinbackDiscountInclTaxOnQuote(
    quote: GetQuoteResponse,
    discountBase: number | null,
    rawTaxRate: number,
  ): void {
    if (!quote.platform_pricing) quote.platform_pricing = {};
    quote.platform_pricing.tax_rate = roundTaxRate(rawTaxRate);
    if (discountBase != null) {
      quote.platform_pricing.winback_discount_incl_tax =
        rawTaxRate > 0
          ? roundCurrency(discountBase * (1 + rawTaxRate))
          : discountBase;
    } else {
      quote.platform_pricing.winback_discount_incl_tax = null;
    }
  }

  /**
   * Validates that the rooms in the given reservations are still available for booking.
   * Fetches current availability from the PMS and throws if any reserved room is no longer available.
   */
  async validateRoomAvailability(
    reservations: ReservationDTO[] | null,
  ): Promise<void> {
    if (!reservations?.length) {
      throw new NoDataError(
        'validateRoomAvailability: Unable to validate room availability — reservation data could not be retrieved',
      );
    }

    const firstRes = reservations[0];
    const hotelId = firstRes.hotel?.id;
    if (!hotelId) return;

    const checkInDate = dayjs(firstRes.check_in).format('YYYY-MM-DD');
    const checkOutDate = dayjs(firstRes.check_out).format('YYYY-MM-DD');

    let availabilityGroups: Group[];
    try {
      // Resnexus will check for the availability of checkout date too, which is not needed.
      // Subtract the end_date by 1 to exclude checkout date from rexnexus availability check.
      const day_before_actual_checkout = dayjs(checkOutDate)
        .subtract(1, 'day')
        .format('YYYY-MM-DD');
      const availabilityInfo = await this.getAvailability({
        start_date: checkInDate,
        end_date: day_before_actual_checkout,
        business_id: Number(firstRes.business_id),
        num_adults: 1,
        num_children: 0,
      });
      availabilityGroups = availabilityInfo.groups || [];
    } catch (error) {
      if (error instanceof NoDataError) {
        throw new NoDataError(
          'The selected room(s) are no longer available for the requested dates',
        );
      }
      throw error;
    }

    const requiredUnitsPerRoom = new Map<number, number>();
    for (const reservation of reservations) {
      requiredUnitsPerRoom.set(
        Number(reservation.room_id),
        (requiredUnitsPerRoom.get(Number(reservation.room_id)) || 0) + 1,
      );
    }

    for (const [
      unit_group_id,
      requiredCount,
    ] of requiredUnitsPerRoom.entries()) {
      const group = availabilityGroups.find(
        (g) => g.unit_group_id === unit_group_id,
      );
      if (!group || group.number_of_units_available < requiredCount) {
        const unitGroupName = reservations.find(
          (r) => r.room_id === unit_group_id,
        )?.room_type;
        throw new NoDataError(
          `Room ${unitGroupName || unit_group_id} is no longer available for the selected dates`,
        );
      }
    }
  }

  /**
   * Sends a request to ResNexus to get availability
   * @param requestParams data needed to get availability
   * @returns the response from ResNexus
   */
  async getAvailability(
    requestParams: GetResNexusSingleRoomAvailabilityRequestParams,
  ): Promise<GetAvailabilityResponse> {
    try {
      if (
        Number(requestParams.business_id) === config.RESNEXUS_TEST_BUSINESS_ID
      ) {
        let testResponse: any;
        if (
          ['EVALUATE_1', 'EVALUATE_2', 'ATTEST_1', 'ATTEST_2'].includes(
            config.RESNEXUS_TEST_MODE || '',
          )
        ) {
          switch (config.RESNEXUS_TEST_MODE) {
            case 'EVALUATE_1':
              testResponse = config.RESNEXUS_AVAILABILITY_EVALUATE_1_RESPONSE;
              break;
            case 'EVALUATE_2':
              testResponse = config.RESNEXUS_AVAILABILITY_EVALUATE_2_RESPONSE;
              break;
            case 'ATTEST_1':
              testResponse = config.RESNEXUS_AVAILABILITY_ATTEST_1_RESPONSE;
              break;
            case 'ATTEST_2':
              testResponse = config.RESNEXUS_AVAILABILITY_ATTEST_2_RESPONSE;
              break;
          }
        }

        if (testResponse) {
          return testResponse as GetAvailabilityResponse;
        }
      }
      const { data } = await this.resNexusInstance.get(
        this.getAvailabilityURI,
        {
          params: requestParams,
        },
      );

      if (data.response_errors?.length > 0) {
        throw new ResNexusError(data.response_errors);
      }

      return data as GetAvailabilityResponse;
    } catch (error) {
      logger.error(`Error getting availability: ${error}`);
      throw error;
    }
  }

  public async getCalendar(
    hotel_phone_number: string,
    start_date: string,
    end_date: string,
    unit_group_id: string,
  ) {
    const formattedHotelPhoneNumber = convertToPhoneNumber(hotel_phone_number);
    if (!formattedHotelPhoneNumber) {
      throw new BadRequestError('getCalendar:: Hotel phone number is required');
    }
    const hotel =
      await this.hotelService.getHotelByAssistantPhoneNumber(
        hotel_phone_number,
      );
    if (!hotel) {
      throw new NoDataError(
        `getCalendar:: Hotel not found for assistant phone number ${hotel_phone_number}`,
      );
    }
    const calendar = await this.getCalendarUtil(
      Number(hotel.business_id),
      start_date,
      end_date,
      unit_group_id,
    );
    const filteredCalendar = calendar.calendars.map((item) => {
      const availabilities = item.data
        .filter((data) => data.available_units > 0)
        .map((data) => ({
          start_date: data.start_date,
          end_date: data.end_date,
          min_stay: data.min_stay,
        }));

      return {
        unit_group_id: item.unit_group_id,
        availabilities: mergeConsecutiveDateRanges(availabilities),
      };
    });
    return filteredCalendar;
  }

  /**
   * Fetches the calendar for the next 30 days and builds a map of unit-group → availability
   * windows with end_dates shifted +1 day (ResNexus returns inclusive end dates, but we
   * use exclusive checkout dates everywhere else).
   */
  private async fetchAvailabilityMap(
    hotelPhoneNumber: string,
    startDate: string,
    unitGroupsIds: number[],
  ): Promise<
    Map<
      number,
      Array<{ start_date: string; end_date: string; min_stay: number }>
    >
  > {
    const endDate = dayjs(startDate).add(30, 'day').format('YYYY-MM-DD');
    const calendarResponse = await this.getCalendar(
      hotelPhoneNumber,
      startDate,
      endDate,
      unitGroupsIds.join(','),
    );

    const availabilityMap = new Map<
      number,
      Array<{ start_date: string; end_date: string; min_stay: number }>
    >();
    for (const item of calendarResponse) {
      const adjustedAvailabilities = item.availabilities.map((entry) => {
        if (entry && typeof entry.end_date === 'string') {
          return {
            ...entry,
            end_date: dayjs(entry.end_date).add(1, 'day').format('YYYY-MM-DD'),
          };
        }
        return entry;
      });
      availabilityMap.set(item.unit_group_id, adjustedAvailabilities);
    }

    return availabilityMap;
  }

  /**
   * Calls ResNexus getcalendar API
   * @param business_id
   * @param start_date
   * @param end_date
   * @param unit_group_id (comma-separated string)
   * @returns the calendar data for the given unit groups and date range (inclusive)
   */
  async getCalendarUtil(
    business_id: number,
    start_date: string,
    end_date: string,
    unit_group_id: string,
  ): Promise<CalendarResponse> {
    try {
      const { data } = await this.resNexusInstance.get(this.getCalendarURI, {
        params: {
          business_id,
          start_date,
          end_date,
          unit_group_id,
        },
      });
      if (data.response_errors?.length > 0) {
        throw new ResNexusError(data.response_errors);
      }
      return data;
    } catch (error) {
      logger.error(`Error in getCalendar: ${error}`);
      throw error;
    }
  }

  async getRateCalendar(
    businessId: string,
    startDate: string,
    endDate: string,
  ): Promise<RateCalendar> {
    const numericBusinessId = Number(businessId);
    const { unit_groups: unitGroups = [] } =
      await this.getUnitGroups(numericBusinessId);
    if (unitGroups.length === 0) {
      return buildResNexusRateCalendar(
        [],
        { business_id: numericBusinessId, calendars: [], response_errors: [] },
        startDate,
        endDate,
      );
    }
    const calendar = await this.getCalendarUtil(
      numericBusinessId,
      startDate,
      endDate,
      unitGroups.map((group) => group.unit_group_id).join(','),
    );
    return buildResNexusRateCalendar(unitGroups, calendar, startDate, endDate);
  }

  async getUnitGroups(businessId: number) {
    try {
      const { data } = await this.resNexusInstance.get(this.getUnitGroupsURI, {
        params: {
          business_id: businessId,
        },
      });

      if (data.response_errors?.length > 0) {
        throw new ResNexusError(data.response_errors);
      }
      logger.info(`getUnitGroups:: ${JSON.stringify(data)}`);

      return data as GetUnitGroupsResponse;
    } catch (error) {
      logger.error(`Error getting unit groups: ${error}`);
      throw error;
    }
  }

  /**
   * Gets room availability and quote for the given dates and number of guests
   * @param availabilityParams the parameters for the availability request
   * @param phoneNumber the phone number the customer is calling from
   * @param hotelPhoneNumber the hotel phone number
   * @param sessionType the session type (voice or chat)
   * @returns the availability and quote information for each group
   */
  async getRoomAvailabilityWithQuote(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionType: SessionType,
  ) {
    let {
      start_date,
      end_date,
      num_adults,
      num_children = 0,
      num_pets = 0,
    } = availabilityParams;

    try {
      const hotel =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          hotelPhoneNumber,
        );
      if (!hotel) {
        throw new NoDataError(
          `getRoomAvailabilityWithQuote: Hotel not found for assistant phone number ${hotelPhoneNumber}`,
        );
      }
      const timezone = hotel.timezone;
      const businessId = Number(hotel.business_id);
      const unitGroups = await this.getUnitGroups(businessId);
      const unitGroupsMetadata = generateUnitGroupMetadata(
        unitGroups.unit_groups,
      );
      const unitGroupsIds = unitGroups.unit_groups.map(
        (group) => group.unit_group_id,
      );

      let callerPhoneNum: string;
      if (sessionType !== SessionType.CHAT) {
        callerPhoneNum = convertToPhoneNumber(phoneNumber) || '';
      } else {
        callerPhoneNum = phoneNumber;
      }
      if (!callerPhoneNum) {
        throw new BadRequestError(
          'getRoomAvailabilityWithQuote: Phone number is required',
        );
      }

      const hotelConfig =
        await this.hotelConfigurationService.getHotelConfigurationByHotelId(
          hotel.id,
        );

      // common function used by all PMS services to validate and correct dates
      const dateResult = validateAndCorrectDates(
        start_date,
        end_date,
        timezone,
        hotelConfig,
      );
      start_date = dateResult.start_date;
      end_date = dateResult.end_date;
      const dateCorrectionDetails = dateResult.dateCorrectionDetails;

      // Fetch availability map for the next 30 days
      const availabilityMap = await this.fetchAvailabilityMap(
        hotelPhoneNumber,
        start_date,
        unitGroupsIds,
      );

      // 1. Fetch availability for the requested period
      //Resnexus will check for the availability of checkout date too, which is not needed.
      //Subtract the end_date by 1 to exclude checkout date from rexnexus availability check.
      const day_before_actual_checkout = dayjs(end_date)
        .subtract(1, 'day')
        .format('YYYY-MM-DD');
      const { groups = [] } = await this.getAvailability({
        business_id: businessId,
        start_date,
        end_date: day_before_actual_checkout,
        num_adults,
        num_children,
      });

      const capeCollectionHotelIds = config.CAPE_COLLECTION_HOTEL_IDS;
      const isCapeCollectionHotel = capeCollectionHotelIds.includes(hotel.id);

      if (!groups.length) {
        const adultsKeyword = num_adults === 1 ? 'adult' : 'adults';
        const childrenKeyword = num_children === 1 ? 'child' : 'children';
        return unitGroups.unit_groups.map((group) => ({
          unit_group_id: group.unit_group_id,
          unit_group_name: group.name,
          room_id: group.unit_group_id,
          room_name: group.name,
          ...(!isCapeCollectionHotel && {
            unit_group_description: group.description,
          }),
          availability_in_requested_period: `For check-in ${start_date} to check-out ${end_date}, no rooms are available
           for ${num_adults} ${adultsKeyword} and ${num_children} ${childrenKeyword}. Try different dates or occupancy.`,
          available_date_ranges_next_30_days_from_checkin:
            availabilityMap.get(group.unit_group_id) || [],
          ...(dateCorrectionDetails && {
            date_correction_details: dateCorrectionDetails,
          }),
        }));
      }

      // 2. Extract only the relevant fields we want to expose to the caller
      let relevantGroupInfo = groups.map((group) => ({
        room_id: group.unit_group_id,
        unit_group_id: group.unit_group_id,
        room_name: group.unit_group_name,
        unit_group_name: group.unit_group_name,
        number_of_units_available: group.number_of_units_available,
        business_id: group.business_id,
      }));

      // When travelling with pets, filter to only pet-friendly rooms
      // TODO: Remove PET_POLICY_FILTER_ENABLED once all hotels have pet_policy_configuration seeded.
      if (num_pets) {
        const hasPetPolicyConfig =
          !!hotelConfig?.pet_policy_configuration?.pet_friendly_unit_group_ids
            ?.length;
        if (hasPetPolicyConfig) {
          const petFriendlyIds =
            hotelConfig!.pet_policy_configuration!.pet_friendly_unit_group_ids;
          relevantGroupInfo = relevantGroupInfo.filter((g) =>
            petFriendlyIds.includes(g.unit_group_id),
          );
        } else if (config.PET_POLICY_FILTER_ENABLED) {
          throw new BadRequestError(
            'Pet-friendly room configuration is not set up for this hotel. Please contact the hotel directly for pet accommodation options.',
          );
        }
      }

      if (!relevantGroupInfo.length) {
        return {
          groups: [],
          discount: null,
          message: num_pets
            ? `No pet-friendly rooms are available for the selected dates.`
            : `No rooms are available for the selected dates.`,
          ...(dateCorrectionDetails && {
            date_correction_details: dateCorrectionDetails,
          }),
        };
      }

      // Common params used for every quote request
      const baseQuoteParams = {
        business_id: businessId,
        check_in: start_date,
        check_out: end_date,
        num_adults,
        num_children,
        num_pets,
      };

      const discount =
        await this.discountService.getUnusedDiscountByPhoneNumberAndHotelId(
          callerPhoneNum,
          hotel.id,
        );

      // 3. Get quotes for each unit group in parallel
      const groupsWithQuotes = await Promise.all(
        relevantGroupInfo.map(async (group) => {
          try {
            const quoteData: GetQuoteResponse = await this.getQuoteUtil({
              ...baseQuoteParams,
              unit_group_id: group.room_id,
            });

            if (quoteData.response_errors?.length) {
              throw new BadRequestError(
                `Quote errors: ${JSON.stringify(quoteData.response_errors)}`,
              );
            }

            const quoteDataAfterModifications = this._applyQuoteModifications(
              quoteData,
              hotel.id,
              hotelConfig,
              discount,
              num_pets,
              hotel.payment_provider,
            );

            // Strip irrelevant properties before returning
            const {
              booking_link,
              pricing_type,
              rate_adjustment,
              available,
              occupancy,
              rate_for_date_list,
              response_errors,
              raw_response: _rawQuote,
              ...compactQuoteData
            } = quoteDataAfterModifications;

            const metadata = unitGroupsMetadata[group.room_id]; // capacity, description, etc.
            return {
              ...metadata,
              number_of_units_available: group.number_of_units_available,
              ...compactQuoteData,
              available_date_ranges_next_30_days_from_checkin:
                availabilityMap.get(group.room_id) || [],
            };
          } catch (err) {
            logger.error(
              `Error getting quote for unit group ${group.room_id}:`,
              err,
            );
            throw err;
          }
        }),
      );

      // Strip sensitive/internal properties from discount before returning
      let sanitizedDiscount = sanitizeDiscount(discount);

      // 4. Assemble final response
      return {
        groups: groupsWithQuotes,
        discount: sanitizedDiscount,
        ...(dateCorrectionDetails && {
          date_correction_details: dateCorrectionDetails,
        }),
      };
    } catch (error) {
      if (error instanceof NoDataError) {
        throw error;
      }
      logger.error(
        'getRoomAvailabilityWithQuote: Error getting availability:',
        error,
      );
      throw error;
    }
  }

  /**
   * Gets room availability with lite quote (natural language format) for the given dates and number of guests
   * @param availabilityParams the parameters for the availability request
   * @param phoneNumber the phone number the customer is calling from
   * @param hotelPhoneNumber the hotel phone number
   * @param sessionType the session type (voice or chat)
   * @returns the availability and quote information in natural language format
   */
  async getRoomAvailabilityWithQuoteLite(
    availabilityParams: GetSingleRoomAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionType: SessionType,
  ) {
    let {
      start_date,
      end_date,
      num_adults,
      num_children = 0,
      num_pets = 0,
    } = availabilityParams;

    try {
      const hotel =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          hotelPhoneNumber,
        );
      if (!hotel) {
        throw new NoDataError(
          `getRoomAvailabilityWithQuoteLite: Hotel not found for assistant phone number ${hotelPhoneNumber}`,
        );
      }
      const timezone = hotel.timezone;
      const businessId = Number(hotel.business_id);
      let callerPhoneNum: string;
      if (sessionType !== SessionType.CHAT) {
        callerPhoneNum = convertToPhoneNumber(phoneNumber) || '';
      } else {
        callerPhoneNum = phoneNumber;
      }
      if (!callerPhoneNum) {
        throw new BadRequestError(
          'getRoomAvailabilityWithQuoteLite: Phone number is required',
        );
      }

      const hotelConfig =
        await this.hotelConfigurationService.getHotelConfigurationByHotelId(
          hotel.id,
        );

      // common function used by all PMS services to validate and correct dates
      const dateResult = validateAndCorrectDates(
        start_date,
        end_date,
        timezone,
        hotelConfig,
      );
      start_date = dateResult.start_date;
      end_date = dateResult.end_date;
      const dateCorrectionDetails = dateResult.dateCorrectionDetails;

      const unitGroups = await this.getUnitGroups(businessId);
      const unitGroupsIds = unitGroups.unit_groups.map(
        (group) => group.unit_group_id,
      );

      // Fetch availability map for the next 30 days
      const availabilityMap = await this.fetchAvailabilityMap(
        hotelPhoneNumber,
        start_date,
        unitGroupsIds,
      );

      // 1. Fetch availability for the requested period
      //Resnexus will check for the availability of checkout date too, which is not needed.
      //Subtract the end_date by 1 to exclude checkout date from rexnexus availability check.
      const day_before_actual_checkout = dayjs(end_date)
        .subtract(1, 'day')
        .format('YYYY-MM-DD');
      const { groups = [] } = await this.getAvailability({
        business_id: businessId,
        start_date,
        end_date: day_before_actual_checkout,
        num_adults,
        num_children,
      });

      const capeCollectionHotelIds = config.CAPE_COLLECTION_HOTEL_IDS;
      const isCapeCollectionHotel = capeCollectionHotelIds.includes(hotel.id);

      if (!groups.length) {
        return unitGroups.unit_groups.map((group) => ({
          unit_group_id: group.unit_group_id,
          unit_group_name: group.name,
          room_id: group.unit_group_id,
          room_name: group.name,
          ...(!isCapeCollectionHotel && {
            unit_group_description: group.description,
          }),
          availability_in_requested_period: this.getUnavailabilityDescription(
            start_date,
            end_date,
            num_adults,
            num_children,
            group.unit_group_id,
            availabilityMap,
          ),
          available_date_ranges_next_30_days_from_checkin: availabilityMap.get(
            group.unit_group_id,
          ) || [
            'No rooms are available for the next 30 days from check-in date',
          ],
          ...(dateCorrectionDetails && {
            date_correction_details: dateCorrectionDetails,
          }),
        }));
      }

      // 2. Extract only the relevant fields we want to expose to the caller
      let relevantGroupInfo = groups.map((group) => ({
        room_id: group.unit_group_id,
        unit_group_id: group.unit_group_id,
        room_name: group.unit_group_name,
        unit_group_name: group.unit_group_name,
        number_of_units_available: group.number_of_units_available,
        business_id: group.business_id,
      }));

      // When travelling with pets, filter to only pet-friendly rooms
      // TODO: Remove PET_POLICY_FILTER_ENABLED once all hotels have pet_policy_configuration seeded.
      if (num_pets) {
        const hasPetPolicyConfig =
          !!hotelConfig?.pet_policy_configuration?.pet_friendly_unit_group_ids
            ?.length;
        if (hasPetPolicyConfig) {
          const petFriendlyIds =
            hotelConfig!.pet_policy_configuration!.pet_friendly_unit_group_ids;
          relevantGroupInfo = relevantGroupInfo.filter((g) =>
            petFriendlyIds.includes(g.unit_group_id),
          );
        } else if (config.PET_POLICY_FILTER_ENABLED) {
          throw new BadRequestError(
            'Pet-friendly room configuration is not set up for this hotel. Please contact the hotel directly for pet accommodation options.',
          );
        }
      }

      if (!relevantGroupInfo.length) {
        return {
          groups: [],
          discount: null,
          message: num_pets
            ? `No pet-friendly rooms are available for the selected dates.`
            : `No rooms are available for the selected dates.`,
          ...(dateCorrectionDetails && {
            date_correction_details: dateCorrectionDetails,
          }),
        };
      }

      // Unavailable = rooms that exist in the hotel catalog but were NOT returned by the availability API.
      // This must be based on the raw PMS availability response (groups), not the post-pet-filter
      // relevantGroupInfo, so that pet-excluded rooms don't appear as "unavailable" date entries.
      const unavailableGroupIds = unitGroupsIds.filter(
        (id) => !groups.some((g) => g.unit_group_id === id),
      );
      const unavailableGroupInfo = unitGroups.unit_groups.filter((group) =>
        unavailableGroupIds.includes(group.unit_group_id),
      );

      // Common params used for every quote request
      const baseQuoteParams = {
        business_id: businessId,
        check_in: start_date,
        check_out: end_date,
        num_adults,
        num_children,
      };

      const discount =
        await this.discountService.getUnusedDiscountByPhoneNumberAndHotelId(
          callerPhoneNum,
          hotel.id,
        );

      // 3. Get quotes for each unit group in parallel and format as natural language
      const groupsWithQuotes = await Promise.all(
        relevantGroupInfo.map(async (group) => {
          try {
            const quoteData = await this.getQuoteUtil({
              ...baseQuoteParams,
              unit_group_id: group.unit_group_id,
            });

            if (quoteData.response_errors?.length) {
              throw new BadRequestError(
                `getRoomAvailabilityWithQuoteLite: Quote errors: ${JSON.stringify(quoteData.response_errors)}`,
              );
            }

            const quoteDataAfterModifications = this._applyQuoteModifications(
              quoteData,
              hotel.id,
              hotelConfig,
              discount,
              num_pets,
              hotel.payment_provider,
            );

            const baseRateText = numberToWords(
              quoteDataAfterModifications.base_rate,
              quoteDataAfterModifications.currency,
            );
            const taxesText = numberToWords(
              quoteDataAfterModifications.taxes,
              quoteDataAfterModifications.currency,
            );
            const feesText = numberToWords(
              quoteDataAfterModifications.fees,
              quoteDataAfterModifications.currency,
            );
            const totalAmountInWords = numberToWords(
              quoteDataAfterModifications.total_amount,
              quoteDataAfterModifications.currency,
            );
            const isNoPayment =
              hotel.payment_provider === PaymentProvider.NOT_APPLICABLE;
            const effectiveAmountCharged = isNoPayment
              ? 0
              : quoteDataAfterModifications.amountCharged;
            const amountChargedInWords = numberToWords(
              effectiveAmountCharged,
              quoteDataAfterModifications.currency,
            );

            // Format guest count text
            const adultsText =
              num_adults === 1 ? '1 adult' : `${num_adults} adults`;
            const childrenText =
              num_children === 0
                ? '0 children'
                : num_children === 1
                  ? '1 child'
                  : `${num_children} children`;
            const lengthOfStay = dayjs(end_date).diff(dayjs(start_date), 'day');
            let description = `For ${adultsText} and ${childrenText}, with check-in on ${start_date} and check-out on ${end_date}, the base rate of the ${group.unit_group_name} (room_id / unit_group_id: ${group.room_id}) is ${baseRateText} for ${lengthOfStay} night${lengthOfStay > 1 ? 's' : ''}, with taxes of ${taxesText} and fees of ${feesText}. The total price is ${totalAmountInWords}.`;
            if (!isNoPayment) {
              description += ` The initial deposit to be paid now to secure the reservation is ${amountChargedInWords}.`;
            } else {
              description += ` No payment is required to secure this reservation.`;
            }
            if (discount) {
              description += ` All amounts have a pre-applied discount of ${discount.type === DiscountType.FLAT ? `flat ${formatCurrencyAmount(hotel.currency, discount.value)}` : `${discount.value} percentage`}.`;
            }
            if (
              num_pets &&
              hotelConfig?.pet_policy_configuration?.pet_friendly_unit_group_ids
                ?.length
            ) {
              description += ` All pet friendly rooms have the pet fees pre-applied.`;
            }
            if (availabilityParams.booking_link) {
              description += ` The booking link is ${quoteDataAfterModifications.booking_link}.`;
            }

            return {
              [group.unit_group_name]: description,
              available_date_ranges_next_30_days_from_checkin:
                availabilityMap.get(group.room_id),
            };
          } catch (err) {
            logger.error(
              `getRoomAvailabilityWithQuoteLite: Error getting quote for unit group ${group.room_id}:`,
              err,
            );
            throw err;
          }
        }),
      );

      // Strip sensitive/internal properties from discount before returning
      let sanitizedDiscount = sanitizeDiscount(discount);

      // 4. Assemble final response
      const response = {
        groups: groupsWithQuotes,
        discount: sanitizedDiscount,
        ...(dateCorrectionDetails && {
          date_correction_details: dateCorrectionDetails,
        }),
      };

      const isVistaVerdeHotel =
        !!config.VISTA_VERDE_ID && hotel.id === config.VISTA_VERDE_ID;

      const isSheridanLakeResort =
        !!config.SHERIDAN_LAKE_RESORT_ID &&
        hotel.id === config.SHERIDAN_LAKE_RESORT_ID;

      const showDateRangesForUnavailable =
        isVistaVerdeHotel || isSheridanLakeResort;

      if (unavailableGroupInfo.length) {
        unavailableGroupInfo.forEach((group) => {
          response.groups.push({
            [group.name]: this.getUnavailabilityDescription(
              start_date,
              end_date,
              num_adults,
              num_children,
              group.unit_group_id,
              availabilityMap,
            ),
            available_date_ranges_next_30_days_from_checkin:
              showDateRangesForUnavailable
                ? availabilityMap.get(group.unit_group_id) || []
                : undefined,
          });
        });
      }

      return response;
    } catch (error) {
      if (error instanceof NoDataError) {
        throw error;
      }
      logger.error(
        'getRoomAvailabilityWithQuoteLite: Error getting availability:',
        error,
      );
      throw error;
    }
  }

  async getRoomAvailabilityWithQuoteLiteV2(..._args: any[]): Promise<any> {
    throw new Error(
      'ResNexusService: getRoomAvailabilityWithQuoteLiteV2 not supported',
    );
  }

  async getMultiRoomAvailabilityWithQuoteLiteV2(..._args: any[]): Promise<any> {
    throw new Error(
      'ResNexusService: getMultiRoomAvailabilityWithQuoteLiteV2 not supported',
    );
  }

  private getUnavailabilityDescription(
    start_date: string,
    end_date: string,
    num_adults: number,
    num_children: number,
    unit_group_id: number,
    availabilityMap: Map<
      number,
      Array<{ start_date: string; end_date: string; min_stay: number }>
    >,
  ): string {
    const adultsKeyword = num_adults === 1 ? 'adult' : 'adults';
    const childrenKeyword = num_children === 1 ? 'child' : 'children';
    const lengthOfStay = dayjs(end_date).diff(dayjs(start_date), 'day');

    const dateRanges = availabilityMap.get(unit_group_id) || [];
    const coveringRanges = dateRanges.filter(
      (range) =>
        (start_date >= range.start_date && start_date <= range.end_date) ||
        (end_date >= range.start_date && end_date <= range.end_date),
    );
    const maxOfMinStay = coveringRanges.reduce(
      (max, range) => Math.max(max, range.min_stay),
      0,
    );
    const isMinStayRestriction =
      coveringRanges.length > 0 && maxOfMinStay > lengthOfStay;

    return isMinStayRestriction
      ? `For check-in ${start_date} to check-out ${end_date}, no rooms are available for ${num_adults} ${adultsKeyword} and ${num_children} ${childrenKeyword} due to a minimum stay requirement of ${maxOfMinStay} night${maxOfMinStay > 1 ? 's' : ''}. Your requested stay is ${lengthOfStay} night${lengthOfStay > 1 ? 's' : ''}. Try extending your stay or choosing different dates`
      : `For check-in ${start_date} to check-out ${end_date}, no rooms are available for ${num_adults} ${adultsKeyword} and ${num_children} ${childrenKeyword}. Try different dates or occupancy`;
  }

  /**
   * Gets multi-room availability and quote for the given dates
   * @param availabilityParams the parameters for the availability request
   * @param phoneNumber the phone number the customer is calling from
   * @param hotelPhoneNumber the hotel phone number
   * @param sessionType the session type (voice or chat)
   * @returns the availability and quote information for each group
   */
  async getMultiRoomAvailabilityWithQuote(
    availabilityParams: GetAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionType: SessionType,
  ) {
    try {
      let { start_date, end_date, num_pets = 0 } = availabilityParams;
      const hotel =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          hotelPhoneNumber,
        );
      if (!hotel) {
        throw new NoDataError(
          `getMultiRoomAvailabilityWithQuote: Hotel not found for assistant phone number ${hotelPhoneNumber}`,
        );
      }
      const timezone = hotel.timezone;
      const businessId = Number(hotel.business_id);
      const unitGroups = await this.getUnitGroups(businessId);
      const unitGroupsMetadata = generateUnitGroupMetadata(
        unitGroups.unit_groups,
      );
      const unitGroupsIds = unitGroups.unit_groups.map(
        (group) => group.unit_group_id,
      );

      const hotelConfig =
        await this.hotelConfigurationService.getHotelConfigurationByHotelId(
          hotel.id,
        );

      // common function used by all PMS services to validate and correct dates
      const dateResult = validateAndCorrectDates(
        start_date,
        end_date,
        timezone,
        hotelConfig,
      );
      start_date = dateResult.start_date;
      end_date = dateResult.end_date;
      const dateCorrectionDetails = dateResult.dateCorrectionDetails;

      let callerPhoneNum: string;
      if (sessionType !== SessionType.CHAT) {
        callerPhoneNum = convertToPhoneNumber(phoneNumber) || '';
      } else {
        callerPhoneNum = phoneNumber;
      }
      if (!callerPhoneNum) {
        throw new BadRequestError(
          'getMultiRoomAvailabilityWithQuote: Phone number is required',
        );
      }

      // Fetch availability map for the next 30 days
      const availabilityMap = await this.fetchAvailabilityMap(
        hotelPhoneNumber,
        start_date,
        unitGroupsIds,
      );

      // 1. Fetch availability for the requested period
      //Resnexus will check for the availability of checkout date too, which is not needed.
      //Subtract the end_date by 1 to exclude checkout date from rexnexus availability check.
      const day_before_actual_checkout = dayjs(end_date)
        .subtract(1, 'day')
        .format('YYYY-MM-DD');

      // Get the groups for just 1 adult. This is to see which all rooms/groups are available.
      // If they are available for 1 adult, it means their maximum capacity is available.
      const { groups = [] } = await this.getAvailability({
        business_id: businessId,
        start_date,
        end_date: day_before_actual_checkout,
        num_adults: 1,
        num_children: 0,
      });

      const capeCollectionHotelIds = config.CAPE_COLLECTION_HOTEL_IDS;
      const isCapeCollectionHotel = capeCollectionHotelIds.includes(hotel.id);

      if (!groups.length) {
        return unitGroups.unit_groups.map((group) => ({
          unit_group_id: group.unit_group_id,
          room_id: group.unit_group_id,
          unit_group_name: group.name,
          ...(!isCapeCollectionHotel && {
            unit_group_description: group.description,
          }),
          availability_in_requested_period: `For check-in ${start_date} to check-out ${end_date}, no rooms are available`,
          available_date_ranges_next_30_days_from_checkin:
            availabilityMap.get(group.unit_group_id) || [],
          ...(dateCorrectionDetails && {
            date_correction_details: dateCorrectionDetails,
          }),
        }));
      }

      // 2. Extract only the relevant fields we want to expose to the caller
      let relevantAvailabilityInfo = groups.map((group) => ({
        room_id: group.unit_group_id,
        unit_group_id: group.unit_group_id,
        room_name: group.unit_group_name,
        unit_group_name: group.unit_group_name,
        number_of_units_available: group.number_of_units_available,
        business_id: group.business_id,
      }));

      // When travelling with pets, filter to only pet-friendly rooms
      // TODO: Remove PET_POLICY_FILTER_ENABLED once all hotels have pet_policy_configuration seeded.
      if (num_pets) {
        const hasPetPolicyConfig =
          !!hotelConfig?.pet_policy_configuration?.pet_friendly_unit_group_ids
            ?.length;
        if (hasPetPolicyConfig) {
          const petFriendlyIds =
            hotelConfig!.pet_policy_configuration!.pet_friendly_unit_group_ids;
          relevantAvailabilityInfo = relevantAvailabilityInfo.filter((g) =>
            petFriendlyIds.includes(g.unit_group_id),
          );
        } else if (config.PET_POLICY_FILTER_ENABLED) {
          throw new BadRequestError(
            'Pet-friendly room configuration is not set up for this hotel. Please contact the hotel directly for pet accommodation options.',
          );
        }
      }

      if (!relevantAvailabilityInfo.length) {
        return {
          groups: [],
          discount: null,
          message: num_pets
            ? `No pet-friendly rooms are available for the selected dates.`
            : `No rooms are available for the selected dates.`,
          ...(dateCorrectionDetails && {
            date_correction_details: dateCorrectionDetails,
          }),
        };
      }

      // Common params used for every quote request
      const baseQuoteParams = {
        business_id: businessId,
        check_in: start_date,
        check_out: end_date,
        num_adults: 1,
        num_children: 0,
      };

      const discount =
        await this.discountService.getUnusedDiscountByPhoneNumberAndHotelId(
          callerPhoneNum,
          hotel.id,
        );

      // 3. Get quotes for each unit group in parallel
      const groupsWithQuotes: GroupWithQuote[] = await Promise.all(
        relevantAvailabilityInfo.map(async (group) => {
          try {
            const quoteData: GetQuoteResponse = await this.getQuoteUtil({
              ...baseQuoteParams,
              unit_group_id: group.unit_group_id,
            });

            if (quoteData.response_errors?.length) {
              throw new Error(
                `Quote errors: ${JSON.stringify(quoteData.response_errors)}`,
              );
            }
            const quoteDataAfterModifications = this._applyQuoteModifications(
              quoteData,
              hotel.id,
              hotelConfig,
              discount,
              num_pets,
              hotel.payment_provider,
            );

            // Strip irrelevant properties before returning
            const {
              num_adults,
              num_children,
              booking_link,
              pricing_type,
              rate_adjustment,
              available,
              occupancy,
              rate_for_date_list,
              response_errors,
              raw_response: _rawQuote,
              ...relevantQuoteInfo
            } = quoteDataAfterModifications;

            const metadata = unitGroupsMetadata[group.unit_group_id]; // capacity, description, etc.
            if (metadata) {
              return {
                ...group,
                ...relevantQuoteInfo,
                ...metadata,
                available_date_ranges_next_30_days_from_checkin:
                  availabilityMap.get(group.unit_group_id) || [],
              };
            } else {
              throw new NoDataError(
                `Metadata for group ${group.unit_group_id} not found`,
              );
            }
          } catch (err) {
            logger.error(
              `Error getting quote for unit group ${group.unit_group_id}:`,
              err,
            );
            throw err;
          }
        }),
      );
      logger.info(`Groups with quotes: ${JSON.stringify(groupsWithQuotes)}`);

      // Strip sensitive/internal properties from discount before returning
      let sanitizedDiscount = sanitizeDiscount(discount);
      // 4. Assemble final response
      return {
        groups: groupsWithQuotes,
        discount: sanitizedDiscount,
        ...(dateCorrectionDetails && {
          date_correction_details: dateCorrectionDetails,
        }),
      };
    } catch (error) {
      if (error instanceof NoDataError) {
        throw error;
      }
      logger.error('Error getting availability:', error);
      throw error;
    }
  }

  /**
   * Gets multi-room availability with lite quote (natural language format) for the given dates
   * @param availabilityParams the parameters for the availability request
   * @param phoneNumber the phone number the customer is calling from
   * @param hotelPhoneNumber the hotel phone number
   * @param sessionType the session type (voice or chat)
   * @returns the availability and quote information in natural language format
   */
  async getMultiRoomAvailabilityWithQuoteLite(
    availabilityParams: GetAvailabilityRequestParams,
    phoneNumber: string,
    hotelPhoneNumber: string,
    sessionType: SessionType,
  ) {
    try {
      let { start_date, end_date, num_pets = 0 } = availabilityParams;
      const hotel =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          hotelPhoneNumber,
        );
      if (!hotel) {
        throw new NoDataError(
          `getMultiRoomAvailabilityWithQuote: Hotel not found for assistant phone number ${hotelPhoneNumber}`,
        );
      }
      const timezone = hotel.timezone;
      const businessId = Number(hotel.business_id);

      const hotelConfig =
        await this.hotelConfigurationService.getHotelConfigurationByHotelId(
          hotel.id,
        );

      // common function used by all PMS services to validate and correct dates
      const dateResult = validateAndCorrectDates(
        start_date,
        end_date,
        timezone,
        hotelConfig,
      );
      start_date = dateResult.start_date;
      end_date = dateResult.end_date;
      const dateCorrectionDetails = dateResult.dateCorrectionDetails;

      let callerPhoneNum: string;
      if (sessionType !== SessionType.CHAT) {
        callerPhoneNum = convertToPhoneNumber(phoneNumber) || '';
      } else {
        callerPhoneNum = phoneNumber;
      }
      if (!callerPhoneNum) {
        throw new BadRequestError(
          'getMultiRoomAvailabilityWithQuote: Phone number is required',
        );
      }

      const unitGroups = await this.getUnitGroups(businessId);
      const unitGroupsMetadata = generateUnitGroupMetadata(
        unitGroups.unit_groups,
      );
      const unitGroupsIds = unitGroups.unit_groups.map(
        (group) => group.unit_group_id,
      );

      // Fetch availability map for the next 30 days
      const availabilityMap = await this.fetchAvailabilityMap(
        hotelPhoneNumber,
        start_date,
        unitGroupsIds,
      );

      // 1. Fetch availability for the requested period
      //Resnexus will check for the availability of checkout date too, which is not needed.
      //Subtract the end_date by 1 to exclude checkout date from rexnexus availability check.
      const day_before_actual_checkout = dayjs(end_date)
        .subtract(1, 'day')
        .format('YYYY-MM-DD');

      // Get the groups for just 1 adult. This is to see which all rooms/groups are available.
      // If they are available for 1 adult, it means their maximum capacity is available.
      const { groups = [] } = await this.getAvailability({
        business_id: businessId,
        start_date,
        end_date: day_before_actual_checkout,
        num_adults: 1,
        num_children: 0,
      });

      const capeCollectionHotelIds = config.CAPE_COLLECTION_HOTEL_IDS;
      const isCapeCollectionHotel = capeCollectionHotelIds.includes(hotel.id);

      if (!groups.length) {
        return unitGroups.unit_groups.map((group) => ({
          unit_group_id: group.unit_group_id,
          room_id: group.unit_group_id,
          unit_group_name: group.name,
          ...(!isCapeCollectionHotel && {
            unit_group_description: group.description,
          }),
          availability_in_requested_period: `For check-in ${start_date} to check-out ${end_date}, no rooms are available`,
          available_date_ranges_next_30_days_from_checkin: availabilityMap.get(
            group.unit_group_id,
          ) || [
            'No rooms are available for the next 30 days from check-in date',
          ],
          ...(dateCorrectionDetails && {
            date_correction_details: dateCorrectionDetails,
          }),
        }));
      }

      // 2. Extract only the relevant fields we want to expose to the caller
      let relevantAvailabilityInfo = groups.map((group) => ({
        room_id: group.unit_group_id,
        unit_group_id: group.unit_group_id,
        room_name: group.unit_group_name,
        unit_group_name: group.unit_group_name,
        number_of_units_available: group.number_of_units_available,
        business_id: group.business_id,
      }));

      // When travelling with pets, filter to only pet-friendly rooms
      // TODO: Remove PET_POLICY_FILTER_ENABLED once all hotels have pet_policy_configuration seeded.
      if (num_pets) {
        const hasPetPolicyConfig =
          !!hotelConfig?.pet_policy_configuration?.pet_friendly_unit_group_ids
            ?.length;
        if (hasPetPolicyConfig) {
          const petFriendlyIds =
            hotelConfig!.pet_policy_configuration!.pet_friendly_unit_group_ids;
          relevantAvailabilityInfo = relevantAvailabilityInfo.filter((g) =>
            petFriendlyIds.includes(g.unit_group_id),
          );
        } else if (config.PET_POLICY_FILTER_ENABLED) {
          throw new BadRequestError(
            'Pet-friendly room configuration is not set up for this hotel. Please contact the hotel directly for pet accommodation options.',
          );
        }
      }

      if (!relevantAvailabilityInfo.length) {
        return {
          groups: [],
          discount: null,
          message: num_pets
            ? `No pet-friendly rooms are available for the selected dates.`
            : `No rooms are available for the selected dates.`,
          ...(dateCorrectionDetails && {
            date_correction_details: dateCorrectionDetails,
          }),
        };
      }

      // Common params used for every quote request
      const baseQuoteParams = {
        business_id: businessId,
        check_in: start_date,
        check_out: end_date,
        num_adults: 1,
        num_children: 0,
      };

      const discount =
        await this.discountService.getUnusedDiscountByPhoneNumberAndHotelId(
          callerPhoneNum,
          hotel.id,
        );

      // 3. Get quotes for each unit group in parallel
      const groupsWithQuotes = await Promise.all(
        relevantAvailabilityInfo.map(async (group) => {
          try {
            const quoteData = await this.getQuoteUtil({
              ...baseQuoteParams,
              unit_group_id: group.unit_group_id,
            });

            if (quoteData.response_errors?.length) {
              throw new Error(
                `Quote errors: ${JSON.stringify(quoteData.response_errors)}`,
              );
            }

            const quoteDataAfterModifications: PMSQuote =
              this._applyQuoteModifications(
                quoteData,
                hotel.id,
                hotelConfig,
                discount,
                num_pets,
                hotel.payment_provider,
              );

            const baseRateText = numberToWords(
              quoteDataAfterModifications.base_rate,
              quoteDataAfterModifications.currency,
            );
            const taxesText = numberToWords(
              quoteDataAfterModifications.taxes,
              quoteDataAfterModifications.currency,
            );
            const feesText = numberToWords(
              quoteDataAfterModifications.fees,
              quoteDataAfterModifications.currency,
            );
            const totalAmountInWords = numberToWords(
              quoteDataAfterModifications.total_amount,
              quoteDataAfterModifications.currency,
            );
            const isNoPayment =
              hotel.payment_provider === PaymentProvider.NOT_APPLICABLE;
            const effectiveAmountCharged = isNoPayment
              ? 0
              : quoteDataAfterModifications.amountCharged;
            const amountChargedInWords = numberToWords(
              effectiveAmountCharged,
              quoteDataAfterModifications.currency,
            );
            const maxCapacity =
              unitGroupsMetadata[group.unit_group_id]?.max_capacity || 0;
            const maxCapacityText =
              maxCapacity === 1 ? '1 person' : `${maxCapacity} people`;
            const maxChildren =
              unitGroupsMetadata[group.unit_group_id]?.max_children || 0;
            const maxChildrenText =
              maxChildren === 1 ? '1 child' : `${maxChildren} children`;

            let description = `For ${group.unit_group_name} (room_id / unit_group_id: ${group.unit_group_id}), with check-in on ${start_date} and check-out on ${end_date}, the base rate is ${baseRateText}, with taxes of ${taxesText} and fees of ${feesText}. The total price is ${totalAmountInWords}.`;
            if (!isNoPayment) {
              description += ` The initial deposit to be paid now to secure the reservation is ${amountChargedInWords.toLowerCase()}.`;
            } else {
              description += ` No payment is required to secure this reservation.`;
            }
            description += ` The maximum capacity of the room is ${maxCapacityText}. The maximum number of children allowed is ${maxChildrenText}.`;
            if (discount) {
              description += ` All amounts have a pre-applied discount of ${discount.type === DiscountType.FLAT ? `flat ${formatCurrencyAmount(hotel.currency, discount.value)}` : `${discount.value} percentage`}.`;
            }
            if (
              num_pets &&
              hotelConfig?.pet_policy_configuration?.pet_friendly_unit_group_ids
                ?.length
            ) {
              description += ` All pet friendly rooms have the pet fees pre-applied.`;
            }
            if (availabilityParams.booking_link) {
              description += ` The booking link is ${quoteDataAfterModifications.booking_link}.`;
            }

            return {
              [group.unit_group_name]: description,
              available_date_ranges_next_30_days_from_checkin:
                availabilityMap.get(group.unit_group_id) || [],
            };
          } catch (err) {
            logger.error(
              `Error getting quote for unit group ${group.unit_group_id}:`,
              err,
            );
            throw err;
          }
        }),
      );
      logger.info(`Groups with quotes: ${JSON.stringify(groupsWithQuotes)}`);

      // Strip sensitive/internal properties from discount before returning
      let sanitizedDiscount = sanitizeDiscount(discount);

      const isVistaVerdeHotel =
        !!config.VISTA_VERDE_ID && hotel.id === config.VISTA_VERDE_ID;

      if (isVistaVerdeHotel) {
        const unavailableGroupIds = unitGroupsIds.filter(
          (id) => !groups.some((g) => g.unit_group_id === id),
        );
        const unavailableGroupInfo = unitGroups.unit_groups.filter((group) =>
          unavailableGroupIds.includes(group.unit_group_id),
        );

        unavailableGroupInfo.forEach((group) => {
          groupsWithQuotes.push({
            [group.name]: `For check-in ${start_date} to check-out ${end_date}, this is not available`,
            available_date_ranges_next_30_days_from_checkin:
              availabilityMap.get(group.unit_group_id) || [],
          });
        });
      }

      // 4. Assemble final response
      return {
        groups: groupsWithQuotes,
        discount: sanitizedDiscount,
        ...(dateCorrectionDetails && {
          date_correction_details: dateCorrectionDetails,
        }),
      };
    } catch (error) {
      if (error instanceof NoDataError) {
        throw error;
      }
      logger.error('Error getting availability:', error);
      throw error;
    }
  }

  async getAllRatesForRoomType(...args: any[]): Promise<any> {
    throw new Error(
      'ResNexusReservationService.getAllRatesForRoomType: Not implemented',
    );
  }

  /**
   * Gets web room availability with quote for the given dates
   * Used by web booking interface
   * @param availabilityParams the parameters for the availability request
   * @returns the availability and quote information for each group
   */
  async getWebRoomAvailabilityV2(
    availabilityParams: GetWebAvailabilityRequestParams,
  ): Promise<{ groups: GroupWithQuote[] }> {
    try {
      let {
        start_date,
        end_date,
        business_id,
        num_adults,
        num_children,
        num_rooms,
      } = availabilityParams;

      const hotel = await this.hotelService.getHotelByBusinessId(business_id);
      if (!hotel) {
        throw new NoDataError(
          `getWebRoomAvailability: Hotel not found for business id ${business_id}`,
        );
      }
      const timezone = hotel.timezone;
      const businessId = Number(business_id);

      // Adjust end_date if it's the same as start_date
      const adjustedEndDateResult = adjustEndDateIfSameAsStartDate(
        start_date,
        end_date,
      );
      if (adjustedEndDateResult.shouldBeCorrected) {
        end_date = adjustedEndDateResult.date;
      }

      // Validate reservation dates
      validateReservationDates(start_date, end_date, timezone);

      // 1. Fetch availability for the requested period
      //Resnexus will check for the availability of checkout date too, which is not needed.
      //Subtract the end_date by 1 to exclude checkout date from rexnexus availability check.
      const day_before_actual_checkout = dayjs(end_date)
        .subtract(1, 'day')
        .format('YYYY-MM-DD');

      const unitGroups = await this.getUnitGroups(businessId);
      const unitGroupsMetadata = generateUnitGroupMetadata(
        unitGroups.unit_groups,
      );

      let groups: Group[] = [];

      if (num_rooms == 1) {
        const result = await this.getAvailability({
          business_id: businessId,
          start_date,
          end_date: day_before_actual_checkout,
          num_adults,
          num_children,
        });
        if (result.groups) {
          groups = result.groups;
        }
      } else {
        // Get the groups for just 1 adult. This is to see which all rooms/groups are available.
        // If they are available for 1 adult, it means their maximum capacity is available.
        const result = await this.getAvailability({
          business_id: businessId,
          start_date,
          end_date: day_before_actual_checkout,
          num_adults: 1,
          num_children: 0,
        });
        if (result.groups) {
          groups = result.groups;
        }
      }

      if (!groups.length) {
        logger.info(
          'getWebRoomAvailability: No availability found for the given dates and number of guests',
        );
        throw new NoDataError(
          'getWebRoomAvailability: No availability found for the given dates and number of guests',
        );
      }

      // 2. Extract only the relevant fields we want to expose to the caller
      const relevantAvailabilityInfo = groups.map(
        ({
          unit_group_id,
          unit_group_name,
          number_of_units_available,
          business_id,
        }) => ({
          unit_group_id,
          room_id: unit_group_id,
          unit_group_name,
          room_name: unit_group_name,
          number_of_units_available,
          business_id,
        }),
      );

      // Common params used for every quote request
      const baseQuoteParams = {
        business_id: businessId,
        check_in: start_date,
        check_out: end_date,
        num_adults: num_rooms === 1 ? num_adults : 1,
        num_children: num_rooms === 1 ? num_children : 0,
      };

      const hotelConfig =
        await this.hotelConfigurationService.getHotelConfigurationByHotelId(
          hotel.id,
        );

      // 3. Get quotes for each unit group in parallel
      const groupsWithQuotes: GroupWithQuote[] = await Promise.all(
        relevantAvailabilityInfo.map(async (group) => {
          try {
            const quoteData: GetQuoteResponse = await this.getQuoteUtil({
              ...baseQuoteParams,
              unit_group_id: group.unit_group_id,
            });

            if (quoteData.response_errors?.length) {
              throw new Error(
                `getWebRoomAvailability: Quote errors: ${JSON.stringify(quoteData.response_errors)}`,
              );
            }

            const quoteDataAfterModifications = this._applyQuoteModifications(
              quoteData,
              hotel.id,
              hotelConfig,
              null,
              0,
              hotel.payment_provider,
            );

            // Strip irrelevant properties before returning
            const {
              num_adults,
              num_children,
              booking_link,
              pricing_type,
              rate_adjustment,
              available,
              occupancy,
              rate_for_date_list,
              response_errors,
              raw_response: _rawQuote,
              ...relevantQuoteInfo
            } = quoteDataAfterModifications;

            const metadata = unitGroupsMetadata[group.unit_group_id]; // capacity, description, etc.
            if (metadata) {
              return { ...group, ...relevantQuoteInfo, ...metadata };
            } else {
              throw new NoDataError(
                `getWebRoomAvailability: Metadata for group ${group.unit_group_id} not found`,
              );
            }
          } catch (err) {
            logger.error(
              `getWebRoomAvailability: Error getting quote for unit group ${group.unit_group_id}:`,
              err,
            );
            throw err;
          }
        }),
      );
      logger.info(
        `getWebRoomAvailability: Groups with quotes: ${JSON.stringify(groupsWithQuotes)}`,
      );

      // 4. Assemble final response
      return { groups: groupsWithQuotes };
    } catch (error) {
      if (error instanceof NoDataError) {
        throw error;
      }
      logger.error(
        'getWebRoomAvailability: Error getting availability:',
        error,
      );
      throw error;
    }
  }

  /**
   * Get updated quote for a reservation modification
   * Handles date extensions, shortenings, and complete date changes
   * Uses PMS-agnostic room_id parameter
   * @param currentReservation - Current reservation details with quote (using room_id)
   * @param newCheckIn - New check-in date
   * @param newCheckOut - New check-out date
   * @param discount - Discount to apply (if any)
   * @returns Updated quote with new pricing
   */
  public async getQuoteForModification(
    currentReservation: ReservationDTO,
    newCheckIn: string,
    newCheckOut: string,
    discount: Discount | null,
  ): Promise<PMSQuote> {
    // Map room_id to ResNexus-specific unit_group_id
    const unit_group_id = Number(currentReservation.room_id);
    const quote_object = currentReservation.quote?.quote_object!;

    const currentCheckIn = formatDateYYYYMMDD(currentReservation.check_in);
    const currentCheckOut = formatDateYYYYMMDD(currentReservation.check_out);

    const overlapCategory = getDateModificationCategory(
      newCheckIn,
      newCheckOut,
      currentCheckIn,
      currentCheckOut,
    );

    // Handle no date change case
    if (overlapCategory === 'no_date_change') {
      return {
        ...quote_object,
        total_amount: computeQuoteTotal(
          currentReservation.quote?.base_rate ?? 0,
          currentReservation.quote?.taxes ?? 0,
          currentReservation.quote?.fees ?? 0,
        ),
      };
    }

    // Fetch hotel config once — shared by both code paths below
    const hotelConfig =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        currentReservation.hotel_id,
      );

    // For completely new date range, fetch a fresh quote
    if (overlapCategory === 'outside_range') {
      const newQuote: GetQuoteResponse = await this.getQuoteUtil({
        business_id: Number(currentReservation.business_id),
        unit_group_id: unit_group_id,
        check_in: newCheckIn,
        check_out: newCheckOut,
        num_adults: currentReservation.num_adults,
        num_children: currentReservation.num_children,
      });

      const hotel =
        currentReservation.hotel ??
        (await this.hotelService.getHotelById(currentReservation.hotel_id));
      return this._applyQuoteModifications(
        newQuote,
        currentReservation.hotel_id,
        hotelConfig,
        discount,
        currentReservation.num_pets,
        hotel.payment_provider,
        currentReservation.quote?.amount_charged,
      );
    }

    // Get exclusive date ranges that need processing
    const exclusiveDates = getExclusiveDates(
      currentCheckIn,
      currentCheckOut,
      newCheckIn,
      newCheckOut,
      overlapCategory,
    );

    if (exclusiveDates.length === 0) {
      return {
        ...quote_object,
        total_amount: computeQuoteTotal(
          currentReservation.quote?.base_rate ?? 0,
          currentReservation.quote?.taxes ?? 0,
          currentReservation.quote?.fees ?? 0,
        ),
      };
    }

    try {
      let accumulatedRawQuote: GetQuoteResponse = {
        ...cloneDeep(quote_object.raw_response),
        check_in: newCheckIn,
        check_out: newCheckOut,
      };

      const extensionPromises: Array<
        Promise<{
          dateRange: {
            startDate: string;
            endDate: string;
            overlapCategory: string;
          };
          newQuoteData: GetQuoteResponse;
        }>
      > = [];
      const shorteningRanges: Array<{ startDate: string; endDate: string }> =
        [];

      // Single pass to categorize and process dates
      for (const dateRange of exclusiveDates) {
        if (EXTENSION_CONDITIONS.has(dateRange.overlapCategory)) {
          // Queue up extension promises
          extensionPromises.push(
            (async () => {
              const newQuoteData: GetQuoteResponse = await this.getQuoteUtil({
                business_id: Number(currentReservation.business_id),
                unit_group_id: unit_group_id,
                check_in: dateRange.startDate,
                check_out: dateRange.endDate,
                num_adults: currentReservation.num_adults,
                num_children: currentReservation.num_children,
              });
              return { dateRange, newQuoteData };
            })(),
          );
        } else if (SHORTEN_QUOTE_CONDITIONS.has(dateRange.overlapCategory)) {
          // Collect shortening ranges
          shorteningRanges.push({
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
          });
        }
      }

      // Process all extensions in parallel
      const extensionResults = await Promise.all(extensionPromises);

      // Apply all extensions
      for (let { dateRange, newQuoteData } of extensionResults) {
        accumulatedRawQuote = combineQuotes(
          accumulatedRawQuote,
          newQuoteData,
          dateRange.overlapCategory,
        );
      }

      // Apply all shortenings
      for (const { startDate, endDate } of shorteningRanges) {
        accumulatedRawQuote = shortenQuote(
          accumulatedRawQuote,
          startDate,
          endDate,
        );
      }

      //  Apply all quote modifications(pet fees, discounts, length-of-stay policy, force-full-payment) to newly combined/shortened quote
      const hotel =
        currentReservation.hotel ??
        (await this.hotelService.getHotelById(currentReservation.hotel_id));
      return this._applyQuoteModifications(
        accumulatedRawQuote,
        currentReservation.hotel_id,
        hotelConfig,
        discount,
        currentReservation.num_pets,
        hotel.payment_provider,
        currentReservation.quote?.amount_charged,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error processing quote updates: ${errorMessage}`, {
        error,
      });
      throw new BaseError(`Failed to update quote: ${errorMessage}`);
    }
  }

  async getRoomsInfo(businessId: string): Promise<GetRoomsInfoResponse> {
    // Delegate to getUnitGroups for ResNexus
    const roomsResponse = await this.getUnitGroups(Number(businessId));
    const filteredResponse: GetRoomsInfoResponse = {
      business_id: Number(businessId),
      response_errors: roomsResponse.response_errors,
      note: 'This is static room type information only (room names, descriptions, capacities). To check if rooms are available for specific dates, you must call the availability tool.',
      unit_groups:
        roomsResponse.unit_groups?.map((group) => {
          const personKeyword =
            group.per_unit_capacity === 1 ? 'person' : 'people';
          const childrenKeyword =
            group.max_children === 1 ? 'child' : 'children';
          const baseText = `${group.per_unit_capacity} ${personKeyword}`;
          const childrenText =
            group.max_children > 0
              ? ` (upto ${group.max_children} ${childrenKeyword})`
              : '';

          const unitGroup: ExtendedUnitGroup = {
            name: group.name,
            room_name: group.name,
            unit_group_name: group.name,
            description: group.description,
            max_capacity: group.per_unit_capacity,
            max_capacity_text: baseText + childrenText,
            max_children: group.max_children,
            unit_type: group.unit_type,
            business_id: group.business_id,
            number_of_units: group.number_of_units,
            per_unit_capacity: group.per_unit_capacity,
            unit_group_id: group.unit_group_id,
            room_id: group.unit_group_id,
            unit_ids: group.unit_ids,
          };
          return unitGroup;
        }) || [],
    };
    return filteredResponse;
  }

  /**
   * Get a map of room IDs to room type names
   * @param businessId - Business/property ID
   * @param roomIds - Array of room IDs to get names for
   * @param roomsInfo - Optional cached rooms info to avoid extra API call
   * @returns Map of room ID to room type name
   */
  async getRoomTypeMap(
    businessId: number,
    roomIds: number[],
    roomsInfo?: GetRoomsInfoResponse,
  ): Promise<Map<string, string>> {
    try {
      // Use cached roomsInfo if provided, otherwise fetch it
      const unitGroups =
        roomsInfo ?? (await this.getRoomsInfo(String(businessId)));

      // Build a map of unit_group_id to name
      const unitGroupNameMap = new Map<string, string>();
      for (const unitGroup of unitGroups?.unit_groups || []) {
        unitGroupNameMap.set(String(unitGroup.unit_group_id), unitGroup.name);
      }

      // Map each requested room ID to its name
      const result = new Map<string, string>();
      for (const roomId of roomIds) {
        const unitGroupName = unitGroupNameMap.get(String(roomId));
        if (unitGroupName) {
          result.set(String(roomId), unitGroupName);
        } else {
          const errMsg = `getRoomTypeMap: No room found for room id: ${roomId}`;
          logger.error(errMsg);
          throw new NoDataError(errMsg);
        }
      }

      return result;
    } catch (error) {
      if (error instanceof BaseError) {
        throw error;
      }
      logger.error(`Error getting room type map: ${JSON.stringify(error)}`);
      throw new BaseError(
        `Error getting room type map: ${JSON.stringify(error)}`,
      );
    }
  }

  async lookupReservationsById(
    _hotel: Hotel,
    _bookingId: string,
  ): Promise<ReservationDTO[]> {
    throw new Error('resNexus: lookupReservationsByAnyId not implemented ');
  }

  async lookupReservationsByPhone(
    _hotel: Hotel,
    _phoneNumber: string,
    _maxResults?: number,
  ): Promise<ReservationDTO[]> {
    throw new Error('resNexus: lookupReservationsByPhone not implemented ');
  }

  async getExternalModificationInfo(..._args: any[]): Promise<any> {
    throw new Error(
      'ResNexusService: getExternalModificationInfo not supported',
    );
  }

  async modifyExternalDirectReservation(..._args: any[]): Promise<any> {
    throw new Error(
      'ResNexusService: modifyExternalDirectReservation not supported',
    );
  }

  async cancelExternalDirectReservation(..._args: any[]): Promise<any> {
    throw new Error(
      'ResNexusService: cancelExternalDirectReservation not supported',
    );
  }

  async getRateIdByCode(..._args: any[]): Promise<undefined> {
    return undefined;
  }

  async validateMultiRoomOccupancy(
    peoplePerRoom: PeoplePerRoom,
    roomsInfo: GetUnitGroupsResponse,
    hotelId: string,
  ): Promise<void> {
    const unitGroups = roomsInfo.unit_groups;
    const unitGroupMap = new Map(
      unitGroups.map((ug) => [ug.unit_group_id, ug]),
    );
    // Deduplicate keys so the same unit group is validated once; multiple bookings
    // of the same room are represented by multiple entries in peoplePerRoom[unitGroupId].
    const inputUnitGroups = Array.from(new Set(Object.keys(peoplePerRoom)));

    for (const unitGroupId of inputUnitGroups) {
      const unitGroup = unitGroupMap.get(Number(unitGroupId));
      if (!unitGroup) {
        throw new BadRequestError(`Invalid unit group id: ${unitGroupId}`);
      }

      const roomName = unitGroup.name;
      const maxCapacity = unitGroup.per_unit_capacity;
      const maxChildren = unitGroup.max_children;

      for (const occupantGroup of peoplePerRoom[unitGroupId]) {
        const numAdults = occupantGroup.num_adults;
        const numChildren = occupantGroup.num_children;
        const totalGuests = numAdults + numChildren;
        const numPets = occupantGroup.num_pets;

        if (numAdults < 1) {
          throw new BadRequestError(
            `${roomName}: At least one adult is required per room`,
          );
        }

        if (maxCapacity > 0 && numAdults > maxCapacity) {
          throw new BadRequestError(
            `${roomName}: Number of adults (${numAdults}) exceeds maximum capacity (${maxCapacity})`,
          );
        }

        if (numChildren > maxChildren) {
          throw new BadRequestError(
            `${roomName}: Number of children (${numChildren}) exceeds maximum allowed (${maxChildren})`,
          );
        }

        if (maxCapacity > 0 && totalGuests > maxCapacity) {
          throw new BadRequestError(
            `${roomName}: Total guests (${totalGuests}) exceeds maximum capacity (${maxCapacity})`,
          );
        }

        if (hotelId === config.CAVE_SPRINGS_ID && numPets && numPets > 0) {
          const maxPets = config.CAVE_SPRINGS_PER_ROOM_PET_CAPACITY;
          if (numPets > maxPets) {
            throw new BadRequestError(
              `Each room has a maximum pet capacity of ${maxPets}`,
            );
          }
        }
      }
    }
  }

  shouldFetchDiscount(): boolean {
    return true;
  }

  buildPartnerNotes({
    numPets,
    discountNote,
  }: ReservationNotesContext): string | null {
    let notes: string | null = discountNote ?? null;

    if (numPets && numPets > 0) {
      const petNote = `Number of Pets = ${numPets};`;
      notes = notes ? `${notes}; ${petNote}` : petNote;
    }

    return notes;
  }
}

const resNexusService = new ResNexusService(
  resNexusInstance,
  hotelService,
  hotelConfigurationService,
  discountService,
);
export default resNexusService;
