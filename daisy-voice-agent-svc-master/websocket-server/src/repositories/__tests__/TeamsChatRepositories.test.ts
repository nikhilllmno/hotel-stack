import { ChatOutboundMessageRepository } from '@/repositories/ChatOutboundMessageRepository';
import { TeamsConversationReferenceRepository } from '@/repositories/TeamsConversationReferenceRepository';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';

describe('TeamsConversationReferenceRepository (pg-mem)', () => {
  const ctx = installPgMemTestContext();

  it('inserts a channel and refreshes its service URL on the next upsert', async () => {
    const repository = new TeamsConversationReferenceRepository(ctx.knex);
    const base = {
      channel_id: '19:abc@thread.tacv2',
      tenant_id: 'tenant-1',
      team_id: 'team-1',
      bot_id: '28:bot',
    };

    await repository.upsert({ ...base, service_url: 'https://amer/' });
    await repository.upsert({ ...base, service_url: 'https://emea/' });

    const found = await repository.findByChannelId('19:abc@thread.tacv2');
    expect(found).toMatchObject({ ...base, service_url: 'https://emea/' });
    expect(
      await repository.findByChannelId('19:other@thread.tacv2'),
    ).toBeNull();
  });
});

describe('ChatOutboundMessageRepository (pg-mem)', () => {
  const ctx = installPgMemTestContext();

  it('stores a message once per channel and id, keeping the latest text', async () => {
    const repository = new ChatOutboundMessageRepository(ctx.knex);
    const message = {
      provider: 'teams',
      channel_id: '19:abc@thread.tacv2',
      message_id: '100',
    };

    await repository.record({ ...message, text: 'first' });
    await repository.record({ ...message, text: 'edited' });

    const found = await repository.find('teams', message.channel_id, '100');
    expect(found?.text).toBe('edited');
    expect(await ctx.knex('chat_outbound_messages').count('* as n')).toEqual([
      { n: 1 },
    ]);
    expect(
      await repository.find('teams', message.channel_id, '101'),
    ).toBeNull();
    expect(
      await repository.find('telegram', message.channel_id, '100'),
    ).toBeNull();
  });
});
