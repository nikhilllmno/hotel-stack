import { CloudbedsGetReservationResponseData } from '@/cloudbeds/types/GetReservationResponse';
import { Hotel } from '@/models/Hotel';
import { Country, PaymentProvider } from '@/types/enums';
import { mapCloudbedsGetReservationToReservationDTO } from '../mapGetReservationToReservationDTO';

const hotel: Hotel = {
  id: 'hotel-id-1',
  name: 'Test Hotel',
  business_id: '12345',
  pms_provider: 'CLOUDBEDS',
  assistant_phone_number: '+10000000000',
  country: Country.US,
  timezone: 'America/Los_Angeles',
  telegram_check_in_group_id: '',
  telegram_alerts_group_id: '',
  sms_number: '',
  internal_phone_number: '',
  url: '',
  address: '',
  image_url: '',
  currency: 'USD',
  payment_provider: PaymentProvider.STRIPE,
  created_at: new Date(),
  updated_at: new Date(),
};

const baseReservation: CloudbedsGetReservationResponseData = {
  reservationID: 'RES123',
  status: 'confirmed',
  startDate: '2026-12-01',
  endDate: '2026-12-03',
  guestList: {
    guest1: {
      guestID: 'guest1',
      isMainGuest: true,
      roomTypeName: 'Deluxe Queen',
      roomTypeID: '674377',
      roomName: '012',
    },
  },
};

describe('mapCloudbedsGetReservationToReservationDTO', () => {
  it('reads room_name/room_number from the assigned room when present', () => {
    const reservation: CloudbedsGetReservationResponseData = {
      ...baseReservation,
      assigned: [
        {
          roomTypeID: '674377',
          roomTypeName: 'Deluxe Queen',
          roomName: 'King 3',
        },
      ],
    };

    const dto = mapCloudbedsGetReservationToReservationDTO(
      reservation,
      hotel,
      null,
    );

    expect(dto.room_name).toBe('King 3');
    expect(dto.room_number).toBe('3');
  });

  it('falls back to the guest-level room name when there is no assigned/unassigned room (regression for the Prospector Inn gap)', () => {
    const dto = mapCloudbedsGetReservationToReservationDTO(
      baseReservation,
      hotel,
      null,
    );

    expect(dto.room_type).toBe('Deluxe Queen');
    expect(dto.room_name).toBe('012');
    expect(dto.room_number).toBe('012');
  });

  it('returns null room_name/room_number when neither the assigned room nor the guest has one', () => {
    const reservation: CloudbedsGetReservationResponseData = {
      ...baseReservation,
      guestList: {
        guest1: {
          guestID: 'guest1',
          isMainGuest: true,
          roomTypeName: 'Deluxe Queen',
          roomTypeID: '674377',
        },
      },
    };

    const dto = mapCloudbedsGetReservationToReservationDTO(
      reservation,
      hotel,
      null,
    );

    expect(dto.room_name).toBeNull();
    expect(dto.room_number).toBeNull();
  });
});
