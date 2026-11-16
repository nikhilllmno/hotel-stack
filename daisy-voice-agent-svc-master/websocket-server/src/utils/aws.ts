import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import config from '../config';
import { AWSError } from '../errors/AWSError';
import logger from './logger';

/**
 * AWS S3 client instance
 */
const s3Client = new S3Client({
  region: config.AWS_REGION,
});

/**
 * Extracts bucket name and key from an S3 URL
 * @param s3Url The S3 URL (e.g., s3://bucket-name/path/to/file or https://bucket-name.s3.amazonaws.com/path/to/file)
 * @returns Object containing bucket and key, or null if invalid
 */
function parseS3Url(s3Url: string): { bucket: string; key: string } | null {
  try {
    // Handle s3:// protocol
    if (s3Url.startsWith('s3://')) {
      const urlWithoutProtocol = s3Url.substring(5);
      const firstSlashIndex = urlWithoutProtocol.indexOf('/');
      if (firstSlashIndex === -1) return null;

      const bucket = urlWithoutProtocol.substring(0, firstSlashIndex);
      const key = urlWithoutProtocol.substring(firstSlashIndex + 1);
      return { bucket, key };
    }
    return null;
  } catch (error) {
    logger.error(`parseS3Url: Error parsing S3 URL: ${s3Url}`, error);
    return null;
  }
}

/**
 * Generates a presigned URL for an S3 object
 * @param s3Url The S3 URL (private URL)
 * @param expiresIn Expiration time in seconds (default: 3600 = 1 hour)
 * @returns Presigned URL or null if the URL is invalid or generation fails
 */
export async function generatePresignedUrl(
  s3Url: string,
  expiresIn: number = 3600,
) {
  if (!s3Url) {
    throw new AWSError('generatePresignedUrl: No S3 URL provided');
  }

  try {
    const parsed = parseS3Url(s3Url);
    if (!parsed) {
      logger.error(`generatePresignedUrl: Invalid S3 URL format: ${s3Url}`);
      throw new AWSError(`Invalid S3 URL format: ${s3Url}`);
    }

    const { bucket, key } = parsed;

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn,
    });

    logger.info(
      `generatePresignedUrl: Generated presigned URL for ${bucket}/${key}`,
    );
    return presignedUrl;
  } catch (error) {
    logger.error(
      `generatePresignedUrl: Error generating presigned URL for ${s3Url}:`,
      error,
    );
    throw error;
  }
}

/**
 * Uploads a file buffer to S3
 * @param buffer The file buffer to upload
 * @param key The S3 key (path) for the file
 * @param contentType The MIME type of the file
 * @param bucket Optional bucket name (defaults to config.AWS_S3_BUCKET)
 * @param expiresIn expiration time in seconds for pre-signed URL (default: 3600 = 1 hour)
 * @returns Pre-signed URL of the uploaded file or null if upload fails
 */
export async function uploadToS3(
  buffer: Buffer,
  key: string,
  contentType: string,
  bucket?: string,
  expiresIn: number = 3600,
) {
  const bucketName = bucket || config.S3_BUCKET;

  if (!bucketName) {
    logger.error('uploadToS3: S3_BUCKET is not configured');
    throw new AWSError('S3_BUCKET is not configured');
  }

  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    await s3Client.send(command);

    const s3Url = `s3://${bucketName}/${key}`;
    logger.info(`uploadToS3: Successfully uploaded file to ${s3Url}`);

    // Generate pre-signed URL for secure access
    const presignedUrl = await generatePresignedUrl(s3Url, expiresIn);
    logger.info(
      `uploadToS3: Generated pre-signed URL expiring in ${expiresIn} seconds`,
    );
    return presignedUrl;
  } catch (error) {
    logger.error(`uploadToS3: Error uploading file to S3:`, error);
    throw error;
  }
}

/**
 * Uploads a file buffer to S3 and returns only the S3 path (no presigned URL).
 * Use this when the path will be stored (e.g. on a reservation) and presigned URL generated on read.
 */
export async function uploadBufferToS3ReturnPath(
  buffer: Buffer,
  key: string,
  contentType: string,
  bucket?: string,
): Promise<string> {
  const bucketName = bucket || config.S3_BUCKET;

  if (!bucketName) {
    logger.error('uploadBufferToS3ReturnPath: S3_BUCKET is not configured');
    throw new AWSError('S3_BUCKET is not configured');
  }

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3Client.send(command);
  const s3Url = `s3://${bucketName}/${key}`;
  logger.info(`uploadBufferToS3ReturnPath: Uploaded to ${s3Url}`);
  return s3Url;
}

/**
 * Generates a presigned download URL for an S3 object using just the s3Key
 * @param s3Key The S3 key (path) of the file
 * @param expiresIn Expiration time in seconds (default: 86400 = 24 hours)
 * @returns Presigned download URL
 */
export async function generatePresignedDownloadUrl(
  s3Key: string,
  expiresIn: number = 3600, // 1 hour
): Promise<string> {
  const bucketName = config.S3_BUCKET;

  if (!bucketName) {
    throw new AWSError('S3_BUCKET is not configured');
  }

  if (!s3Key) {
    throw new AWSError('s3Key is required');
  }

  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn });

    logger.info(
      `generatePresignedDownloadUrl: Generated presigned download URL for ${s3Key}`,
    );
    return url;
  } catch (error) {
    logger.error(
      'generatePresignedDownloadUrl: Error generating presigned download URL:',
      error,
    );
    throw error;
  }
}

/**
 * Generates a presigned URL for uploading a file to S3
 * @param fileName Original filename (extension optional - can be derived from contentType)
 * @param contentType MIME type of the file
 * @param folder Optional folder path to organize uploads
 * @param expiresIn Expiration time in seconds (default: 3600 = 1 hour)
 * @returns Object containing uploadUrl, s3Key, and expiresIn
 */
export async function generatePresignedUploadUrl(
  fileName: string,
  contentType: string,
  folder?: string,
  expiresIn: number = 3600, // 1 hour
): Promise<{ uploadUrl: string; s3Key: string; expiresIn: number }> {
  const bucketName = config.S3_BUCKET;

  if (!bucketName) {
    throw new AWSError('S3_BUCKET is not configured');
  }

  try {
    const fileExtension = getExtensionFromContentType(contentType);
    const uniqueFileName = `${fileName}.${fileExtension}`;
    const s3Key = folder ? `${folder}/${uniqueFileName}` : uniqueFileName;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn });

    logger.info(
      `generatePresignedUploadUrl: Generated presigned upload URL for ${s3Key}`,
    );
    return {
      uploadUrl,
      s3Key,
      expiresIn,
    };
  } catch (error) {
    logger.error(
      'generatePresignedUploadUrl: Error generating presigned upload URL:',
      error,
    );
    throw error;
  }
}

function getExtensionFromContentType(contentType: string): string {
  return contentType.split('/').pop() || '';
}
