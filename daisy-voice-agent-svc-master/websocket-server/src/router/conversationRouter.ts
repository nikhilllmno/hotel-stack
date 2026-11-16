import { Router } from 'express';
import { ConversationController } from '../controller/conversationController';
import {
  setSessionData,
  validatePhoneNumber,
} from '../middleware/validatePhoneNumberAndSetSession';

export const conversationRouter = Router();
const conversationController = new ConversationController();

conversationRouter.post(
  '/history',
  validatePhoneNumber,
  setSessionData,
  conversationController.getConversationHistory.bind(conversationController),
);

conversationRouter.get(
  '/channel-history',
  conversationController.getChannelHistory.bind(conversationController),
);

conversationRouter.use(validatePhoneNumber);
conversationRouter.use(setSessionData);

conversationRouter.get(
  '/transcripts',
  conversationController.getTranscriptsByPhoneNumber.bind(
    conversationController,
  ),
);

conversationRouter.post(
  '/',
  conversationController.createConversationMessage.bind(conversationController),
);

conversationRouter.patch(
  '/',
  conversationController.updateConversation.bind(conversationController),
);
