#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'migrations');

// Pre-existing duplicate-prefix pairs, already applied in prod — grandfathered so this
// check doesn't fail on old history. Renaming these files would desync the
// `knex_migrations` tracking table in environments where they've already run, so they
// stay as-is. Any *new* file added under one of these prefixes (a third file, or a
// change to the pair itself) still fails the check.
const GRANDFATHERED_DUPLICATES = {
  '008': ['008_add_telegram_chatId_to_hotels.ts', '008_create_conversation_table.ts'],
  '009': ['009_create_conversation_messages_table.ts', '009_create_escalations_table.ts'],
  '018': ['018_add_assistant_phone_number_to_hotel.ts', '018_create_user_table.ts'],
  '026': ['026_add_intent_to_conversation.ts', '026_add_type_to_session.ts'],
  '105': [
    '105_add_city_to_addresses.ts',
    '105_add_negative_sentiment_followup_enabled_to_hotel_configurations.ts',
  ],
  '119': [
    '119_add_payment_link_disabled_to_payments.ts',
    '119_add_sms_inbox_activity_to_sessions.ts',
  ],
  '120': ['120_add_metadata_to_sessions.ts', '120_add_rate_code_to_reservations.ts'],
  '121': [
    '121_add_call_forwarding_configuration_to_hotel_configurations.ts',
    '121_remove_payment_provider_defaults.ts',
  ],
  '143': [
    '143_add_payment_account_id_to_hotel_configurations.ts',
    '143_fix_reservations_external_id_unique_constraint.ts',
  ],
};

const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /\.(ts|js)$/.test(f));

const byPrefix = new Map();
let hasErrors = false;

for (const file of files) {
  const match = file.match(/^(\d+)_/);
  if (!match) {
    console.error(`Migration file missing numeric prefix: ${file}`);
    hasErrors = true;
    continue;
  }
  const prefix = match[1];
  if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
  byPrefix.get(prefix).push(file);
}

for (const [prefix, group] of byPrefix) {
  if (group.length <= 1) continue;

  const grandfathered = GRANDFATHERED_DUPLICATES[prefix] || [];
  const newFiles = group.filter((f) => !grandfathered.includes(f));

  if (newFiles.length > 0) {
    hasErrors = true;
    console.error(`Duplicate migration number "${prefix}":`);
    group.forEach((f) => {
      const tag = grandfathered.includes(f) ? '(pre-existing)' : '(new)';
      console.error(`  - ${f} ${tag}`);
    });
  }
}

if (hasErrors) {
  console.error(
    '\nTwo or more migrations share the same numeric prefix. Knex runs migrations in filename-alphabetical order, ' +
      'so a duplicate prefix means the run order depends on the suffix text rather than intent — rename the new ' +
      'file to the next unused number.'
  );
  process.exit(1);
}

console.log(`OK - ${files.length} migrations, no new duplicate numeric prefixes.`);
