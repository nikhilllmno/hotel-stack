import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import {
  CallForwardingConfiguration,
  CallForwardingRule,
} from '../../types/hotelConfiguration';
import logger from '../../utils/logger';

dayjs.extend(utc);
dayjs.extend(timezone);

export class CallForwardingHelper {
  /**
   * Resolves the phone number to forward calls to based on the hotel's
   * call forwarding configuration and the current time in the hotel's timezone.
   *
   * Returns null if the configuration is disabled or missing, signaling
   * the caller should fall back to legacy behavior.
   */
  public resolveForwardingNumber(
    config: CallForwardingConfiguration | null | undefined,
    hotelTimezone: string,
  ): string | null {
    if (!config || !config.enabled) {
      return null;
    }

    const now = dayjs().tz(hotelTimezone);
    const currentTime = now.format('HH:mm');
    const currentDayOfWeek = now.day();
    const currentDate = now.format('YYYY-MM-DD');
    const yesterdayDayOfWeek = now.subtract(1, 'day').day();

    const matchingRules = config.rules
      .filter((rule) => rule.enabled)
      .filter((rule) =>
        this.doesRuleMatch(
          rule,
          currentTime,
          currentDayOfWeek,
          currentDate,
          yesterdayDayOfWeek,
        ),
      );

    if (matchingRules.length === 0) {
      logger.info(
        `CallForwardingHelper:: No matching rules, using default number: ${config.default_phone_number}`,
      );
      return config.default_phone_number;
    }

    const bestRule = matchingRules.reduce((best, rule) =>
      rule.priority > best.priority ? rule : best,
    );

    logger.info(
      `CallForwardingHelper:: Matched rule "${bestRule.label || bestRule.id}" (priority: ${bestRule.priority}), forwarding to: ${bestRule.phone_number}`,
    );
    return bestRule.phone_number;
  }

  private doesRuleMatch(
    rule: CallForwardingRule,
    currentTime: string,
    currentDayOfWeek: number,
    currentDate: string,
    yesterdayDayOfWeek: number,
  ): boolean {
    const { conditions } = rule;

    if (conditions.specific_dates?.length) {
      if (!conditions.specific_dates.includes(currentDate)) {
        return false;
      }
    }

    const isOvernightRange = conditions.time_range
      ? conditions.time_range.end < conditions.time_range.start
      : false;

    if (conditions.time_range) {
      if (
        !this.isTimeInRange(
          currentTime,
          conditions.time_range.start,
          conditions.time_range.end,
        )
      ) {
        return false;
      }
    }

    if (conditions.days_of_week?.length) {
      if (isOvernightRange && currentTime < conditions.time_range!.end) {
        // We're in the early morning portion of an overnight range;
        // check if YESTERDAY is in days_of_week (the range started yesterday)
        if (!conditions.days_of_week.includes(yesterdayDayOfWeek)) {
          return false;
        }
      } else {
        if (!conditions.days_of_week.includes(currentDayOfWeek)) {
          return false;
        }
      }
    }

    return true;
  }

  private isTimeInRange(
    currentTime: string,
    start: string,
    end: string,
  ): boolean {
    if (start <= end) {
      return currentTime >= start && currentTime < end;
    }
    // Overnight range: e.g. "22:00" to "06:00"
    return currentTime >= start || currentTime < end;
  }
}

export const callForwardingHelper = new CallForwardingHelper();
