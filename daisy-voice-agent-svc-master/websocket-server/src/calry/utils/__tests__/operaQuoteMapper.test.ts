import { OperaRateInfoResponse } from '@/calry/types';
import { mapOperaRateInfoToPMSQuote } from '@/calry/utils/operaQuoteMapper';
import { HotelConfiguration } from '@/models/HotelConfiguration';
import { PetFeeStrategyType } from '@/types/petFeeStrategy';

/** Two nights of 300 with 30 tax each, as Opera reports them. */
const RATE_INFO: OperaRateInfoResponse = {
  summary: {
    details: [
      {
        summaryDate: '2026-09-05',
        revenue: 300,
        tax: 30,
        gross: 300,
        net: 330,
        ratePlanCode: '2026SUMMER',
        currencyCode: 'USD',
      },
      {
        summaryDate: '2026-09-06',
        revenue: 300,
        tax: 30,
        gross: 300,
        net: 330,
        ratePlanCode: '2026SUMMER',
        currencyCode: 'USD',
      },
    ],
    gross: 600,
    net: 660,
    currencyCode: 'USD',
  },
};

function map(
  overrides: Partial<Parameters<typeof mapOperaRateInfoToPMSQuote>[0]> = {},
) {
  return mapOperaRateInfoToPMSQuote({
    rateInfo: RATE_INFO,
    ratePlanCode: '2026SUMMER',
    checkIn: '2026-09-05',
    checkOut: '2026-09-07',
    roomTypeId: 'DEL',
    numPets: 0,
    hotelId: 'hotel-uuid-1',
    hotelConfig: null,
    ...overrides,
  });
}

describe('mapOperaRateInfoToPMSQuote', () => {
  it('reads the stay from gross and derives tax from net', () => {
    const quote = map();

    expect(quote.base_rate).toBe(600);
    expect(quote.taxes).toBe(60);
    expect(quote.fees).toBe(0);
    expect(quote.total_amount).toBe(660);
  });

  it('charges the full total, since Calry hotels take no deposit', () => {
    expect(map().amountCharged).toBe(660);
  });

  it('reports the rate plan as both rate code and rate id', () => {
    const quote = map();

    expect(quote.rate_code).toBe('2026SUMMER');
    expect(quote.rate_id).toBe('2026SUMMER');
    expect(quote.currency).toBe('USD');
  });

  it('sums the nightly details when the summary header is missing', () => {
    const quote = map({
      rateInfo: { summary: { details: RATE_INFO.summary!.details } },
    });

    expect(quote.base_rate).toBe(600);
    expect(quote.taxes).toBe(60);
  });

  it('never reports negative tax when net is below gross', () => {
    const quote = map({
      rateInfo: { summary: { gross: 600, net: 500, currencyCode: 'USD' } },
    });

    expect(quote.taxes).toBe(0);
    expect(quote.total_amount).toBe(600);
  });

  it('adds the hotel pet fee to fees', () => {
    const hotelConfig = {
      pet_fee_configuration: {
        strategy: PetFeeStrategyType.FlatFee,
        fee_amount: 50,
      },
    } as HotelConfiguration;

    const quote = map({ numPets: 2, hotelConfig });

    expect(quote.fees).toBe(50);
    expect(quote.total_amount).toBe(710);
  });

  it('returns a zero quote when Opera priced nothing', () => {
    const quote = map({ rateInfo: {} });

    expect(quote.base_rate).toBe(0);
    expect(quote.total_amount).toBe(0);
  });
});
