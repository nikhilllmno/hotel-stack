import { Customer } from '../../dtos/Customer';
import { Hotel } from '../../dtos/Hotel';
import logger from '../../utils/logger';

/**
 * Context log for payment-failure monitoring (invoice ↔ hotel / phones).
 * Kept as a stringified message so log scrapers can parse JSON fields from plain text.
 */
export function logPaymentContext(args: {
  invoiceId: string;
  hotel: Hotel;
  bookingId: string;
  customer: Customer;
}): void {
  try {
    logger.info(
      `Payment context: ${JSON.stringify({
        invoice: args?.invoiceId,
        hotel_id: args?.hotel?.id,
        booking_id: args?.bookingId,
        customer_phone_suffix: args?.customer?.phone_number?.slice(-4),
        assistant_phone_suffix: args?.hotel?.assistant_phone_number?.slice(-4),
      })}`,
    );
  } catch (error) {
    logger.error('Failed to log payment context:', error);
  }
}
