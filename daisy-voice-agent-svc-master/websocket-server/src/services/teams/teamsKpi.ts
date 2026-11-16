import { HotelRepository } from '../../repositories/HotelRepository';
import { KpiStatValue, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';

export type TeamsHotelLookup = Pick<
  HotelRepository,
  'findByTelegramCheckInGroupId' | 'findByTelegramTranscriptGroupId'
>;

/**
 * Teams only knows the channel, so the hotel for the `clientId` dimension is
 * found through the check-in / transcript channel columns. A failed lookup
 * leaves the metric unattributed instead of failing the message.
 */
export async function logTeamsKpi(args: {
  stat: KpiStatValue;
  contextName: string;
  channelId: string;
  hotels: TeamsHotelLookup;
}): Promise<void> {
  const { stat, contextName, channelId, hotels } = args;
  let clientId: string | undefined;
  try {
    const hotel =
      (await hotels.findByTelegramCheckInGroupId(channelId)) ??
      (await hotels.findByTelegramTranscriptGroupId(channelId));
    clientId = hotel?.assistant_phone_number;
  } catch (error) {
    logger.warn(
      `logTeamsKpi: Could not resolve hotel for channel ${channelId}: ${(error as Error).message}`,
    );
  }
  logKpi({ stat, value: 1, contextName, clientId });
}
