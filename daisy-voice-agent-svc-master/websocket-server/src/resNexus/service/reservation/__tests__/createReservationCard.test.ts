const mockLoggerInfo = jest.fn();

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { Customer } from '@/dtos/Customer';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import { Reservation } from '@/dtos/Reservation';
import { PmsBookingOutcomeUnknownError } from '@/errors/PmsBookingOutcomeUnknownError';
import { Hotel } from '@/models/Hotel';
import { stripCardFields } from '@/resNexus/utils/helper';
import { Country, PaymentProvider, PmsProvider } from '@/types/enums';
import { AxiosError, isAxiosError } from 'axios';
import { ResNexusService } from '../reservationService';

const HOTEL_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const BUSINESS_ID = '12345';
const PAN = '4111111111111111';
const CVV = '737';

/* eslint-disable @typescript-eslint/no-explicit-any */

function buildCustomer(): Customer {
  return {
    phone_number: '+14083205093',
    hotel_id: HOTEL_ID,
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada@example.com',
    address: {
      address_first_line: '1 Ada Way',
      city: 'Schmoton',
      state_or_province: 'OH',
      postal_code: '12345',
      country: 'US',
    },
  } as Customer;
}

function buildReservation(): Reservation {
  return {
    id: 'res-1',
    booking_id: 'BOOKING1',
    phone_number: '+14083205093',
    type: SessionType.SMS,
    room_id: 123,
    business_id: BUSINESS_ID,
    hotel_id: HOTEL_ID,
    pms_provider: PmsProvider.RESNEXUS,
    status: ReservationStatus.INACTIVE,
    check_in: new Date('2026-01-01'),
    check_out: new Date('2026-01-03'),
    num_adults: 2,
    num_children: 0,
    num_pets: 0,
    customer: buildCustomer(),
    hotel: {
      id: HOTEL_ID,
      business_id: BUSINESS_ID,
      currency: 'USD',
      country: Country.US,
      pms_provider: PmsProvider.RESNEXUS,
      payment_provider: PaymentProvider.RESNEXUS,
    } as Hotel,
    quote: null,
    discount: null,
  } as Reservation;
}

const QUOTE = {
  base_rate: 200,
  taxes: 30,
  fees: 10,
  amount_charged: 240,
  quote_object: {},
} as any;

describe('ResNexusService.createReservation — card', () => {
  let post: jest.Mock;
  let service: ResNexusService;

  beforeEach(() => {
    mockLoggerInfo.mockReset();
    post = jest.fn().mockResolvedValue({
      data: { reservation_id: 'PMS-1', response_errors: [] },
    });
    service = new ResNexusService(
      { post } as any,
      { getHotelById: jest.fn() } as any,
      {} as any,
      {} as any,
    );
  });

  function create(card?: any) {
    return service.createReservation({
      reservation: buildReservation(),
      customer: buildCustomer(),
      quote: QUOTE,
      discount: null,
      card,
    });
  }

  it('sends the card fields in the shape ResNexus documents', async () => {
    await create({
      pan: PAN,
      cvv: CVV,
      expiryMonth: 12,
      expiryYear: 2030,
      cardHolderName: 'Ada Lovelace',
    });

    const [, body] = post.mock.calls[0];
    expect(body).toMatchObject({
      card_name: 'Ada Lovelace',
      card_number: PAN,
      card_cvv: CVV,
      expire_month: 12,
      expire_year: 2030,
    });
  });

  it('omits the card fields entirely when no card is passed', async () => {
    await create();

    const [, body] = post.mock.calls[0];
    expect(Object.keys(body)).not.toContain('card_number');
    expect(Object.keys(body)).not.toContain('card_cvv');
    expect(Object.keys(body)).not.toContain('expire_month');
  });

  it('keeps the card out of its own log line', async () => {
    await create({ pan: PAN, cvv: CVV, expiryMonth: 12, expiryYear: 2030 });

    const logged = mockLoggerInfo.mock.calls.flat().join(' ');
    expect(logged).toContain('Creating resnexus reservation');
    expect(logged).not.toContain(PAN);
    expect(logged).not.toContain(CVV);
  });

  function axiosErrorWithCard(status?: number): AxiosError {
    return new AxiosError(
      status ? `Request failed with status code ${status}` : 'timeout exceeded',
      status ? 'ERR_BAD_RESPONSE' : 'ECONNABORTED',
      { data: JSON.stringify({ card_number: PAN, card_cvv: CVV }) } as any,
      {},
      status ? ({ status, data: {} } as any) : undefined,
    );
  }

  const CARD = { pan: PAN, cvv: CVV, expiryMonth: 12, expiryYear: 2030 };

  it('does not rethrow the axios error, which carries the card in its request body', async () => {
    post.mockRejectedValue(axiosErrorWithCard(400));

    const error = await create({
      pan: PAN,
      cvv: CVV,
      expiryMonth: 12,
      expiryYear: 2030,
    }).catch((e: unknown) => e);

    expect(isAxiosError(error)).toBe(false);
    expect(error).not.toBeInstanceOf(PmsBookingOutcomeUnknownError);
    expect((error as Error).message).toContain('400');
    expect(JSON.stringify(error)).not.toContain(PAN);
    expect(JSON.stringify(error)).not.toContain(CVV);
  });

  it.each([
    ['a timeout', undefined],
    ['a server error', 503],
  ])(
    'reports the outcome as unknown on %s, since ResNexus may have booked the room',
    async (_case, status) => {
      post.mockRejectedValue(axiosErrorWithCard(status));

      const error = await create(CARD).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PmsBookingOutcomeUnknownError);
      expect(JSON.stringify(error)).not.toContain(PAN);
    },
  );
});

describe('ResNexusService.createReservation — pet notes', () => {
  let post: jest.Mock;
  let service: ResNexusService;

  beforeEach(() => {
    post = jest.fn().mockResolvedValue({
      data: { reservation_id: 'PMS-1', response_errors: [] },
    });
    service = new ResNexusService(
      { post } as any,
      { getHotelById: jest.fn() } as any,
      {} as any,
      {} as any,
    );
  });

  async function notesFor(paymentProvider: PaymentProvider, numPets = 2) {
    const reservation = buildReservation();
    reservation.num_pets = numPets;
    reservation.hotel!.payment_provider = paymentProvider;
    await service.createReservation({
      reservation,
      customer: buildCustomer(),
      quote: { ...QUOTE, platform_pricing: { pet_fee_incl_tax: 40 } },
      discount: null,
      notes_from_partner: service.buildPartnerNotes({ numPets }) ?? undefined,
    });
    return post.mock.calls[0][1].notes_from_partner as string | undefined;
  }

  it('adds the pet fee to collect under the booking-time pet count when ResNexus takes the payment', async () => {
    expect(await notesFor(PaymentProvider.RESNEXUS)).toBe(
      'Number of Pets = 2;\nPet fee to collect at property = $40.00',
    );
  });

  it('sends no notes when ResNexus takes the payment and there are no pets', async () => {
    expect(await notesFor(PaymentProvider.RESNEXUS, 0)).toBeUndefined();
  });

  it('keeps the balance note and adds no pet fee line when Dextr collected the payment', async () => {
    const notes = await notesFor(PaymentProvider.STRIPE);
    expect(notes).toContain('Balance Due');
    expect(notes).not.toContain('Pet fee');
  });
});

describe('stripCardFields', () => {
  it('replaces every card field and leaves the rest of the body alone', () => {
    expect(
      stripCardFields({
        external_id: 'BK-1',
        card_name: 'Ada Lovelace',
        card_number: PAN,
        card_cvv: CVV,
        expire_month: 12,
        expire_year: 2030,
      }),
    ).toEqual({
      external_id: 'BK-1',
      card_name: '[REDACTED]',
      card_number: '[REDACTED]',
      card_cvv: '[REDACTED]',
      expire_month: '[REDACTED]',
      expire_year: '[REDACTED]',
    });
  });

  it('keeps fields that merely look like card fields', () => {
    const body = { card_holder_name: 'Ada', masked_card: '**** 1111' };
    expect(stripCardFields(body)).toEqual(body);
  });

  it('does not mutate the body on its way to the API', () => {
    const body = { card_number: PAN };
    stripCardFields(body);
    expect(body.card_number).toBe(PAN);
  });

  it('hands back anything that is not a plain body', () => {
    expect(stripCardFields(undefined)).toBeUndefined();
    expect(stripCardFields('already serialized')).toBe('already serialized');
  });
});
