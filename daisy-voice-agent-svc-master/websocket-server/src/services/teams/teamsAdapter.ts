import type { CloudAdapter, ConnectorClient } from '@microsoft/agents-hosting';
import config from '../../config';
import { TeamsError } from '../../errors/TeamsError';
import logger from '../../utils/logger';

export const TEAMS_CHANNEL_ID = 'msteams';

export type TeamsConnector = Pick<
  ConnectorClient,
  | 'createConversation'
  | 'sendToConversation'
  | 'updateActivity'
  | 'deleteActivity'
>;

/** Runs a call against the Bot Connector of the region a channel lives in. */
export interface TeamsConnectorProvider {
  withConnector<T>(
    target: { serviceUrl: string; tenantId: string; conversationId: string },
    run: (connector: TeamsConnector) => Promise<T>,
  ): Promise<T>;
}

export function isTeamsConfigured(): boolean {
  return Boolean(
    config.TEAMS_BOT_APP_ID &&
    config.TEAMS_BOT_APP_PASSWORD &&
    config.TEAMS_BOT_TENANT_ID,
  );
}

let adapter: CloudAdapter | undefined;

/**
 * Single CloudAdapter shared by the webhook and outbound sends. The SDK is
 * loaded on first use so environments without Teams credentials never load it.
 */
export async function getTeamsAdapter(): Promise<CloudAdapter> {
  if (!adapter) {
    if (!isTeamsConfigured()) {
      throw new TeamsError(
        'Teams bot credentials are missing (TEAMS_BOT_APP_ID, TEAMS_BOT_APP_PASSWORD, TEAMS_BOT_TENANT_ID).',
      );
    }
    const { CloudAdapter: CloudAdapterClass } =
      await import('@microsoft/agents-hosting');
    const created = new CloudAdapterClass({
      clientId: config.TEAMS_BOT_APP_ID,
      clientSecret: config.TEAMS_BOT_APP_PASSWORD,
      tenantId: config.TEAMS_BOT_TENANT_ID,
    });
    // The SDK default posts "The agent encountered an error" into the channel.
    created.onTurnError = async (_context, error) => {
      logger.error(`Teams turn error: ${error.message}`);
    };
    adapter = created;
  }
  return adapter;
}

export class SdkTeamsConnectorProvider implements TeamsConnectorProvider {
  async withConnector<T>(
    target: { serviceUrl: string; tenantId: string; conversationId: string },
    run: (connector: TeamsConnector) => Promise<T>,
  ): Promise<T> {
    const teamsAdapter = await getTeamsAdapter();
    let result: T | undefined;
    let failure: { error: unknown } | undefined;
    await teamsAdapter.continueConversation(
      config.TEAMS_BOT_APP_ID,
      {
        channelId: TEAMS_CHANNEL_ID,
        serviceUrl: target.serviceUrl,
        conversation: {
          id: target.conversationId,
          tenantId: target.tenantId,
          isGroup: true,
          conversationType: 'channel',
        },
      },
      async (context) => {
        const connector = context.turnState.get<ConnectorClient>(
          teamsAdapter.ConnectorClientKey,
        );
        try {
          result = await run(connector);
        } catch (error) {
          // The adapter hands errors thrown here to onTurnError, which only logs, so keep it for the caller.
          failure = { error };
        }
      },
    );
    if (failure) {
      throw failure.error;
    }
    return result as T;
  }
}
