import { BadRequestError } from '../../errors/BadRequestError';
import { BaseError } from '../../errors/BaseError';
import { NoDataError } from '../../errors/NoDataError';
import { ChannelModel } from '../../models/ChannelModel';
import { Hotel } from '../../models/Hotel';
import { HotelConfiguration } from '../../models/HotelConfiguration';
import { ChannelRepository } from '../../repositories/ChannelRepository';
import { HotelConfigurationRepository } from '../../repositories/HotelConfigurationRepository';
import { HotelRepository } from '../../repositories/HotelRepository';
import { StayntouchClient } from '../../stayntouch/client/StayntouchClient';
import { GetRateResponse } from '../../stayntouch/types/GetRateResponse';
import { PmsProvider } from '../../types/enums';
import logger from '../../utils/logger';

export class HotelService {
  private hotelRepository: HotelRepository;
  private hotelConfigurationRepository: HotelConfigurationRepository;
  private channelRepository: ChannelRepository;

  constructor(
    hotelRepository: HotelRepository,
    hotelConfigurationRepository?: HotelConfigurationRepository,
    channelRepository?: ChannelRepository,
  ) {
    this.hotelRepository = hotelRepository;
    this.hotelConfigurationRepository =
      hotelConfigurationRepository || new HotelConfigurationRepository();
    this.channelRepository = channelRepository || new ChannelRepository();
  }

  /**
   * Fetches hotels by business ID
   * @param businessId The ID of the business to fetch hotels for
   * @returns Promise with an array of hotels
   */
  public async getHotelByBusinessId(businessId: string): Promise<Hotel | null> {
    try {
      if (!businessId) {
        throw new BadRequestError(
          'getHotelByBusinessId:: Business ID is required',
        );
      }

      logger.info(
        `getHotelByBusinessId:: Fetching hotels for business ID: ${businessId}`,
      );
      const hotel = await this.hotelRepository.findByBusinessId(businessId);

      return hotel;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `getHotelByBusinessId:: Error fetching hotels for business ID ${businessId}:`,
        errorMessage,
      );
      throw new Error(
        `getHotelByBusinessId:: Failed to fetch hotels: ${errorMessage}`,
      );
    }
  }

  public async getHotelByBusinessIdOrPhoneNumber(
    businessId?: string,
    phoneNumber?: string,
  ): Promise<Hotel | null> {
    try {
      if (!businessId && !phoneNumber) {
        throw new BadRequestError(
          'getHotelByBusinessIdOrPhoneNumber:: Either business ID or phone number is required',
        );
      }
      if (businessId) {
        logger.info(
          `getHotelByBusinessIdOrPhoneNumber:: Fetching hotels for business ID ${businessId}`,
        );
      } else {
        logger.info(
          `getHotelByBusinessIdOrPhoneNumber:: Fetching hotels for phone number ${phoneNumber}`,
        );
      }
      const hotel = await this.hotelRepository.findByBusinessIDorPhoneNumber(
        businessId,
        phoneNumber,
      );

      return hotel;
    } catch (error) {
      const errorMessage =
        error instanceof BaseError ? error.message : 'Unknown error';
      if (businessId) {
        logger.error(
          `getHotelByBusinessIdOrPhoneNumber:: Error fetching hotels for business ID ${businessId}:`,
          errorMessage,
        );
      } else if (phoneNumber) {
        logger.error(
          `getHotelByBusinessIdOrPhoneNumber:: Error fetching hotels for phone number ${phoneNumber}:`,
          errorMessage,
        );
      }
      throw error;
    }
  }

  /**
   * Fetches a hotel by ID
   * @param id The ID of the hotel to fetch
   * @returns Promise with the hotel or null if not found
   */
  public async getHotelById(id: string): Promise<Hotel> {
    try {
      if (!id) {
        throw new BadRequestError('Hotel ID is required');
      }

      logger.info(`Fetching hotel with ID: ${id}`);
      const hotel = await this.hotelRepository.findById(id);

      if (!hotel) {
        logger.info(`No hotel found with ID: ${id}`);
        throw new NoDataError(`No hotel found with ID: ${id}`);
      }

      logger.info(`Successfully fetched hotel with ID: ${id}`);
      return hotel;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `Error in HotelService::getHotelById: Error fetching hotel with ID ${id}:`,
        errorMessage,
      );
      throw error;
    }
  }

  /**
   * Fetches a hotel along with its configurations and channels using a single query with joins
   * @param id The ID of the hotel to fetch
   * @returns Promise with the hotel, configurations, and channels
   */
  public async getHotelWithConfigurationsAndChannels(id: string): Promise<{
    hotel: Hotel;
    configuration: HotelConfiguration | null;
    channel: ChannelModel | null;
  }> {
    try {
      if (!id) {
        throw new BadRequestError('Hotel ID is required');
      }

      logger.info(
        `Fetching hotel with configurations and channels for ID: ${id}`,
      );

      const result =
        await this.hotelRepository.findByIdWithConfigurationsAndChannels(id);

      if (!result) {
        logger.info(`No hotel found with ID: ${id}`);
        throw new NoDataError(`No hotel found with ID: ${id}`);
      }

      logger.info(
        `Successfully fetched hotel with configurations and channels for ID: ${id}`,
      );

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `Error in HotelService::getHotelWithConfigurationsAndChannels: Error fetching hotel with ID ${id}:`,
        errorMessage,
      );
      throw error;
    }
  }

  public async getHotelByAssistantPhoneNumber(
    phoneNumber: string,
  ): Promise<Hotel | null> {
    try {
      if (!phoneNumber) {
        throw new Error('Assistant phone number is required');
      }

      logger.info(`Fetching hotel with assistant phone number: ${phoneNumber}`);
      const hotel =
        await this.hotelRepository.findByAssistantPhoneNumber(phoneNumber);

      if (!hotel) {
        logger.info(
          `No hotel found with assistant phone number: ${phoneNumber}`,
        );
        return null;
      }

      logger.info(
        `Successfully fetched hotel with assistant phone number: ${phoneNumber}`,
      );
      return hotel;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `Error fetching hotel with assistant phone number ${phoneNumber}:`,
        errorMessage,
      );
      throw new Error(`Failed to fetch hotel: ${errorMessage}`);
    }
  }

  public async getHotels(): Promise<Hotel[]> {
    return this.hotelRepository.findAll();
  }

  public async getHotelsByIds(ids: string[]): Promise<Hotel[]> {
    return this.hotelRepository.findByIds(ids);
  }

  /**
   * Creates a new hotel.
   * @param data Hotel data (without id, created_at, updated_at)
   * @returns Promise with the created hotel
   */
  public async createHotel(
    data: Omit<Hotel, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<Hotel> {
    try {
      if (!data.name?.trim()) {
        throw new BadRequestError('Hotel name is required');
      }
      logger.info('Creating hotel', { name: data.name });
      const hotel = await this.hotelRepository.create(data);
      logger.info('Successfully created hotel', { id: hotel.id });
      return hotel;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error in HotelService::createHotel:', errorMessage);
      throw error;
    }
  }

  /**
   * Deletes a hotel by ID.
   * @param id The ID of the hotel to delete
   * @returns Promise<boolean> true if deleted, false if not found
   */
  public async deleteHotel(id: string): Promise<boolean> {
    try {
      if (!id) {
        throw new BadRequestError('Hotel ID is required');
      }
      logger.info(`Deleting hotel with ID: ${id}`);
      const deleted = await this.hotelRepository.delete(id);
      if (deleted) {
        logger.info(`Successfully deleted hotel with ID: ${id}`);
      }
      return deleted;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `Error in HotelService::deleteHotel for ID ${id}:`,
        errorMessage,
      );
      throw error;
    }
  }

  public async getHotelsByTimezone(timezones: string[]): Promise<Hotel[]> {
    return this.hotelRepository.findByTimezones(timezones);
  }

  /**
   * Updates a hotel by ID
   * @param id The ID of the hotel to update
   * @param data The data to update
   * @returns Promise with the updated hotel or null if not found
   */
  public async updateHotel(
    id: string,
    data: Partial<Omit<Hotel, 'id' | 'created_at' | 'updated_at'>>,
  ): Promise<Hotel | null> {
    try {
      if (!id) {
        throw new BadRequestError('Hotel ID is required');
      }

      logger.info(`Updating hotel with ID: ${id}`);
      const updatedHotel = await this.hotelRepository.update(id, data);

      if (!updatedHotel) {
        logger.info(`No hotel found with ID: ${id}`);
        throw new NoDataError(`No hotel found with ID: ${id}`);
      }

      logger.info(`Successfully updated hotel with ID: ${id}`);
      return updatedHotel;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error updating hotel with ID ${id}:`, errorMessage);
      throw error;
    }
  }

  /**
   * Syncs room types from Stayntouch PMS for a specific hotel
   * @param hotelId The ID of the hotel to sync room types for
   * @returns Promise with the updated hotel
   */
  public async syncRoomTypes(hotelId: string): Promise<Hotel> {
    try {
      if (!hotelId) {
        throw new BadRequestError('Hotel ID is required');
      }

      logger.info(`Syncing room types for hotel ID: ${hotelId}`);

      const hotel = await this.hotelRepository.findById(hotelId);
      if (!hotel) {
        throw new NoDataError(`No hotel found with ID: ${hotelId}`);
      }

      if (!hotel.business_id) {
        throw new BadRequestError(
          `Hotel ${hotelId} does not have a business_id configured`,
        );
      }

      if (hotel.pms_provider !== PmsProvider.STAYNTOUCH) {
        throw new BadRequestError(
          `Hotel ${hotelId} is not using Stayntouch PMS`,
        );
      }

      logger.info(
        `Fetching room types from Stayntouch for business_id: ${hotel.business_id}`,
      );
      const roomTypes = await new StayntouchClient(hotelId).getRoomTypes(
        hotel.business_id,
      );

      logger.info(`Updating room types in database for hotel ID: ${hotelId}`, {
        total_count: roomTypes.total_count,
      });

      const updatedHotel = await this.hotelRepository.updateRoomTypes(
        hotelId,
        roomTypes,
      );

      if (!updatedHotel) {
        throw new NoDataError(
          `Failed to update room types for hotel ${hotelId}`,
        );
      }

      logger.info(`Successfully synced room types for hotel ID: ${hotelId}`);
      return updatedHotel;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `Error syncing room types for hotel ID ${hotelId}:`,
        errorMessage,
      );
      throw error;
    }
  }

  /**
   * Syncs room types from Stayntouch PMS for all Stayntouch hotels
   * @returns Promise with array of results for each hotel
   */
  public async syncRoomTypesForStayntouchHotels(): Promise<
    Array<{
      hotelId: string;
      hotelName: string;
      success: boolean;
      error?: string;
      roomTypesCount?: number;
    }>
  > {
    try {
      // TODO: Eventually do this for all hotels.
      logger.info('Starting room types sync for all Stayntouch hotels');

      const stayntouchHotels = await this.hotelRepository.findByPmsProvider(
        PmsProvider.STAYNTOUCH,
      );

      logger.info(`Found ${stayntouchHotels.length} Stayntouch hotels to sync`);

      const processedResults: Array<{
        hotelId: string;
        hotelName: string;
        success: boolean;
        error?: string;
        roomTypesCount?: number;
      }> = [];

      for (const hotel of stayntouchHotels) {
        try {
          const updatedHotel = await this.syncRoomTypes(hotel.id);
          processedResults.push({
            hotelId: hotel.id,
            hotelName: hotel.name,
            success: true,
            roomTypesCount: updatedHotel.room_types?.total_count || 0,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          logger.error(
            `Failed to sync room types for hotel ${hotel.id} (${hotel.name}):`,
            errorMessage,
          );
          processedResults.push({
            hotelId: hotel.id,
            hotelName: hotel.name,
            success: false,
            error: errorMessage,
          });
        }
      }

      const successCount = processedResults.filter((r) => r.success).length;
      const failureCount = processedResults.filter((r) => !r.success).length;

      logger.info(
        `Room types sync completed. Success: ${successCount}, Failed: ${failureCount}`,
      );

      return processedResults;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error syncing room types for all hotels:', errorMessage);
      throw error;
    }
  }

  public async syncHotelRatesForStayntouchHotels(): Promise<
    Array<{
      hotelId: string;
      hotelName: string;
      success: boolean;
      error?: string;
      ratesCount?: number;
    }>
  > {
    try {
      logger.info('Starting hotel rates sync for all Stayntouch hotels');

      const stayntouchHotels = await this.hotelRepository.findByPmsProvider(
        PmsProvider.STAYNTOUCH,
      );

      logger.info(
        `Found ${stayntouchHotels.length} Stayntouch hotels to sync rates for`,
      );

      const processedResults: Array<{
        hotelId: string;
        hotelName: string;
        success: boolean;
        error?: string;
        ratesCount?: number;
      }> = [];

      for (const hotel of stayntouchHotels) {
        try {
          const stayntouchHotelId = parseInt(String(hotel.business_id), 10);
          if (Number.isNaN(stayntouchHotelId)) {
            throw new Error(`Invalid business_id for hotel ${hotel.id}`);
          }

          const client = new StayntouchClient(hotel.id);
          const rates = await client.getHotelRates(stayntouchHotelId);

          await this.hotelConfigurationRepository.updateHotelRatesByHotelId(
            hotel.id,
            rates,
          );

          logger.info(
            `Successfully synced hotel rates for hotel ${hotel.id} (${hotel.name})`,
            {
              ratesCount: rates.length,
            },
          );

          processedResults.push({
            hotelId: hotel.id,
            hotelName: hotel.name,
            success: true,
            ratesCount: rates.length,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          logger.error(
            `Failed to sync hotel rates for hotel ${hotel.id} (${hotel.name}):`,
            errorMessage,
          );
          processedResults.push({
            hotelId: hotel.id,
            hotelName: hotel.name,
            success: false,
            error: errorMessage,
          });
        }
      }

      const successCount = processedResults.filter((r) => r.success).length;
      const failureCount = processedResults.filter((r) => !r.success).length;

      logger.info(
        `Hotel rates sync completed. Success: ${successCount}, Failed: ${failureCount}`,
      );

      return processedResults;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        'Error syncing hotel rates for all Stayntouch hotels:',
        errorMessage,
      );
      throw error;
    }
  }

  /**
   * Returns cached hotel rates from the DB, or null if none are stored.
   */
  public async getCachedHotelRates(
    hotelId: string,
  ): Promise<GetRateResponse[] | null> {
    return this.hotelConfigurationRepository.findHotelRatesByHotelId(hotelId);
  }

  /**
   * When current_phone is empty (omitted, null, or whitespace-only), internal_phone_number must be null or blank; otherwise digit-normalized match is required.
   */
  public async adminUpdateHotelPhone(params: {
    hotelId: string;
    currentPhone: string | null | undefined;
    newPhone: string;
  }): Promise<Hotel> {
    const { hotelId, currentPhone, newPhone } = params;
    if (!hotelId) {
      throw new BadRequestError('Hotel ID is required');
    }
    logger.info(`adminUpdateHotelPhone for hotel ID: ${hotelId}`);

    const hotel = await this.hotelRepository.findById(hotelId);
    if (!hotel) {
      throw new NoDataError(`No hotel found with ID: ${hotelId}`);
    }

    const currentTrimmed = (currentPhone ?? '').trim();
    const storedInternal = hotel.internal_phone_number;
    const requestCurrentEmpty = currentTrimmed === '';
    const storedInternalEmpty =
      storedInternal == null || String(storedInternal).trim() === '';

    if (requestCurrentEmpty && !storedInternalEmpty) {
      throw new BadRequestError(
        'current_phone is empty but this hotel has a non-empty internal_phone_number',
      );
    }
    if (!requestCurrentEmpty && storedInternalEmpty) {
      throw new BadRequestError(
        "current_phone does not match this hotel's internal_phone_number",
      );
    }
    if (!requestCurrentEmpty && !storedInternalEmpty) {
      const expected = this.normalizePhoneDigits(currentTrimmed);
      const internalNorm = this.normalizePhoneDigits(String(storedInternal));
      if (expected.length === 0) {
        throw new BadRequestError(
          'current_phone must contain at least one digit',
        );
      }
      if (internalNorm !== expected) {
        throw new BadRequestError(
          "current_phone does not match this hotel's internal_phone_number",
        );
      }
    }

    const updated = await this.hotelRepository.update(hotelId, {
      internal_phone_number: newPhone.trim(),
      sms_number: newPhone.trim(),
    });
    if (!updated) {
      throw new NoDataError(`No hotel found with ID: ${hotelId}`);
    }
    logger.info(`adminUpdateHotelPhone succeeded for hotel ID: ${hotelId}`);
    return updated;
  }

  private normalizePhoneDigits(phone: string): string {
    return phone.replace(/\D/g, '');
  }
}

// Create and export a singleton instance
export const hotelService = new HotelService(new HotelRepository());
