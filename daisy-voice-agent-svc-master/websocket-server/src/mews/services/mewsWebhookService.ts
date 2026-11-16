import logger from '../../utils/logger';
import { MewsWebhookPayload, MewsWebhookResponse } from '../types';

export class MewsWebhookService {
  async handleWebhookEvent(
    payload: MewsWebhookPayload,
  ): Promise<MewsWebhookResponse> {
    if (!payload?.Events?.length) {
      logger.warn(
        'MewsWebhookService: Ignoring webhook payload without events',
        { enterpriseId: payload?.EnterpriseId },
      );
      return {
        success: true,
        message: 'Mews webhook payload ignored because no events were sent',
      };
    }

    logger.info(
      `MewsWebhookService: Received webhook enterpriseId=${payload.EnterpriseId} integrationId=${payload.IntegrationId} events=${payload.Events.map((e) => e.Discriminator).join(',')}`,
    );

    // switch (event.Discriminator) {
    //   case 'ServiceOrderUpdated':
    //     return await this.handleServiceOrderUpdated(event);
    //   case 'CustomerAdded':
    //   case 'CustomerUpdated':
    //     return await this.handleCustomerUpdated(event);
    //   case 'PaymentUpdated':
    //     return await this.handlePaymentUpdated(event);
    //   default:
    //     logger.warn(`MewsWebhookService: Ignoring unhandled event type=${event.Discriminator}`);
    //     return { success: true, message: `Event type ${event.Discriminator} ignored` };
    // }
    return {
      success: true,
      message: 'Mews webhook events received but not processed yet',
    };
  }
}

export const mewsWebhookService = new MewsWebhookService();
