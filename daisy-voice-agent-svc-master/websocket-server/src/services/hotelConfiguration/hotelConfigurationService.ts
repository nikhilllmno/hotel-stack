import { Knex } from 'knex';
import _ from 'lodash';
import { randomUUID as uuidv4 } from 'node:crypto';
import {
  CreateHotelConfigurationRequest,
  UpdateHotelConfigurationRequest,
} from '../../dtos/HotelConfiguration';
import { BadRequestError } from '../../errors/BadRequestError';
import { NoDataError } from '../../errors/NoDataError';
import { HotelConfiguration } from '../../models/HotelConfiguration';
import { HotelConfigurationRepository } from '../../repositories/HotelConfigurationRepository';
import { HotelRepository } from '../../repositories/HotelRepository';
import {
  AuthorizeNetConfig,
  CallForwardingConfiguration,
  CloudbedsPaymentSdkConfig,
  ExternalAuthConfig,
  FollowupPaymentLinkConfiguration,
  PaymentConfiguration,
  TwilioConfiguration,
} from '../../types/hotelConfiguration';
import logger from '../../utils/logger';
import { VapiAssistantService } from '../vapi/vapiAssistantService';

export class HotelConfigurationService {
  private hotelConfigurationRepository: HotelConfigurationRepository;
  private hotelRepository: HotelRepository;
  private vapiAssistantService: VapiAssistantService;

  constructor(
    hotelConfigurationRepository: HotelConfigurationRepository,
    hotelRepository?: HotelRepository,
    vapiAssistantService?: VapiAssistantService,
  ) {
    this.hotelConfigurationRepository = hotelConfigurationRepository;
    this.hotelRepository = hotelRepository || new HotelRepository();
    this.vapiAssistantService =
      vapiAssistantService || new VapiAssistantService();
  }

  /**
   * Creates a new hotel configuration
   * @param data The hotel configuration data to create
   * @param trx Optional database transaction
   * @returns Promise with the created hotel configuration
   */
  /**
   * Fire-and-forget: syncs VAPI structured outputs for configs that
   * require them (e.g. followup_payment_link_configuration).
   */
  private triggerVapiStructuredOutputSync(
    hotelId: string,
    configuration: HotelConfiguration,
  ): void {
    void (async () => {
      try {
        const hotel = await this.hotelRepository.findById(hotelId);
        if (!hotel) return;

        const enabledFields: string[] = [];
        if (
          (
            configuration.followup_payment_link_configuration as FollowupPaymentLinkConfiguration | null
          )?.enabled
        ) {
          enabledFields.push('followup_payment_link_configuration');
        }

        await this.vapiAssistantService.syncStructuredOutputs(
          hotel.assistant_phone_number,
          enabledFields,
        );
      } catch (error) {
        logger.error(
          `triggerVapiStructuredOutputSync: Failed for hotel ${hotelId}: ${error}`,
        );
      }
    })();
  }

  /**
   * Assigns a UUID to each rule in the call forwarding configuration that doesn't already have one.
   */
  private assignRuleIds(
    config: CallForwardingConfiguration | null | undefined,
  ): CallForwardingConfiguration | null | undefined {
    if (!config || !config.rules) return config;
    return {
      ...config,
      rules: config.rules.map((rule) => ({
        ...rule,
        id: rule.id || uuidv4(),
      })),
    };
  }

  public async createHotelConfiguration(
    data: CreateHotelConfigurationRequest,
    trx?: Knex.Transaction,
  ): Promise<HotelConfiguration> {
    try {
      if (!data.hotel_id) {
        throw new BadRequestError(
          'createHotelConfiguration:: Hotel ID is required',
        );
      }

      // Check if configuration already exists for this hotel (only active ones)
      const existing = await this.hotelConfigurationRepository.findByHotelId(
        data.hotel_id,
        trx,
      );
      if (existing) {
        throw new BadRequestError(
          `createHotelConfiguration: Configuration already exists for hotel ID ${data.hotel_id}`,
        );
      }

      if (data.call_forwarding_configuration) {
        data.call_forwarding_configuration = this.assignRuleIds(
          data.call_forwarding_configuration,
        );
      }

      logger.info(
        `createHotelConfiguration: Creating configuration for hotel ID: ${data.hotel_id}`,
      );
      const configuration = await this.hotelConfigurationRepository.create(
        data,
        trx,
      );

      logger.info(
        `createHotelConfiguration: Successfully created configuration with ID: ${configuration.id}`,
      );

      this.triggerVapiStructuredOutputSync(data.hotel_id, configuration);

      return configuration;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `createHotelConfiguration: Error creating configuration:`,
        errorMessage,
      );
      throw error;
    }
  }

  /**
   * Fetches hotel configuration by ID
   * @param id The ID of the configuration
   * @param trx Optional database transaction
   * @returns Promise with the hotel configuration or null
   */
  public async getHotelConfigurationById(
    id: number,
    trx?: Knex.Transaction,
  ): Promise<HotelConfiguration | null> {
    try {
      if (!id) {
        throw new BadRequestError(
          'getHotelConfigurationById:: Configuration ID is required',
        );
      }

      logger.info(
        `getHotelConfigurationById:: Fetching configuration with ID: ${id}`,
      );
      const configuration = await this.hotelConfigurationRepository.findById(
        id,
        trx,
      );

      if (!configuration) {
        logger.warn(
          `getHotelConfigurationById:: No configuration found with ID: ${id}`,
        );
      }

      return configuration;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `getHotelConfigurationById:: Error fetching configuration:`,
        errorMessage,
      );
      throw error;
    }
  }

  /**
   * Fetches hotel configuration by hotel ID
   * @param hotelId The hotel ID
   * @param trx Optional database transaction
   * @returns Promise with the hotel configuration or null
   */
  public async getHotelConfigurationByHotelId(
    hotelId: string,
    trx?: Knex.Transaction,
  ): Promise<HotelConfiguration | null> {
    try {
      if (!hotelId) {
        throw new BadRequestError(
          'getHotelConfigurationByHotelId:: Hotel ID is required',
        );
      }

      logger.info(
        `getHotelConfigurationByHotelId:: Fetching configuration for hotel ID: ${hotelId}`,
      );
      const configuration =
        await this.hotelConfigurationRepository.findByHotelId(hotelId, trx);

      if (!configuration) {
        logger.warn(
          `getHotelConfigurationByHotelId:: No configuration found for hotel ID: ${hotelId}`,
        );
      }

      return configuration;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `getHotelConfigurationByHotelId:: Error fetching configuration:`,
        errorMessage,
      );
      throw error;
    }
  }

  /**
   * Returns only the Twilio configuration for a hotel (single-column read),
   * used by the SMS notification path to avoid a full-row fetch.
   */
  public async getTwilioConfigurationByHotelId(
    hotelId: string,
    trx?: Knex.Transaction,
  ): Promise<TwilioConfiguration | null> {
    return this.hotelConfigurationRepository.findTwilioConfigurationByHotelId(
      hotelId,
      trx,
    );
  }

  /**
   * Returns only the transcript agent URL for a hotel (single-column read),
   * used by the per-SMS transcript-sync path to avoid a full-row fetch.
   */
  public async getTranscriptAgentUrlByHotelId(
    hotelId: string,
    trx?: Knex.Transaction,
  ): Promise<string | null> {
    return this.hotelConfigurationRepository.findTranscriptAgentUrlByHotelId(
      hotelId,
      trx,
    );
  }

  /**
   * Returns only the escalation agent URL for a hotel (single-column read),
   * used by the manager-reply escalation path to avoid a full-row fetch.
   */
  public async getEscalationAgentUrlByHotelId(
    hotelId: string,
    trx?: Knex.Transaction,
  ): Promise<string | null> {
    return this.hotelConfigurationRepository.findEscalationAgentUrlByHotelId(
      hotelId,
      trx,
    );
  }

  /**
   * Returns only the payment account ID for a hotel (single-column read),
   * used by the auto-charge and payment link paths to avoid a full-row fetch.
   */
  public async getPaymentAccountIdByHotelId(
    hotelId: string,
    trx?: Knex.Transaction,
  ): Promise<string | null> {
    return this.hotelConfigurationRepository.findPaymentAccountIdByHotelId(
      hotelId,
      trx,
    );
  }

  public async getAuthorizenetConfigByHotelId(
    hotelId: string,
    trx?: Knex.Transaction,
  ): Promise<AuthorizeNetConfig | null> {
    return this.hotelConfigurationRepository.findAuthorizenetConfigByHotelId(
      hotelId,
      trx,
    );
  }

  /**
   * Returns the hotel's live PMS credential (`external_auth_config`), or null if
   * none is set. `apiToken` is returned encrypted — decrypt before use.
   */
  public async getExternalAuthConfigByHotelId(
    hotelId: string,
    trx?: Knex.Transaction,
  ): Promise<ExternalAuthConfig | null> {
    return this.hotelConfigurationRepository.findExternalAuthConfigByHotelId(
      hotelId,
      trx,
    );
  }

  /**
   * Writes an already-encrypted API token into the hotel's `external_auth_config`.
   */
  public async updateExternalAuthConfigApiTokenByHotelId(
    hotelId: string,
    encryptedApiToken: string,
    trx?: Knex.Transaction,
  ): Promise<number> {
    try {
      return await this.hotelConfigurationRepository.updateExternalAuthConfigApiTokenByHotelId(
        hotelId,
        encryptedApiToken,
        trx,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `updateExternalAuthConfigApiTokenByHotelId:: Error updating external auth config for hotel ID ${hotelId}:`,
        errorMessage,
      );
      throw error;
    }
  }

  /**
   * Sets or clears the disabled marker in the hotel's `external_auth_config`.
   */
  public async setExternalAuthConfigDisabledAt(
    hotelId: string,
    disabledAt: Date | null,
    trx?: Knex.Transaction,
  ): Promise<number> {
    return this.hotelConfigurationRepository.setExternalAuthConfigDisabledAt(
      hotelId,
      disabledAt,
      trx,
    );
  }

  /**
   * Writes already-encrypted OAuth client credentials into the hotel's
   * `external_auth_config`, preserving other fields.
   */
  public async updateExternalAuthConfigOAuthCredentialsByHotelId(
    hotelId: string,
    encryptedClientId: string,
    encryptedClientSecret: string,
    trx?: Knex.Transaction,
  ): Promise<number> {
    try {
      return await this.hotelConfigurationRepository.updateExternalAuthConfigOAuthCredentialsByHotelId(
        hotelId,
        encryptedClientId,
        encryptedClientSecret,
        trx,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `updateExternalAuthConfigOAuthCredentialsByHotelId:: Error updating OAuth credentials for hotel ID ${hotelId}:`,
        errorMessage,
      );
      throw error;
    }
  }

  public async updateExternalAuthConfigCloudbedsPaymentSdkByHotelId(
    hotelId: string,
    sdkConfig: CloudbedsPaymentSdkConfig,
    trx?: Knex.Transaction,
  ): Promise<number> {
    try {
      return await this.hotelConfigurationRepository.updateExternalAuthConfigCloudbedsPaymentSdkByHotelId(
        hotelId,
        sdkConfig,
        trx,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `updateExternalAuthConfigCloudbedsPaymentSdkByHotelId:: Error updating Cloudbeds Payment SDK config for hotel ID ${hotelId}:`,
        errorMessage,
      );
      throw error;
    }
  }

  /**
   * Fetches all hotel configurations
   * @param trx Optional database transaction
   * @returns Promise with an array of hotel configurations
   */
  public async getAllHotelConfigurations(
    trx?: Knex.Transaction,
  ): Promise<HotelConfiguration[]> {
    try {
      logger.info(
        'getAllHotelConfigurations:: Fetching all hotel configurations',
      );
      const configurations =
        await this.hotelConfigurationRepository.findAll(trx);

      logger.info(
        `getAllHotelConfigurations:: Found ${configurations.length} configurations`,
      );
      return configurations;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `getAllHotelConfigurations:: Error fetching configurations:`,
        errorMessage,
      );
      throw error;
    }
  }

  /**
   * Updates hotel configuration by ID
   * @param id The configuration ID
   * @param data The update data
   * @param trx Optional database transaction
   * @returns Promise with the updated hotel configuration
   */
  public async updateHotelConfiguration(
    id: number,
    data: UpdateHotelConfigurationRequest,
    trx?: Knex.Transaction,
  ): Promise<HotelConfiguration> {
    try {
      if (!id) {
        throw new BadRequestError(
          'updateHotelConfiguration:: Configuration ID is required',
        );
      }

      const existing = await this.hotelConfigurationRepository.findById(
        id,
        trx,
      );
      if (!existing) {
        throw new NoDataError(
          `updateHotelConfiguration:: No configuration found with ID: ${id}`,
        );
      }

      logger.info(
        `updateHotelConfiguration:: Updating configuration with ID: ${id}`,
      );
      const updated = await this.hotelConfigurationRepository.update(
        id,
        data,
        trx,
      );

      if (!updated) {
        throw new Error(
          `updateHotelConfiguration:: Failed to update configuration with ID: ${id}`,
        );
      }

      logger.info(
        `updateHotelConfiguration:: Successfully updated configuration with ID: ${id}`,
      );
      return updated;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `updateHotelConfiguration:: Error updating configuration:`,
        errorMessage,
      );
      throw error;
    }
  }

  /**
   * Updates hotel configuration by hotel ID
   * @param hotelId The hotel ID
   * @param data The update data
   * @param trx Optional database transaction
   * @returns Promise with the updated hotel configuration
   */
  public async updateHotelConfigurationByHotelId(
    hotelId: string,
    data: UpdateHotelConfigurationRequest,
    trx?: Knex.Transaction,
  ): Promise<HotelConfiguration> {
    try {
      if (!hotelId) {
        throw new BadRequestError(
          'updateHotelConfigurationByHotelId:: Hotel ID is required',
        );
      }

      const existing = await this.hotelConfigurationRepository.findByHotelId(
        hotelId,
        trx,
      );
      if (!existing) {
        throw new NoDataError(
          `updateHotelConfigurationByHotelId:: No configuration found for hotel ID: ${hotelId}`,
        );
      }

      logger.info(
        `updateHotelConfigurationByHotelId:: Updating configuration for hotel ID: ${hotelId}`,
      );
      const updateData: UpdateHotelConfigurationRequest = {
        payment_configuration: {
          ...(typeof existing.payment_configuration === 'string'
            ? JSON.parse(existing.payment_configuration)
            : existing.payment_configuration || ({} as PaymentConfiguration)),
          ...data.payment_configuration,
        },
        same_day_booking_configuration: _.merge(
          {},
          typeof existing.same_day_booking_configuration === 'string'
            ? JSON.parse(existing.same_day_booking_configuration)
            : existing.same_day_booking_configuration,
          data.same_day_booking_configuration,
        ),
        onboarding_sms_configuration: _.merge(
          {},
          typeof existing.onboarding_sms_configuration === 'string'
            ? JSON.parse(existing.onboarding_sms_configuration)
            : existing.onboarding_sms_configuration,
          data.onboarding_sms_configuration,
        ),
        ...(data.last_daily_message !== undefined && {
          last_daily_message: data.last_daily_message,
        }),
        ...(data.discount_settings !== undefined && {
          discount_settings: data.discount_settings,
        }),
        ...(data.cancellation_policy !== undefined && {
          cancellation_policy: data.cancellation_policy,
        }),
        ...(data.platform_fee_settings !== undefined && {
          platform_fee_settings: data.platform_fee_settings,
        }),
        ...(data.sms_agent_enabled !== undefined && {
          sms_agent_enabled: data.sms_agent_enabled,
        }),
        ...(data.negative_sentiment_followup_enabled !== undefined && {
          negative_sentiment_followup_enabled:
            data.negative_sentiment_followup_enabled,
        }),
        ...(data.terms_and_policy_config !== undefined && {
          terms_and_policy_config: _.merge(
            {},
            typeof existing.terms_and_policy_config === 'string'
              ? JSON.parse(existing.terms_and_policy_config)
              : (existing.terms_and_policy_config ?? {}),
            data.terms_and_policy_config,
          ),
        }),
        ...(data.length_of_stay_discount_policy !== undefined && {
          length_of_stay_discount_policy: data.length_of_stay_discount_policy,
        }),
        ...(data.pet_fee_configuration !== undefined && {
          pet_fee_configuration: data.pet_fee_configuration,
        }),
        ...(data.pet_policy_configuration !== undefined && {
          pet_policy_configuration: data.pet_policy_configuration,
        }),
        ...(data.initial_deposit_policy !== undefined && {
          initial_deposit_policy: data.initial_deposit_policy,
        }),
        ...(data.reservation_date_policy !== undefined && {
          reservation_date_policy: data.reservation_date_policy,
        }),
        ...(data.processing_fee_percentage !== undefined && {
          processing_fee_percentage: data.processing_fee_percentage,
        }),
        ...(data.transcript_agent_url !== undefined && {
          transcript_agent_url: data.transcript_agent_url,
        }),
        ...(data.escalation_agent_url !== undefined && {
          escalation_agent_url: data.escalation_agent_url,
        }),
        ...(data.rate_code_config !== undefined && {
          rate_code_config: data.rate_code_config,
        }),
        ...(data.call_forwarding_configuration !== undefined && {
          call_forwarding_configuration: this.assignRuleIds(
            data.call_forwarding_configuration,
          ),
        }),
        ...(data.escalation_report_configuration !== undefined && {
          escalation_report_configuration: data.escalation_report_configuration,
        }),
        ...(data.enable_manager_barge_in !== undefined && {
          enable_manager_barge_in: data.enable_manager_barge_in,
        }),
        ...(data.manager_routing_timeout_seconds !== undefined && {
          manager_routing_timeout_seconds: data.manager_routing_timeout_seconds,
        }),
        ...(data.followup_payment_link_configuration !== undefined && {
          followup_payment_link_configuration:
            data.followup_payment_link_configuration,
        }),
        ...(data.dextr_pms_source_id !== undefined && {
          dextr_pms_source_id: data.dextr_pms_source_id,
        }),
        ...(data.twilio_configuration !== undefined && {
          twilio_configuration: data.twilio_configuration,
        }),
        ...(data.payment_account_id !== undefined && {
          payment_account_id: data.payment_account_id,
        }),
        // Shallow merge: door_lock_config holds settings for separate features
        // (Alfred door codes, the lockbox log), so updating one must not drop
        // the others. `lockbox_log: null` clears just the log; a null
        // door_lock_config clears everything.
        ...(data.door_lock_config !== undefined && {
          door_lock_config:
            data.door_lock_config === null
              ? null
              : { ...existing.door_lock_config, ...data.door_lock_config },
        }),
        // Replaced whole, not merged: the sister list is ordered, and a merge
        // could not remove a sister hotel.
        ...(data.cross_sell_configuration !== undefined && {
          cross_sell_configuration: data.cross_sell_configuration,
        }),
      };

      const updated = await this.hotelConfigurationRepository.updateByHotelId(
        hotelId,
        updateData,
        trx,
      );

      if (!updated) {
        throw new Error(
          `updateHotelConfigurationByHotelId:: Failed to update configuration for hotel ID: ${hotelId}`,
        );
      }

      logger.info(
        `updateHotelConfigurationByHotelId:: Successfully updated configuration for hotel ID: ${hotelId}`,
      );

      this.triggerVapiStructuredOutputSync(hotelId, updated);

      return updated;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `updateHotelConfigurationByHotelId:: Error updating configuration:`,
        errorMessage,
      );
      throw error;
    }
  }

  /**
   * Deletes hotel configuration by ID
   * @param id The configuration ID
   * @param trx Optional database transaction
   * @returns Promise with boolean indicating success
   */
  public async deleteHotelConfiguration(
    id: number,
    trx?: Knex.Transaction,
  ): Promise<boolean> {
    try {
      if (!id) {
        throw new BadRequestError(
          'deleteHotelConfiguration:: Configuration ID is required',
        );
      }

      const existing = await this.hotelConfigurationRepository.findById(
        id,
        trx,
      );
      if (!existing) {
        throw new NoDataError(
          `deleteHotelConfiguration:: No configuration found with ID: ${id}`,
        );
      }

      logger.info(
        `deleteHotelConfiguration:: Soft deleting configuration with ID: ${id}`,
      );
      const deleted = await this.hotelConfigurationRepository.delete(id, trx);

      if (deleted) {
        logger.info(
          `deleteHotelConfiguration:: Successfully soft deleted configuration with ID: ${id}`,
        );
      }

      return deleted;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `deleteHotelConfiguration:: Error deleting configuration:`,
        errorMessage,
      );
      throw error;
    }
  }

  /**
   * Deletes hotel configuration by hotel ID
   * @param hotelId The hotel ID
   * @param trx Optional database transaction
   * @returns Promise with boolean indicating success
   */
  public async deleteHotelConfigurationByHotelId(
    hotelId: string,
    trx?: Knex.Transaction,
  ): Promise<boolean> {
    try {
      if (!hotelId) {
        throw new BadRequestError(
          'deleteHotelConfigurationByHotelId:: Hotel ID is required',
        );
      }

      const existing = await this.hotelConfigurationRepository.findByHotelId(
        hotelId,
        trx,
      );
      if (!existing) {
        throw new NoDataError(
          `deleteHotelConfigurationByHotelId:: No configuration found for hotel ID: ${hotelId}`,
        );
      }

      logger.info(
        `deleteHotelConfigurationByHotelId:: Soft deleting configuration for hotel ID: ${hotelId}`,
      );
      const deleted = await this.hotelConfigurationRepository.deleteByHotelId(
        hotelId,
        trx,
      );

      if (deleted) {
        logger.info(
          `deleteHotelConfigurationByHotelId:: Successfully soft deleted configuration for hotel ID: ${hotelId}`,
        );
      }

      return deleted;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `deleteHotelConfigurationByHotelId:: Error deleting configuration:`,
        errorMessage,
      );
      throw error;
    }
  }
}

const hotelConfigurationRepository = new HotelConfigurationRepository();
export const hotelConfigurationService = new HotelConfigurationService(
  hotelConfigurationRepository,
);
