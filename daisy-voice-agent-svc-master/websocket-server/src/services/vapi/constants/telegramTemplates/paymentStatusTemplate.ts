import { PaymentStatus } from '../../../../dtos/enum/PaymentStatus';
import { SessionType } from '../../../../dtos/enum/SessionType';
import { formatCurrencyAmount } from '../../../../utils/helper';
import { sanitizeTelegramHTML } from '../../../../utils/sanitizeTelegramHTML';
export interface PaymentStatusMessage {
  status: PaymentStatus;
  phoneNumber: string;
  bookingId: string | null;
  amount: number;
  guestFirstName: string;
  totalAmount: number;
  sessionType: SessionType;
  guestLastName?: string;
  startDate?: Date;
  endDate?: Date;
  currency?: string;
  isAutoCharge?: boolean;
  retryInfo?: { attempt: number; maxRetries: number };
}

function formatDate(date: Date | undefined): string {
  if (!date) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatPhoneForTelegram(
  phoneNumber: string | undefined | null,
  sessionType: SessionType,
): string {
  const raw = String(phoneNumber || '').trim();
  if (!raw) return '';
  if (sessionType === SessionType.CHAT) {
    return raw.startsWith('+') ? raw.slice(1) : raw;
  }
  return raw.startsWith('+') ? raw : `+${raw}`;
}

export enum BookingPaymentNote {
  COLLECT_AT_HOTEL = 'No payment has been collected. All payments to be collected by the hotel.',
  AUTO_CHARGE_LATER = 'No payment collected at booking. Payment will be auto-charged per hotel policy.',
  CLOUDBEDS_CARD_CAPTURE = 'Cloudbeds will handle the auto-charge as per the hotel configuration.',
  CLOUDBEDS_CHARGED_AT_BOOKING = 'Paid in full at booking through Cloudbeds Payments.',
  CLOUDBEDS_CHARGE_NEEDS_CHECK = 'Card on file, but the charge at booking was not confirmed for every room. Check the payment in Cloudbeds before charging again.',
}

export interface BookingConfirmedMessage {
  phoneNumber: string;
  bookingId: string | null;
  guestFirstName: string;
  totalAmount: number;
  sessionType: SessionType;
  paymentNote: BookingPaymentNote;
  guestLastName?: string;
  startDate?: Date;
  endDate?: Date;
  currency?: string;
  /** Rooms of the same booking the PMS refused after the others were booked. */
  failedBookingIds?: string[];
}

export function noPaymentBookingConfirmedTemplate(
  message: BookingConfirmedMessage,
): string {
  const totalAmountValue = Number(message.totalAmount) || 0;
  const currency = message.currency;
  const formattedPhone = formatPhoneForTelegram(
    message.phoneNumber,
    message.sessionType,
  );
  const caller = formattedPhone
    ? `<a href="tel:${formattedPhone}">${sanitizeTelegramHTML(formattedPhone)}</a>`
    : '';

  const bookingId = sanitizeTelegramHTML(message.bookingId || '');
  const guestName = sanitizeTelegramHTML(
    `${message.guestFirstName || ''} ${message.guestLastName || ''}`.trim(),
  );
  const stay = sanitizeTelegramHTML(
    `${formatDate(message.startDate)} -> ${formatDate(message.endDate)}`,
  );
  const totalAmount = sanitizeTelegramHTML(
    !isNaN(totalAmountValue) && currency
      ? formatCurrencyAmount(currency, totalAmountValue)
      : '',
  );

  let text = '';
  switch (message.sessionType) {
    case SessionType.CALL:
      text += `Source: Call\n📞Caller: ${caller}\n`;
      break;
    case SessionType.WEB:
      text += `Source: Web\nCustomer phone: ${caller}\n`;
      break;
    case SessionType.CHAT:
      text += `Source: Chat\nCustomer ID: ${caller}\n`;
      break;
    case SessionType.SMS:
      text += `Source: SMS\nCustomer phone: ${caller}\n`;
      break;
  }

  const failedBookingIds = message.failedBookingIds ?? [];
  text += failedBookingIds.length
    ? `<b>⚠️ Booking Partly Confirmed</b>\n\n`
    : `<b>✅ Booking Confirmed</b>\n\n`;
  text += `Booking ID: ${bookingId}  |  Guest: ${guestName}\n`;
  text += `Stay: ${stay}\n`;
  text += `Total Amount: ${totalAmount}\n\n`;
  if (failedBookingIds.length) {
    text += `<b>Not booked:</b> ${sanitizeTelegramHTML(failedBookingIds.join(', '))}. Please follow up with the guest.\n\n`;
  }
  const note = message.paymentNote;
  text += `<i>⚠️ ${sanitizeTelegramHTML(note)}</i>`;

  return text.trim();
}

export function paymentStatusTemplate(message: PaymentStatusMessage): string {
  const status = message.status;

  const amountValue = Number(message.amount) || 0;
  const totalAmountValue = Number(message.totalAmount) || 0;
  const remainingValue = Number(totalAmountValue - amountValue);
  const currency = message.currency;
  const formattedPhone = formatPhoneForTelegram(
    message.phoneNumber,
    message.sessionType,
  );
  const caller = formattedPhone
    ? `<a href="tel:${formattedPhone}">${sanitizeTelegramHTML(formattedPhone)}</a>`
    : '';

  const amount = sanitizeTelegramHTML(
    !isNaN(amountValue) && currency
      ? formatCurrencyAmount(currency, amountValue)
      : '',
  );

  const bookingId = sanitizeTelegramHTML(message.bookingId || '');

  const guestName = sanitizeTelegramHTML(
    `${message.guestFirstName || ''} ${message.guestLastName || ''}`.trim(),
  );

  const stay = sanitizeTelegramHTML(
    `${formatDate(message.startDate)} -> ${formatDate(message.endDate)}`,
  );

  const totalAmount = sanitizeTelegramHTML(
    !isNaN(totalAmountValue) && currency
      ? formatCurrencyAmount(currency, totalAmountValue)
      : '',
  );

  const remainingBalance = sanitizeTelegramHTML(
    !isNaN(remainingValue) && currency
      ? formatCurrencyAmount(currency, remainingValue)
      : '',
  );

  let text = '';
  switch (message.sessionType) {
    case SessionType.CALL:
      text += `Source: Call\n📞Caller: ${caller}\n`;
      break;
    case SessionType.WEB:
      text += `Source: Web\nCustomer phone: ${caller}\n`;
      break;
    case SessionType.CHAT:
      text += `Source: Chat\nCustomer ID: ${caller}\n`;
      break;
    case SessionType.SMS:
      text += `Source: SMS\nCustomer phone: ${caller}\n`;
      break;
  }

  switch (status) {
    case PaymentStatus.COMPLETED:
      text += `<b>✅ Payment Received</b>\n\n`;
      text += `Amount Received: <b>${amount}</b>\n`;
      break;
    case PaymentStatus.FAILED:
      if (message.isAutoCharge && message.retryInfo) {
        text += `<b>❌ Auto-Charge Failed — Retries Exhausted (${message.retryInfo.attempt}/${message.retryInfo.maxRetries})</b>\n\n`;
      } else if (message.isAutoCharge) {
        text += `<b>❌ Auto-Charge Payment Failed</b>\n\n`;
      } else {
        text += `<b>❌ Payment Failed</b>\n\n`;
      }
      text += `Attempted Amount: <b>${amount}</b>\n`;
      break;
  }

  text += `Booking ID: ${bookingId}  |  Guest: ${guestName}\n`;
  text += `Stay: ${stay}\n`;
  text += `Total Amount: ${totalAmount}`;

  if (status === PaymentStatus.COMPLETED) {
    text += `  |  Remaining Balance: ${remainingBalance}`;
  }

  return text.trim();
}
