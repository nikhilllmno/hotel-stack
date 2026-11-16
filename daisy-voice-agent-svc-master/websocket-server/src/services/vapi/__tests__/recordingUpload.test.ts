import { EndOfCallStatusMessage } from '../../../models/request/EndOfCallReport';
import {
  isPrivateVapiRecordingUrl,
  resolveRecordingUrlFromVapiPayload,
} from '../recordingUpload';

const MONO_URL = 'https://storage.vapi.ai/call-019f270c-mono.mp3';
const STEREO_URL = 'https://storage.vapi.ai/call-019f270c-stereo.mp3';
const LEGACY_URL = 'https://storage.vapi.ai/call-019f270c-legacy-mono.mp3';

function message(
  overrides: Partial<EndOfCallStatusMessage> = {},
): EndOfCallStatusMessage {
  return {
    type: 'end-of-call-report',
    artifact: {},
    ...overrides,
  } as EndOfCallStatusMessage;
}

describe('resolveRecordingUrlFromVapiPayload', () => {
  it('prefers artifact.recording.mono.combinedUrl (VAPI 2025+ shape)', () => {
    const url = resolveRecordingUrlFromVapiPayload(
      message({
        artifact: {
          recordingUrl: LEGACY_URL,
          recording: {
            stereoUrl: STEREO_URL,
            mono: {
              combinedUrl: MONO_URL,
              assistantUrl: 'https://storage.vapi.ai/assistant.mp3',
              customerUrl: 'https://storage.vapi.ai/customer.mp3',
            },
          },
        },
      }),
    );

    expect(url).toBe(MONO_URL);
  });

  it('falls back to flat monoUrl and stereoUrl when mono is not nested', () => {
    expect(
      resolveRecordingUrlFromVapiPayload(
        message({
          artifact: {
            recording: {
              monoUrl: MONO_URL,
              stereoUrl: STEREO_URL,
            },
          },
        }),
      ),
    ).toBe(MONO_URL);

    expect(
      resolveRecordingUrlFromVapiPayload(
        message({
          artifact: {
            recording: {
              stereoUrl: STEREO_URL,
            },
          },
        }),
      ),
    ).toBe(STEREO_URL);
  });

  it('falls back to legacy artifact.recordingUrl and message.recordingUrl', () => {
    expect(
      resolveRecordingUrlFromVapiPayload(
        message({
          artifact: { recordingUrl: LEGACY_URL },
        }),
      ),
    ).toBe(LEGACY_URL);

    expect(
      resolveRecordingUrlFromVapiPayload(
        message({
          recordingUrl: LEGACY_URL,
        }),
      ),
    ).toBe(LEGACY_URL);
  });

  it('returns undefined when no recording URL is present', () => {
    expect(resolveRecordingUrlFromVapiPayload(message())).toBeUndefined();
  });
});

describe('isPrivateVapiRecordingUrl', () => {
  it('detects HIPAA Cloudflare R2 private recording URLs', () => {
    expect(
      isPrivateVapiRecordingUrl(
        'https://94bdb67bb98da30b06bdd917725c037d.r2.cloudflarestorage.com/hipaa-recordings/019f67d2-mono.mp3',
      ),
    ).toBe(true);
  });

  it('treats public storage.vapi.ai URLs as not private', () => {
    expect(isPrivateVapiRecordingUrl(MONO_URL)).toBe(false);
  });
});
