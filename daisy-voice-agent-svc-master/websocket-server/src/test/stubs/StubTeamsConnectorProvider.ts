import {
  TeamsConnector,
  TeamsConnectorProvider,
} from '../../services/teams/teamsAdapter';

type ActivityLike = {
  text?: string;
  attachments?: Array<{ contentType?: string; content?: unknown }>;
};

export interface StubTeamsMessage {
  id: string;
  channelId: string;
  /** `channel` for a new thread root, `channel;messageid=root` for a reply. */
  conversationId: string;
  serviceUrl: string;
  tenantId: string;
  activity: ActivityLike;
  /** Number of times the message was edited after it was posted. */
  edits: number;
}

interface AdaptiveCardLike {
  body?: Array<{
    type: string;
    text?: string;
    actions?: Array<{ title: string; data: { daisyAction: string } }>;
  }>;
}

/**
 * In-memory Teams Bot Connector. Keeps every message posted through it, so a
 * test can read what a channel would show. Pass it as `connectors` to
 * `TeamsNotificationService`.
 */
export class StubTeamsConnectorProvider implements TeamsConnectorProvider {
  readonly messages: StubTeamsMessage[] = [];
  private nextId = 1700000000000;

  async withConnector<T>(
    target: { serviceUrl: string; tenantId: string; conversationId: string },
    run: (connector: TeamsConnector) => Promise<T>,
  ): Promise<T> {
    const connector = {
      createConversation: (params: {
        tenantId?: string;
        channelData?: { channel?: { id?: string } };
        activity: ActivityLike;
      }) => {
        const channelId = params.channelData?.channel?.id ?? '';
        const message = this.post(
          channelId,
          channelId,
          target.serviceUrl,
          params.tenantId ?? target.tenantId,
          params.activity,
        );
        return Promise.resolve({
          id: `${channelId};messageid=${message.id}`,
          activityId: message.id,
        });
      },
      sendToConversation: (conversationId: string, activity: ActivityLike) => {
        const message = this.post(
          conversationId.split(';')[0],
          conversationId,
          target.serviceUrl,
          target.tenantId,
          activity,
        );
        return Promise.resolve({ id: message.id });
      },
      updateActivity: (
        _conversationId: string,
        activityId: string,
        activity: ActivityLike,
      ) => {
        const message = this.messages.find((m) => m.id === activityId);
        if (!message) {
          return Promise.reject(new Error(`Unknown activity ${activityId}`));
        }
        message.activity = activity;
        message.edits += 1;
        return Promise.resolve({ id: activityId });
      },
      deleteActivity: (_conversationId: string, activityId: string) => {
        const index = this.messages.findIndex((m) => m.id === activityId);
        if (index >= 0) {
          this.messages.splice(index, 1);
        }
        return Promise.resolve();
      },
    };
    return run(connector as unknown as TeamsConnector);
  }

  inChannel(channelId: string): StubTeamsMessage[] {
    return this.messages.filter((m) => m.channelId === channelId);
  }

  /** What a user reads: the plain text, or the text block of a card. */
  textOf(message: StubTeamsMessage): string {
    const card = this.cardOf(message);
    if (card) {
      return card.body?.find((b) => b.type === 'TextBlock')?.text ?? '';
    }
    return message.activity.text ?? '';
  }

  /** Buttons of a card as `{ title, data }`, where `data` is what a click sends back. */
  buttonsOf(message: StubTeamsMessage): Array<{ title: string; data: string }> {
    return (this.cardOf(message)?.body ?? [])
      .filter((b) => b.type === 'ActionSet')
      .flatMap((b) => b.actions ?? [])
      .map((a) => ({ title: a.title, data: a.data.daisyAction }));
  }

  private cardOf(message: StubTeamsMessage): AdaptiveCardLike | undefined {
    return message.activity.attachments?.[0]?.content as
      | AdaptiveCardLike
      | undefined;
  }

  private post(
    channelId: string,
    conversationId: string,
    serviceUrl: string,
    tenantId: string,
    activity: ActivityLike,
  ): StubTeamsMessage {
    const message: StubTeamsMessage = {
      id: String(this.nextId++),
      channelId,
      conversationId,
      serviceUrl,
      tenantId,
      activity,
      edits: 0,
    };
    this.messages.push(message);
    return message;
  }
}
