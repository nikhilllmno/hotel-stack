import { Request, Response } from 'express';
import { CustomRequest } from '../customheaderTypes/express';
import { SessionType } from '../dtos/enum/SessionType';
import { SessionCreateDto } from '../dtos/Session';
import { BadRequestError } from '../errors/BadRequestError';
import { ConversationService } from '../services/conversation/ConversationService';
import { SessionService } from '../services/session/SessionService';
import { generatePresignedUrl } from '../utils/aws';
import { createHttpClient } from '../utils/httpClient';
import logger from '../utils/logger';
import {
  analyticsSummarySchema,
  createSessionSchema,
} from '../validators/sessionSchema';
import { handleCoreApiErrorAndSendResponse } from './util/helper';

const recordingHttpClient = createHttpClient('recording-stream');

export class SessionController {
  constructor(
    private sessionService: SessionService,
    private conversationService: ConversationService,
  ) {}

  async streamRecordingBySessionId(req: Request, res: Response): Promise<void> {
    const { sessionId } = req.params;

    try {
      const conversation =
        await this.conversationService.getConversationBySessionId(sessionId);

      if (!conversation || !conversation.recording_url) {
        res.status(404).json({ error: 'Recording not found' });
        return;
      }

      const storedUrl = conversation.recording_url;

      if (storedUrl.startsWith('s3://')) {
        try {
          const presignedUrl = await generatePresignedUrl(storedUrl, 3600);
          res.redirect(302, presignedUrl);
          return;
        } catch (error) {
          logger.error('Error generating presigned recording URL:', error);
          res.status(404).json({ error: 'Recording not found' });
          return;
        }
      }

      const response = await recordingHttpClient.get(storedUrl, {
        responseType: 'stream',
      });

      if (!response.data) {
        res.status(502).json({ error: 'Failed to fetch recording' });
        return;
      }

      const contentType = response.headers['content-type'];
      res.setHeader(
        'Content-Type',
        typeof contentType === 'string' && contentType
          ? contentType
          : 'audio/wav',
      );
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${sessionId}.wav"`,
      );

      response.data.pipe(res);
    } catch (error) {
      logger.error('Error streaming recording:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  public async createSession(req: CustomRequest, res: Response): Promise<void> {
    const payload = req.body;

    // Validate the request payload
    const { error, value } = createSessionSchema.validate(payload);
    if (error) {
      logger.error(
        `Validation error in createSession: ${error.details[0].message}`,
      );
      res.status(400).json({
        error: 'Validation failed',
        details: error.details[0].message,
      });
      return;
    }

    const validatedPayload: SessionCreateDto = value;

    try {
      const { session, status } =
        await this.sessionService.createSession(validatedPayload);
      res.status(status).json(session);
    } catch (error) {
      logger.error(`Error creating session: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async updateSession(req: CustomRequest, res: Response): Promise<void> {
    const payload = req.body;
    try {
      const session = await this.sessionService.updateSession(payload);
      res.status(200).json(session);
    } catch (error) {
      logger.error(`Error upserting session: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async getLatestActiveSession(
    req: CustomRequest,
    res: Response,
  ): Promise<void> {
    const callerPhoneNumber: string = req.phoneNumber || '';
    const hotelPhoneNumber: string = req.body?.assistant_phone_number;
    const sessionType: SessionType = req.body?.session_type;

    try {
      if (!hotelPhoneNumber) {
        throw new BadRequestError(
          'getLatestActiveSession: Hotel phone number is required',
        );
      }
      if (!callerPhoneNumber) {
        throw new BadRequestError(
          'getLatestActiveSession: Caller phone number is required',
        );
      }

      const session = await this.sessionService.getLatestActiveSession(
        hotelPhoneNumber,
        callerPhoneNumber,
        sessionType,
      );
      res.status(200).json(session);
    } catch (error) {
      logger.error(`Error getting latest active session: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async sendAnalyticsSummary(
    req: Request,
    res: Response,
  ): Promise<void> {
    const { error, value } = analyticsSummarySchema.validate(req.body);
    if (error) {
      logger.error(
        `Validation error in sendAnalyticsSummary: ${error.details[0].message}`,
      );
      res.status(400).json({
        error: 'Validation failed',
        details: error.details[0].message,
      });
      return;
    }

    try {
      const results = await this.sessionService.sendAnalyticsSummary(value);
      res.status(200).json({ results });
    } catch (err) {
      logger.error(`Error in sendAnalyticsSummary: ${err}`);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  }
}
