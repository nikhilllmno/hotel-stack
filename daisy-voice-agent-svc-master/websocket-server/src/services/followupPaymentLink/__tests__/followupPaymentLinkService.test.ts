import { SessionType } from '../../../dtos/enum/SessionType';
import { Hotel } from '../../../models/Hotel';
import { HotelConfiguration } from '../../../models/HotelConfiguration';
import { Session } from '../../../models/Session';
import { Country, PaymentProvider } from '../../../types/enums';
import {
  FollowupAvailability,
  FollowupPaymentLinkService,
} from '../followupPaymentLinkService';

jest.mock('../../../utils/helper', () => {
  const actual = jest.requireActual('../../../utils/helper');
  return {
    ...actual,
    convertToPhoneNumber: (p: string) => p || null,
  };
});

function makeHotel(overrides: Partial<Hotel> = {}): Hotel {
  return {
    id: 'hotel-1',
    name: 'Test Hotel',
    business_id: '100',
    pms_provider: 'resnexus',
    assistant_phone_number: '+15551234567',
    country: Country.US,
    timezone: 'America/New_York',
    telegram_check_in_group_id: '',
    telegram_alerts_group_id: '',
    sms_number: '+15559999999',
    internal_phone_number: '+15558888888',
    url: 'https://testhotel.com',
    address: '',
    image_url: '',
    currency: 'USD',
    payment_provider: PaymentProvider.STRIPE,
    ...overrides,
  } as Hotel;
}

function makeConfig(
  overrides: Partial<HotelConfiguration> = {},
): HotelConfiguration {
  return {
    id: 1,
    hotel_id: 'hotel-1',
    sms_agent_enabled: false,
    negative_sentiment_followup_enabled: false,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as HotelConfiguration;
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    assistant_phone_number: '+15551234567',
    caller_phone_number: '+15550001111',
    session_type: SessionType.CALL,
    session_status: 'ended',
    ...overrides,
  } as Session;
}

const followupAvailability: FollowupAvailability = {
  check_in: '2026-08-01',
  check_out: '2026-08-03',
  num_adults: 2,
  num_children: 0,
  num_pets: 0,
};

describe('FollowupPaymentLinkService', () => {
  let service: FollowupPaymentLinkService;
  let mockRoomReservationService: any;
  let mockSmsService: any;

  beforeEach(() => {
    mockRoomReservationService = {
      getRoomAvailabilityWithQuote: jest.fn(),
      createSingleRoomReservation: jest.fn(),
    };
    mockSmsService = {
      sendMessage: jest.fn().mockResolvedValue(true),
    };
    service = new FollowupPaymentLinkService(
      mockRoomReservationService,
      mockSmsService,
    );
  });

  it('does nothing when followup config is not enabled', async () => {
    await service.handleFollowupPaymentLink({
      hotel: makeHotel(),
      hotelConfiguration: makeConfig({
        followup_payment_link_configuration: {
          enabled: false,
          threshold_check_enabled: false,
          min_available_rooms_threshold: 0,
          threshold_occupancy_mode: 'default',
        },
      }),
      session: makeSession(),
      phoneNumber: '+15550001111',
      followupAvailability,
    });

    expect(
      mockRoomReservationService.getRoomAvailabilityWithQuote,
    ).not.toHaveBeenCalled();
    expect(
      mockRoomReservationService.createSingleRoomReservation,
    ).not.toHaveBeenCalled();
  });

  it('does nothing when followup config is null', async () => {
    await service.handleFollowupPaymentLink({
      hotel: makeHotel(),
      hotelConfiguration: makeConfig({
        followup_payment_link_configuration: null,
      }),
      session: makeSession(),
      phoneNumber: '+15550001111',
      followupAvailability,
    });

    expect(
      mockRoomReservationService.getRoomAvailabilityWithQuote,
    ).not.toHaveBeenCalled();
  });

  it('skips when total available rooms is below threshold', async () => {
    mockRoomReservationService.getRoomAvailabilityWithQuote.mockResolvedValue({
      groups: [
        {
          room_id: 1,
          number_of_units_available: 2,
          total_amount: 200,
          unit_group_id: 1,
          unit_group_name: 'Standard',
          business_id: 100,
          base_rate: 180,
          taxes: 10,
          fees: 10,
          amountCharged: 200,
          check_in: '2026-08-01',
          check_out: '2026-08-03',
        },
      ],
      discount: null,
    });

    await service.handleFollowupPaymentLink({
      hotel: makeHotel(),
      hotelConfiguration: makeConfig({
        followup_payment_link_configuration: {
          enabled: true,
          threshold_check_enabled: true,
          min_available_rooms_threshold: 5,
          threshold_occupancy_mode: 'requested',
        },
      }),
      session: makeSession(),
      phoneNumber: '+15550001111',
      followupAvailability,
    });

    expect(
      mockRoomReservationService.getRoomAvailabilityWithQuote,
    ).toHaveBeenCalledTimes(1);
    expect(
      mockRoomReservationService.createSingleRoomReservation,
    ).not.toHaveBeenCalled();
  });

  it('selects the cheapest room and creates a reservation', async () => {
    const groups = [
      {
        room_id: 2,
        number_of_units_available: 3,
        total_amount: 350,
        unit_group_id: 2,
        unit_group_name: 'Deluxe',
        business_id: 100,
        base_rate: 300,
        taxes: 30,
        fees: 20,
        amountCharged: 350,
        check_in: '2026-08-01',
        check_out: '2026-08-03',
      },
      {
        room_id: 1,
        number_of_units_available: 5,
        total_amount: 200,
        unit_group_id: 1,
        unit_group_name: 'Standard',
        business_id: 100,
        base_rate: 180,
        taxes: 10,
        fees: 10,
        amountCharged: 200,
        check_in: '2026-08-01',
        check_out: '2026-08-03',
      },
    ];

    mockRoomReservationService.getRoomAvailabilityWithQuote.mockResolvedValue({
      groups,
      discount: null,
    });
    mockRoomReservationService.createSingleRoomReservation.mockResolvedValue({
      secureUrl: 'https://secure.daisy.com/test_hotel/review-123',
      booking_id: 'BK-001',
    });

    await service.handleFollowupPaymentLink({
      hotel: makeHotel(),
      hotelConfiguration: makeConfig({
        followup_payment_link_configuration: {
          enabled: true,
          threshold_check_enabled: true,
          min_available_rooms_threshold: 5,
          threshold_occupancy_mode: 'requested',
        },
      }),
      session: makeSession(),
      phoneNumber: '+15550001111',
      followupAvailability,
    });

    expect(
      mockRoomReservationService.createSingleRoomReservation,
    ).toHaveBeenCalledTimes(1);
    const reservationArgs =
      mockRoomReservationService.createSingleRoomReservation.mock.calls[0];
    expect(reservationArgs[0].room_id).toBe(1); // cheapest room
    expect(reservationArgs[5]).toEqual({ skipPaymentNotification: true });

    expect(mockSmsService.sendMessage).toHaveBeenCalledTimes(1);
    const smsPayload = mockSmsService.sendMessage.mock.calls[0][0];
    expect(smsPayload.content.message).toContain('Test Hotel');
    expect(smsPayload.content.message).toContain('review-123');
  });

  it('skips threshold check when threshold_check_enabled is false', async () => {
    const groups = [
      {
        room_id: 1,
        number_of_units_available: 1,
        total_amount: 200,
        unit_group_id: 1,
        unit_group_name: 'Standard',
        business_id: 100,
        base_rate: 180,
        taxes: 10,
        fees: 10,
        amountCharged: 200,
        check_in: '2026-08-01',
        check_out: '2026-08-03',
      },
    ];

    mockRoomReservationService.getRoomAvailabilityWithQuote.mockResolvedValue({
      groups,
      discount: null,
    });
    mockRoomReservationService.createSingleRoomReservation.mockResolvedValue({
      secureUrl: 'https://secure.daisy.com/test_hotel/review-456',
    });

    await service.handleFollowupPaymentLink({
      hotel: makeHotel(),
      hotelConfiguration: makeConfig({
        followup_payment_link_configuration: {
          enabled: true,
          threshold_check_enabled: false,
          min_available_rooms_threshold: 100,
          threshold_occupancy_mode: 'requested',
        },
      }),
      session: makeSession(),
      phoneNumber: '+15550001111',
      followupAvailability,
    });

    // Only 1 availability call (for booking), no threshold check
    expect(
      mockRoomReservationService.getRoomAvailabilityWithQuote,
    ).toHaveBeenCalledTimes(1);
    expect(
      mockRoomReservationService.createSingleRoomReservation,
    ).toHaveBeenCalledTimes(1);
  });

  it('uses default occupancy (1 adult) for threshold when mode is default', async () => {
    const thresholdGroups = [
      {
        room_id: 1,
        number_of_units_available: 10,
        total_amount: 100,
        unit_group_id: 1,
        unit_group_name: 'Standard',
        business_id: 100,
        base_rate: 90,
        taxes: 5,
        fees: 5,
        amountCharged: 100,
        check_in: '2026-08-01',
        check_out: '2026-08-03',
      },
    ];
    const bookingGroups = [
      {
        room_id: 1,
        number_of_units_available: 8,
        total_amount: 200,
        unit_group_id: 1,
        unit_group_name: 'Standard',
        business_id: 100,
        base_rate: 180,
        taxes: 10,
        fees: 10,
        amountCharged: 200,
        check_in: '2026-08-01',
        check_out: '2026-08-03',
      },
    ];

    mockRoomReservationService.getRoomAvailabilityWithQuote
      .mockResolvedValueOnce({ groups: thresholdGroups, discount: null })
      .mockResolvedValueOnce({ groups: bookingGroups, discount: null });
    mockRoomReservationService.createSingleRoomReservation.mockResolvedValue({
      secureUrl: 'https://secure.daisy.com/test_hotel/review-789',
    });

    await service.handleFollowupPaymentLink({
      hotel: makeHotel(),
      hotelConfiguration: makeConfig({
        followup_payment_link_configuration: {
          enabled: true,
          threshold_check_enabled: true,
          min_available_rooms_threshold: 5,
          threshold_occupancy_mode: 'default',
        },
      }),
      session: makeSession(),
      phoneNumber: '+15550001111',
      followupAvailability,
    });

    // Two availability calls: one with 1 adult (threshold), one with actual occupancy (booking)
    expect(
      mockRoomReservationService.getRoomAvailabilityWithQuote,
    ).toHaveBeenCalledTimes(2);

    const thresholdCall =
      mockRoomReservationService.getRoomAvailabilityWithQuote.mock.calls[0][0];
    expect(thresholdCall.num_adults).toBe(1);
    expect(thresholdCall.num_children).toBe(0);

    const bookingCall =
      mockRoomReservationService.getRoomAvailabilityWithQuote.mock.calls[1][0];
    expect(bookingCall.num_adults).toBe(2);
    expect(bookingCall.num_children).toBe(0);

    expect(
      mockRoomReservationService.createSingleRoomReservation,
    ).toHaveBeenCalledTimes(1);
  });

  it('skips when no rooms are available for requested occupancy', async () => {
    mockRoomReservationService.getRoomAvailabilityWithQuote.mockResolvedValue({
      groups: [],
      discount: null,
    });

    await service.handleFollowupPaymentLink({
      hotel: makeHotel(),
      hotelConfiguration: makeConfig({
        followup_payment_link_configuration: {
          enabled: true,
          threshold_check_enabled: false,
          min_available_rooms_threshold: 0,
          threshold_occupancy_mode: 'requested',
        },
      }),
      session: makeSession(),
      phoneNumber: '+15550001111',
      followupAvailability,
    });

    expect(
      mockRoomReservationService.createSingleRoomReservation,
    ).not.toHaveBeenCalled();
    expect(mockSmsService.sendMessage).not.toHaveBeenCalled();
  });
});
