import { Response } from 'express';
import { PHONE_NUMBER_HEADER } from '../constants/header';
import { CustomRequest } from '../customheaderTypes/express';
import { BadRequestError } from '../errors/BadRequestError';
import { NoDataError } from '../errors/NoDataError';
import { ConversationService } from '../services/conversation/ConversationService';
import { hotelService } from '../services/hotel/hotelService';
import sessionService from '../services/session/SessionService';
import { convertToPhoneNumber, formatPhoneNumber } from '../utils/helper';
import logger from '../utils/logger';
import {
  channelHistoryQuerySchema,
  getConversationHistoryQuerySchema,
  getConversationMessagesQuerySchema,
} from '../validators/sessionSchema';
import {
  handleAgentErrorAndSendResponse,
  handleCoreApiErrorAndSendResponse,
} from './util/helper';

export class ConversationController {
  private conversationService: ConversationService;

  constructor() {
    this.conversationService = new ConversationService();
  }

  async updateConversation(req: CustomRequest, res: Response) {
    const session_id = req.sessionId;
    const payload = req.body;
    try {
      if (!session_id) {
        throw new Error('No session found for phone number');
      }
      const conversation =
        await this.conversationService.updateConversationBySessionId(
          session_id,
          payload,
        );
      res.status(200).json(conversation);
    } catch (error) {
      logger.error('Error updating conversation:', error);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  //Creates a conversation if it doesn't exist
  public async createConversationMessage(
    req: CustomRequest,
    res: Response,
  ): Promise<void> {
    const sessionId = req.sessionId;
    const callerPhoneNumber = req.phoneNumber;
    const assistantPhoneNumber = req.assistantPhoneNumber;
    const payload = req.body.data;
    const sessionType = req.body.session_type;
    const hotelId = req.hotelId;
    try {
      if (!sessionId) {
        throw new BadRequestError(
          'createConversationMessage: No sessionId found',
        );
      }
      if (!assistantPhoneNumber) {
        throw new BadRequestError(
          'createConversationMessage: No assistantPhoneNumber found',
        );
      }
      if (!callerPhoneNumber) {
        throw new BadRequestError(
          'createConversationMessage: No callerPhoneNumber found',
        );
      }
      if (!hotelId) {
        throw new BadRequestError(
          'createConversationMessage: No hotelId found',
        );
      }
      const conversationWithMessages =
        await this.conversationService.createConversationMessages(
          sessionId,
          callerPhoneNumber,
          payload,
          assistantPhoneNumber!,
          sessionType,
          hotelId,
        );

      res.status(200).json(conversationWithMessages);
    } catch (error) {
      logger.error(`Error creating conversation message: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }

  public async getConversationHistory(
    req: CustomRequest,
    res: Response,
  ): Promise<void> {
    const { error, value } = getConversationHistoryQuerySchema.validate(
      req.query,
    );
    if (error) {
      logger.error(
        `Validation error in getConversationHistory: ${error.details.map((d) => d.message).join(', ')}`,
      );
      res.status(400).json({
        error: 'Validation failed',
        details: error.details.map((d) => d.message),
      });
      return;
    }

    const phoneNumber = req.phoneNumber;
    const hotelId = req.hotelId;

    if (!phoneNumber || !hotelId) {
      res.status(400).json({ error: 'Phone number and hotel ID are required' });
      return;
    }

    const { limit, sort_order } = value;

    try {
      const messages = await this.conversationService.getConversationHistory(
        phoneNumber,
        hotelId,
        limit,
        sort_order,
      );
      res.status(200).json(messages);
    } catch (error) {
      logger.error(`Error retrieving conversation history: ${error}`);
      handleAgentErrorAndSendResponse(error, res);
    }
  }

  public async getChannelHistory(
    req: CustomRequest,
    res: Response,
  ): Promise<void> {
    const { error, value } = channelHistoryQuerySchema.validate(req.query);
    if (error) {
      logger.error(
        `Validation error in getChannelHistory: ${error.details.map((d) => d.message).join(', ')}`,
      );
      res.status(400).json({
        error: 'Validation failed',
        details: error.details.map((d) => d.message),
      });
      return;
    }

    const rawPhone = req.get(PHONE_NUMBER_HEADER);
    if (!rawPhone) {
      res.status(400).json({
        error: 'Phone number is required in X-Phone-Number header',
      });
      return;
    }

    try {
      const hotel = await hotelService.getHotelByBusinessIdOrPhoneNumber(
        value.business_id,
        value.assistant_phone_number
          ? convertToPhoneNumber(value.assistant_phone_number)
          : undefined,
      );
      if (!hotel) {
        throw new NoDataError('No hotel found');
      }

      const cleanedPhone = convertToPhoneNumber(
        formatPhoneNumber(rawPhone, hotel.country),
      );
      if (!cleanedPhone) {
        throw new BadRequestError('Invalid phone number');
      }

      const result = await sessionService.getChannelHistoryByCallerPhone(
        hotel.id,
        cleanedPhone,
        value.session_type,
        value.page,
        value.limit,
        {
          base_path: `${req.baseUrl}${req.path}?`,
          query_params: { ...req.query },
        },
        value.include_tool_calls,
      );
      res.status(200).json(result);
    } catch (err) {
      logger.error(`Error retrieving channel history: ${err}`);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  }

  public async getTranscriptsByPhoneNumber(
    req: CustomRequest,
    res: Response,
  ): Promise<void> {
    const phoneNumber = req.phoneNumber;

    // Validate query parameters
    const { error, value } = getConversationMessagesQuerySchema.validate(
      req.query,
    );
    if (error) {
      logger.error(
        `Validation error in getConversationMessages: ${error.details[0].message}`,
      );
      res.status(400).json({
        error: 'Validation failed',
        details: error.details[0].message,
      });
      return;
    }

    const { limit, sort_order } = value;

    try {
      if (!phoneNumber) {
        throw new BadRequestError('No phone number found in request');
      }

      const conversationMessages =
        await this.conversationService.getTranscriptsByPhoneNumber(
          phoneNumber,
          limit,
          sort_order,
        );
      res.status(200).json(conversationMessages);
    } catch (error) {
      logger.error(`Error getting conversation messages: ${error}`);
      handleCoreApiErrorAndSendResponse(error, res);
    }
  }
}
