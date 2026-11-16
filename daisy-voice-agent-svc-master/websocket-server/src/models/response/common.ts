export interface Pagination {
  current_page: number;
  limit: number;
  total: number;
  total_pages: number;
  next_page: string;
  prev_page: string;
}
