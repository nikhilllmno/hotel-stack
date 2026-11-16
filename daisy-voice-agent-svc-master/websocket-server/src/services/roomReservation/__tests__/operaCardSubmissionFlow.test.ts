/**
 * End to end for the OPERA card route. Opera keeps the card once it is
 * attached, so neither the card number nor the OPI token may reach our database.
 */
jest.mock('@/calry/services/operaCardTokenService', () => ({
  operaCardTokenService: { exchangeCard: jest.fn() },
}));

jest.mock('@/calry/services/operaCardAttachService', () => ({
  operaCardAttachService: { attachCard: jest.fn() },
}));

jest.mock('@/calry/services/operaFolioService', () => ({
  operaFolioService: { postPayment: jest.fn() },
}));

import { operaCardAttachService } from '@/calry/services/operaCardAttachService';
import { operaCardTokenService } from '@/calry/services/operaCardTokenService';
import { operaFolioService } from '@/calry/services/operaFolioService';
import { PaymentStatus } from '@/dtos/enum/PaymentStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { StubPmsReservationService } from '@/test/stubs/StubPmsReservationService';
import { PaymentProvider } from '@/types/enums';
import dayjs from 'dayjs';
import { RoomReservationService } from '../roomReservationService';

const PAN = '4111111111111111';
const TOKEN = '483204890324827';

const paymentCard = {
  token: TOKEN,
  cardType: 'VA',
  expiryDate: '2612',
  maskedPan: 'XXXXXXXXXXXX1111',
  cardHolderName: 'Jane Doe',
};

describe('OPERA card submission flow', () => {
  const ctx = installPgMemTestContext();
  const { hotelId } = RESERVATION_FLOW_FIXTURE_IDS;

  let service: RoomReservationService;

  beforeEach(async () => {
    await ctx.knex('hotels').where({ id: hotelId }).update({
      payment_provider: PaymentProvider.OPERA,
      updated_at: new Date(),
    });
    jest.clearAllMocks();
    (operaCardTokenService.exchangeCard as jest.Mock).mockResolvedValue(
      paymentCard,
    );
    (operaFolioService.postPayment as jest.Mock).mockResolvedValue('POST-1');

    ({ service } = createTestRoomReservationService({
      knex: ctx.knex,
      externalStubs: { pmsReservationService: new StubPmsReservationService() },
    }));
    // Opera itself is out of scope; the reservation only needs its Opera id.
    jest
      .spyOn(service as never, 'finalizePmsReservations')
      .mockImplementation((async (reservations: { external_id?: string }[]) =>
        reservations.map((r) => ({
          ...r,
          external_id: 'OPERA-98765',
        }))) as never);
  });

  async function submitCard() {
    const created = await service.createSingleRoomReservation(
      {
        check_in: dayjs().add(7, 'day').format('YYYY-MM-DD'),
        check_out: dayjs().add(9, 'day').format('YYYY-MM-DD'),
        customer_email: 'jane@example.com',
        customer_first_name: 'Jane',
        customer_last_name: 'Doe',
        customer_phone_number: '+15559876543',
        num_adults: 2,
        room_id: 101,
        session_type: SessionType.SMS,
      } as never,
      '+15559876543',
      RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
      '77777777-7777-7777-7777-777777777777',
      SessionType.SMS,
    );
    const review = await ctx
      .knex('booking_reviews')
      .where({ booking_id: created.booking_id })
      .first();

    return service.processOperaCardTokenAndCreateReservations({
      reservation_review_id: review.reservation_review_id,
      pan: PAN,
      expiryDate: '2612',
      card_holder_name: 'Jane Doe',
    });
  }

  it('tokenizes the card, attaches the token and completes the payment', async () => {
    await submitCard();

    expect(operaCardTokenService.exchangeCard).toHaveBeenCalledWith(
      hotelId,
      { pan: PAN, expiryDate: '2612', cardHolderName: 'Jane Doe' },
      expect.any(String),
    );
    expect(operaCardAttachService.attachCard).toHaveBeenCalledWith(
      expect.objectContaining({ card: paymentCard }),
    );

    const paymentRow = await ctx
      .knex('payments')
      .where({ hotel_id: hotelId })
      .first();
    expect(paymentRow.payment_status).toBe(PaymentStatus.COMPLETED);
    expect(Number(paymentRow.amount_charged)).toBeGreaterThan(0);
    expect(operaFolioService.postPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: 'OPERA-98765',
        amount: Number(paymentRow.amount_charged),
        paymentMethodCode: 'VA',
      }),
    );
    expect(paymentRow.booking_confirmation_id).toBe('POST-1');
  });

  it('stores nothing card-related', async () => {
    await submitCard();

    const customerRows = await ctx
      .knex('customers')
      .where({ hotel_id: hotelId });
    expect(customerRows.length).toBeGreaterThan(0);
    for (const row of customerRows) {
      expect(row.card_metadata).toBeFalsy();
    }

    for (const table of ['customers', 'payments', 'reservations']) {
      const persisted = JSON.stringify(
        await ctx.knex(table).where({ hotel_id: hotelId }),
      );
      expect(persisted).not.toContain(PAN);
      expect(persisted).not.toContain(TOKEN);
    }
  });
});
