import { Request, Response } from 'express';
import {
  CreateUploadRequest,
  CreateUploadResponse,
  GetFileUrlResponse,
} from '../dtos/Upload';
import {
  generatePresignedDownloadUrl,
  generatePresignedUploadUrl,
} from '../utils/aws';
import logger from '../utils/logger';
import { createUploadSchema } from '../validators/uploadSchema';
import { handleCoreApiErrorAndSendResponse } from './util/helper';

export class FileUploadController {
  /**
   * Create a presigned URL for direct S3 upload
   * POST /uploads
   */
  public async createUpload(req: Request, res: Response): Promise<void> {
    const payload = req.body;

    // Validate the request payload
    const { error, value } = createUploadSchema.validate(payload);
    if (error) {
      logger.error(
        `Validation error in createUpload: ${error.details[0].message}`,
      );
      res.status(400).json({
        error: 'Validation failed',
        details: error.details[0].message,
      });
      return;
    }

    const validatedPayload: CreateUploadRequest = value;

    try {
      const { uploadUrl, s3Key, expiresIn } = await generatePresignedUploadUrl(
        validatedPayload.fileName,
        validatedPayload.contentType,
        validatedPayload.folder,
        86400 * 7, // 7 days expiry
      );

      const response: CreateUploadResponse = {
        uploadUrl,
        s3Key,
        expiresIn,
      };

      logger.info(
        `Created presigned upload URL for file: ${validatedPayload.fileName}`,
      );
      res.status(201).json(response);
    } catch (error) {
      logger.error(`Error creating upload URL: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  /**
   * Get presigned download URL for a file in S3
   */
  public async getPresignedDownloadUrl(
    req: Request,
    res: Response,
  ): Promise<void> {
    const s3Key = req.query.s3Key as string;

    if (!s3Key) {
      res.status(400).json({
        error: 'Validation failed',
        details: 's3Key query parameter is required',
      });
      return;
    }

    try {
      const url = await generatePresignedDownloadUrl(s3Key, 86400 * 7); // 7 days expiry

      const response: GetFileUrlResponse = {
        url,
      };

      logger.info(`Generated presigned download URL for: ${s3Key}`);
      res.status(200).json(response);
    } catch (error) {
      logger.error(`Error getting file URL: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }
}
