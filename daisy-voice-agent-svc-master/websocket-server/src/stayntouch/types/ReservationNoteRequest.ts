export interface ReservationNoteItem {
  description: string;
}

export interface AddReservationNotesRequest {
  notes: ReservationNoteItem[];
}
