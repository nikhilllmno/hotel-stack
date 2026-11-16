import { Pagination } from '../../models/response/common';
import { ConversationMessage } from '../ConversationMessage';

export interface Transcript {
  data: ConversationMessage[];
  pagination: Pagination;
}
