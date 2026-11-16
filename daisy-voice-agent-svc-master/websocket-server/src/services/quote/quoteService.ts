import { Knex } from 'knex';
import { Quote } from '../../models/Quote';
import { QuoteRepository } from '../../repositories/QuoteRepository';
import { validatePlatformPricing } from '../../utils/validateReservationRequest';

export class QuoteService {
  private quoteRepository: QuoteRepository;

  constructor(quoteRepository: QuoteRepository = new QuoteRepository()) {
    this.quoteRepository = quoteRepository;
  }

  async createQuote(
    params: Omit<Quote, 'id' | 'created_at' | 'updated_at'>,
    transaction?: Knex.Transaction,
  ): Promise<Quote> {
    const platform_pricing = validatePlatformPricing(
      params.platform_pricing ?? null,
    );
    const quote = await this.quoteRepository.create(
      {
        reservation_id: params.reservation_id,
        base_rate: params.base_rate,
        taxes: params.taxes,
        fees: params.fees,
        amount_charged: params.amount_charged,
        quote_object: params.quote_object,
        platform_pricing,
      },
      transaction,
    );

    return quote;
  }

  async createQuotes(
    params: Omit<Quote, 'id' | 'created_at' | 'updated_at'>[],
    transaction?: Knex.Transaction,
  ): Promise<Quote[]> {
    const validated = params.map((quote) => ({
      ...quote,
      platform_pricing: validatePlatformPricing(quote.platform_pricing ?? null),
    }));
    const quotes = await this.quoteRepository.createMany(
      validated,
      transaction,
    );
    return quotes;
  }

  async getQuoteByReservationId(reservationId: string): Promise<Quote | null> {
    return this.quoteRepository.findByReservationId(reservationId);
  }

  async updateQuote(id: string, data: Partial<Quote>): Promise<Quote | null> {
    const updateData = { ...data };
    if (updateData.platform_pricing !== undefined) {
      updateData.platform_pricing = validatePlatformPricing(
        updateData.platform_pricing,
      );
    }
    return this.quoteRepository.update(id, updateData);
  }
}

// Create and export a singleton instance
export const quoteService = new QuoteService();
export default quoteService;
