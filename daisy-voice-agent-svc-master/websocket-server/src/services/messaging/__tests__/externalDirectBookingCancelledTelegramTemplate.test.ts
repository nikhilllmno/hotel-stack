import { Reservation as ReservationDTO } from '@/dtos/Reservation';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import dayjs from 'dayjs';
import { externalDirectBookingCancelledReviewRefundTelegramTemplate } from '../messageTemplates';

function buildReservation(): ReservationDTO {
  return {
    id: 'res-1',
    booking_id: 'BK-RES-1',
    external_id: '8018156056034',
    external_public_id: 'CONF-12345',
    phone_number: '+15550001111',
    type: SessionType.EXTERNAL,
    room_id: 674377,
    room_type: 'Deluxe Queen',
    business_id: '1001',
    hotel_id: '11111111-1111-1111-1111-111111111111',
    pms_provider: 'stayntouch',
    status: ReservationStatus.ACTIVE,
    check_in: dayjs('2026-08-01').toDate(),
    check_out: dayjs('2026-08-02').toDate(),
    created_at: dayjs('2026-06-04').toDate(),
    num_adults: 1,
    num_children: 0,
    customer: {
      hotel_id: '11111111-1111-1111-1111-111111111111',
      first_name: 'Hashrin',
      last_name: 'K',
      phone_number: '+15550001111',
      email: 'aslam@dextr.ai',
    },
    hotel: null,
    hotel_configuration: null,
    channel: null,
    payments: null,
    quote: null,
    discount: null,
  };
}

describe('externalDirectBookingCancelledReviewRefundTelegramTemplate', () => {
  it('includes guest name, external booking id, and stay dates', () => {
    const message =
      externalDirectBookingCancelledReviewRefundTelegramTemplate(
        buildReservation(),
      );

    expect(message).toContain('Booking Cancelled');
    expect(message).toContain('Hashrin K');
    expect(message).toContain('CONF');
    expect(message).toContain('12345');
    expect(message).toContain('2026');
    expect(message).toContain('08');
    expect(message).toContain('Refund Amount');
  });
});
