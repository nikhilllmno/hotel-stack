import { Escalation } from '../../models/Escalations';

export interface CallerRequests {
  data: Escalation[];
  pagination: {
    current_page: number;
    limit: number;
    total_items: number;
    total_pages: number;
    next_page: string;
    prev_page: string;
  };
}
