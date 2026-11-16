/**
 * Maps Opera's `reservations/rateInfo` summary onto the PMS-agnostic
 * `PMSQuote`, applying the hotel's pet fee.
 *
 * Opera reports `gross` as the stay before tax and `net` as gross + tax, so
 * `base_rate` is `gross` and `taxes` is `net - gross`. Per-night `details[]`
 * are summed rather than trusting the header when the header is missing.
 *
 * Opera exposes no fee bucket separate from tax on this endpoint, so `fees`
 * carries only the pet fee Daisy prices locally.
 */

import { HotelConfiguration } from '../../models/HotelConfiguration';
import { PMSQuote } from '../../pms/types/Quote';
import { getPetFeeStrategy } from '../../services/roomReservation/petFeeStrategies';
import { roundCurrency } from '../../utils/helper';
import logger from '../../utils/logger';
import { CalryPetFeeQuote, OperaRateInfoResponse } from '../types';

export interface OperaQuoteMappingParams {
  rateInfo: OperaRateInfoResponse;
  ratePlanCode: string;
  checkIn: string;
  checkOut: string;
  roomTypeId: string;
  numPets: number;
  hotelId: string;
  hotelConfig?: HotelConfiguration | null;
}

function sum(values: (number | undefined)[]): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

export function mapOperaRateInfoToPMSQuote({
  rateInfo,
  ratePlanCode,
  checkIn,
  checkOut,
  roomTypeId,
  numPets,
  hotelId,
  hotelConfig,
}: OperaQuoteMappingParams): PMSQuote {
  const summary = rateInfo.summary;
  const details = summary?.details ?? [];

  const baseRate = roundCurrency(
    summary?.gross ?? sum(details.map((night) => night.gross)),
  );
  const net = roundCurrency(summary?.net ?? sum(details.map((n) => n.net)));
  const taxes = roundCurrency(Math.max(0, net - baseRate));

  let fees = 0;
  const petFee = calculatePetFee({
    checkIn,
    checkOut,
    roomTypeId,
    numPets,
    hotelId,
    hotelConfig,
    pricing: { base_rate: baseRate, taxes, fees },
  });
  if (petFee > 0) {
    fees = petFee;
  }

  const totalAmount = roundCurrency(baseRate + taxes + fees);

  return {
    base_rate: baseRate,
    taxes,
    fees,
    total_amount: totalAmount,
    // As with the unified Calry path, Calry cannot collect a deposit, so the
    // whole amount is settled outside the PMS.
    amountCharged: totalAmount,
    currency: summary?.currencyCode,
    rate_code: ratePlanCode,
    rate_id: ratePlanCode,
    raw_response: rateInfo,
  };
}

function calculatePetFee({
  checkIn,
  checkOut,
  roomTypeId,
  numPets,
  hotelId,
  hotelConfig,
  pricing,
}: {
  checkIn: string;
  checkOut: string;
  roomTypeId: string;
  numPets: number;
  hotelId: string;
  hotelConfig?: HotelConfiguration | null;
  pricing: { base_rate: number; taxes: number; fees: number };
}): number {
  if (numPets <= 0) return 0;

  const strategy = getPetFeeStrategy(
    hotelId,
    hotelConfig?.pet_fee_configuration,
    roomTypeId,
  );
  if (!strategy) return 0;

  const total = roundCurrency(pricing.base_rate + pricing.taxes + pricing.fees);
  const quoteAdapter: CalryPetFeeQuote = {
    check_in: checkIn,
    check_out: checkOut,
    unit_group_id: roomTypeId,
    base_rate: pricing.base_rate,
    taxes: pricing.taxes,
    fees: pricing.fees,
    total_amount: total,
    amountCharged: total,
  };

  strategy.validatePetCount(numPets);
  const petFee = roundCurrency(
    strategy.calculatePetFee(quoteAdapter, numPets) || 0,
  );

  if (petFee > 0) {
    logger.info('Opera mapOperaRateInfoToPMSQuote: applying pet fee', {
      hotelId,
      roomTypeId,
      numPets,
      petFee,
    });
  }

  return petFee;
}
