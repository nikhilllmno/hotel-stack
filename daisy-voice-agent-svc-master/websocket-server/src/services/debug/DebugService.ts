import { DebugConversationMessage } from '../../models/ConversationMessage';
import {
  ConversationMessageRepository,
  DebugQueryParams,
} from '../../repositories/ConversationMessageRepository';

export class DebugService {
  private conversationMessageRepository: ConversationMessageRepository;

  constructor() {
    this.conversationMessageRepository = new ConversationMessageRepository();
  }

  async queryConversations(
    params: DebugQueryParams,
  ): Promise<DebugConversationMessage[]> {
    return this.conversationMessageRepository.debugQueryConversations(params);
  }
}
