export interface ConversationSummary {
  summary: string;
  /** Legacy VAPI HTTP URL only; omitted when stored value is s3:// */
  recording_url?: string;
  /** Playable URL for dashboard audio player */
  recording_presigned_url?: string;
}
