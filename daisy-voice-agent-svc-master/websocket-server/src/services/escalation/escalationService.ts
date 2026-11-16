import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

import { CallerRequests } from '../../dtos/dashboard/callerRequests';
import { BadRequestError } from '../../errors/BadRequestError';
import { EscalationError } from '../../errors/EscalationError';
import { Escalation } from '../../models/Escalations';
import { Hotel } from '../../models/Hotel';
import { EscalationRepository } from '../../repositories/EscalationRepository';
import { EscalationReportConfiguration } from '../../types/hotelConfiguration';
import logger from '../../utils/logger';
import { hotelService, HotelService } from '../hotel/hotelService';
import {
  hotelConfigurationService,
  HotelConfigurationService,
} from '../hotelConfiguration/hotelConfigurationService';
import {
  ChatServiceResolver,
  notificationFactory,
  NotificationType,
} from '../notification/notificationFactory';
import { SMSNotificationService } from '../notification/smsNotificationService';

dayjs.extend(utc);
dayjs.extend(timezone);

type EscalationInput = Omit<
  Escalation,
  'id' | 'created_at' | 'updated_at' | 'hotel_id' | 'reminder_count'
>;
const escalationRepository = new EscalationRepository();

interface EscalationJobResult {
  hotel_id: string;
  hotel_name: string;
  status: 'sent' | 'skipped' | 'error';
  detail?: string;
}

export class EscalationService {
  constructor(
    private escalationRepository: EscalationRepository,
    private hotelService: HotelService,
    private notificationFactory: ChatServiceResolver,
    private smsService: SMSNotificationService,
    private hotelConfigurationService: HotelConfigurationService,
  ) {}

  public async handleEscalation(
    input: EscalationInput,
    assistantPhoneNumber: string,
  ): Promise<Escalation> {
    try {
      const hotel =
        await this.hotelService.getHotelByAssistantPhoneNumber(
          assistantPhoneNumber,
        );

      if (!hotel) {
        const errorMessage = `handleEscalation: Hotel is not configured for the phone number ${assistantPhoneNumber}`;
        logger.error(errorMessage);
        throw new BadRequestError(errorMessage);
      }

      // Create escalation record once
      const escalation = await this.escalationRepository.create({
        ...input,
        hotel_id: hotel.id,
      });

      // DO NOT change this format. If escalation replies are supported and the manager responds to
      // this chat message, the backend then uses the 'Customer Phone' section to get the customer's number.
      const messageText = `New Escalation Received:\n${input.message}\nCustomer Name: ${input.full_name}\n📞 Customer Phone: ${input.phone_number}`;
      const notificationType =
        hotel.notification_type ?? NotificationType.TELEGRAM;
      try {
        if (!hotel.telegram_check_in_group_id) {
          throw new EscalationError(
            `handleEscalation: No ${notificationType} notification sent for escalation ${escalation?.id ?? ''}. Hotel ${hotel.id} does not have a ${notificationType} chat ID`,
          );
        }
        const externalMessageId = await this.notificationFactory
          .getChatService(hotel.notification_type)
          .sendMessage({
            recipient: hotel.telegram_check_in_group_id,
            content: {
              message: messageText,
              parseMode: 'HTML',
            },
          });
        if (externalMessageId) {
          await this.escalationRepository.update(escalation.id, {
            external_message_id: externalMessageId.toString(),
          });
        }
      } catch (error) {
        const errMsg = `handleEscalation: Failed to send ${notificationType} notification for escalation ${escalation?.id ?? ''}. Error: ${error}`;
        logger.error(errMsg);
        throw new EscalationError(errMsg + '\n');
      }

      return escalation;
    } catch (error) {
      logger.error(
        `Error Occurred in escalation service :: Error creating escalation: ${JSON.stringify(
          error,
        )}`,
      );
      throw error;
    }
  }

  public async findEscalationById(id: string): Promise<Escalation | null> {
    return this.escalationRepository.findById(id);
  }

  public async findEscalationByPhone(
    phone_number: string,
  ): Promise<Escalation | null> {
    return this.escalationRepository.findByPhone(phone_number);
  }

  public async findEscalationByExternalMessageId(
    externalMessageId: string,
    hotelId: string,
  ): Promise<Escalation | null> {
    return this.escalationRepository.findByExternalMessageId(
      externalMessageId,
      hotelId,
    );
  }

  public async getAllEscalations(): Promise<Escalation[]> {
    return this.escalationRepository.findAll();
  }

  public async updateEscalation(
    id: string,
    data: Partial<Omit<Escalation, 'id' | 'created_at' | 'updated_at'>>,
  ): Promise<Escalation | null> {
    return this.escalationRepository.update(id, data);
  }

  public async deleteEscalation(id: string): Promise<boolean> {
    return this.escalationRepository.delete(id);
  }

  public async getEscalationsBySessionId(
    session_id: string,
  ): Promise<Escalation[]> {
    const escalations =
      await this.escalationRepository.findEscalationBySessionId(session_id);
    if (!escalations) {
      logger.info(`Escalations not found for session id: ${session_id}`);
      return [];
    }
    return escalations;
  }

  public async getEscalationsList(
    hotel_id: string,
    page: number = 1,
    limit: number = 10,
    start_date?: Date,
    end_date?: Date,
  ): Promise<CallerRequests> {
    const offset = (page - 1) * limit;
    const escalations =
      await this.escalationRepository.getPaginatedEscalationsByHotelId(
        hotel_id,
        offset,
        limit,
        start_date,
        end_date,
      );
    const total_count =
      await this.escalationRepository.getTotalEscalationCountByHotelId(
        hotel_id,
        start_date,
        end_date,
      );
    const total_pages = Math.ceil(total_count / limit);
    let next_page = '';
    let prev_page = '';
    if (page < total_pages && start_date && end_date) {
      next_page = `/escalations?start_date=${start_date.toISOString()}&end_date=${end_date.toISOString()}&page=${page + 1}&limit=${limit}`;
    }
    if (page > 1 && start_date && end_date) {
      prev_page = `/escalations?start_date=${start_date.toISOString()}&end_date=${end_date.toISOString()}&page=${page - 1}&limit=${limit}`;
    }
    const summary: CallerRequests = {
      data: escalations,
      pagination: {
        current_page: page,
        limit: limit,
        total_items: total_count,
        total_pages: total_pages,
        next_page: next_page,
        prev_page: prev_page,
      },
    };
    logger.info(`Returned ${escalations.length} caller requests`);
    return summary;
  }

  /**
   * Sends a daily summary report of open escalations to each hotel's Telegram group.
   * Only fires when the hotel's local time is within [reporting_time - cron_window_minutes, reporting_time].
   */
  public async sendDailyReport(): Promise<EscalationJobResult[]> {
    const hotels = await this.hotelService.getHotels();
    const results: EscalationJobResult[] = [];
    const configs = await Promise.all(
      hotels.map(async (hotel) => {
        const config = await this.getEscalationReportConfig(hotel.id);
        return config ? { hotel, config } : null;
      }),
    );
    const hotelsWithConfig: {
      hotel: Hotel;
      config: EscalationReportConfiguration;
    }[] = configs.filter(
      (c): c is { hotel: Hotel; config: EscalationReportConfiguration } =>
        c !== null,
    );

    for (const { hotel, config } of hotelsWithConfig) {
      try {
        if (!hotel.timezone) {
          results.push({
            hotel_id: hotel.id,
            hotel_name: hotel.name,
            status: 'skipped',
            detail: 'no timezone',
          });
          continue;
        }

        if (!hotel.telegram_check_in_group_id) {
          results.push({
            hotel_id: hotel.id,
            hotel_name: hotel.name,
            status: 'skipped',
            detail: 'no telegram group',
          });
          continue;
        }

        if (
          !this.isInReportingWindow(
            hotel.timezone,
            config.reporting_time,
            config.cron_window_minutes,
          )
        ) {
          results.push({
            hotel_id: hotel.id,
            hotel_name: hotel.name,
            status: 'skipped',
            detail: 'outside reporting window',
          });
          continue;
        }

        const since = new Date(
          Date.now() - config.period_hours * 60 * 60 * 1000,
        );
        const openEscalations = await this.escalationRepository.findOpenSince(
          hotel.id,
          since,
        );

        if (openEscalations.length === 0) {
          results.push({
            hotel_id: hotel.id,
            hotel_name: hotel.name,
            status: 'skipped',
            detail: 'no open escalations',
          });
          continue;
        }

        const message = this.formatDailyReport(
          hotel,
          openEscalations,
          config.period_hours,
        );
        await this.notificationFactory
          .getChatService(hotel.notification_type)
          .sendMessage({
            recipient: hotel.telegram_check_in_group_id,
            content: { message, parseMode: 'HTML' },
          });

        results.push({
          hotel_id: hotel.id,
          hotel_name: hotel.name,
          status: 'sent',
        });
      } catch (error) {
        const err = error as Error;
        logger.error(
          `sendDailyReport: Error for hotel ${hotel.id}: ${err.message}`,
        );
        results.push({
          hotel_id: hotel.id,
          hotel_name: hotel.name,
          status: 'error',
          detail: err.message,
        });
      }
    }

    return results;
  }

  /**
   * Sends reminder messages (as replies to the original escalation message) for escalations
   * that have been open past the configured delay.
   */
  public async sendReminders(): Promise<EscalationJobResult[]> {
    const hotels = await this.hotelService.getHotels();
    const configs = await Promise.all(
      hotels.map(async (hotel) => {
        const config = await this.getEscalationReportConfig(hotel.id);
        return config ? { hotel, config } : null;
      }),
    );
    const hotelsWithConfig: {
      hotel: Hotel;
      config: EscalationReportConfiguration;
    }[] = configs.filter(
      (c): c is { hotel: Hotel; config: EscalationReportConfiguration } =>
        c !== null,
    );
    const results: EscalationJobResult[] = [];

    for (const { hotel, config } of hotelsWithConfig) {
      try {
        if (!hotel.telegram_check_in_group_id) {
          results.push({
            hotel_id: hotel.id,
            hotel_name: hotel.name,
            status: 'skipped',
            detail: 'no telegram group',
          });
          continue;
        }

        const escalations = await this.escalationRepository.findNeedingReminder(
          hotel.id,
          config.reminder_delay_minutes,
          config.cron_window_minutes,
          config.reminder_resend_count,
        );

        if (escalations.length === 0) {
          results.push({
            hotel_id: hotel.id,
            hotel_name: hotel.name,
            status: 'skipped',
            detail: 'no escalations needing reminder',
          });
          continue;
        }

        let sentCount = 0;
        for (const escalation of escalations) {
          try {
            await this.notificationFactory
              .getChatService(hotel.notification_type)
              .sendMessage({
                recipient: hotel.telegram_check_in_group_id,
                content: {
                  message: '⏳ This escalation is still OPEN. Please review.',
                  replyToMessageId: escalation.external_message_id,
                },
              });

            await this.escalationRepository.update(escalation.id, {
              reminder_count: (escalation.reminder_count ?? 0) + 1,
            });
            sentCount++;
          } catch (error) {
            const err = error as Error;
            logger.error(
              `sendReminders: Failed to send reminder for escalation ${escalation.id}: ${err.message}`,
            );
          }
        }

        results.push({
          hotel_id: hotel.id,
          hotel_name: hotel.name,
          status: 'sent',
          detail: `${sentCount} reminders sent`,
        });
      } catch (error) {
        const err = error as Error;
        logger.error(
          `sendReminders: Error for hotel ${hotel.id}: ${err.message}`,
        );
        results.push({
          hotel_id: hotel.id,
          hotel_name: hotel.name,
          status: 'error',
          detail: err.message,
        });
      }
    }

    return results;
  }

  private isInReportingWindow(
    tz: string,
    reportingTime: string,
    windowMinutes: number,
  ): boolean {
    const [targetHour, targetMinute] = reportingTime.split(':').map(Number);
    const hotelNow = dayjs().tz(tz);
    const todayTarget = hotelNow
      .hour(targetHour)
      .minute(targetMinute)
      .second(0)
      .millisecond(0);

    return (
      (hotelNow.isAfter(todayTarget) || hotelNow.isSame(todayTarget)) &&
      hotelNow.isBefore(todayTarget.add(windowMinutes, 'minute'))
    );
  }

  private async getEscalationReportConfig(
    hotelId: string,
  ): Promise<EscalationReportConfiguration | null> {
    const hotelConfig =
      await this.hotelConfigurationService.getHotelConfigurationByHotelId(
        hotelId,
      );
    return hotelConfig?.escalation_report_configuration ?? null;
  }

  private formatDailyReport(
    hotel: Hotel,
    escalations: Escalation[],
    periodHours: number,
  ): string {
    const lines: string[] = [
      `🚨 <u><b>TODAY'S ESCALATION REPORT (last ${periodHours}h)</b></u> 🚨`,
      `Hotel: ${hotel.name}`,
      `Pending escalations: ${escalations.length}`,
      '',
    ];

    escalations.forEach((esc, i) => {
      const ageMs = Date.now() - new Date(esc.created_at).getTime();
      const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
      const ageMinutes = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60));
      const ageStr =
        ageHours > 0 ? `${ageHours}h ${ageMinutes}m ago` : `${ageMinutes}m ago`;

      lines.push(
        `${i + 1}. ${esc.full_name} — ${esc.phone_number} — ${ageStr}`,
      );
      lines.push(`   "${esc.message}"`);
      lines.push('');
    });

    return lines.join('\n');
  }
}

// Create singleton instances of notification services
const smsService = new SMSNotificationService();

// Create the escalation service with direct service injection
export const escalationService = new EscalationService(
  escalationRepository,
  hotelService,
  notificationFactory,
  smsService,
  hotelConfigurationService,
);

export default escalationService;
