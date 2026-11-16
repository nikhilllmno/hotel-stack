// Factory for creating PMS-specific reservation services

import calryReservationService from '../calry/services/reservationService';
import cloudbedsReservationService from '../cloudbeds/services/reservationService';
import { BadRequestError } from '../errors/BadRequestError';
import { NoDataError } from '../errors/NoDataError';
import hostawayReservationService from '../hostaway/service/reservation/reservationService';
import { MewsReservationService } from '../mews/services/reservationService';
import resNexusService from '../resNexus/service/reservation/reservationService';
import { hotelService, HotelService } from '../services/hotel/hotelService';
import {
  hotelConfigurationService,
  HotelConfigurationService,
} from '../services/hotelConfiguration/hotelConfigurationService';
import { StayntouchReservationService } from '../stayntouch/services/reservationService';
import { PmsProvider } from '../types/enums';
import logger from '../utils/logger';
import { IPMSReservationService } from './types/IPMSReservationService';

export class PMSServiceFactory {
  constructor(
    private hotelService: HotelService,
    private hotelConfigurationService: HotelConfigurationService,
  ) {}

  /**
   * Factory method - creates/returns PMS reservation service for a hotel
   * @param hotelId - The hotel ID to get the service for
   * @returns IPMSReservationService implementation for the hotel's PMS
   */
  async getReservationService(
    hotelId: string,
  ): Promise<IPMSReservationService> {
    // Get hotel and PMS provider info
    const hotel = await this.hotelService.getHotelById(hotelId);

    if (!hotel.pms_provider) {
      logger.error(
        `getReservationService: Hotel ${hotelId} does not have a PMS provider configured`,
      );
      throw new NoDataError(
        `Hotel ${hotelId} does not have a PMS provider configured`,
      );
    }

    // Get PMS provider details from hotels table (pms_type field)
    // For now, we'll use a simple lookup. Later this can be from a pms_providers table
    const pmsType = hotel.pms_provider;

    let service: IPMSReservationService;

    // Create PMS-specific service with its repository
    switch (pmsType.toLowerCase()) {
      case PmsProvider.RESNEXUS: {
        // Create a new instance with injected dependencies
        service = resNexusService;
        break;
      }

      case PmsProvider.HOSTAWAY: {
        service = hostawayReservationService;
        break;
      }

      case PmsProvider.STAYNTOUCH: {
        service = new StayntouchReservationService(
          hotelId,
          this.hotelService,
          this.hotelConfigurationService,
        );
        break;
      }

      case PmsProvider.CLOUDBEDS: {
        service = cloudbedsReservationService;
        break;
      }

      case PmsProvider.MEWS: {
        service = new MewsReservationService(this.hotelService);
        break;
      }

      case PmsProvider.CALRY: {
        service = calryReservationService;
        break;
      }

      default:
        logger.error(
          `getReservationService: Unsupported PMS provider: ${pmsType}`,
        );
        throw new BadRequestError(`Unsupported PMS provider: ${pmsType}`);
    }

    return service;
  }
}

const pmsServiceFactory = new PMSServiceFactory(
  hotelService,
  hotelConfigurationService,
);
export default pmsServiceFactory;
