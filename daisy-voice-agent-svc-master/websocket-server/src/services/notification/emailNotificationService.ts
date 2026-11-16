// src/services/notification/email-notification.service.ts

import config from '../../config';
import { BadRequestError } from '../../errors/BadRequestError';
import { ExternalAPIError } from '../../errors/ExternalApiError';
import { createHttpClient } from '../../utils/httpClient';
import logger from '../../utils/logger';
import { NotificationService } from './notificationAbstract';
import { NotificationEmailContent, NotificationPayload } from './types';
/**
 * Email-specific notification payload
 */
export interface EmailNotificationPayload extends NotificationPayload {
  recipient: string; // Email address
  content: NotificationEmailContent; // Email content (subject, HTML content, etc.)
}

/**
 * Implementation of NotificationService for Email
 */
const emailHttpClient = createHttpClient('email', {
  headers: { 'Content-Type': 'application/json' },
  timeout: config.API_TIMEOUT,
});

export class EmailNotificationService extends NotificationService {
  private apiUrl: string;

  constructor() {
    super();
    this.apiUrl = config.EMAIL_API_URL;
  }

  /**
   * Sends an email message through an API
   * @param payload The email notification payload
   * @returns Promise resolving to a JSON string
   */
  async sendMessage(payload: EmailNotificationPayload): Promise<string> {
    const { recipient, content } = payload;

    if (!recipient || !content?.subject || !content?.message) {
      logger.error('Missing email parameters: recipient, subject, or message');
      throw new BadRequestError(
        'Missing email parameters: recipient, subject, or message',
      );
    }
    const cc = content?.cc?.length ? content.cc.join(', ') : undefined;
    const bcc = content?.bcc?.length ? content.bcc.join(', ') : undefined;
    try {
      // Prepare email payload for the API
      const apiPayload = {
        action: 'sendEmail',
        payload: {
          to: recipient,
          subject: content.subject,
          body: content.message,
          ...(cc && { cc }),
          ...(bcc && { bcc }),
        },
      };

      // Send email via API
      const response = await emailHttpClient.post(this.apiUrl, apiPayload);

      if (response.data.success === true) {
        logger.info(
          `Email notification sent via API successfully to ${recipient}`,
        );
        return JSON.stringify(response.data);
      } else {
        logger.error(
          `Failed to send email notification via API: ${response.data.message}`,
        );
        throw new ExternalAPIError(
          `Failed to send email notification via API: Email server error ${response.data.message}`,
        );
      }
    } catch (error) {
      logger.error(`Error sending email notification via API: ${error}`);
      throw error;
    }
  }
}
