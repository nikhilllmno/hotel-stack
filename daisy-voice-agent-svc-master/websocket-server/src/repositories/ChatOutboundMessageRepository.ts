import { ChatOutboundMessage } from '../models/ChatOutboundMessage';
import { BaseRepository } from './BaseRepository';

export class ChatOutboundMessageRepository extends BaseRepository {
  private tableName = 'chat_outbound_messages';

  async record(
    message: Pick<
      ChatOutboundMessage,
      'provider' | 'channel_id' | 'message_id' | 'text'
    >,
  ): Promise<void> {
    await this.db(this.tableName)
      .insert({ ...message, created_at: this.db.fn.now() })
      .onConflict(['provider', 'channel_id', 'message_id'])
      .merge({ text: message.text });
  }

  async find(
    provider: string,
    channelId: string,
    messageId: string,
  ): Promise<ChatOutboundMessage | null> {
    const result = await this.db(this.tableName)
      .where({
        provider,
        channel_id: channelId,
        message_id: messageId,
      })
      .first();
    return result || null;
  }
}
