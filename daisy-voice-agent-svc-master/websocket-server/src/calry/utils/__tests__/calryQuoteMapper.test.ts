import { CalryQuote, CalryRatePlan } from '@/calry/types';
import { mapCalryRatePlanToPMSQuote } from '@/calry/utils/calryQuoteMapper';
import { HotelConfiguration } from '@/models/HotelConfiguration';
import { PetFeeStrategyType } from '@/types/petFeeStrategy';

const QUOTE: CalryQuote = {
  propertyId: '212815',
  roomTypeId: '341959',
  currency: 'USD',
};

/** The worked example from Calry's own docs. */
const PLAN: CalryRatePlan = {
  ratePlanId: 'BAR',
  name: 'Best Available Rate',
  totalPrice: 1168.7,
  deposit: 10,
  basePrice: { totalBasePrice: 1053 },
  fee: { totalFee: 115 },
  tax: { totalTax: 96 },
  discount: { totalDiscount: -105.3 },
};

function map(
  overrides: Partial<Parameters<typeof mapCalryRatePlanToPMSQuote>[0]> = {},
) {
  return mapCalryRatePlanToPMSQuote({
    quote: QUOTE,
    plan: PLAN,
    rateCode: 'BAR',
    checkIn: '2026-09-01',
    checkOut: '2026-09-03',
    roomTypeId: '341959',
    numPets: 0,
    hotelId: 'hotel-uuid-1',
    hotelConfig: null,
    ...overrides,
  });
}

describe('mapCalryRatePlanToPMSQuote', () => {
  it('maps the price blocks and folds the discount into fees', () => {
    const quote = map();

    expect(quote.base_rate).toBe(1053);
    expect(quote.taxes).toBe(96);
    expect(quote.fees).toBe(9.7);
    expect(quote.total_amount).toBe(1158.7);
  });

  it('excludes the deposit, which Calry reports but cannot collect', () => {
    const quote = map();

    // Calry's totalPrice (1168.7) includes the 10 deposit; the stay itself
    // is 1158.7.
    expect(quote.total_amount).toBe(PLAN.totalPrice - PLAN.deposit!);
  });

  it('charges the full total, since Calry hotels take no deposit', () => {
    const quote = map();

    expect(quote.amountCharged).toBe(quote.total_amount);
  });

  it('carries the rate identity and raw response through', () => {
    const quote = map();

    expect(quote.rate_code).toBe('BAR');
    expect(quote.rate_id).toBe('BAR');
    expect(quote.currency).toBe('USD');
    expect(quote.raw_response).toBe(QUOTE);
  });

  it('falls back to the rate code as the rate id when Calry omits ratePlanId', () => {
    const quote = map({ plan: { ...PLAN, ratePlanId: undefined } });

    expect(quote.rate_id).toBe('BAR');
  });

  it('treats missing price blocks as zero', () => {
    const quote = map({ plan: { totalPrice: 0 } });

    expect(quote).toMatchObject({
      base_rate: 0,
      taxes: 0,
      fees: 0,
      total_amount: 0,
    });
  });

  it('adds the configured pet fee to fees and the total', () => {
    const hotelConfig = {
      pet_fee_configuration: {
        strategy: PetFeeStrategyType.FlatFee,
        fee_amount: 50,
      },
    } as HotelConfiguration;

    const quote = map({ numPets: 2, hotelConfig });

    expect(quote.fees).toBe(59.7);
    expect(quote.total_amount).toBe(1208.7);
  });

  it('does not add a pet fee when there are no pets', () => {
    const hotelConfig = {
      pet_fee_configuration: {
        strategy: PetFeeStrategyType.FlatFee,
        fee_amount: 50,
      },
    } as HotelConfiguration;

    const quote = map({ numPets: 0, hotelConfig });

    expect(quote.fees).toBe(9.7);
  });
});
