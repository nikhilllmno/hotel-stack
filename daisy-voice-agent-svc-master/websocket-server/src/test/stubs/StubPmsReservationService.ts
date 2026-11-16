import { Reservation } from '../../dtos/Reservation';
import {
  CreateReservationParams,
  CreateReservationResponse,
  IPMSReservationService,
} from '../../pms/types/IPMSReservationService';
import { PMSQuote } from '../../pms/types/Quote';
import { PMSQuoteRequest } from '../../pms/types/QuoteRequest';

export interface StubPmsReservationServiceOptions {
  quote?: PMSQuote;
}

export class StubPmsReservationService implements Pick<
  IPMSReservationService,
  | 'getQuote'
  | 'getRoomsInfo'
  | 'getRoomTypeMap'
  | 'validateRoomAvailability'
  | 'validateMultiRoomOccupancy'
  | 'createReservation'
  | 'cancelReservation'
  | 'cancelExternalDirectReservation'
  | 'modifyReservation'
  | 'shouldFetchDiscount'
  | 'buildPartnerNotes'
  | 'lookupReservationsById'
  | 'lookupReservationsByPhone'
> {
  getQuote = jest.fn(
    (_params: PMSQuoteRequest): Promise<PMSQuote> =>
      Promise.resolve(this.quote),
  );

  lookupReservationsById = jest.fn(
    (..._args: unknown[]): Promise<Reservation[]> => Promise.resolve([]),
  );

  lookupReservationsByPhone = jest.fn(
    (..._args: unknown[]): Promise<Reservation[]> => Promise.resolve([]),
  );

  getRoomsInfo = jest.fn().mockResolvedValue({});

  getRoomTypeMap = jest.fn(
    (_businessId: string, roomIds: number[]): Promise<Map<string, string>> =>
      Promise.resolve(
        new Map(roomIds.map((roomId) => [String(roomId), 'standard'])),
      ),
  );

  validateRoomAvailability = jest.fn().mockResolvedValue(undefined);

  validateMultiRoomOccupancy = jest.fn().mockResolvedValue(undefined);

  createReservation = jest.fn(
    (_params: CreateReservationParams): Promise<CreateReservationResponse> =>
      Promise.resolve({ reservation_id: 'EXT-TEST-1' }),
  );

  modifyReservation = jest.fn(
    (..._args: unknown[]): Promise<PMSQuote> => Promise.resolve(this.quote),
  );

  cancelReservation = jest.fn().mockResolvedValue({ status: true });

  cancelExternalDirectReservation = jest
    .fn()
    .mockResolvedValue({ status: true });

  shouldFetchDiscount = jest.fn().mockReturnValue(false);

  buildPartnerNotes = jest.fn().mockReturnValue(null);

  private quote: PMSQuote;

  constructor(options: StubPmsReservationServiceOptions = {}) {
    this.quote = options.quote ?? {
      amountCharged: 100,
      base_rate: 80,
      fees: 10,
      taxes: 10,
      total_amount: 100,
    };
  }
}
