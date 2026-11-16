import { Knex } from 'knex';
import {
  CreateHotelConfigurationRequest,
  UpdateHotelConfigurationRequest,
} from '../dtos/HotelConfiguration';
import { HotelConfiguration } from '../models/HotelConfiguration';
import { GetRateResponse } from '../stayntouch/types/GetRateResponse';
import {
  AuthorizeNetConfig,
  CloudbedsPaymentSdkConfig,
  CrossSellConfiguration,
  DoorLockConfig,
  ExternalAuthConfig,
  PaymentConfiguration,
  SameDayBookingConfiguration,
  ThreeDSConfig,
  TwilioConfiguration,
} from '../types/hotelConfiguration';
import { decrypt, encrypt } from '../utils/encryption';
import logger from '../utils/logger';
import { BaseRepository } from './BaseRepository';

export function hydrateHotelConfigurationRow(
  row: HotelConfiguration,
): HotelConfiguration {
  if (
    row.twilio_configuration &&
    typeof row.twilio_configuration === 'string'
  ) {
    row.twilio_configuration = JSON.parse(
      decrypt(row.twilio_configuration),
    ) as TwilioConfiguration;
  }
  // Written with JSON.stringify and normally returned parsed by the jsonb driver,
  // but consumers destructure it directly — a raw string reads as all-undefined
  // and silently disables the same-day rules.
  if (
    row.same_day_booking_configuration &&
    typeof row.same_day_booking_configuration === 'string'
  ) {
    row.same_day_booking_configuration = JSON.parse(
      row.same_day_booking_configuration,
    ) as SameDayBookingConfiguration;
  }
  if (row.threeDS_config && typeof row.threeDS_config === 'string') {
    row.threeDS_config = JSON.parse(row.threeDS_config) as ThreeDSConfig;
  }
  if (row.door_lock_config && typeof row.door_lock_config === 'string') {
    row.door_lock_config = JSON.parse(row.door_lock_config) as DoorLockConfig;
  }
  if (
    row.payment_configuration &&
    typeof row.payment_configuration === 'string'
  ) {
    row.payment_configuration = JSON.parse(
      row.payment_configuration,
    ) as PaymentConfiguration;
  }
  if (
    row.cross_sell_configuration &&
    typeof row.cross_sell_configuration === 'string'
  ) {
    row.cross_sell_configuration = JSON.parse(
      row.cross_sell_configuration,
    ) as CrossSellConfiguration;
  }
  return row;
}

export class HotelConfigurationRepository extends BaseRepository {
  private tableName = 'hotel_configurations';

  async create(
    data: CreateHotelConfigurationRequest,
    trx?: Knex.Transaction,
  ): Promise<HotelConfiguration> {
    const dbInstance = trx || this.db;
    const [result] = await dbInstance(this.tableName)
      .insert({
        hotel_id: data.hotel_id,
        payment_configuration: data.payment_configuration
          ? JSON.stringify(data.payment_configuration)
          : null,
        same_day_booking_configuration: data.same_day_booking_configuration
          ? JSON.stringify(data.same_day_booking_configuration)
          : null,
        reservation_date_policy: data.reservation_date_policy
          ? JSON.stringify(data.reservation_date_policy)
          : null,
        onboarding_sms_configuration: data.onboarding_sms_configuration
          ? JSON.stringify(data.onboarding_sms_configuration)
          : null,
        terms_and_policy_config: data.terms_and_policy_config
          ? JSON.stringify(data.terms_and_policy_config)
          : null,
        length_of_stay_discount_policy: data.length_of_stay_discount_policy
          ? JSON.stringify(data.length_of_stay_discount_policy)
          : null,
        pet_fee_configuration: data.pet_fee_configuration
          ? JSON.stringify(data.pet_fee_configuration)
          : null,
        pet_policy_configuration: data.pet_policy_configuration
          ? JSON.stringify(data.pet_policy_configuration)
          : null,
        initial_deposit_policy: data.initial_deposit_policy
          ? JSON.stringify(data.initial_deposit_policy)
          : null,
        processing_fee_percentage: data.processing_fee_percentage ?? null,
        manager_routing_timeout_seconds:
          data.manager_routing_timeout_seconds ?? null,
        transcript_agent_url: data.transcript_agent_url ?? null,
        escalation_agent_url: data.escalation_agent_url ?? null,
        rate_code_config: data.rate_code_config
          ? JSON.stringify(data.rate_code_config)
          : null,
        call_forwarding_configuration: data.call_forwarding_configuration
          ? JSON.stringify(data.call_forwarding_configuration)
          : null,
        escalation_report_configuration: data.escalation_report_configuration
          ? JSON.stringify(data.escalation_report_configuration)
          : null,
        followup_payment_link_configuration:
          data.followup_payment_link_configuration
            ? JSON.stringify(data.followup_payment_link_configuration)
            : null,
        dextr_pms_source_id: data.dextr_pms_source_id ?? null,
        twilio_configuration: data.twilio_configuration
          ? encrypt(JSON.stringify(data.twilio_configuration))
          : null,
        payment_account_id: data.payment_account_id ?? null,
        threeDS_config: data.threeDS_config
          ? JSON.stringify(data.threeDS_config)
          : null,
        door_lock_config: data.door_lock_config
          ? JSON.stringify(data.door_lock_config)
          : null,
        cross_sell_configuration: data.cross_sell_configuration
          ? JSON.stringify(data.cross_sell_configuration)
          : null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('*');

    return hydrateHotelConfigurationRow(result);
  }

  async findById(
    id: number,
    trx?: Knex.Transaction,
  ): Promise<HotelConfiguration | null> {
    const dbInstance = trx || this.db;
    const result = await dbInstance(this.tableName)
      .where({ id })
      .whereNull('deleted_at')
      .first();

    if (!result) return null;

    return hydrateHotelConfigurationRow(result);
  }

  async findByHotelId(
    hotelId: string,
    trx?: Knex.Transaction,
  ): Promise<HotelConfiguration | null> {
    const dbInstance = trx || this.db;
    const result = await dbInstance(this.tableName)
      .where({ hotel_id: hotelId })
      .whereNull('deleted_at')
      .first();

    if (!result) return null;

    return hydrateHotelConfigurationRow(result);
  }

  async findAll(trx?: Knex.Transaction): Promise<HotelConfiguration[]> {
    const dbInstance = trx || this.db;
    const results = await dbInstance(this.tableName)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc');

    return results.map((row: HotelConfiguration) =>
      hydrateHotelConfigurationRow(row),
    );
  }

  async update(
    id: number,
    data: UpdateHotelConfigurationRequest,
    trx?: Knex.Transaction,
  ): Promise<HotelConfiguration | null> {
    const dbInstance = trx || this.db;
    const updateData = {
      ...(data.payment_configuration !== undefined && {
        payment_configuration: data.payment_configuration
          ? JSON.stringify(data.payment_configuration)
          : null,
      }),
      ...(data.same_day_booking_configuration !== undefined && {
        same_day_booking_configuration: data.same_day_booking_configuration
          ? JSON.stringify(data.same_day_booking_configuration)
          : null,
      }),
      ...(data.reservation_date_policy !== undefined && {
        reservation_date_policy: data.reservation_date_policy
          ? JSON.stringify(data.reservation_date_policy)
          : null,
      }),
      ...(data.onboarding_sms_configuration !== undefined && {
        onboarding_sms_configuration: data.onboarding_sms_configuration
          ? JSON.stringify(data.onboarding_sms_configuration)
          : null,
      }),
      ...(data.last_daily_message !== undefined && {
        last_daily_message: data.last_daily_message
          ? JSON.stringify(data.last_daily_message)
          : null,
      }),
      ...(data.discount_settings !== undefined && {
        discount_settings: data.discount_settings
          ? JSON.stringify(data.discount_settings)
          : null,
      }),
      ...(data.cancellation_policy !== undefined && {
        cancellation_policy: data.cancellation_policy
          ? JSON.stringify(data.cancellation_policy)
          : null,
      }),
      ...(data.platform_fee_settings !== undefined && {
        platform_fee_settings: data.platform_fee_settings
          ? JSON.stringify(data.platform_fee_settings)
          : null,
      }),
      ...(data.sms_agent_enabled !== undefined && {
        sms_agent_enabled: data.sms_agent_enabled,
      }),
      ...(data.enable_manager_barge_in !== undefined && {
        enable_manager_barge_in: data.enable_manager_barge_in,
      }),
      ...(data.manager_routing_timeout_seconds !== undefined && {
        manager_routing_timeout_seconds: data.manager_routing_timeout_seconds,
      }),
      ...(data.terms_and_policy_config !== undefined && {
        terms_and_policy_config:
          data.terms_and_policy_config == null
            ? null
            : typeof data.terms_and_policy_config === 'string'
              ? data.terms_and_policy_config
              : JSON.stringify(data.terms_and_policy_config),
      }),
      ...(data.length_of_stay_discount_policy !== undefined && {
        length_of_stay_discount_policy: data.length_of_stay_discount_policy
          ? JSON.stringify(data.length_of_stay_discount_policy)
          : null,
      }),
      ...(data.pet_fee_configuration !== undefined && {
        pet_fee_configuration: data.pet_fee_configuration
          ? JSON.stringify(data.pet_fee_configuration)
          : null,
      }),
      ...(data.pet_policy_configuration !== undefined && {
        pet_policy_configuration: data.pet_policy_configuration
          ? JSON.stringify(data.pet_policy_configuration)
          : null,
      }),
      ...(data.initial_deposit_policy !== undefined && {
        initial_deposit_policy: data.initial_deposit_policy
          ? JSON.stringify(data.initial_deposit_policy)
          : null,
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
        rate_code_config: data.rate_code_config
          ? JSON.stringify(data.rate_code_config)
          : null,
      }),
      ...(data.call_forwarding_configuration !== undefined && {
        call_forwarding_configuration: data.call_forwarding_configuration
          ? JSON.stringify(data.call_forwarding_configuration)
          : null,
      }),
      ...(data.escalation_report_configuration !== undefined && {
        escalation_report_configuration: data.escalation_report_configuration
          ? JSON.stringify(data.escalation_report_configuration)
          : null,
      }),
      ...(data.followup_payment_link_configuration !== undefined && {
        followup_payment_link_configuration:
          data.followup_payment_link_configuration
            ? JSON.stringify(data.followup_payment_link_configuration)
            : null,
      }),
      ...(data.dextr_pms_source_id !== undefined && {
        dextr_pms_source_id: data.dextr_pms_source_id,
      }),
      ...(data.twilio_configuration !== undefined && {
        twilio_configuration: data.twilio_configuration
          ? encrypt(JSON.stringify(data.twilio_configuration))
          : null,
      }),
      ...(data.payment_account_id !== undefined && {
        payment_account_id: data.payment_account_id,
      }),
      ...(data.threeDS_config !== undefined && {
        threeDS_config: data.threeDS_config
          ? JSON.stringify(data.threeDS_config)
          : null,
      }),
      ...(data.door_lock_config !== undefined && {
        door_lock_config: data.door_lock_config
          ? JSON.stringify(data.door_lock_config)
          : null,
      }),
      ...(data.cross_sell_configuration !== undefined && {
        cross_sell_configuration: data.cross_sell_configuration
          ? JSON.stringify(data.cross_sell_configuration)
          : null,
      }),
      updated_at: new Date(),
    };

    const [result] = await dbInstance(this.tableName)
      .where({ id })
      .whereNull('deleted_at')
      .update(updateData)
      .returning('*');

    if (!result) return null;

    return hydrateHotelConfigurationRow(result);
  }

  async updateByHotelId(
    hotelId: string,
    data: UpdateHotelConfigurationRequest,
    trx?: Knex.Transaction,
  ): Promise<HotelConfiguration | null> {
    const dbInstance = trx || this.db;
    const updateData = {
      ...(data.payment_configuration !== undefined && {
        payment_configuration: data.payment_configuration
          ? JSON.stringify(data.payment_configuration)
          : null,
      }),
      ...(data.same_day_booking_configuration !== undefined && {
        same_day_booking_configuration: data.same_day_booking_configuration
          ? JSON.stringify(data.same_day_booking_configuration)
          : null,
      }),
      ...(data.reservation_date_policy !== undefined && {
        reservation_date_policy: data.reservation_date_policy
          ? JSON.stringify(data.reservation_date_policy)
          : null,
      }),
      ...(data.onboarding_sms_configuration !== undefined && {
        onboarding_sms_configuration: data.onboarding_sms_configuration
          ? JSON.stringify(data.onboarding_sms_configuration)
          : null,
      }),
      ...(data.last_daily_message !== undefined && {
        last_daily_message: data.last_daily_message
          ? JSON.stringify(data.last_daily_message)
          : null,
      }),
      ...(data.discount_settings !== undefined && {
        discount_settings: data.discount_settings
          ? JSON.stringify(data.discount_settings)
          : null,
      }),
      ...(data.cancellation_policy !== undefined && {
        cancellation_policy: data.cancellation_policy
          ? JSON.stringify(data.cancellation_policy)
          : null,
      }),
      ...(data.platform_fee_settings !== undefined && {
        platform_fee_settings: data.platform_fee_settings
          ? JSON.stringify(data.platform_fee_settings)
          : null,
      }),
      ...(data.sms_agent_enabled !== undefined && {
        sms_agent_enabled: data.sms_agent_enabled,
      }),
      ...(data.enable_manager_barge_in !== undefined && {
        enable_manager_barge_in: data.enable_manager_barge_in,
      }),
      ...(data.manager_routing_timeout_seconds !== undefined && {
        manager_routing_timeout_seconds: data.manager_routing_timeout_seconds,
      }),
      ...(data.terms_and_policy_config !== undefined && {
        terms_and_policy_config:
          data.terms_and_policy_config == null
            ? null
            : typeof data.terms_and_policy_config === 'string'
              ? data.terms_and_policy_config
              : JSON.stringify(data.terms_and_policy_config),
      }),
      ...(data.length_of_stay_discount_policy !== undefined && {
        length_of_stay_discount_policy: data.length_of_stay_discount_policy
          ? JSON.stringify(data.length_of_stay_discount_policy)
          : null,
      }),
      ...(data.pet_fee_configuration !== undefined && {
        pet_fee_configuration: data.pet_fee_configuration
          ? JSON.stringify(data.pet_fee_configuration)
          : null,
      }),
      ...(data.pet_policy_configuration !== undefined && {
        pet_policy_configuration: data.pet_policy_configuration
          ? JSON.stringify(data.pet_policy_configuration)
          : null,
      }),
      ...(data.initial_deposit_policy !== undefined && {
        initial_deposit_policy: data.initial_deposit_policy
          ? JSON.stringify(data.initial_deposit_policy)
          : null,
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
        rate_code_config: data.rate_code_config
          ? JSON.stringify(data.rate_code_config)
          : null,
      }),
      ...(data.call_forwarding_configuration !== undefined && {
        call_forwarding_configuration: data.call_forwarding_configuration
          ? JSON.stringify(data.call_forwarding_configuration)
          : null,
      }),
      ...(data.escalation_report_configuration !== undefined && {
        escalation_report_configuration: data.escalation_report_configuration
          ? JSON.stringify(data.escalation_report_configuration)
          : null,
      }),
      ...(data.followup_payment_link_configuration !== undefined && {
        followup_payment_link_configuration:
          data.followup_payment_link_configuration
            ? JSON.stringify(data.followup_payment_link_configuration)
            : null,
      }),
      ...(data.dextr_pms_source_id !== undefined && {
        dextr_pms_source_id: data.dextr_pms_source_id,
      }),
      ...(data.twilio_configuration !== undefined && {
        twilio_configuration: data.twilio_configuration
          ? encrypt(JSON.stringify(data.twilio_configuration))
          : null,
      }),
      ...(data.payment_account_id !== undefined && {
        payment_account_id: data.payment_account_id,
      }),
      ...(data.threeDS_config !== undefined && {
        threeDS_config: data.threeDS_config
          ? JSON.stringify(data.threeDS_config)
          : null,
      }),
      ...(data.door_lock_config !== undefined && {
        door_lock_config: data.door_lock_config
          ? JSON.stringify(data.door_lock_config)
          : null,
      }),
      ...(data.cross_sell_configuration !== undefined && {
        cross_sell_configuration: data.cross_sell_configuration
          ? JSON.stringify(data.cross_sell_configuration)
          : null,
      }),
      updated_at: new Date(),
    };

    const [result] = await dbInstance(this.tableName)
      .where({ hotel_id: hotelId })
      .whereNull('deleted_at')
      .update(updateData)
      .returning('*');

    if (!result) return null;

    return hydrateHotelConfigurationRow(result);
  }

  async delete(id: number, trx?: Knex.Transaction): Promise<boolean> {
    const dbInstance = trx || this.db;
    const count = await dbInstance(this.tableName)
      .where({ id })
      .whereNull('deleted_at')
      .update({
        deleted_at: new Date(),
        updated_at: new Date(),
      });
    return count > 0;
  }

  async deleteByHotelId(
    hotelId: string,
    trx?: Knex.Transaction,
  ): Promise<boolean> {
    const dbInstance = trx || this.db;
    const count = await dbInstance(this.tableName)
      .where({ hotel_id: hotelId })
      .whereNull('deleted_at')
      .update({
        deleted_at: new Date(),
        updated_at: new Date(),
      });
    return count > 0;
  }

  /**
   * Returns only the `transcript_agent_url` for a specific hotel, avoiding a
   * full-row fetch on the per-SMS transcript-sync path.
   */
  async findTranscriptAgentUrlByHotelId(
    hotelId: string,
    trx?: Knex.Transaction,
  ): Promise<string | null> {
    const dbInstance = trx || this.db;
    const row = await dbInstance(this.tableName)
      .where({ hotel_id: hotelId })
      .whereNull('deleted_at')
      .first('transcript_agent_url');

    return row?.transcript_agent_url ?? null;
  }

  /**
   * Returns only the `escalation_agent_url` for a specific hotel, avoiding a
   * full-row fetch on the manager-reply escalation path.
   */
  async findEscalationAgentUrlByHotelId(
    hotelId: string,
    trx?: Knex.Transaction,
  ): Promise<string | null> {
    const dbInstance = trx || this.db;
    const row = await dbInstance(this.tableName)
      .where({ hotel_id: hotelId })
      .whereNull('deleted_at')
      .first('escalation_agent_url');

    return row?.escalation_agent_url ?? null;
  }

  async findTwilioConfigurationByHotelId(
    hotelId: string,
    trx?: Knex.Transaction,
  ): Promise<TwilioConfiguration | null> {
    const dbInstance = trx || this.db;
    const row = await dbInstance(this.tableName)
      .where({ hotel_id: hotelId })
      .whereNull('deleted_at')
      .whereNotNull('twilio_configuration')
      .first('twilio_configuration');

    if (!row?.twilio_configuration) return null;

    return JSON.parse(
      decrypt(row.twilio_configuration as string),
    ) as TwilioConfiguration;
  }

  /**
   * Returns the `payment_account_id` for a specific hotel, avoiding a
   * full-row fetch on the auto-charge and payment link paths.
   */
  async findPaymentAccountIdByHotelId(
    hotelId: string,
    trx?: Knex.Transaction,
  ): Promise<string | null> {
    const dbInstance = trx || this.db;
    const row = await dbInstance(this.tableName)
      .where({ hotel_id: hotelId })
      .whereNull('deleted_at')
      .first('payment_account_id');

    return row?.payment_account_id ?? null;
  }

  /**
   * Returns the raw (encrypted) `api_token` for a specific hotel configuration.
   */
  async findApiTokenByHotelId(
    hotelId: string,
    trx?: Knex.Transaction,
  ): Promise<string | null> {
    const dbInstance = trx || this.db;
    const row = await dbInstance(this.tableName)
      .where({ hotel_id: hotelId })
      .whereNull('deleted_at')
      .whereNotNull('api_token')
      .first('api_token');

    return row?.api_token ?? null;
  }

  /**
   * Writes an encrypted token into the active hotel_configurations row
   * for a specific hotel.
   *
   * @returns Number of rows updated.
   */
  async updateApiTokenByHotelId(
    hotelId: string,
    encryptedToken: string,
    trx?: Knex.Transaction,
  ): Promise<number> {
    const dbInstance = trx || this.db;
    return dbInstance(this.tableName)
      .where({ hotel_id: hotelId })
      .whereNull('deleted_at')
      .update({ api_token: encryptedToken, updated_at: new Date() });
  }

  /**
   * Real Postgres (via the `pg` driver) parses jsonb columns into objects
   * automatically; pg-mem returns the raw stored string instead.
   */
  private parseExternalAuthConfig(value: unknown): ExternalAuthConfig | null {
    if (!value) {
      return null;
    }
    return typeof value === 'string'
      ? JSON.parse(value)
      : (value as ExternalAuthConfig);
  }

  /**
   * Returns the hotel's `external_auth_config` (the live PMS credential — see
   * `ExternalAuthConfig`), or null if none is set. `apiToken` is returned as
   * stored (encrypted); decryption is the caller's responsibility.
   */
  async findExternalAuthConfigByHotelId(
    hotelId: string,
    trx?: Knex.Transaction,
  ): Promise<ExternalAuthConfig | null> {
    const dbInstance = trx || this.db;
    const row = await dbInstance(this.tableName)
      .where({ hotel_id: hotelId })
      .whereNull('deleted_at')
      .first('external_auth_config');

    return this.parseExternalAuthConfig(row?.external_auth_config);
  }

  /**
   * Writes an already-encrypted API token into `external_auth_config`, preserving
   * any other fields already stored there. Clears `disabledAt` (re-enables the
   * integration) since storing a fresh token means the credential is valid again.
   * Reads and writes happen inside one transaction with a row lock (`FOR UPDATE`)
   * so a concurrent update to the same hotel's config can't be silently
   * overwritten.
   *
   * @returns Number of rows updated.
   */
  async updateExternalAuthConfigApiTokenByHotelId(
    hotelId: string,
    encryptedApiToken: string,
    trx?: Knex.Transaction,
  ): Promise<number> {
    const run = async (activeTrx: Knex.Transaction): Promise<number> => {
      const row = await activeTrx(this.tableName)
        .where({ hotel_id: hotelId })
        .whereNull('deleted_at')
        .forUpdate()
        .first('external_auth_config');

      const existing = this.parseExternalAuthConfig(row?.external_auth_config);
      const externalAuthConfig: ExternalAuthConfig = {
        ...existing,
        apiToken: encryptedApiToken,
        disabledAt: null,
      };

      return activeTrx(this.tableName)
        .where({ hotel_id: hotelId })
        .whereNull('deleted_at')
        .update({
          external_auth_config: JSON.stringify(externalAuthConfig),
          updated_at: new Date(),
        });
    };

    try {
      return await (trx ? run(trx) : this.db.transaction(run));
    } catch (error) {
      logger.error(
        `updateExternalAuthConfigApiTokenByHotelId: Failed to update external_auth_config for hotel ID ${hotelId}. Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  /**
   * Sets or clears the disabled marker in `external_auth_config`, preserving the
   * existing `apiToken`. Pass a `Date` when the integration is reported
   * disabled; pass `null` to clear it on re-enable. No-ops if the hotel has
   * no `external_auth_config` yet (nothing to disable). Reads and writes happen
   * inside one transaction with a row lock (`FOR UPDATE`) so a concurrent
   * update to the same hotel's config can't be silently overwritten.
   *
   * @returns Number of rows updated.
   */
  async setExternalAuthConfigDisabledAt(
    hotelId: string,
    disabledAt: Date | null,
    trx?: Knex.Transaction,
  ): Promise<number> {
    const run = async (activeTrx: Knex.Transaction): Promise<number> => {
      const row = await activeTrx(this.tableName)
        .where({ hotel_id: hotelId })
        .whereNull('deleted_at')
        .forUpdate()
        .first('external_auth_config');

      const existing = this.parseExternalAuthConfig(row?.external_auth_config);
      if (!existing) {
        return 0;
      }

      const externalAuthConfig: ExternalAuthConfig = {
        ...existing,
        disabledAt: disabledAt ? disabledAt.toISOString() : null,
      };

      return activeTrx(this.tableName)
        .where({ hotel_id: hotelId })
        .whereNull('deleted_at')
        .update({
          external_auth_config: JSON.stringify(externalAuthConfig),
          updated_at: new Date(),
        });
    };

    return trx ? run(trx) : this.db.transaction(run);
  }

  /**
   * Returns every active hotel that has a RemoteLock refresh token stored in
   * `external_auth_config` — i.e. the hotels the refresh job has anything to
   * do. There is no env-var list of RemoteLock hotels: a hotel becomes one
   * only once someone pastes its token pair into this column.
   */
  async findHotelIdsWithRemoteLockRefreshToken(
    trx?: Knex.Transaction,
  ): Promise<string[]> {
    const dbInstance = trx || this.db;
    const rows = await dbInstance(this.tableName)
      .whereNull('deleted_at')
      .whereRaw("external_auth_config->>'remotelock_refresh_token' IS NOT NULL")
      .select('hotel_id');

    return rows.map((row: { hotel_id: string }) => row.hotel_id);
  }

  /**
   * Writes the new RemoteLock access token and rotated refresh token into
   * `external_auth_config` in one update, so a mid-write failure can never
   * leave the DB holding the new access token alongside the now-invalidated
   * old refresh token (which would strand the hotel until a manual reseed).
   *
   * Other fields already in the column (`apiToken`, `disabledAt`) are
   * preserved. Read and write happen inside one transaction with a row lock
   * (`FOR UPDATE`) so a concurrent update can't be silently overwritten.
   *
   * @returns Number of rows updated.
   */
  async updateExternalAuthConfigRemoteLockTokensByHotelId(
    hotelId: string,
    encryptedAccessToken: string,
    encryptedRefreshToken: string,
    trx?: Knex.Transaction,
  ): Promise<number> {
    const run = async (activeTrx: Knex.Transaction): Promise<number> => {
      const row = await activeTrx(this.tableName)
        .where({ hotel_id: hotelId })
        .whereNull('deleted_at')
        .forUpdate()
        .first('external_auth_config');

      const existing = this.parseExternalAuthConfig(row?.external_auth_config);
      const externalAuthConfig: ExternalAuthConfig = {
        ...existing,
        remotelock_access_token: encryptedAccessToken,
        remotelock_refresh_token: encryptedRefreshToken,
      };

      return activeTrx(this.tableName)
        .where({ hotel_id: hotelId })
        .whereNull('deleted_at')
        .update({
          external_auth_config: JSON.stringify(externalAuthConfig),
          updated_at: new Date(),
        });
    };

    return trx ? run(trx) : this.db.transaction(run);
  }

  /**
   * Writes an encrypted token into every active hotel_configurations row
   * whose hotel matches the given PMS provider.
   *
   * @returns Number of rows updated.
   */
  async updateApiTokenByPmsProvider(
    pmsProvider: string,
    encryptedToken: string,
    trx?: Knex.Transaction,
  ): Promise<number> {
    const dbInstance = trx || this.db;
    return dbInstance(this.tableName)
      .whereIn(
        'hotel_id',
        this.db('hotels').select('id').where('pms_provider', pmsProvider),
      )
      .whereNull('deleted_at')
      .update({ api_token: encryptedToken, updated_at: new Date() });
  }

  async findHotelRatesByHotelId(
    hotelId: string,
    trx?: Knex.Transaction,
  ): Promise<GetRateResponse[] | null> {
    const dbInstance = trx || this.db;
    const row = await dbInstance(this.tableName)
      .where({ hotel_id: hotelId })
      .whereNull('deleted_at')
      .whereNotNull('hotel_rates')
      .first('hotel_rates');

    if (!row?.hotel_rates) return null;

    try {
      const rates =
        typeof row.hotel_rates === 'string'
          ? JSON.parse(row.hotel_rates)
          : row.hotel_rates;

      return Array.isArray(rates) && rates.length > 0 ? rates : null;
    } catch {
      return null;
    }
  }

  async updateHotelRatesByHotelId(
    hotelId: string,
    rates: GetRateResponse[],
    trx?: Knex.Transaction,
  ): Promise<number> {
    const dbInstance = trx || this.db;
    return dbInstance(this.tableName)
      .where({ hotel_id: hotelId })
      .whereNull('deleted_at')
      .update({
        hotel_rates: JSON.stringify(rates),
        updated_at: new Date(),
      });
  }

  private parseAuthorizenetConfig(value: unknown): AuthorizeNetConfig | null {
    if (!value) return null;
    const parsed: AuthorizeNetConfig =
      typeof value === 'string'
        ? JSON.parse(value)
        : (value as AuthorizeNetConfig);
    // A partial config (missing either encrypted token) is unusable — treat it
    // as "not connected" rather than letting decrypt() throw a cryptic error.
    if (!parsed?.accessToken || !parsed?.refreshToken) {
      return null;
    }
    return {
      ...parsed,
      accessToken: decrypt(parsed.accessToken),
      refreshToken: decrypt(parsed.refreshToken),
    };
  }

  async findAuthorizenetConfigByHotelId(
    hotelId: string,
    trx?: Knex.Transaction,
  ): Promise<AuthorizeNetConfig | null> {
    const dbInstance = trx || this.db;
    const row = await dbInstance(this.tableName)
      .where({ hotel_id: hotelId })
      .whereNull('deleted_at')
      .first('external_auth_config');

    if (!row?.external_auth_config) return null;
    const externalConfig =
      typeof row.external_auth_config === 'string'
        ? JSON.parse(row.external_auth_config)
        : row.external_auth_config;

    return this.parseAuthorizenetConfig(externalConfig.authorizeNet);
  }

  async updateAuthorizenetConfigByHotelId(
    hotelId: string,
    authnetConfig: AuthorizeNetConfig,
    trx?: Knex.Transaction,
  ): Promise<number> {
    const run = async (activeTrx: Knex.Transaction): Promise<number> => {
      const row = await activeTrx(this.tableName)
        .where({ hotel_id: hotelId })
        .whereNull('deleted_at')
        .forUpdate()
        .first('external_auth_config');

      const existing = row?.external_auth_config
        ? typeof row.external_auth_config === 'string'
          ? JSON.parse(row.external_auth_config)
          : row.external_auth_config
        : {};

      const encrypted: AuthorizeNetConfig = {
        ...authnetConfig,
        accessToken: encrypt(authnetConfig.accessToken),
        refreshToken: encrypt(authnetConfig.refreshToken),
      };

      const merged = { ...existing, authorizeNet: encrypted };

      return activeTrx(this.tableName)
        .where({ hotel_id: hotelId })
        .whereNull('deleted_at')
        .update({
          external_auth_config: JSON.stringify(merged),
          updated_at: new Date(),
        });
    };

    return trx ? run(trx) : this.db.transaction(run);
  }

  /**
   * Returns every active hotel that has OAuth client credentials stored in
   * `external_auth_config` and whose `hotels.pms_provider` matches the given
   * provider. Used by token refresh jobs to discover which hotels need a
   * credential exchange — no env-var hotel list required.
   */
  async findHotelIdsWithOAuthClientCredentials(
    pmsProvider: string,
    trx?: Knex.Transaction,
  ): Promise<string[]> {
    const dbInstance = trx || this.db;
    const rows = await dbInstance(this.tableName)
      .join('hotels', 'hotel_configurations.hotel_id', 'hotels.id')
      .where('hotels.pms_provider', pmsProvider)
      .whereNull('hotel_configurations.deleted_at')
      .whereRaw(
        "hotel_configurations.external_auth_config->>'oauth_client_id' IS NOT NULL",
      )
      .whereRaw(
        "hotel_configurations.external_auth_config->>'oauth_client_secret' IS NOT NULL",
      )
      .select('hotel_configurations.hotel_id');

    return rows.map((row: { hotel_id: string }) => row.hotel_id);
  }

  /**
   * Writes already-encrypted OAuth client credentials into `external_auth_config`,
   * preserving any other fields (`apiToken`, `disabledAt`, `remotelock_*`). Read
   * and write happen inside one transaction with a row lock (`FOR UPDATE`) so a
   * concurrent update can't be silently overwritten.
   *
   * @returns Number of rows updated.
   */
  async updateExternalAuthConfigOAuthCredentialsByHotelId(
    hotelId: string,
    encryptedClientId: string,
    encryptedClientSecret: string,
    trx?: Knex.Transaction,
  ): Promise<number> {
    const run = async (activeTrx: Knex.Transaction): Promise<number> => {
      const row = await activeTrx(this.tableName)
        .where({ hotel_id: hotelId })
        .whereNull('deleted_at')
        .forUpdate()
        .first('external_auth_config');

      const existing = this.parseExternalAuthConfig(row?.external_auth_config);
      const externalAuthConfig: ExternalAuthConfig = {
        ...existing,
        oauth_client_id: encryptedClientId,
        oauth_client_secret: encryptedClientSecret,
      };

      return activeTrx(this.tableName)
        .where({ hotel_id: hotelId })
        .whereNull('deleted_at')
        .update({
          external_auth_config: JSON.stringify(externalAuthConfig),
          updated_at: new Date(),
        });
    };

    return trx ? run(trx) : this.db.transaction(run);
  }

  async updateExternalAuthConfigCloudbedsPaymentSdkByHotelId(
    hotelId: string,
    sdkConfig: CloudbedsPaymentSdkConfig,
    trx?: Knex.Transaction,
  ): Promise<number> {
    const run = async (activeTrx: Knex.Transaction): Promise<number> => {
      const row = await activeTrx(this.tableName)
        .where({ hotel_id: hotelId })
        .whereNull('deleted_at')
        .forUpdate()
        .first('external_auth_config');

      const existing = this.parseExternalAuthConfig(row?.external_auth_config);
      const externalAuthConfig: ExternalAuthConfig = {
        ...existing,
        cloudbedsPaymentSdk: sdkConfig,
      };

      return activeTrx(this.tableName)
        .where({ hotel_id: hotelId })
        .whereNull('deleted_at')
        .update({
          external_auth_config: JSON.stringify(externalAuthConfig),
          updated_at: new Date(),
        });
    };

    return trx ? run(trx) : this.db.transaction(run);
  }
}
