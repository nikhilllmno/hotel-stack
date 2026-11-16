import logger from '../../utils/logger';
import { getReservationTotalAmount } from '../../utils/reservation';
import { ChannelService, channelService } from '../channel/channelService';
import { HotelService, hotelService } from '../hotel/hotelService';
import {
  HotelConfigurationService,
  hotelConfigurationService,
} from '../hotelConfiguration/hotelConfigurationService';
import {
  ChatServiceResolver,
  notificationFactory,
} from '../notification/notificationFactory';
import { NotificationPayload } from '../notification/types';
import roomReservationService, {
  RoomReservationService,
} from '../roomReservation/roomReservationService';
import {
  guestCheckinDailyTemplate,
  GuestReservation,
} from '../vapi/constants/telegramTemplates/guestCheckinDailyTemplate';

// Import dayjs and its plugins
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { Reservation as ReservationDTO } from '../../dtos/Reservation';
import { BaseError } from '../../errors/BaseError';
import { Hotel } from '../../models/Hotel';
import { CheckInMessageAction } from '../../types/enums';

// Extend dayjs with plugins
dayjs.extend(utc);
dayjs.extend(timezone);

export class GuestCheckinSummaryService {
  constructor(
    private hotelService: HotelService,
    private hotelConfigurationService: HotelConfigurationService,
    private channelService: ChannelService,
    private roomReservationService: RoomReservationService,
    private readonly notificationFactory: ChatServiceResolver,
  ) {}

  /**
   * Triggered when a reservation is updated
   * Sends a Telegram notification to the hotel's check-in group
   * @param hotelId
   * @param action
   * @param bookingIdOfUpdatedReservation
   * @param originalAmount
   * @returns
   */
  public async sendSummaryToHotel(
    hotelId: string,
    action: CheckInMessageAction,
    bookingIdOfUpdatedReservation?: string,
    originalAmount?: number,
  ): Promise<string | number | null> {
    // Step 1: Fetch reservation data
    const hotelData = await this.hotelService.getHotelById(hotelId);
    const timezone = hotelData?.timezone;
    if (!timezone)
      throw new BaseError(
        'sendSummaryToHotel: No timezone configured for hotel',
      );
    const checkInDate = dayjs().tz(timezone).format('YYYY-MM-DD');

    const statuses = [ReservationStatus.ACTIVE, ReservationStatus.CANCELLED];
    const reservations =
      await this.roomReservationService.getReservationsForCheckInNotification(
        hotelId,
        checkInDate,
        statuses,
      );

    if (reservations?.length === 0) {
      logger.info(
        `sendSummaryToHotel:: No reservations found for hotel ${hotelId}. Skipping telegram check-in message`,
      );
      return null;
    }

    // Get channel by hotel ID
    const channel = await this.channelService.getChannelByHotelId(hotelId);
    const checkInGroupId = channel?.check_in_group_id;
    if (!checkInGroupId)
      throw new BaseError(
        'sendSummaryToHotel: No check-in group configured for hotel',
      );

    // Group reservations by payment_id
    const reservationsByPaymentId = reservations.reduce(
      (acc, reservation) => {
        const paymentId =
          reservation.payments?.map((p) => p.id).sort()[0] || '';
        if (!acc[paymentId]) {
          acc[paymentId] = [];
        }
        acc[paymentId].push(reservation);
        return acc;
      },
      {} as Record<string, ReservationDTO[]>,
    );

    // Group and format reservations by payment_id
    const formattedReservations: GuestReservation[] = Object.values(
      reservationsByPaymentId,
    ).map((groupedReservations) => {
      // Use the first reservation for common details
      const firstReservation = groupedReservations[0];

      // Calculate total guests across all reservations in this group
      const totalAdults = groupedReservations.reduce(
        (sum, res) => sum + (res.num_adults || 0),
        0,
      );
      const totalChildren = groupedReservations.reduce(
        (sum, res) => sum + (res.num_children || 0),
        0,
      );
      const totalPets = groupedReservations.reduce(
        (sum, res) => sum + (res.num_pets || 0),
        0,
      );

      // Calculate total amount and advance amount (include pricing breakdown when present)
      const totalAmount = groupedReservations.reduce(
        (sum, res) => sum + getReservationTotalAmount(res),
        0,
      );
      let advanceAmount = groupedReservations.reduce((sum, res) => {
        const resAdvance = res.quote?.amount_charged || 0;
        // Apply original amount if this is the updated reservation
        if (
          bookingIdOfUpdatedReservation === res.booking_id &&
          originalAmount
        ) {
          return sum + originalAmount;
        }
        return sum + resAdvance;
      }, 0);

      // Create room info array
      const rooms = groupedReservations.map((res) => {
        const checkIn = new Date(res.check_in);
        const checkOut = new Date(res.check_out);
        const nights = Math.max(
          Math.round(
            (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24),
          ),
          1,
        );
        return {
          roomType: res.room_type,
          nights: nights,
        };
      });

      const result: GuestReservation = {
        guestFirstName: firstReservation.customer.first_name || '',
        guestLastName: firstReservation.customer.last_name || '',
        rooms: rooms.length > 1 ? rooms : undefined, // Only include rooms array if multiple
        roomType: rooms.length === 1 ? firstReservation.room_type : undefined, // Keep single room format
        checkIn: firstReservation.check_in,
        checkOut: firstReservation.check_out,
        phone: firstReservation.customer.phone_number,
        totalAmount: totalAmount,
        advanceAmount: advanceAmount,
        status: firstReservation.status,
        currency: hotelData.currency,
        discount: firstReservation.discount,
        numAdults: totalAdults,
        numChildren: totalChildren,
        numPets: totalPets,
      };
      return result;
    });

    // Step 2: Format Telegram message
    const messageText = guestCheckinDailyTemplate(
      {
        date: dayjs().tz(timezone),
        reservations: formattedReservations,
      },
      action,
    );

    // Step 3: Send notification message
    // Create notification payload
    const notificationPayload: NotificationPayload = {
      recipient: checkInGroupId,
      content: {
        message: messageText,
        parseMode: 'HTML',
      },
    };

    let messageId: string | number;
    try {
      messageId = (await this.notificationFactory
        .getChatService(hotelData.notification_type)
        .sendMessage(notificationPayload)) as string | number;
      if (!messageId)
        throw new BaseError('sendSummaryToHotel: Notification message failed');
    } catch (error) {
      logger.error(
        `sendSummaryToHotel: Failed to send Telegram message for hotel ${hotelId}: ${error}`,
      );
      throw error;
    }

    // Step 4: Store message ID and date in hotel configuration
    // date should be in the hotel's timezone, in the YYYY-MM-DD format
    const updatePayload = {
      last_daily_message: {
        message_id: messageId,
        date: dayjs().tz(timezone).format('YYYY-MM-DD'),
      },
    };
    const hotelConfiguration =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        hotelId,
      );
    if (hotelConfiguration) {
      await this.hotelConfigurationService.updateHotelConfiguration(
        hotelConfiguration.id,
        updatePayload,
      );
    } else {
      await this.hotelConfigurationService.createHotelConfiguration({
        hotel_id: hotelId,
        ...updatePayload,
      });
    }

    return messageId;
  }

  /**
   * Sends Telegram check-in summaries to all hotels in the specified timezones
   * @param timezones Array of timezone strings
   * @returns Array of results for each hotel
   */
  public async sendSummaryToHotels(timezones: string[]) {
    // Define result types for success and failure tracking
    type SuccessResult = {
      status: 'success';
      hotelId: string;
      messageId: string | number | null;
    };

    type FailureResult = {
      status: 'failure';
      hotelId: string;
      error: string;
    };

    type Result = SuccessResult | FailureResult;

    // Step 1: Fetch reservation data
    const hotels = await this.hotelService.getHotelsByTimezone(timezones);
    if (!hotels || hotels.length === 0) {
      logger.warn('sendSummaryToHotels:: No hotels found');
      return [];
    }

    // Process each hotel in parallel
    const processHotel = async (hotel: Hotel): Promise<Result> => {
      const hotelId = hotel.id;

      try {
        // Get channel by hotel ID
        const channel = await this.channelService.getChannelByHotelId(hotelId);
        const checkInGroupId = channel?.check_in_group_id;

        // Check if chatId is configured
        if (!checkInGroupId) {
          logger.error(
            `sendSummaryToHotels:: No check-in group configured for hotel ${hotelId}`,
          );
          return {
            status: 'failure',
            hotelId,
            error: 'No check-in group configured for hotel',
          };
        }

        // Get the check-in date in the hotel's timezone
        const hotelTimeZone = hotel.timezone;
        const checkInDate = dayjs().tz(hotelTimeZone).format('YYYY-MM-DD');

        // Get reservations for this hotel
        const statuses = [
          ReservationStatus.ACTIVE,
          ReservationStatus.CANCELLED,
        ];
        const reservations =
          await this.roomReservationService.getReservationsForCheckInNotification(
            hotelId,
            checkInDate,
            statuses,
          );

        if (!reservations || reservations.length === 0) {
          logger.info(
            `sendSummaryToHotels:: No reservations found for hotel ${hotelId}. Skipping telegram check-in message`,
          );
          return {
            status: 'success',
            hotelId,
            messageId: null,
          };
        }

        // Group reservations by payment_id
        const reservationsByPaymentId = reservations.reduce(
          (acc, reservation) => {
            const paymentId =
              reservation.payments?.map((p) => p.id).sort()[0] || '';
            if (!acc[paymentId]) {
              acc[paymentId] = [];
            }
            acc[paymentId].push(reservation);
            return acc;
          },
          {} as Record<string, ReservationDTO[]>,
        );

        // Group and format reservations by payment_id
        const formattedReservations: GuestReservation[] = Object.values(
          reservationsByPaymentId,
        ).map((groupedReservations) => {
          const firstReservation = groupedReservations[0];

          const totalAdults = groupedReservations.reduce(
            (sum, res) => sum + (res.num_adults || 0),
            0,
          );
          const totalChildren = groupedReservations.reduce(
            (sum, res) => sum + (res.num_children || 0),
            0,
          );
          const totalPets = groupedReservations.reduce(
            (sum, res) => sum + (res.num_pets || 0),
            0,
          );

          const totalAmount = groupedReservations.reduce(
            (sum, res) => sum + getReservationTotalAmount(res),
            0,
          );
          const advanceAmount = groupedReservations.reduce(
            (sum, res) => sum + (res.quote?.amount_charged || 0),
            0,
          );

          const rooms = groupedReservations.map((res) => {
            const checkIn = new Date(res.check_in);
            const checkOut = new Date(res.check_out);
            const nights = Math.max(
              Math.round(
                (checkOut.getTime() - checkIn.getTime()) /
                  (1000 * 60 * 60 * 24),
              ),
              1,
            );
            return {
              roomType: res.room_type,
              nights: nights,
            };
          });

          const result: GuestReservation = {
            guestFirstName: firstReservation.customer.first_name || '',
            guestLastName: firstReservation.customer.last_name || '',
            rooms: rooms.length > 1 ? rooms : undefined,
            roomType:
              rooms.length === 1 ? firstReservation.room_type : undefined,
            checkIn: firstReservation.check_in,
            checkOut: firstReservation.check_out,
            phone: firstReservation.customer.phone_number,
            totalAmount: totalAmount,
            advanceAmount: advanceAmount,
            status: firstReservation.status,
            currency: hotel.currency,
            discount: firstReservation.discount,
            numAdults: totalAdults,
            numChildren: totalChildren,
            numPets: totalPets,
          };
          return result;
        });

        // Step 2: Format Telegram message
        const messageText = guestCheckinDailyTemplate(
          {
            date: dayjs().tz(hotelTimeZone),
            reservations: formattedReservations,
          },
          CheckInMessageAction.API_TRIGGER,
        );

        // Step 3: Send Telegram message
        // Create notification payload
        const notificationPayload: NotificationPayload = {
          recipient: checkInGroupId,
          content: {
            message: messageText,
            parseMode: 'HTML',
          },
        };

        const messageId = await this.notificationFactory
          .getChatService(hotel.notification_type)
          .sendMessage(notificationPayload);
        if (!messageId) {
          logger.error(
            `sendSummaryToHotels:: Telegram message failed for hotel ${hotelId}`,
          );
          return {
            status: 'failure',
            hotelId,
            error: `Check-in summary message failed for hotel ${hotelId}`,
          };
        }

        // Step 4: Store message ID and date in hotel configuration
        // Date should be in the hotel's timezone and in the YYYY-MM-DD format

        const updatePayload = {
          last_daily_message: {
            message_id: messageId,
            date: dayjs().tz(hotelTimeZone).format('YYYY-MM-DD'),
          },
        };
        const hotelConfiguration =
          await this.hotelConfigurationService.getHotelConfigurationByHotelId(
            hotelId,
          );
        if (hotelConfiguration) {
          await this.hotelConfigurationService.updateHotelConfiguration(
            hotelConfiguration.id,
            updatePayload,
          );
        } else {
          await this.hotelConfigurationService.createHotelConfiguration({
            hotel_id: hotelId,
            ...updatePayload,
          });
        }

        // Return success result
        return {
          status: 'success',
          hotelId,
          messageId,
        };
      } catch (error) {
        // Log error and return failure result
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        logger.error(
          `sendSummaryToHotels:: Error processing hotel ${hotelId}: ${errorMessage}`,
        );
        return {
          status: 'failure',
          hotelId,
          error: errorMessage,
        };
      }
    };

    // Run all hotel processing in parallel and collect results
    const results = await Promise.all(hotels.map(processHotel));
    return results;
  }

  public async updateSummary(
    hotelId: string,
    action: CheckInMessageAction,
    bookingId?: string,
    originalAmount?: number,
  ): Promise<string | number | null> {
    try {
      // Step 1: Fetch existing message
      const hotel = await hotelService.getHotelById(hotelId);
      const hotelConfiguration =
        await this.hotelConfigurationService.getHotelConfigurationByHotelId(
          hotelId,
        );
      logger.info(
        `updateSummary: Existing message: ${JSON.stringify(hotelConfiguration?.last_daily_message)}`,
      );

      // Get channel by hotel ID
      const channel = await this.channelService.getChannelByHotelId(hotelId);
      const groupId = channel?.check_in_group_id;

      if (hotelConfiguration?.last_daily_message && groupId) {
        // Check if we need to delete today's message
        const currentDay = dayjs().tz(hotel.timezone).format('YYYY-MM-DD');
        const lastCheckInMessageDate =
          hotelConfiguration.last_daily_message.date;

        // Only delete if the message was sent today
        if (currentDay === lastCheckInMessageDate) {
          try {
            // Step 2: Delete notification message
            await this.notificationFactory
              .getChatService(hotel.notification_type)
              .deleteMessage?.(
                groupId,
                hotelConfiguration.last_daily_message.message_id,
              );
            logger.info(
              `updateSummary: Deleted today's telegram message for hotel ${hotelId}`,
            );
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'Unknown error';
            logger.error(
              `updateSummary: Error deleting telegram message for hotel ${hotelId}. Proceeding with sending the new message anyway. Error: ${errorMessage}`,
            );
          }
        } else {
          logger.info(
            `Skipping message deletion for hotel ${hotelId}: message is from ${lastCheckInMessageDate}, current day is ${currentDay}`,
          );
        }
      }
      // Step 4: Re-trigger message
      if (action === CheckInMessageAction.UPDATE) {
        // Notification triggered when an existing reservation is modified.
        return await this.sendSummaryToHotel(
          hotelId,
          action,
          bookingId,
          originalAmount,
        );
      }
      if (action === CheckInMessageAction.CANCEL) {
        // Notification triggered when an existing reservation is cancelled.
        return await this.sendSummaryToHotel(hotelId, action, bookingId);
      }
      // Notification triggered when a new reservation is created.
      return await this.sendSummaryToHotel(
        hotelId,
        action,
        bookingId,
        originalAmount,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `Error updating Telegram check-in summary for hotel ${hotelId}: ${errorMessage}`,
      );
      throw new Error(
        `Failed to update Telegram check-in summary for hotel ${hotelId}: ${errorMessage}`,
      );
    }
  }
}

// Create and export the singleton instance
export const guestCheckinSummaryService = new GuestCheckinSummaryService(
  hotelService,
  hotelConfigurationService,
  channelService,
  roomReservationService,
  notificationFactory,
);

export default guestCheckinSummaryService;
