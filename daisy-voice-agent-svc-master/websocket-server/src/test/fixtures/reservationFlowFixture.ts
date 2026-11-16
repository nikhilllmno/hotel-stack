import { Knex } from 'knex';
import { PaymentProvider, PmsProvider } from '../../types/enums';

export const RESERVATION_FLOW_FIXTURE_IDS = {
  assistantPhoneNumber: '+15551234567',
  businessId: '1001',
  hotelConfigurationId: '66666666-6666-6666-6666-666666666666',
  hotelId: '22222222-2222-2222-2222-222222222222',
  hotelImageS3Url: 's3://test-bucket/hotels/test-hotel.png',
  hotelName: 'Test Hotel',
  smsNumber: '+15551230000',
} as const;

export interface ReservationFlowHotelFixture {
  assistantPhoneNumber: string;
  businessId: string;
  hotelId: string;
  hotelName: string;
}

export async function seedReservationFlowHotel(
  knex: Knex,
): Promise<ReservationFlowHotelFixture> {
  const now = new Date();
  const {
    assistantPhoneNumber,
    businessId,
    hotelConfigurationId,
    hotelId,
    hotelName,
    smsNumber,
  } = RESERVATION_FLOW_FIXTURE_IDS;

  await knex('hotels').insert({
    address: '123 Test St',
    assistant_phone_number: assistantPhoneNumber,
    business_id: Number(businessId),
    country: 'US',
    created_at: now,
    currency: '$',
    id: hotelId,
    image_url: RESERVATION_FLOW_FIXTURE_IDS.hotelImageS3Url,
    internal_phone_number: assistantPhoneNumber,
    name: hotelName,
    payment_provider: PaymentProvider.STRIPE,
    pms_provider: PmsProvider.RESNEXUS,
    sms_number: smsNumber,
    telegram_alerts_group_id: '',
    timezone: 'America/New_York',
    updated_at: now,
    url: 'https://hotel.test.dextr',
  });

  await knex('hotel_configurations').insert({
    created_at: now,
    hotel_id: hotelId,
    id: hotelConfigurationId,
    sms_agent_enabled: false,
    updated_at: now,
  });

  return {
    assistantPhoneNumber,
    businessId,
    hotelId,
    hotelName,
  };
}

export async function ageReservationAndPayment(
  knex: Knex,
  reservationId: string,
  paymentId: string,
  ageMinutes: number,
): Promise<void> {
  const staleCreatedAt = new Date(Date.now() - ageMinutes * 60 * 1000);

  await knex('reservations').where({ id: reservationId }).update({
    created_at: staleCreatedAt,
    updated_at: staleCreatedAt,
  });

  await knex('payments').where({ id: paymentId }).update({
    created_at: staleCreatedAt,
    updated_at: staleCreatedAt,
  });

  await knex('payment_reservations')
    .where({ reservation_id: reservationId, payment_id: paymentId })
    .update({
      created_at: staleCreatedAt,
      updated_at: staleCreatedAt,
    });
}
