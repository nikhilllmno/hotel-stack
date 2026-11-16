import { SessionType } from '../../dtos/enum/SessionType';

export interface GetAvailabilityRequestParams {
  start_date: string;
  end_date: string;
  session_type: SessionType;
  booking_link: boolean;
  num_pets?: number;
}

export interface GetRateCalendarRequestParams {
  business_id: string;
  start_date: string;
  end_date: string;
}

export interface GetWebAvailabilityRequestParams {
  start_date: string;
  end_date: string;
  business_id: string;
  num_adults: number;
  num_children: number;
  num_rooms: number;
}

export interface GetSingleRoomAvailabilityRequestParams extends GetAvailabilityRequestParams {
  num_adults: number;
  num_children?: number;
}
