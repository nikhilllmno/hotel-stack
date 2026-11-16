import { TeamsConversationReference } from '../models/TeamsConversationReference';
import { BaseRepository } from './BaseRepository';

export class TeamsConversationReferenceRepository extends BaseRepository {
  private tableName = 'teams_conversation_references';

  async findByChannelId(
    channelId: string,
  ): Promise<TeamsConversationReference | null> {
    const result = await this.db(this.tableName)
      .where({ channel_id: channelId })
      .first();
    return result || null;
  }

  /** Records where a channel lives; the service URL moves between regions, so it is refreshed on every call. */
  async upsert(
    reference: Omit<TeamsConversationReference, 'created_at' | 'updated_at'>,
  ): Promise<void> {
    await this.db(this.tableName)
      .insert({
        ...reference,
        created_at: this.db.fn.now(),
        updated_at: this.db.fn.now(),
      })
      .onConflict('channel_id')
      .merge({
        tenant_id: reference.tenant_id,
        service_url: reference.service_url,
        team_id: reference.team_id ?? null,
        bot_id: reference.bot_id,
        updated_at: this.db.fn.now(),
      });
  }
}
