process.env.STAYNTOUCH_BASE_URL = 'https://api.stayntouch.test/connect';

import { Reservation as ReservationDTO } from '@/dtos/Reservation';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import { BadRequestError } from '@/errors/BadRequestError';
import { StayntouchReservationService } from '@/stayntouch/services/reservationService';
import dayjs from 'dayjs';

function buildReservationDetails(
  overrides: Partial<ReservationDTO> = {},
): ReservationDTO {
  const checkIn = dayjs().add(30, 'day').toDate();
  const checkOut = dayjs().add(32, 'day').toDate();

  return {
    id: 'res-1',
    booking_id: 'BK-RES-1',
    external_id: '8018156056034',
    phone_number: '+15550001111',
    type: SessionType.EXTERNAL,
    room_id: 674377,
    room_type: 'Deluxe Queen',
    business_id: '1001',
    hotel_id: '11111111-1111-1111-1111-111111111111',
    pms_provider: 'stayntouch',
    status: ReservationStatus.ACTIVE,
    check_in: checkIn,
    check_out: checkOut,
    num_adults: 1,
    num_children: 0,
    customer: {
      hotel_id: '11111111-1111-1111-1111-111111111111',
      first_name: 'Hashrin',
      last_name: 'Gay',
      phone_number: '+15550001111',
      email: 'aslam@dextr.ai',
    },
    hotel: null,
    hotel_configuration: null,
    channel: null,
    payments: null,
    quote: null,
    discount: null,
    ...overrides,
  };
}

describe('StayntouchReservationService.cancelExternalDirectReservation', () => {
  let service: StayntouchReservationService;
  let cancelReservationSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new StayntouchReservationService(
      '11111111-1111-1111-1111-111111111111',
    );
    cancelReservationSpy = jest
      .spyOn(service, 'cancelReservation')
      .mockResolvedValue({ status: true });
  });

  afterEach(() => {
    cancelReservationSpy.mockRestore();
  });

  it('delegates to cancelReservation with external_id and booking context', async () => {
    const reservation = buildReservationDetails();

    const result = await service.cancelExternalDirectReservation(
      reservation,
      'Guest requested cancellation',
    );

    expect(cancelReservationSpy).toHaveBeenCalledWith({
      business_id: '1001',
      external_id: '8018156056034',
      internal_id: 'BK-RES-1',
      reason: 'Guest requested cancellation',
    });
    expect(result).toEqual({ status: true });
  });

  it('throws when external_id is missing', async () => {
    const reservation = buildReservationDetails({ external_id: undefined });

    await expect(
      service.cancelExternalDirectReservation(
        reservation,
        'Guest requested cancellation',
      ),
    ).rejects.toThrow(BadRequestError);

    expect(cancelReservationSpy).not.toHaveBeenCalled();
  });
});
