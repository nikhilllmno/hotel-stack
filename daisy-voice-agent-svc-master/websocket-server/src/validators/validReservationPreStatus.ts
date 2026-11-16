import { ReservationStatus } from '../dtos/enum/ReservationStatus';

export const validReservationPreStatus: { [key: string]: ReservationStatus[] } =
  {
    ACTIVE: [ReservationStatus.INACTIVE, ReservationStatus.NO_SHOW],
    CANCELLED: [
      ReservationStatus.ACTIVE,
      ReservationStatus.INACTIVE,
      ReservationStatus.NO_SHOW,
    ],
    FAILED: [ReservationStatus.INACTIVE],
    NO_SHOW: [ReservationStatus.ACTIVE],
    INACTIVE: [ReservationStatus.ACTIVE],
  };
