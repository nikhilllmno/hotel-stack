import { PaymentStatus } from '../../dtos/enum/PaymentStatus';
import { Reservation } from '../../dtos/Reservation';
import { NoDataError } from '../../errors/NoDataError';
import { DiscountType } from '../../types/discount';
import { Country } from '../../types/enums';
import {
  formatCurrencyAmount,
  formatDateYYYYMMDD,
  formatPhoneNumber,
} from '../../utils/helper';

export function bookingLinkSMSTemplate(
  hotelName: string,
  bookingLink: string,
): string {
  return (
    `Thank you for choosing ${hotelName}!\n` +
    `To complete your reservation, please use this link: ${bookingLink}\n` +
    `You can review the details, add additional rooms if needed, and complete your payment.\n` +
    `We look forward to welcoming you soon!`
  );
}

export function reviewLinkSMSTemplate(
  hotelName: string,
  reviewLink: string,
  timeoutMins: number,
  hotelPhoneNumber: string,
  hotelCountry: Country,
  smsAgentEnabled = false,
): string {
  const formattedPhoneNumber = hotelPhoneNumber
    ? formatPhoneNumber(hotelPhoneNumber, hotelCountry)
    : '';
  const automatedNote = smsAgentEnabled
    ? ''
    : 'Please note: this is an automated message — please do not reply.' +
      (formattedPhoneNumber
        ? ` If you need any assistance, kindly give us a call at ${formattedPhoneNumber}.`
        : '') +
      '\n';
  return (
    `Thank you for choosing ${hotelName}!\n` +
    `To confirm your reservation, please review and submit your details here: ${reviewLink} .\n` +
    `This link will expire in ${timeoutMins} minutes.\n` +
    automatedNote +
    `We look forward to welcoming you soon!`
  );
}

export function paymentLinkSMSTemplate(
  hotelName: string,
  url: string,
  timeoutMins: number,
  hotelPhoneNumber: string,
  hotelCountry: Country,
  smsAgentEnabled = false,
): string {
  const formattedPhoneNumber = formatPhoneNumber(
    hotelPhoneNumber,
    hotelCountry,
  );
  const automatedNote = smsAgentEnabled
    ? ''
    : `Please note: this is an automated message — please do not reply. If you need any assistance, kindly give us a call at ${formattedPhoneNumber}.\n`;
  return (
    `Thank you for choosing ${hotelName}!\n` +
    `To confirm your reservation, please complete your payment here: ${url} .\n` +
    `This link will expire in ${timeoutMins} minutes, and without payment the reservation will be cancelled.\n` +
    automatedNote +
    `We look forward to welcoming you soon!`
  );
}

export function followupPaymentLinkSMSTemplate(
  hotelName: string,
  url: string,
  timeoutMins: number,
): string {
  return (
    `Hi there, this is the reservation team at ${hotelName}. Anything further we can help with?\n\n` +
    `Btw, for your dates, I'm holding your room here for the next ${timeoutMins} mins: ${url} .\n\n` +
    `Feel free to let me know if there's anything else you need\n\n` +
    `-Danny`
  );
}

export function paymentLinkEmailTemplate(
  firstName: string,
  hotelName: string,
  url: string,
  timeoutMins: number,
): string {
  return [
    `Hello ${firstName},`,
    `Thank you for choosing ${hotelName}!`,
    `To confirm your reservation, please complete your payment here: <a href="${url}">Complete Payment</a>.`,
    `The link will expire in ${timeoutMins} minutes, and without payment the reservation will be cancelled.`,
    `We look forward to welcoming you soon!`,
  ].join('<br/>');
}

export function paymentReminderSMSTemplate(
  firstName: string,
  hotelName: string,
  url: string,
  minutesLeft: number,
  hotelPhoneNumber: string,
  hotelCountry: Country,
  reminderNumber = 1,
  smsAgentEnabled = false,
): string {
  const formattedPhoneNumber = formatPhoneNumber(
    hotelPhoneNumber,
    hotelCountry,
  );
  const automatedNote = smsAgentEnabled
    ? ''
    : `Please note: this is an automated message — please do not reply. If you need any assistance, kindly give us a call at ${formattedPhoneNumber}.\n`;
  if (reminderNumber === 1) {
    return (
      `Hi ${firstName}, a gentle reminder that you have [${minutesLeft} mins] to secure your reservation by completing the payment on ${url} .\n` +
      `Without payment, the reservation will be cancelled and released for others to book.\n` +
      automatedNote
    );
  }
  return (
    `Hi ${firstName}, this is your final reminder to complete your payment to secure your reservation at ${hotelName}. The link shared above expires in [${minutesLeft} mins].\n` +
    automatedNote +
    `Cheers`
  );
}

export function reservationCancelledDueToPaymentExpirationSMSTemplate(
  firstName: string,
  hotelName: string,
  hotelPhoneNumber: string,
  hotelCountry: Country,
  smsAgentEnabled = false,
): string {
  const formattedPhoneNumber = formatPhoneNumber(
    hotelPhoneNumber,
    hotelCountry,
  );
  const automatedNote = smsAgentEnabled
    ? ''
    : `This is an automated message — please do not reply.\n`;
  return (
    `Hi ${firstName}, this is ${hotelName}.\n` +
    `The payment link for your reservation has expired, and your booking has been cancelled because we did not receive your payment.\n` +
    `If you would still like to stay with us, please call us at ${formattedPhoneNumber} and we'll be happy to assist you with a new reservation.\n` +
    automatedNote +
    `Thank you.`
  );
}

export function reservationCancelledByUserSMSTemplate(
  firstName: string,
  hotelName: string,
  hotelPhoneNumber: string,
  hotelCountry: Country,
  smsAgentEnabled = false,
): string {
  const formattedPhoneNumber = formatPhoneNumber(
    hotelPhoneNumber,
    hotelCountry,
  );
  const automatedNote = smsAgentEnabled
    ? ''
    : `Please note: this is an automated message — please do not reply. If you need any assistance, kindly give us a call at ${formattedPhoneNumber}.\n`;
  return (
    `Hi ${firstName}, this is ${hotelName}.\n` +
    `Your reservation has been cancelled as per your request.\n` +
    `We're sorry to miss the chance to host you this time, and we hope to welcome you on a future stay.\n` +
    automatedNote
  );
}

export function reservationCancelledByDashboardSMSTemplate(
  firstName: string,
  hotelName: string,
  hotelPhoneNumber: string,
  hotelCountry: Country,
  smsAgentEnabled = false,
): string {
  const formattedPhoneNumber = formatPhoneNumber(
    hotelPhoneNumber,
    hotelCountry,
  );
  const automatedNote = smsAgentEnabled
    ? ''
    : `Please note: this is an automated message — please do not reply. If you need any assistance, kindly give us a call at ${formattedPhoneNumber}.\n`;
  return (
    `Hi ${firstName}, this is ${hotelName}.\n` +
    `Your reservation has been cancelled.\n` +
    `If you have any questions or would like to rebook, please contact us at ${formattedPhoneNumber}.\n` +
    automatedNote
  );
}

export function discountSMSTemplate(
  hotelName: string,
  hotelPhoneNumber: string,
  discountType: DiscountType,
  discountValue: number,
  expiryDays: number,
  hotelCountry: Country,
  currency: string,
  smsAgentEnabled = false,
): string {
  const discountText =
    discountType === DiscountType.FLAT
      ? formatCurrencyAmount(currency, discountValue)
      : `${discountValue}%`;
  const formattedPhoneNumber = formatPhoneNumber(
    hotelPhoneNumber,
    hotelCountry,
  );
  const expiryHours = expiryDays * 24;
  const automatedNote = smsAgentEnabled
    ? ''
    : `\n\nThis is an automated message — please do not reply.`;
  return (
    `Hey there - this is ${hotelName} reaching out, in case we didn't meet your requirements for your stay.\n` +
    `Just to let you know, if you had issues with our room pricing, we're happy to provide a ${discountText} discount if you call us back within ${expiryHours} hours of this message.\n` +
    `If interested, please only use this number to give us a call back on ${formattedPhoneNumber}.\n` +
    `Note that we cannot offer a discount if you use a different number from this one to make a booking.\n` +
    `We look forward to welcoming you!` +
    automatedNote
  );
}

export function paymentSuccessSMSTemplate(
  checkIn: string,
  checkOut: string,
  customerEmail: string,
  amount: number,
  currency: string,
  bookingId?: string,
): string {
  const bookingIdText = bookingId ? ` Your booking ID is ${bookingId}.` : '';
  return `You're all set! We've received your ${formatCurrencyAmount(currency, amount)} advance and your ${checkIn} to ${checkOut} booking is confirmed.${bookingIdText} Confirmation sent to ${customerEmail ? customerEmail : 'your email'}.\nSee you soon!`;
}

export function bookingConfirmedSMSTemplate(
  checkIn: string,
  checkOut: string,
  customerEmail: string,
  bookingId?: string,
): string {
  const bookingIdText = bookingId ? ` Your booking ID is ${bookingId}.` : '';
  return `You're all set! Your ${checkIn} to ${checkOut} booking is confirmed.${bookingIdText} Confirmation sent to ${customerEmail ? customerEmail : 'your email'}.\nSee you soon!`;
}

export function bookingPartlyConfirmedSMSTemplate(
  checkIn: string,
  checkOut: string,
  customerEmail: string,
  failedRoomCount: number,
  totalRoomCount: number,
  bookingId?: string,
): string {
  const bookingIdText = bookingId ? ` Your booking ID is ${bookingId}.` : '';
  return `Your ${checkIn} to ${checkOut} booking is only partly confirmed: ${failedRoomCount} of your ${totalRoomCount} rooms could not be booked.${bookingIdText} Confirmation of the booked rooms sent to ${customerEmail ? customerEmail : 'your email'}.\nPlease try again from your booking link, or contact the property.`;
}

export function guestChargedSMSTemplate(
  firstName: string,
  hotelName: string,
  amount: number,
  currency: string,
  hotelPhoneNumber: string,
  hotelCountry: Country,
  reason?: string,
  smsAgentEnabled = false,
): string {
  const formattedPhoneNumber = formatPhoneNumber(
    hotelPhoneNumber,
    hotelCountry,
  );
  const reasonText = reason ? ` for ${reason}` : '';
  const automatedNote = smsAgentEnabled
    ? ''
    : `Please note: this is an automated message — please do not reply.\n`;
  return (
    `Hi ${firstName}, this is ${hotelName}.\n` +
    `We have charged ${formatCurrencyAmount(currency, amount)}${reasonText} to your payment method.\n` +
    `If you have any questions or concerns, please contact us at ${formattedPhoneNumber}.\n` +
    automatedNote +
    `Thank you.`
  );
}

export function guestAutoChargedSMSTemplate(
  amount: number,
  reservation: Reservation,
): string {
  if (!reservation.hotel) {
    throw new NoDataError(
      `guestAutoChargedSMSTemplate: No hotel found for reservation ${reservation.id}`,
    );
  }
  const firstName = reservation.customer.first_name || 'Guest';
  const hotelName = reservation.hotel.name || '';
  const currency = reservation.hotel.currency || '';
  const checkInDate = reservation.check_in
    ? reservation.check_in.toDateString()
    : '';
  const checkOutDate = reservation.check_out
    ? reservation.check_out.toDateString()
    : '';
  const adults = reservation.num_adults || 0;
  const children = reservation.num_children || 0;
  const pets = reservation.num_pets || 0;
  const roomType = reservation.room_type || '';

  return (
    `Hi ${firstName},\n` +
    `we've processed your remaining balance of ${formatCurrencyAmount(currency, amount)} for your stay at ${hotelName}. Looking forward to welcoming you!\n` +
    `Reservation Details:\n` +
    `Dates: ${checkInDate} - ${checkOutDate}\n` +
    `RoomType: ${roomType}\n` +
    `Guests - ${adults} Adults, ${children ? `${children} Children` : ''}, ${pets ? `${pets} Pets` : ''}\n` +
    `You're all set! We look forward to welcoming you.`
  );
}

export function guestRefundedSMSTemplate(
  firstName: string,
  hotelName: string,
  amount: number,
  currency: string,
  hotelPhoneNumber: string,
  hotelCountry: Country,
  reason?: string,
  smsAgentEnabled = false,
): string {
  const formattedPhoneNumber = formatPhoneNumber(
    hotelPhoneNumber,
    hotelCountry,
  );
  const reasonText = reason ? ` for ${reason}` : '';
  const automatedNote = smsAgentEnabled
    ? ''
    : `Please note: this is an automated message — please do not reply.\n`;
  return (
    `Hi ${firstName}, this is ${hotelName}.\n` +
    `We have processed a refund of ${formatCurrencyAmount(currency, amount)}${reasonText} to your payment method.\n` +
    `Please allow 5-10 business days for the refund to appear in your account.\n` +
    `If you have any questions, please contact us at ${formattedPhoneNumber}.\n` +
    automatedNote +
    `Thank you.`
  );
}

export function reservationModifiedRefundTelegramTemplate(
  reservation: Reservation,
  refundAmount: number | null,
  newCheckIn: string,
  newCheckOut: string,
): string {
  const guestName =
    `${reservation.customer.first_name || ''} ${reservation.customer.last_name || ''}`.trim() ||
    'Guest';
  const bookingId =
    reservation.external_public_id ||
    reservation.external_id ||
    reservation.booking_id ||
    '';
  const originalCheckIn = formatDateYYYYMMDD(reservation.check_in);
  const originalCheckOut = formatDateYYYYMMDD(reservation.check_out);
  const modifiedCheckIn = newCheckIn;
  const modifiedCheckOut = newCheckOut;
  const currency = reservation.hotel?.currency || '';

  const escapeMarkdownV2 = (text: string): string => {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
  };

  const refundLine =
    refundAmount != null
      ? `  • Refund Amount\\: ${escapeMarkdownV2(formatCurrencyAmount(currency, refundAmount))}\n`
      : `  • Refund Amount\\: To be determined\n`;

  return (
    `*Reservation Modified \\- Review Refund Eligibility*\n\n` +
    `*Guest\\:* ${escapeMarkdownV2(guestName)}\n` +
    `*Booking ID\\:* ${escapeMarkdownV2(bookingId)}\n` +
    `*Modification Details\\:*\n` +
    `  • Previous Dates\\: ${escapeMarkdownV2(String(originalCheckIn))} \\-\\> ${escapeMarkdownV2(String(originalCheckOut))}\n` +
    `  • New Dates\\: ${escapeMarkdownV2(String(modifiedCheckIn))} \\-\\> ${escapeMarkdownV2(String(modifiedCheckOut))}\n` +
    refundLine +
    `\n*Next Steps\\:*\n` +
    `Open Dextr Dashboard to review the modified booking and process the refund\\.`
  );
}

export function reservationModifiedPaymentTelegramTemplate(
  reservation: Reservation,
  additionalAmount: number,
  newCheckIn: string,
  newCheckOut: string,
  newDateBreakdown: Array<{
    date: string;
    room_type: string;
    rate_code: string;
    amount: number;
    currency: string;
  }> = [],
): string {
  const guestName =
    `${reservation.customer.first_name || ''} ${reservation.customer.last_name || ''}`.trim() ||
    'Guest';
  const bookingId =
    reservation.external_public_id ||
    reservation.external_id ||
    reservation.booking_id ||
    '';
  const originalCheckIn = formatDateYYYYMMDD(reservation.check_in);
  const originalCheckOut = formatDateYYYYMMDD(reservation.check_out);
  const modifiedCheckIn = newCheckIn;
  const modifiedCheckOut = newCheckOut;
  const currency = reservation.hotel?.currency || '';

  const escapeMarkdownV2 = (text: string): string => {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
  };

  const dateBreakdownLines =
    newDateBreakdown.length > 0
      ? `\n*Additional Nights Breakdown\\:*\n` +
        newDateBreakdown
          .map(
            (entry) =>
              `  • ${escapeMarkdownV2(entry.date)} \\| ${escapeMarkdownV2(entry.room_type)} \\| ${escapeMarkdownV2(entry.rate_code)} \\| ${escapeMarkdownV2(formatCurrencyAmount(entry.currency, entry.amount))}`,
          )
          .join('\n') +
        '\n'
      : '';

  return (
    `*Reservation Modified \\- Payment Collection Required*\n\n` +
    `*Guest\\:* ${escapeMarkdownV2(guestName)}\n` +
    `*Booking ID\\:* ${escapeMarkdownV2(bookingId)}\n` +
    `*Modification Details\\:*\n` +
    `  • Previous Dates\\: ${escapeMarkdownV2(String(originalCheckIn))} \\-\\> ${escapeMarkdownV2(String(originalCheckOut))}\n` +
    `  • New Dates\\: ${escapeMarkdownV2(String(modifiedCheckIn))} \\-\\> ${escapeMarkdownV2(String(modifiedCheckOut))}\n` +
    `  • Additional Amount\\: ${escapeMarkdownV2(formatCurrencyAmount(currency, additionalAmount))}\n` +
    dateBreakdownLines +
    `\n*Next Steps\\:*\n` +
    `Collect the additional payment from the guest at the property\\.`
  );
}

export function reservationModifiedRoomChangeTelegramTemplate(
  reservation: Reservation,
  newRoomTypeName: string,
  newCheckIn: string,
  newCheckOut: string,
  newRoomTotalAmount: number,
): string {
  const guestName =
    `${reservation.customer.first_name || ''} ${reservation.customer.last_name || ''}`.trim() ||
    'Guest';
  const bookingId =
    reservation.external_public_id ||
    reservation.external_id ||
    reservation.booking_id ||
    '';
  const originalCheckIn = formatDateYYYYMMDD(reservation.check_in);
  const originalCheckOut = formatDateYYYYMMDD(reservation.check_out);
  const modifiedCheckIn = newCheckIn;
  const modifiedCheckOut = newCheckOut;
  const currency = reservation.hotel?.currency || '';

  const escapeMarkdownV2 = (text: string): string => {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
  };

  return (
    `*Reservation Modified \\- Room Change*\n\n` +
    `*Guest\\:* ${escapeMarkdownV2(guestName)}\n` +
    `*Booking ID\\:* ${escapeMarkdownV2(bookingId)}\n` +
    `*Modification Details\\:*\n` +
    `  • Previous Dates\\: ${escapeMarkdownV2(String(originalCheckIn))} \\-\\> ${escapeMarkdownV2(String(originalCheckOut))}\n` +
    `  • New Dates\\: ${escapeMarkdownV2(String(modifiedCheckIn))} \\-\\> ${escapeMarkdownV2(String(modifiedCheckOut))}\n` +
    `  • New Room\\: ${escapeMarkdownV2(newRoomTypeName)}\n` +
    `  • New Room Total\\: ${escapeMarkdownV2(formatCurrencyAmount(currency, newRoomTotalAmount))}\n` +
    `\n*Note\:* The amount shown is the total for the new room, not the payment delta\. Any additional payment or refund should be settled at the property\.`
  );
}

export function bookingCancelledReviewRefundTelegramTemplate(
  reservation: Reservation,
): string {
  const guestName =
    `${reservation.customer.first_name || ''} ${reservation.customer.last_name || ''}`.trim() ||
    'Guest';
  const bookingId =
    reservation.external_public_id ||
    reservation.external_id ||
    reservation.booking_id ||
    '';
  const bookedOn = reservation.created_at
    ? formatDateYYYYMMDD(reservation.created_at)
    : 'N/A';
  const checkInDate = formatDateYYYYMMDD(reservation.check_in);
  const checkOutDate = formatDateYYYYMMDD(reservation.check_out);
  const amountCollected =
    reservation.payments?.reduce(
      (sum, payment) =>
        [
          PaymentStatus.COMPLETED,
          PaymentStatus.REFUNDED,
          PaymentStatus.REFUND_FAILED,
        ].includes(payment.payment_status)
          ? sum + (Number(payment.amount_charged) ?? 0)
          : sum,
      0,
    ) ?? 0;
  const currency = reservation.hotel?.currency || '';

  // Escape special characters for Telegram MarkdownV2
  const escapeMarkdownV2 = (text: string): string => {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
  };

  return (
    `*Booking Cancelled \\- Review Refund Eligibility*\n\n` +
    `*Guest\\:* ${escapeMarkdownV2(guestName)}\n` +
    `*Booking ID\\:* ${escapeMarkdownV2(bookingId)}\n` +
    `*Booking Details\\:*\n` +
    `  • Booked On\\: ${escapeMarkdownV2(bookedOn)}\n` +
    `  • Dates\\: ${escapeMarkdownV2(String(checkInDate))} \\-\\> ${escapeMarkdownV2(String(checkOutDate))}\n` +
    `  • Amount Collected\\: ${escapeMarkdownV2(formatCurrencyAmount(currency, amountCollected))}\n\n` +
    `*Next Steps\\:*\n` +
    `Open Dextr Dashboard to review cancelled booking and process refund if applicable\\.`
  );
}

export function externalDirectBookingCancelledReviewRefundTelegramTemplate(
  reservation: Reservation,
): string {
  const guestName =
    `${reservation.customer.first_name || ''} ${reservation.customer.last_name || ''}`.trim() ||
    'Guest';
  const bookingId =
    reservation.external_public_id ||
    reservation.external_id ||
    reservation.booking_id ||
    '';
  const bookedOn = reservation.created_at
    ? formatDateYYYYMMDD(reservation.created_at)
    : 'N/A';
  const checkInDate = formatDateYYYYMMDD(reservation.check_in);
  const checkOutDate = formatDateYYYYMMDD(reservation.check_out);

  const escapeMarkdownV2 = (text: string): string => {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
  };

  return (
    `*Booking Cancelled \\- Review Refund Eligibility*\n\n` +
    `*Guest\\:* ${escapeMarkdownV2(guestName)}\n` +
    `*Booking ID\\:* ${escapeMarkdownV2(bookingId)}\n` +
    `*Booking Details\\:*\n` +
    `  • Booked On\\: ${escapeMarkdownV2(bookedOn)}\n` +
    `  • Dates\\: ${escapeMarkdownV2(String(checkInDate))} \\-\\> ${escapeMarkdownV2(String(checkOutDate))}\n` +
    `  • Refund Amount\\: To be determined\n`
  );
}

/** Guest SMS when a manager takes over the conversation (Telegram barge-in). */
export function managerSteppingInSmsTemplate(): string {
  return 'Manager is stepping into this chat to assist you personally.';
}

/** Guest SMS when routing returns to Daisy AI after manager handback. */
export function managerSteppingOutSmsTemplate(): string {
  return 'Manager is stepping out of the chat. Daisy will handle your messages from now on.';
}
