import config from '../../config';
import {
  EndOfCallStatusMessage,
  VapiCallRecordingArtifact,
} from '../../models/request/EndOfCallReport';
import { uploadBufferToS3ReturnPath } from '../../utils/aws';
import { createHttpClient } from '../../utils/httpClient';
import logger from '../../utils/logger';

const recordingDownloadClient = createHttpClient('recording-download', {
  timeout: 60_000,
});

const vapiArtifactClient = createHttpClient('vapi-recording-artifact', {
  baseURL: config.VAPI_API_BASE_URL,
  timeout: 60_000,
});

function coerceHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.startsWith('http') ? trimmed : undefined;
}

function resolveUrlFromRecordingArtifact(
  recording: VapiCallRecordingArtifact,
): string | undefined {
  const mono = recording.mono;
  const monoCombinedUrl =
    mono && typeof mono === 'object'
      ? coerceHttpUrl(mono.combinedUrl)
      : undefined;

  return (
    coerceHttpUrl(recording.monoUrl) ??
    monoCombinedUrl ??
    (typeof mono === 'string' ? coerceHttpUrl(mono) : undefined) ??
    coerceHttpUrl(recording.stereoUrl) ??
    (typeof recording.stereo === 'string'
      ? coerceHttpUrl(recording.stereo)
      : undefined)
  );
}

/** Resolve VAPI recording URL from artifact.recording with legacy fallbacks. */
export function resolveRecordingUrlFromVapiPayload(
  message: EndOfCallStatusMessage,
): string | undefined {
  const recording = message.artifact?.recording;
  if (recording && typeof recording === 'object') {
    const url = resolveUrlFromRecordingArtifact(recording);
    if (url) return url;
  }

  return (
    coerceHttpUrl(message.artifact?.recordingUrl) ??
    coerceHttpUrl(message.recordingUrl) ??
    coerceHttpUrl(message.stereoRecordingUrl)
  );
}

/**
 * HIPAA / private storage URLs cannot be downloaded anonymously.
 * @see https://docs.vapi.ai/assistants/retrieve-call-artifacts
 */
export function isPrivateVapiRecordingUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes('hipaa-recordings') ||
    lower.includes('.r2.cloudflarestorage.com')
  );
}

function recordingFileExtension(url: string): string {
  const match = url.match(/\.(mp3|wav|m4a|ogg)(\?|$)/i);
  return match ? `.${match[1].toLowerCase()}` : '.wav';
}

function recordingContentType(extension: string): string {
  switch (extension) {
    case '.mp3':
      return 'audio/mpeg';
    case '.m4a':
      return 'audio/mp4';
    case '.ogg':
      return 'audio/ogg';
    default:
      return 'audio/wav';
  }
}

function extensionFromContentType(contentType: string | undefined): string {
  if (!contentType) return '.wav';
  const type = contentType.split(';')[0].trim().toLowerCase();
  switch (type) {
    case 'audio/mpeg':
    case 'audio/mp3':
      return '.mp3';
    case 'audio/mp4':
    case 'audio/m4a':
      return '.m4a';
    case 'audio/ogg':
      return '.ogg';
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return '.wav';
    default:
      return '.wav';
  }
}

export async function fetchRecordingBuffer(vapiUrl: string): Promise<Buffer> {
  const response = await recordingDownloadClient.get<ArrayBuffer>(vapiUrl, {
    responseType: 'arraybuffer',
  });
  return Buffer.from(response.data);
}

/**
 * Download mono recording via VAPI authenticated artifact endpoint.
 * Private/HIPAA URLs in webhooks are not directly downloadable; this endpoint
 * returns a 302 to a short-lived signed URL.
 *
 * @see https://docs.vapi.ai/assistants/retrieve-call-artifacts
 */
export async function fetchRecordingBufferViaVapiApi(
  callId: string,
  vapiApiKey: string,
): Promise<{ buffer: Buffer; extension: string }> {
  const response = await vapiArtifactClient.get<ArrayBuffer>(
    `call/${callId}/mono-recording`,
    {
      headers: { Authorization: `Bearer ${vapiApiKey}` },
      responseType: 'arraybuffer',
      maxRedirects: 5,
      // Do not forward the VAPI key to Cloudflare R2 / signed storage hosts.
      beforeRedirect: (options) => {
        if (options.headers) {
          delete options.headers.Authorization;
          delete options.headers.authorization;
        }
      },
    },
  );

  const contentType = response.headers?.['content-type'] as string | undefined;
  return {
    buffer: Buffer.from(response.data),
    extension: extensionFromContentType(contentType),
  };
}

/**
 * Download call audio from VAPI and upload to S3.
 * Prefers authenticated VAPI artifact API (required for HIPAA private URLs),
 * then falls back to a direct GET of the webhook URL for public recordings.
 * Returns s3:// URL on success, or the original VAPI URL if S3 is not configured.
 *
 * @param options.vapiApiKey - Optional override (e.g. backfill uses VAPI_OLD_API_KEY in non-prod).
 */
export async function persistCallRecordingToS3(
  vapiRecordingUrl: string,
  hotelId: string,
  sessionId: string,
  callId: string,
  options?: { vapiApiKey?: string },
): Promise<string> {
  if (!config.S3_BUCKET) {
    logger.warn(
      'persistCallRecordingToS3: S3_BUCKET not configured, saving VAPI URL',
    );
    return vapiRecordingUrl;
  }

  let extension = recordingFileExtension(vapiRecordingUrl);
  let buffer: Buffer | undefined;
  const apiKey = (options?.vapiApiKey || config.VAPI_API_KEY || '').trim();
  const privateUrl = isPrivateVapiRecordingUrl(vapiRecordingUrl);

  if (apiKey && callId) {
    try {
      const downloaded = await fetchRecordingBufferViaVapiApi(callId, apiKey);
      buffer = downloaded.buffer;
      extension = downloaded.extension;
      logger.info(
        'persistCallRecordingToS3: downloaded via VAPI authenticated artifact API',
        { callId, privateUrl },
      );
    } catch (err) {
      if (privateUrl) {
        logger.error(
          'persistCallRecordingToS3: authenticated download failed for private/HIPAA URL',
          { callId, err },
        );
        throw err;
      }
      logger.warn(
        'persistCallRecordingToS3: VAPI artifact API download failed, falling back to direct URL',
        { callId, err },
      );
    }
  } else if (privateUrl) {
    throw new Error(
      'Private/HIPAA recording URL requires a VAPI API key and call id for authenticated download',
    );
  }

  if (!buffer) {
    buffer = await fetchRecordingBuffer(vapiRecordingUrl);
  }

  return uploadBufferToS3ReturnPath(
    buffer,
    `recordings/${hotelId}/${sessionId}/${callId}${extension}`,
    recordingContentType(extension),
  );
}
