export interface TeamsConversationReference {
  channel_id: string;
  tenant_id: string;
  service_url: string;
  team_id?: string | null;
  bot_id: string;
  created_at?: Date;
  updated_at?: Date;
}
