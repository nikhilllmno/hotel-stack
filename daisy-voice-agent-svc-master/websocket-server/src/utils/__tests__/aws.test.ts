// registerExternalMocks stubs generatePresignedUrl for every suite; this one needs the real module.
jest.mock('../aws', () => jest.requireActual('../aws'));

jest.mock('@/config', () => ({
  __esModule: true,
  default: {
    ...jest.requireActual('@/config').default,
    AWS_REGION: 'us-west-1',
    S3_BUCKET: 'daisy-test-bucket',
  },
}));

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import config from '../../config';
import { AWSError } from '../../errors/AWSError';
import {
  generatePresignedDownloadUrl,
  generatePresignedUploadUrl,
  generatePresignedUrl,
  uploadBufferToS3ReturnPath,
  uploadToS3,
} from '../aws';

// SigV4 presigning is offline but still resolves credentials; static env creds keep the
// provider chain from reaching for IMDS.
process.env.AWS_ACCESS_KEY_ID = 'AKIATESTACCESSKEY';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-access-key';

const TEST_BUCKET = 'daisy-test-bucket';

describe('utils/aws', () => {
  let sendSpy: jest.SpiedFunction<S3Client['send']>;

  beforeEach(() => {
    config.S3_BUCKET = TEST_BUCKET;
    sendSpy = jest
      .spyOn(S3Client.prototype, 'send')
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function lastPutCommand(): PutObjectCommand {
    return sendSpy.mock.calls[0][0] as unknown as PutObjectCommand;
  }

  describe('generatePresignedUrl', () => {
    it('signs a GET URL for the bucket and key in the s3:// URL', async () => {
      const url = new URL(
        await generatePresignedUrl('s3://other-bucket/folder/file.pdf', 900),
      );

      expect(url.protocol).toBe('https:');
      expect(url.hostname).toBe('other-bucket.s3.us-west-1.amazonaws.com');
      expect(url.pathname).toBe('/folder/file.pdf');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
      expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
      expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
      expect(url.searchParams.get('x-id')).toBe('GetObject');
    });

    it('defaults to a one hour expiry', async () => {
      const url = new URL(await generatePresignedUrl('s3://bucket/key.txt'));

      expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
    });

    it('throws when no S3 URL is provided', async () => {
      await expect(generatePresignedUrl('')).rejects.toThrow(AWSError);
    });

    it('rejects URLs that are not the s3:// form', async () => {
      await expect(
        generatePresignedUrl('https://bucket.s3.amazonaws.com/key.txt'),
      ).rejects.toThrow('Invalid S3 URL format');
    });

    it('rejects an s3:// URL with no key', async () => {
      await expect(generatePresignedUrl('s3://bucket-only')).rejects.toThrow(
        'Invalid S3 URL format',
      );
    });

    it('does not send any S3 request', async () => {
      await generatePresignedUrl('s3://bucket/key.txt');

      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe('generatePresignedDownloadUrl', () => {
    it('signs a GET URL against the configured bucket', async () => {
      const url = new URL(
        await generatePresignedDownloadUrl('invoices/inv-1.pdf', 120),
      );

      expect(url.hostname).toBe(`${TEST_BUCKET}.s3.us-west-1.amazonaws.com`);
      expect(url.pathname).toBe('/invoices/inv-1.pdf');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('120');
      expect(url.searchParams.get('x-id')).toBe('GetObject');
    });

    it('throws when the bucket is not configured', async () => {
      config.S3_BUCKET = '';

      await expect(generatePresignedDownloadUrl('key.pdf')).rejects.toThrow(
        'S3_BUCKET is not configured',
      );
    });

    it('throws when the key is missing', async () => {
      await expect(generatePresignedDownloadUrl('')).rejects.toThrow(
        's3Key is required',
      );
    });
  });

  describe('generatePresignedUploadUrl', () => {
    it('signs a PUT URL and derives the extension from the content type', async () => {
      const result = await generatePresignedUploadUrl(
        'guest-id',
        'image/png',
        'uploads/hotel-1',
        600,
      );

      expect(result.s3Key).toBe('uploads/hotel-1/guest-id.png');
      expect(result.expiresIn).toBe(600);

      const url = new URL(result.uploadUrl);
      expect(url.hostname).toBe(`${TEST_BUCKET}.s3.us-west-1.amazonaws.com`);
      expect(url.pathname).toBe('/uploads/hotel-1/guest-id.png');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
      expect(url.searchParams.get('x-id')).toBe('PutObject');
    });

    it('places the file at the bucket root when no folder is given', async () => {
      const result = await generatePresignedUploadUrl(
        'receipt',
        'application/pdf',
      );

      expect(result.s3Key).toBe('receipt.pdf');
      expect(result.expiresIn).toBe(3600);
    });

    it('throws when the bucket is not configured', async () => {
      config.S3_BUCKET = '';

      await expect(
        generatePresignedUploadUrl('file', 'image/png'),
      ).rejects.toThrow('S3_BUCKET is not configured');
    });
  });

  describe('uploadToS3', () => {
    it('puts the buffer and returns a presigned URL for it', async () => {
      const buffer = Buffer.from('hello');

      const presignedUrl = await uploadToS3(
        buffer,
        'docs/hello.txt',
        'text/plain',
        undefined,
        60,
      );

      expect(sendSpy).toHaveBeenCalledTimes(1);
      const command = lastPutCommand();
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toMatchObject({
        Bucket: TEST_BUCKET,
        Key: 'docs/hello.txt',
        Body: buffer,
        ContentType: 'text/plain',
      });

      const url = new URL(presignedUrl);
      expect(url.hostname).toBe(`${TEST_BUCKET}.s3.us-west-1.amazonaws.com`);
      expect(url.pathname).toBe('/docs/hello.txt');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
    });

    it('prefers an explicitly passed bucket over the configured one', async () => {
      const presignedUrl = await uploadToS3(
        Buffer.from('x'),
        'k.txt',
        'text/plain',
        'explicit-bucket',
      );

      expect(lastPutCommand().input.Bucket).toBe('explicit-bucket');
      expect(new URL(presignedUrl).hostname).toBe(
        'explicit-bucket.s3.us-west-1.amazonaws.com',
      );
    });

    it('throws without sending when no bucket is available', async () => {
      config.S3_BUCKET = '';

      await expect(
        uploadToS3(Buffer.from('x'), 'k.txt', 'text/plain'),
      ).rejects.toThrow('S3_BUCKET is not configured');
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('propagates a failed upload', async () => {
      sendSpy.mockRejectedValue(new Error('AccessDenied') as never);

      await expect(
        uploadToS3(Buffer.from('x'), 'k.txt', 'text/plain'),
      ).rejects.toThrow('AccessDenied');
    });
  });

  describe('uploadBufferToS3ReturnPath', () => {
    it('returns the s3:// path instead of a presigned URL', async () => {
      const buffer = Buffer.from('pdf');

      const s3Url = await uploadBufferToS3ReturnPath(
        buffer,
        'folios/f-1.pdf',
        'application/pdf',
      );

      expect(s3Url).toBe(`s3://${TEST_BUCKET}/folios/f-1.pdf`);
      expect(lastPutCommand().input).toMatchObject({
        Bucket: TEST_BUCKET,
        Key: 'folios/f-1.pdf',
        Body: buffer,
        ContentType: 'application/pdf',
      });
    });

    it('uses an explicitly passed bucket', async () => {
      const s3Url = await uploadBufferToS3ReturnPath(
        Buffer.from('x'),
        'k.pdf',
        'application/pdf',
        'explicit-bucket',
      );

      expect(s3Url).toBe('s3://explicit-bucket/k.pdf');
    });

    it('throws without sending when no bucket is available', async () => {
      config.S3_BUCKET = '';

      await expect(
        uploadBufferToS3ReturnPath(
          Buffer.from('x'),
          'k.pdf',
          'application/pdf',
        ),
      ).rejects.toThrow('S3_BUCKET is not configured');
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });
});
