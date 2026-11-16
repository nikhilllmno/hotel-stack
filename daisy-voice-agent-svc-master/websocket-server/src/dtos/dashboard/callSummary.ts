export interface CallSummary {
  calls: {
    total: number;
    duration_seconds: number;
  };
}

export interface ConversationSummary {
  total_conversations: number;
  total_duration: number;
}
