import { Pagination } from '../../models/response/common';
import { GroupedReservation } from './groupedReservation';

export interface HotelReservationListResponse {
  data: GroupedReservation[];
  pagination: Pagination;
}
