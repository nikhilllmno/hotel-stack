export enum StripeWebhookEventType {
  PaymentIntentSucceeded = 'payment_intent.succeeded',
  PaymentIntentFailed = 'payment_intent.payment_failed',
  PaymentIntentCanceled = 'payment_intent.canceled',
  InvoicePaymentPaid = 'invoice_payment.paid',
  InvoicePaymentFailed = 'invoice.payment_failed',
  RefundUpdated = 'refund.updated',
  CheckoutSessionCompleted = 'checkout.session.completed',
}
