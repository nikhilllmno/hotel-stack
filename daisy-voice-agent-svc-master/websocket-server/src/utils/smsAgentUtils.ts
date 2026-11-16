import axios from 'axios';
import config from '../config';
import { hotelConfigurationService } from '../services/hotelConfiguration/hotelConfigurationService';
import { createHttpClient } from './httpClient';
import logger from './logger';

const smsAgentHttpClient = createHttpClient('sms-agent', {
  headers: { 'Content-Type': 'application/json' },
});

export interface TranscriptAgentPayload {
  customer_phone_number: string;
  assistant_phone_number: string;
  assistant_sms_number: string;
  sms_body: string;
  /** When true, instructs the n8n transcript webhook to re-trigger the AI agent path. */
  trigger_agent?: boolean;
}

/**
 * Append SMS sent by the voice agent to the SMS agent's transcript
 * @param hotelId - The hotel ID to look up the transcript agent URL
 * @param payload - The payload to send to the transcript agent
 */
export async function appendSmsToSmsAgentTranscript(
  hotelId: string,
  payload: TranscriptAgentPayload,
): Promise<void> {
  const transcriptAgentUrl =
    (await hotelConfigurationService.getTranscriptAgentUrlByHotelId(hotelId)) ??
    undefined;

  if (!transcriptAgentUrl) {
    logger.info(
      `sendToTranscriptAgent: No transcript agent URL configured for hotel_id ${hotelId}`,
    );
    return;
  }

  try {
    // Ensure phone numbers have + prefix
    const normalizedPayload = {
      ...payload,
      customer_phone_number: ensurePlusPrefix(payload.customer_phone_number),
      assistant_phone_number: ensurePlusPrefix(payload.assistant_phone_number),
      assistant_sms_number: ensurePlusPrefix(payload.assistant_sms_number),
    };

    const token = config.DAISY_API_KEY_V2;
    if (!token) {
      logger.warn(
        `sendToTranscriptAgent: DAISY_API_KEY_V2 not found, skipping transcript agent notification`,
      );
      return;
    }

    await smsAgentHttpClient.post(transcriptAgentUrl, normalizedPayload, {
      headers: {
        token: token,
      },
    });

    logger.info(
      `sendToTranscriptAgent: Successfully sent SMS content to transcript agent for hotel_id ${hotelId}`,
    );
  } catch (error) {
    // Log but don't throw - transcript agent notification is not critical
    if (axios.isAxiosError(error)) {
      const status = error.response?.status || 'unknown';
      const data = error.response?.data || error.message;
      logger.error(
        `sendToTranscriptAgent: Failed to send to transcript agent, status: ${status}, response: ${JSON.stringify(data)}`,
      );
    } else {
      logger.error(
        `sendToTranscriptAgent: Error sending to transcript agent: ${(error as Error).message}`,
      );
    }
  }
}

/**
 * Trigger the dedicated n8n handback webhook after "Switch to AI".
 *
 * The endpoint accepts plain JSON and does not require a Twilio signature —
 * it jumps directly into the AI processing nodes.
 *
 * n8n webhook receives:
 *   { from: "+1xxx", to: "+1yyy", body: "guest message" }
 */
export async function triggerHandbackWorkflow(
  hotelId: string,
  payload: {
    customer_phone_number: string;
    assistant_sms_number: string;
    sms_body: string;
  },
): Promise<void> {
  const handbackUrl = config.HANDBACK_AGENT_URL;

  if (!handbackUrl) {
    logger.info(
      `triggerHandbackWorkflow: No HANDBACK_AGENT_URL configured, skipping`,
    );
    return;
  }

  try {
    await smsAgentHttpClient.post(handbackUrl, {
      from: ensurePlusPrefix(payload.customer_phone_number),
      to: ensurePlusPrefix(payload.assistant_sms_number),
      body: payload.sms_body,
    });

    logger.info(
      `triggerHandbackWorkflow: Triggered handback workflow for hotel_id ${hotelId}`,
    );
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status || 'unknown';
      const data = error.response?.data || error.message;
      logger.error(
        `triggerHandbackWorkflow: Failed, status: ${status}, response: ${JSON.stringify(data)}`,
      );
    } else {
      logger.error(
        `triggerHandbackWorkflow: Error: ${(error as Error).message}`,
      );
    }
  }
}

const ensurePlusPrefix = (phoneNumber: string) =>
  phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
