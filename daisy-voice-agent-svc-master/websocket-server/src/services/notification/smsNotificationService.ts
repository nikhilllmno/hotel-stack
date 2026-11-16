// src/services/notification/telegram-notification.service.ts

import twilio from 'twilio';
import { TwilioMessageParams } from '../../dtos/twilio/TwilioMessageParams';
import { BadRequestError } from '../../errors/BadRequestError';
import { TwilioError } from '../../errors/TwilioError';
import logger from '../../utils/logger';
import { NotificationService } from './notificationAbstract';
import { NotificationPayload, NotificationSMSContent } from './types';

/**
 * Implementation of NotificationService for Telegram
 */
export class SMSNotificationService extends NotificationService {
  constructor() {
    super(); // Call to parent class constructor
  }

  /**
   * Sends an SMS/MMS message using Twilio
   * @param options Message options including recipient and message body
   * @returns Message SID if successful
   */
  async sendMessage(payload: NotificationPayload): Promise<string> {
    const recipient = payload.recipient;
    const content = payload.content as NotificationSMSContent;
    if (!recipient || !content) {
      throw new BadRequestError(
        `Aborting SMS notification: Invalid payload: ${JSON.stringify(payload)}`,
      );
    }

    const hotelSmsNumber = content.from;
    if (!hotelSmsNumber) {
      throw new BadRequestError(
        `sendMessage: Aborting SMS notification: Sender number is missing: ${JSON.stringify(payload)}`,
      );
    }

    const twilioConfig = content.twilioConfiguration;
    if (!twilioConfig) {
      throw new TwilioError(
        `sendMessage: Aborting SMS notification: No Twilio configuration found for number ${hotelSmsNumber}`,
      );
    }

    const twilioClient = twilio(
      twilioConfig.twilioAccountSid,
      twilioConfig.twilioAuthToken,
    );
    if (!twilioClient) {
      throw new TwilioError(
        'sendMessage: Aborting SMS notification: Failed to initialize Twilio client',
      );
    }

    try {
      const messageParams: TwilioMessageParams = {
        body: content.message,
        to: recipient,
        from: hotelSmsNumber,
      };

      // Add media URLs if provided (for MMS)
      if (content.mediaUrl && content.mediaUrl.length > 0) {
        messageParams.mediaUrl = content.mediaUrl;
        logger.info(
          `Sending MMS (${content.mediaUrl.length} attachment(s)) to phone ending ...${recipient.slice(-4)}`,
        );
      }

      const message = await twilioClient.messages.create(messageParams);

      const messageType =
        content.mediaUrl && content.mediaUrl.length > 0 ? 'MMS' : 'SMS';
      logger.info(
        `${messageType} sent to phone ending ...${recipient.slice(-4)} with SID: ${message.sid}`,
      );
      return message.sid;
    } catch (error) {
      logger.error('Error sending SMS/MMS:', error);
      throw new TwilioError(
        `Failed to send SMS/MMS: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}

const smsService = new SMSNotificationService();
export default smsService;
