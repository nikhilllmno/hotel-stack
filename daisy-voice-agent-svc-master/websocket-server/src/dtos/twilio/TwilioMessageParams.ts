/**
 * Twilio message parameters interface
 * Based on Twilio API documentation for creating messages
 */
export interface TwilioMessageParams {
  body: string;
  to: string;
  from: string;
  mediaUrl?: string[];
}
