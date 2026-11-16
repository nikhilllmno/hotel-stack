import { BaseError } from './BaseError';

/**
 * HTTP Status Code: 404 Not Found
 * Error thrown when a Shift4 GetInvoice request returns "Invoice Not Found".
 * This means the original transaction was never processed by Shift4 and can
 * safely be retried with the same invoice number.
 * Ref: https://docs.shift4.com/guides/response-handling/timeouts-and-communications-failures
 */
export class Shift4InvoiceNotFoundError extends BaseError {
  invoice: string;

  constructor(invoice: string) {
    super(
      `Shift4 invoice not found: ${invoice}. Original transaction can be retried.`,
    );
    this.statusCode = 404;
    this.invoice = invoice;

    Object.setPrototypeOf(this, Shift4InvoiceNotFoundError.prototype);
  }
}
