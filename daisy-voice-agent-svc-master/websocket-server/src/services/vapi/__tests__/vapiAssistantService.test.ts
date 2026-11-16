import axios from 'axios';
import { VapiAssistantService } from '../vapiAssistantService';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('../../../config', () => ({
  __esModule: true,
  default: {
    VAPI_API_KEY: 'test-api-key',
    VAPI_API_BASE_URL: 'https://api.vapi.ai',
    API_TIMEOUT: 10000,
    VAPI_FOLLOWUP_AVAILABILITY_STRUCTURED_OUTPUT_ID: 'so-followup-123',
  },
}));

describe('VapiAssistantService', () => {
  let service: VapiAssistantService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VapiAssistantService();
  });

  describe('resolveAssistantId', () => {
    it('returns assistant ID when phone number matches', async () => {
      mockedAxios.get.mockResolvedValue({
        data: [
          { number: '+15551111111', assistantId: 'ast-aaa' },
          { number: '+15552222222', assistantId: 'ast-bbb' },
        ],
      });

      const id = await service.resolveAssistantId('+15552222222');
      expect(id).toBe('ast-bbb');
    });

    it('returns null when no match', async () => {
      mockedAxios.get.mockResolvedValue({
        data: [{ number: '+15551111111', assistantId: 'ast-aaa' }],
      });

      const id = await service.resolveAssistantId('+15559999999');
      expect(id).toBeNull();
    });

    it('returns null on API error', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Network error'));

      const id = await service.resolveAssistantId('+15551111111');
      expect(id).toBeNull();
    });
  });

  describe('getAssistantStructuredOutputIds', () => {
    it('returns structured output IDs from artifactPlan', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          artifactPlan: {
            structuredOutputIds: ['so-1', 'so-2'],
          },
        },
      });

      const ids = await service.getAssistantStructuredOutputIds('ast-aaa');
      expect(ids).toEqual(['so-1', 'so-2']);
    });

    it('returns empty array when no artifactPlan', async () => {
      mockedAxios.get.mockResolvedValue({ data: {} });
      const ids = await service.getAssistantStructuredOutputIds('ast-aaa');
      expect(ids).toEqual([]);
    });
  });

  describe('syncStructuredOutputs', () => {
    it('adds structured output ID when config is enabled', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({
          data: [{ number: '+15551234567', assistantId: 'ast-hotel' }],
        })
        .mockResolvedValueOnce({
          data: {
            artifactPlan: {
              structuredOutputIds: ['so-existing'],
            },
          },
        });
      mockedAxios.patch.mockResolvedValue({ data: {} });

      await service.syncStructuredOutputs('+15551234567', [
        'followup_payment_link_configuration',
      ]);

      expect(mockedAxios.patch).toHaveBeenCalledTimes(1);
      const patchBody = mockedAxios.patch.mock.calls[0][1] as {
        artifactPlan: { structuredOutputIds: string[] };
      };
      expect(patchBody.artifactPlan.structuredOutputIds).toContain(
        'so-existing',
      );
      expect(patchBody.artifactPlan.structuredOutputIds).toContain(
        'so-followup-123',
      );
    });

    it('removes structured output ID when config is disabled', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({
          data: [{ number: '+15551234567', assistantId: 'ast-hotel' }],
        })
        .mockResolvedValueOnce({
          data: {
            artifactPlan: {
              structuredOutputIds: ['so-existing', 'so-followup-123'],
            },
          },
        });
      mockedAxios.patch.mockResolvedValue({ data: {} });

      await service.syncStructuredOutputs('+15551234567', []);

      expect(mockedAxios.patch).toHaveBeenCalledTimes(1);
      const patchBody = mockedAxios.patch.mock.calls[0][1] as {
        artifactPlan: { structuredOutputIds: string[] };
      };
      expect(patchBody.artifactPlan.structuredOutputIds).toContain(
        'so-existing',
      );
      expect(patchBody.artifactPlan.structuredOutputIds).not.toContain(
        'so-followup-123',
      );
    });

    it('does not patch when no changes needed', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({
          data: [{ number: '+15551234567', assistantId: 'ast-hotel' }],
        })
        .mockResolvedValueOnce({
          data: {
            artifactPlan: {
              structuredOutputIds: ['so-followup-123'],
            },
          },
        });

      await service.syncStructuredOutputs('+15551234567', [
        'followup_payment_link_configuration',
      ]);

      expect(mockedAxios.patch).not.toHaveBeenCalled();
    });

    it('skips when assistant cannot be resolved', async () => {
      mockedAxios.get.mockResolvedValue({ data: [] });

      await service.syncStructuredOutputs('+15559999999', [
        'followup_payment_link_configuration',
      ]);

      expect(mockedAxios.patch).not.toHaveBeenCalled();
    });
  });
});
