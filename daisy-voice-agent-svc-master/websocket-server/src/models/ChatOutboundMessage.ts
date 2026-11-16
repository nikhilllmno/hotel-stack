export interface ChatOutboundMessage {
  id: string;
  provider: string;
  channel_id: string;
  message_id: string;
  text: string;
  created_at?: Date;
}
