import { BaseError } from './BaseError';

export const PAYMENT_SUCCEEDED_PROCESSING_FAILED =
  'PAYMENT_SUCCEEDED_PROCESSING_FAILED';

/**
 * HTTP Status Code: 207 Multi-Status
 *
 * Thrown when a Shift4 charge succeeded (money was collected) but downstream
 * processing — DB status updates, reservation creation, PMS recording, etc. —
 * subsequently failed. The payment exists and must NOT be retried; manual
 * reconciliation may be required.
 *
 * Frontend should check `errorCode === PAYMENT_SUCCEEDED_PROCESSING_FAILED`
 * and surface a message like: "Payment was collected but we encountered an
 * issue finalising your booking. Please contact support with reference: <invoiceId>."
 */
export class PaymentSucceededProcessingFailedError extends BaseError {
  errorCode: string;
  paymentId: string;
  invoiceId: string;

  constructor(message: string, paymentId: string, invoiceId: string) {
    super(message);
    this.name = 'PaymentSucceededProcessingFailedError';
    this.statusCode = 207;
    this.errorCode = PAYMENT_SUCCEEDED_PROCESSING_FAILED;
    this.paymentId = paymentId;
    this.invoiceId = invoiceId;

    Object.setPrototypeOf(
      this,
      PaymentSucceededProcessingFailedError.prototype,
    );
  }

  public toJSON() {
    return {
      message: this.message,
      statusCode: this.statusCode,
      errorCode: this.errorCode,
      paymentId: this.paymentId,
      invoiceId: this.invoiceId,
    };
  }
}
