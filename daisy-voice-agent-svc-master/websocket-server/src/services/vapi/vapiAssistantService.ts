import axios, { AxiosError } from 'axios';
import config from '../../config';
import logger from '../../utils/logger';

interface StructuredOutputMapping {
  configField: string;
  envKeys: Array<keyof typeof config>;
}

// This is the registry of structured output IDs for the VAPI assistant
const STRUCTURED_OUTPUT_REGISTRY: StructuredOutputMapping[] = [
  {
    configField: 'followup_payment_link_configuration',
    envKeys: [
      'VAPI_FOLLOWUP_AVAILABILITY_STRUCTURED_OUTPUT_ID',
      'VAPI_AVAILABILITY_ENQUIRED_STRUCTURED_OUTPUT_ID',
      'VAPI_PAYMENT_LINK_SENT_STRUCTURED_OUTPUT_ID',
    ],
  },
];

export class VapiAssistantService {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor() {
    this.apiKey = (config.VAPI_API_KEY || '').trim();
    this.baseUrl = (config.VAPI_API_BASE_URL || 'https://api.vapi.ai').replace(
      /\/$/,
      '',
    );
  }

  private getAuthHeaders() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Resolves the VAPI assistant ID for a given phone number by listing
   * all phone numbers and matching on the number field.
   */
  async resolveAssistantId(phoneNumber: string): Promise<string | null> {
    if (!phoneNumber) {
      return null;
    }
    try {
      const { data } = await axios.get(`${this.baseUrl}/phone-number`, {
        headers: this.getAuthHeaders(),
        params: { limit: 100 },
        timeout: config.API_TIMEOUT,
      });

      const normalized = phoneNumber.replace(/\D/g, '');
      const match = (
        data as Array<{ number?: string; assistantId?: string }>
      ).find(
        (pn) => pn.number?.replace(/\D/g, '') === normalized.replace(/\D/g, ''),
      );

      return match?.assistantId || null;
    } catch (err) {
      logger.error('VapiAssistantService.resolveAssistantId failed', {
        phoneNumber,
        error: axios.isAxiosError(err)
          ? (err as AxiosError).response?.data
          : err,
      });
      return null;
    }
  }

  /**
   * Gets the current structuredOutputIds from a VAPI assistant's artifactPlan.
   */
  async getAssistantStructuredOutputIds(
    assistantId: string,
  ): Promise<string[]> {
    try {
      const { data } = await axios.get(
        `${this.baseUrl}/assistant/${assistantId}`,
        {
          headers: this.getAuthHeaders(),
          timeout: config.API_TIMEOUT,
        },
      );

      return (
        (data as { artifactPlan?: { structuredOutputIds?: string[] } })
          ?.artifactPlan?.structuredOutputIds || []
      );
    } catch (err) {
      logger.error(
        'VapiAssistantService.getAssistantStructuredOutputIds failed',
        {
          assistantId,
          error: axios.isAxiosError(err)
            ? (err as AxiosError).response?.data
            : err,
        },
      );
      return [];
    }
  }

  /**
   * Updates the structuredOutputIds on a VAPI assistant's artifactPlan.
   */
  async updateAssistantStructuredOutputIds(
    assistantId: string,
    structuredOutputIds: string[],
  ): Promise<boolean> {
    try {
      await axios.patch(
        `${this.baseUrl}/assistant/${assistantId}`,
        {
          artifactPlan: { structuredOutputIds },
        },
        {
          headers: this.getAuthHeaders(),
          timeout: config.API_TIMEOUT,
        },
      );
      return true;
    } catch (err) {
      logger.error(
        'VapiAssistantService.updateAssistantStructuredOutputIds failed',
        {
          assistantId,
          error: axios.isAxiosError(err)
            ? (err as AxiosError).response?.data
            : err,
        },
      );
      return false;
    }
  }

  /**
   * Syncs structured output IDs for a hotel's VAPI assistant based on
   * the hotel configuration. Adds or removes structured output IDs
   * from the assistant's artifactPlan as configs are toggled.
   *
   * @param assistantPhoneNumber The hotel's assistant phone number
   * @param enabledConfigFields Config field names that are currently enabled
   */
  async syncStructuredOutputs(
    assistantPhoneNumber: string,
    enabledConfigFields: string[],
  ): Promise<void> {
    if (!this.apiKey) {
      logger.warn(
        'VapiAssistantService.syncStructuredOutputs: VAPI_API_KEY not configured, skipping',
      );
      return;
    }

    const assistantId = await this.resolveAssistantId(assistantPhoneNumber);
    if (!assistantId) {
      logger.warn(
        `VapiAssistantService.syncStructuredOutputs: Could not resolve assistant ID for ${assistantPhoneNumber}`,
      );
      return;
    }

    const currentIds = await this.getAssistantStructuredOutputIds(assistantId);
    const updatedIds = new Set(currentIds);
    let changed = false;

    for (const mapping of STRUCTURED_OUTPUT_REGISTRY) {
      const shouldBeEnabled = enabledConfigFields.includes(mapping.configField);

      for (const envKey of mapping.envKeys) {
        const structuredOutputId = ((config[envKey] as string) || '').trim();
        if (!structuredOutputId) {
          continue;
        }

        if (shouldBeEnabled && !updatedIds.has(structuredOutputId)) {
          updatedIds.add(structuredOutputId);
          changed = true;
          logger.info(
            `VapiAssistantService.syncStructuredOutputs: Adding structured output ${structuredOutputId} to assistant ${assistantId}`,
          );
        } else if (!shouldBeEnabled && updatedIds.has(structuredOutputId)) {
          updatedIds.delete(structuredOutputId);
          changed = true;
          logger.info(
            `VapiAssistantService.syncStructuredOutputs: Removing structured output ${structuredOutputId} from assistant ${assistantId}`,
          );
        }
      }
    }

    if (changed) {
      const success = await this.updateAssistantStructuredOutputIds(
        assistantId,
        Array.from(updatedIds),
      );
      if (success) {
        logger.info(
          `VapiAssistantService.syncStructuredOutputs: Successfully updated assistant ${assistantId}`,
        );
      }
    }
  }
}

export const vapiAssistantService = new VapiAssistantService();
