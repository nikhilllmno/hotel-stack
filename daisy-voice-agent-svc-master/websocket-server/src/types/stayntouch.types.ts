export interface StayntouchReservationData {
  id: number;
  hotel_id: string;
  confirmation_number: string;
  arrival_date: string;
  arrival_time: string;
  departure_date: string;
  departure_time: string;
  status: string;
  room_id?: number;
  room_number?: string;
  object?: string;
  [key: string]: any;
}

export interface StayntouchEvent {
  id: number;
  object: string;
  event:
    | 'create_reservation'
    | 'edit_reservation'
    | 'cancel_reservation'
    | 'checkin_completed'
    | 'checkedout';
  created_at: string;
  data: StayntouchReservationData;
}

export interface WebhookResponse {
  success: boolean;
  message: string;
  reservation_id?: string;
}
