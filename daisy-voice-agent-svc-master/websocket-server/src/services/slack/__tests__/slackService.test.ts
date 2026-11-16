import { SlackError } from '@/errors/SlackError';
import { SlackService } from '@/services/slack/slackService';
import { SlackMessagePayload } from '@/services/slack/types';
import axios from 'axios';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/xxxx';

describe('SlackService', () => {
  beforeEach(() => {
    mockedAxios.post.mockReset();
    mockedAxios.post.mockResolvedValue({ status: 200, data: 'ok' });
    // `post` uses axios.isAxiosError to decide how to unwrap failures.
    (mockedAxios.isAxiosError as unknown as jest.Mock).mockReturnValue(false);
  });

  describe('isConfigured', () => {
    it('is true when a webhook URL is supplied', () => {
      expect(new SlackService({ webhookUrl: WEBHOOK }).isConfigured()).toBe(
        true,
      );
    });

    it('is false when no webhook URL is supplied', () => {
      expect(new SlackService().isConfigured()).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('posts a plain-text message to the configured webhook', async () => {
      const service = new SlackService({ webhookUrl: WEBHOOK });

      await service.sendMessage({
        recipient: '',
        content: { message: 'Hello, World!' },
      });

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      const [url, payload, options] = mockedAxios.post.mock.calls[0];
      expect(url).toBe(WEBHOOK);
      expect(payload).toEqual({ text: 'Hello, World!' });
      expect(options).toEqual({
        timeout: 60_000,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    it('passes a full Block Kit payload through unchanged', async () => {
      const service = new SlackService({ webhookUrl: WEBHOOK });
      const payload: SlackMessagePayload = {
        text: 'fallback',
        blocks: [{ type: 'section' }],
      };

      await service.sendMessage({
        recipient: '',
        content: { message: payload },
      });

      expect(mockedAxios.post.mock.calls[0][1]).toEqual(payload);
    });

    it('uses the recipient as a per-call webhook override', async () => {
      const override = 'https://hooks.slack.com/services/OVERRIDE';
      const service = new SlackService({ webhookUrl: WEBHOOK });

      await service.sendMessage({
        recipient: override,
        content: { message: 'hi' },
      });

      expect(mockedAxios.post.mock.calls[0][0]).toBe(override);
    });

    it('respects a custom timeout', async () => {
      const service = new SlackService({
        webhookUrl: WEBHOOK,
        timeoutMs: 5000,
      });

      await service.sendMessage({ recipient: '', content: { message: 'hi' } });

      expect(mockedAxios.post.mock.calls[0][2]).toMatchObject({
        timeout: 5000,
      });
    });

    it('throws a SlackError when no webhook is configured', async () => {
      const service = new SlackService();

      await expect(
        service.sendMessage({ recipient: '', content: { message: 'hi' } }),
      ).rejects.toBeInstanceOf(SlackError);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('wraps a Slack rejection in a SlackError surfacing the response body', async () => {
      const axiosError = {
        message: 'Request failed',
        response: { data: 'invalid_payload' },
      };
      mockedAxios.post.mockRejectedValue(axiosError);
      (mockedAxios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);
      const service = new SlackService({ webhookUrl: WEBHOOK });

      await expect(
        service.sendMessage({ recipient: '', content: { message: 'hi' } }),
      ).rejects.toThrow('Failed to post message to Slack: invalid_payload');
    });
  });

  describe('sendMessages', () => {
    it('sends one post per message and reports each as successful', async () => {
      const service = new SlackService({ webhookUrl: WEBHOOK });

      const results = await service.sendMessages(['one', 'two', 'three']);

      expect(mockedAxios.post).toHaveBeenCalledTimes(3);
      expect(results).toEqual([
        { success: true },
        { success: true },
        { success: true },
      ]);
    });

    it('returns an empty array when given no messages', async () => {
      const service = new SlackService({ webhookUrl: WEBHOOK });

      const results = await service.sendMessages([]);

      expect(results).toEqual([]);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('captures a per-message failure without aborting the rest', async () => {
      mockedAxios.post
        .mockResolvedValueOnce({ status: 200, data: 'ok' })
        .mockRejectedValueOnce({
          message: 'boom',
          response: { data: 'no_service' },
        })
        .mockResolvedValueOnce({ status: 200, data: 'ok' });
      (mockedAxios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);
      const service = new SlackService({ webhookUrl: WEBHOOK });

      const results = await service.sendMessages(['a', 'b', 'c']);

      expect(mockedAxios.post).toHaveBeenCalledTimes(3);
      expect(results[0]).toEqual({ success: true });
      expect(results[1]).toEqual({
        success: false,
        error: 'Failed to post message to Slack: no_service',
      });
      expect(results[2]).toEqual({ success: true });
    });

    it('uses the webhookUrl argument as an override for every message', async () => {
      const override = 'https://hooks.slack.com/services/BATCH_OVERRIDE';
      const service = new SlackService({ webhookUrl: WEBHOOK });

      await service.sendMessages(['x', 'y'], override);

      expect(mockedAxios.post.mock.calls[0][0]).toBe(override);
      expect(mockedAxios.post.mock.calls[1][0]).toBe(override);
    });

    it('reports failures for every message when no webhook is configured', async () => {
      const service = new SlackService();

      const results = await service.sendMessages(['a', 'b']);

      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success === false)).toBe(true);
      expect(results[0].error).toContain('Slack webhook URL is not configured');
    });
  });
});
