import config from '../../config';
import { SessionType } from '../../dtos/enum/SessionType';
import { smsEvents } from '../../events/smsEvents';
import { Hotel } from '../../models/Hotel';
import { HotelConfiguration } from '../../models/HotelConfiguration';
import { Session } from '../../models/Session';
import {
  GetAvailabilityResponse,
  GroupWithQuote,
} from '../../models/response/roomReservation';
import { convertToPhoneNumber } from '../../utils/helper';
import logger from '../../utils/logger';
import { followupPaymentLinkSMSTemplate } from '../messaging/messageTemplates';
import { SMSNotificationService } from '../notification/smsNotificationService';
import {
  NotificationPayload,
  NotificationSMSContent,
} from '../notification/types';
import { RoomReservationService } from '../roomReservation/roomReservationService';

export interface FollowupAvailability {
  check_in: string;
  check_out: string;
  num_adults: number;
  num_children: number;
  num_pets: number;
}

export interface HandleFollowupPaymentLinkParams {
  hotel: Hotel;
  hotelConfiguration: HotelConfiguration | null;
  session: Session;
  phoneNumber: string;
  followupAvailability: FollowupAvailability;
}

export class FollowupPaymentLinkService {
  constructor(
    private readonly roomReservationService: RoomReservationService,
    private readonly smsService: SMSNotificationService,
  ) {}

  async handleFollowupPaymentLink(
    params: HandleFollowupPaymentLinkParams,
  ): Promise<void> {
    const {
      hotel,
      hotelConfiguration,
      session,
      phoneNumber,
      followupAvailability,
    } = params;

    const followupConfig =
      hotelConfiguration?.followup_payment_link_configuration;
    if (!followupConfig?.enabled) {
      return;
    }

    const callerPhone = convertToPhoneNumber(phoneNumber);
    if (!callerPhone) {
      logger.warn(
        `handleFollowupPaymentLink:: Invalid caller phone number: ${phoneNumber}`,
      );
      return;
    }

    let availabilityForBooking: GetAvailabilityResponse;

    if (followupConfig.threshold_check_enabled) {
      const thresholdOccupancy =
        followupConfig.threshold_occupancy_mode === 'default'
          ? { num_adults: 1, num_children: 0 }
          : {
              num_adults: followupAvailability.num_adults,
              num_children: followupAvailability.num_children,
            };

      const thresholdAvailability =
        await this.roomReservationService.getRoomAvailabilityWithQuote(
          {
            start_date: followupAvailability.check_in,
            end_date: followupAvailability.check_out,
            num_adults: thresholdOccupancy.num_adults,
            num_children: thresholdOccupancy.num_children,
            num_pets: followupAvailability.num_pets,
            session_type: SessionType.CALL,
            booking_link: false,
          },
          callerPhone,
          hotel.assistant_phone_number,
          SessionType.CALL,
        );

      const groups = thresholdAvailability?.groups ?? [];
      const totalAvailable = groups.reduce(
        (
          sum: number,
          g: { number_of_units_available?: number; available_units?: number },
        ) => sum + (g.number_of_units_available ?? g.available_units ?? 0),
        0,
      );

      if (totalAvailable < followupConfig.min_available_rooms_threshold) {
        logger.info(
          `handleFollowupPaymentLink:: Hotel ${hotel.name} has ${totalAvailable} available rooms, ` +
            `below threshold of ${followupConfig.min_available_rooms_threshold}. Skipping followup.`,
        );
        return;
      }

      if (followupConfig.threshold_occupancy_mode === 'requested') {
        availabilityForBooking = thresholdAvailability;
      } else {
        availabilityForBooking =
          await this.roomReservationService.getRoomAvailabilityWithQuote(
            {
              start_date: followupAvailability.check_in,
              end_date: followupAvailability.check_out,
              num_adults: followupAvailability.num_adults,
              num_children: followupAvailability.num_children,
              num_pets: followupAvailability.num_pets,
              session_type: SessionType.CALL,
              booking_link: false,
            },
            callerPhone,
            hotel.assistant_phone_number,
            SessionType.CALL,
          );
      }
    } else {
      availabilityForBooking =
        await this.roomReservationService.getRoomAvailabilityWithQuote(
          {
            start_date: followupAvailability.check_in,
            end_date: followupAvailability.check_out,
            num_adults: followupAvailability.num_adults,
            num_children: followupAvailability.num_children,
            num_pets: followupAvailability.num_pets,
            session_type: SessionType.CALL,
            booking_link: false,
          },
          callerPhone,
          hotel.assistant_phone_number,
          SessionType.CALL,
        );
    }

    const bookingGroups = availabilityForBooking.groups as GroupWithQuote[];
    if (!bookingGroups || bookingGroups.length === 0) {
      logger.info(
        `handleFollowupPaymentLink:: No available rooms for hotel ${hotel.name} with requested occupancy. Skipping followup.`,
      );
      return;
    }

    const cheapestRoom = [...bookingGroups].sort(
      (a, b) => (a.total_amount || 0) - (b.total_amount || 0),
    )[0];

    logger.info(
      `handleFollowupPaymentLink:: Cheapest room for hotel ${hotel.name}: ` +
        `room_id=${cheapestRoom.room_id}, total_amount=${cheapestRoom.total_amount}`,
    );

    const reservation =
      await this.roomReservationService.createSingleRoomReservation(
        {
          check_in: followupAvailability.check_in,
          check_out: followupAvailability.check_out,
          room_id: cheapestRoom.room_id,
          num_adults: followupAvailability.num_adults,
          num_children: followupAvailability.num_children,
          num_pets: followupAvailability.num_pets,
          customer_first_name: '',
          customer_last_name: '',
          customer_phone_number: callerPhone,
          session_type: SessionType.CALL,
        },
        callerPhone,
        hotel.assistant_phone_number,
        session.id,
        SessionType.CALL,
        { skipPaymentNotification: true },
      );

    const secureUrl =
      'secureUrl' in reservation
        ? reservation.secureUrl
        : 'payment_link' in reservation
          ? reservation.payment_link
          : undefined;

    if (!secureUrl) {
      logger.error(
        `handleFollowupPaymentLink:: No review URL returned from reservation creation for session ${session.id}`,
      );
      return;
    }

    const smsBody = followupPaymentLinkSMSTemplate(
      hotel.name,
      secureUrl,
      config.REVIEW_TIMEOUT,
    );

    const smsPayload: NotificationPayload = {
      recipient: callerPhone,
      content: {
        from: hotel.sms_number,
        message: smsBody,
        twilioConfiguration: hotelConfiguration?.twilio_configuration,
      } as NotificationSMSContent,
    };

    const smsResult = await this.smsService.sendMessage(smsPayload);
    if (smsResult) {
      smsEvents.emitSmsSent({
        sessionId: session.id,
        message: smsBody,
        from: hotel.sms_number,
        to: callerPhone,
        callerPhoneNumber: callerPhone,
        assistantPhoneNumber: session.assistant_phone_number,
        timestamp: new Date(),
        hotelSmsNumber: hotel.sms_number,
        smsAgentEnabled: hotelConfiguration?.sms_agent_enabled || false,
        hotelId: hotel.id,
      });
      logger.info(
        `handleFollowupPaymentLink:: Followup payment link SMS sent for session ${session.id}`,
      );
    }
  }
}
