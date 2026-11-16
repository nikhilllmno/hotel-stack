import { Knex } from 'knex';
import { BadRequestError } from '../../errors/BadRequestError';
import { ChannelModel } from '../../models/ChannelModel';
import { ChannelRepository } from '../../repositories/ChannelRepository';
import logger from '../../utils/logger';

export class ChannelService {
  private channelRepository: ChannelRepository;

  constructor(channelRepository: ChannelRepository) {
    this.channelRepository = channelRepository;
  }

  /**
   * Fetches channel by hotel ID
   * @param hotelId The hotel ID
   * @param trx Optional database transaction
   * @returns Promise with the channel or null
   */
  public async getChannelByHotelId(
    hotelId: string,
    trx?: Knex.Transaction,
  ): Promise<ChannelModel | null> {
    try {
      if (!hotelId) {
        throw new BadRequestError('getChannelByHotelId:: Hotel ID is required');
      }

      logger.info(
        `getChannelByHotelId:: Fetching channel for hotel ID: ${hotelId}`,
      );
      const channel = await this.channelRepository.findByHotelId(hotelId, trx);

      if (!channel) {
        logger.warn(
          `getChannelByHotelId:: No channel found for hotel ID: ${hotelId}`,
        );
      }

      return channel;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `getChannelByHotelId:: Error fetching channel:`,
        errorMessage,
      );
      throw error;
    }
  }
}

// Create and export singleton instance
const channelRepository = new ChannelRepository();
export const channelService = new ChannelService(channelRepository);

export default channelService;
