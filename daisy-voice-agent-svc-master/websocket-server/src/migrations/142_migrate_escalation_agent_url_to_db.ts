import { Knex } from 'knex';

function parseEscalationAgentUrlConfig(): Record<string, string> {
  try {
    const parsed = JSON.parse(
      process.env.ESCALATION_AGENT_URL_CONFIG || '{}',
    ) as Record<string, unknown>;

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && entry[1] !== '',
      ),
    );
  } catch {
    return {};
  }
}

export async function up(knex: Knex): Promise<void> {
  const urlConfig = parseEscalationAgentUrlConfig();
  const hotelIds = Object.keys(urlConfig);

  if (hotelIds.length === 0) {
    return;
  }

  await knex.transaction(async (trx) => {
    const notFoundIds: string[] = [];

    for (const hotelId of hotelIds) {
      const updatedCount = await trx('hotel_configurations')
        .where({ hotel_id: hotelId })
        .whereNull('deleted_at')
        .update({
          escalation_agent_url: urlConfig[hotelId],
          updated_at: trx.fn.now(),
        });

      if (updatedCount === 0) {
        notFoundIds.push(hotelId);
      }
    }

    // Allow partial updates: dev/local DBs may not have all hotels seeded
    if (notFoundIds.length > 0) {
      console.warn(
        `Escalation agent URL migration: skipped ${notFoundIds.length} hotel(s) (no matching non-deleted row): ${notFoundIds.join(', ')}`,
      );
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  const hotelIds = Object.keys(parseEscalationAgentUrlConfig());

  if (hotelIds.length === 0) {
    return;
  }

  await knex('hotel_configurations')
    .whereIn('hotel_id', hotelIds)
    .whereNull('deleted_at')
    .update({
      escalation_agent_url: null,
      updated_at: knex.fn.now(),
    });
}
