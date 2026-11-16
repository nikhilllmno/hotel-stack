import type { Request, Response } from 'express';
import { generatePresignedUrl } from '../../utils/aws';
import { createHttpClient } from '../../utils/httpClient';
import { SessionController } from '../sessionController';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../utils/aws', () => ({
  generatePresignedUrl: jest.fn(),
}));

jest.mock('../../utils/httpClient', () => ({
  createHttpClient: jest.fn(() => ({ get: jest.fn() })),
}));

// The controller builds its recording client at import time; grab that instance.
const recordingClient = (createHttpClient as jest.Mock).mock.results[0].value;
const mockGet = recordingClient.get as jest.Mock;
const mockPresign = generatePresignedUrl as jest.Mock;

function createResponse() {
  const res = {} as Response & {
    statusCode?: number;
    body?: unknown;
    headers?: Record<string, unknown>;
    redirectedTo?: string;
  };
  res.headers = {};
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response['status'];
  res.json = jest.fn((payload: unknown) => {
    res.body = payload;
    return res;
  }) as unknown as Response['json'];
  res.setHeader = jest.fn((name: string, value: unknown) => {
    res.headers![name] = value;
    return res;
  }) as unknown as Response['setHeader'];
  res.redirect = jest.fn((code: number, url: string) => {
    res.statusCode = code;
    res.redirectedTo = url;
  }) as unknown as Response['redirect'];
  return res;
}

function createRequest(sessionId: string) {
  return { params: { sessionId } } as unknown as Request;
}

/** Minimal stand-in for the piped axios stream body. */
function createStream() {
  return { pipe: jest.fn() };
}

describe('SessionController.streamRecordingBySessionId', () => {
  const conversationService = { getConversationBySessionId: jest.fn() };
  let controller: SessionController;
  let res: ReturnType<typeof createResponse>;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new SessionController({} as any, conversationService as any);
    res = createResponse();
  });

  it('404s when the conversation does not exist', async () => {
    conversationService.getConversationBySessionId.mockResolvedValue(null);

    await controller.streamRecordingBySessionId(createRequest('s1'), res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Recording not found' });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('404s when the conversation has no recording_url', async () => {
    conversationService.getConversationBySessionId.mockResolvedValue({
      recording_url: null,
    });

    await controller.streamRecordingBySessionId(createRequest('s1'), res);

    expect(res.statusCode).toBe(404);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('redirects to a presigned URL for s3:// recordings without fetching', async () => {
    conversationService.getConversationBySessionId.mockResolvedValue({
      recording_url: 's3://bucket/call.wav',
    });
    mockPresign.mockResolvedValue('https://signed.example/call.wav');

    await controller.streamRecordingBySessionId(createRequest('s1'), res);

    expect(mockPresign).toHaveBeenCalledWith('s3://bucket/call.wav', 3600);
    expect(res.statusCode).toBe(302);
    expect(res.redirectedTo).toBe('https://signed.example/call.wav');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('404s when presigning an s3:// recording fails', async () => {
    conversationService.getConversationBySessionId.mockResolvedValue({
      recording_url: 's3://bucket/call.wav',
    });
    mockPresign.mockRejectedValue(new Error('no such key'));

    await controller.streamRecordingBySessionId(createRequest('s1'), res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Recording not found' });
  });

  describe('legacy http(s) recordings', () => {
    const HTTP_URL = 'https://storage.example/call.wav';

    function givenUpstream(headers: Record<string, unknown>, data: unknown) {
      conversationService.getConversationBySessionId.mockResolvedValue({
        recording_url: HTTP_URL,
      });
      mockGet.mockResolvedValue({ headers, data });
    }

    it('streams the body and forwards the upstream content-type', async () => {
      const stream = createStream();
      givenUpstream({ 'content-type': 'audio/mpeg' }, stream);

      await controller.streamRecordingBySessionId(createRequest('s1'), res);

      expect(mockGet).toHaveBeenCalledWith(HTTP_URL, {
        responseType: 'stream',
      });
      expect(res.headers?.['Content-Type']).toBe('audio/mpeg');
      expect(res.headers?.['Content-Disposition']).toBe(
        'inline; filename="s1.wav"',
      );
      expect(stream.pipe).toHaveBeenCalledWith(res);
    });

    it('falls back to audio/wav when the upstream sends no content-type', async () => {
      givenUpstream({}, createStream());

      await controller.streamRecordingBySessionId(createRequest('s1'), res);

      expect(res.headers?.['Content-Type']).toBe('audio/wav');
    });

    it('falls back to audio/wav when the content-type is an empty string', async () => {
      givenUpstream({ 'content-type': '' }, createStream());

      await controller.streamRecordingBySessionId(createRequest('s1'), res);

      expect(res.headers?.['Content-Type']).toBe('audio/wav');
    });

    // axios types a header as AxiosHeaderValue, so a non-string is representable
    // even though Node's parser collapses duplicate content-type headers.
    it('falls back to audio/wav when the content-type is not a string', async () => {
      givenUpstream(
        { 'content-type': ['audio/wav', 'audio/mpeg'] },
        createStream(),
      );

      await controller.streamRecordingBySessionId(createRequest('s1'), res);

      expect(res.headers?.['Content-Type']).toBe('audio/wav');
    });

    it('502s when the upstream returns no body', async () => {
      givenUpstream({ 'content-type': 'audio/wav' }, undefined);

      await controller.streamRecordingBySessionId(createRequest('s1'), res);

      expect(res.statusCode).toBe(502);
      expect(res.body).toEqual({ error: 'Failed to fetch recording' });
    });

    it('500s when the upstream request throws', async () => {
      conversationService.getConversationBySessionId.mockResolvedValue({
        recording_url: HTTP_URL,
      });
      mockGet.mockRejectedValue(new Error('ECONNRESET'));

      await controller.streamRecordingBySessionId(createRequest('s1'), res);

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error' });
    });
  });
});
