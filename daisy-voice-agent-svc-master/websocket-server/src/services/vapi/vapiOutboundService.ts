import axios, { AxiosError } from 'axios';
import config from '../../config';
import logger from '../../utils/logger';
import { VapiOutboundCallBody } from '../../validators/vapiOutboundCallSchema';

/** Strip invisible Unicode (e.g. U+200C) that breaks E.164 when copy-pasted from UIs */
function sanitizePhoneNumber(value: string): string {
  return value.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}

export class VapiOutboundService {
  /**
   * Creates an outbound phone call via Vapi (POST /call).
   * @see https://docs.vapi.ai/calls/outbound-calling
   */
  async createOutboundCall(body: VapiOutboundCallBody): Promise<unknown> {
    const apiKey = config.VAPI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('VAPI_API_KEY is not configured');
    }

    const baseURL = (config.VAPI_API_BASE_URL || 'https://api.vapi.ai').replace(
      /\/$/,
      '',
    );

    const payload: Record<string, unknown> = {
      phoneNumberId: body.phone_number_id,
      customer: { number: sanitizePhoneNumber(body.customer_number) },
    };

    if (body.assistant_id) {
      payload.assistantId = body.assistant_id;
    }
    if (body.assistant) {
      payload.assistant = body.assistant;
    }
    if (body.schedule_plan) {
      payload.schedulePlan = body.schedule_plan;
    }

    const overrides: Record<string, unknown> = {
      ...(body.assistant_overrides ?? {}),
    };
    if (body.message !== undefined && body.message !== '') {
      overrides.firstMessage = body.message;
    }
    if (Object.keys(overrides).length > 0) {
      payload.assistantOverrides = overrides;
    }

    try {
      const { data } = await axios.post(`${baseURL}/call`, payload, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: config.API_TIMEOUT,
      });
      return data;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const ax = err as AxiosError<{ message?: string }>;
        const status = ax.response?.status ?? 502;
        const msg =
          (ax.response?.data as { message?: string })?.message ||
          ax.message ||
          'Vapi outbound call failed';
        logger.error('VapiOutboundService.createOutboundCall failed', {
          status,
          message: msg,
        });
        const e = new Error(msg) as Error & {
          statusCode: number;
          details?: unknown;
        };
        e.statusCode = status;
        e.details = ax.response?.data;
        throw e;
      }
      throw err;
    }
  }
}

export const vapiOutboundService = new VapiOutboundService();
