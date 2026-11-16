import { ReservationPaymentStatus } from '../../../../dtos/enum/ReservationPaymentStatus';
import { formatCurrencyAmount } from '../../../../utils/helper';
import { sanitizeTelegramHTML } from '../../../../utils/sanitizeTelegramHTML';

export interface CallCompletionMessage {
  phoneNumber?: string;
  callStartTime?: Date;
  callEndTime?: Date;
  duration?: string; // in milliseconds
  callbackRequest?: string[];
  bookingDetails?: Array<{
    id?: string;
    external_id?: string;
    external_public_id?: string;
    guestFirstName?: string;
    guestLastName?: string;
    noOfAdults?: number;
    noOfChildren?: number;
    noOfPets?: number;
    startDate?: Date;
    endDate?: Date;
    rateTotal?: number;
    advance?: number;
    paymentStatus?: ReservationPaymentStatus;
    currency?: string;
  }>;
  summary?: string;
  recordingLink?: string;
}

function formatDate(date: Date | undefined): string {
  if (!date) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatDuration(ms: string | undefined): string {
  if (!ms) return '';
  const totalSeconds = Math.floor(Number(ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes} min ${seconds} sec`;
}

function formatArray(arr?: string[]): string {
  return sanitizeTelegramHTML((arr || []).join(' / '));
}

export function callCompletionTemplate(
  message: CallCompletionMessage = {},
): string {
  const formattedPhone = message.phoneNumber
    ? message.phoneNumber.startsWith('+')
      ? message.phoneNumber
      : `+${message.phoneNumber}`
    : '';
  const caller = formattedPhone
    ? `<a href="tel:${formattedPhone}">${sanitizeTelegramHTML(formattedPhone)}</a>`
    : '';

  let durationInMs = 0;
  if (message.callStartTime && message.callEndTime) {
    durationInMs =
      new Date(message.callEndTime).getTime() -
      new Date(message.callStartTime).getTime();
  }
  const duration = sanitizeTelegramHTML(formatDuration(String(durationInMs)));
  const summary = sanitizeTelegramHTML(message.summary || '');
  const callbackRequestText = message.callbackRequest?.length
    ? `<b>Callback Request Details</b>\n${formatArray(message.callbackRequest)}\n`
    : '';

  const recordingLink = message.recordingLink
    ? `<a href="${sanitizeTelegramHTML(message.recordingLink)}">Download call recording</a>`
    : 'No transcription link available';

  let text = `
  <b>📞 New Call Alert</b>
  Caller: ${caller}
  Duration: ${duration}

  ${callbackRequestText}
  `;

  // PS: Multi-room bookings are not distinct bookings. Distinct bookings do not have a common booking_id prefix.
  const distinctBookings = message.bookingDetails || [];
  for (const booking of distinctBookings) {
    const guestName = sanitizeTelegramHTML(
      `${booking.guestFirstName || ''} ${booking.guestLastName || ''}`.trim(),
    );

    const guests = [
      booking.noOfAdults || booking.noOfAdults === 0
        ? `${booking.noOfAdults} Adults`
        : 'No Adults',
      booking.noOfChildren || booking.noOfChildren === 0
        ? `${booking.noOfChildren} Children`
        : null,
      booking.noOfPets || booking.noOfPets === 0
        ? `${booking.noOfPets} Pets`
        : null,
    ]
      .filter(Boolean)
      .join(', ');

    const stay = `${formatDate(booking.startDate)} to ${formatDate(booking.endDate)}`;
    const rateTotal =
      (booking.rateTotal || booking.rateTotal === 0) && booking.currency
        ? formatCurrencyAmount(booking.currency, booking.rateTotal)
        : '';
    const advance =
      (booking.advance || booking.advance === 0) && booking.currency
        ? formatCurrencyAmount(booking.currency, booking.advance)
        : '';
    const idToExpose = booking.external_public_id || booking.external_id;
    text += `
    <b>Booking Details</b>
    `;
    if (idToExpose) {
      text += `
    Booking ID: ${sanitizeTelegramHTML(idToExpose)}  |  Guest: ${guestName}
      `;
    }
    if (booking.paymentStatus) {
      const paymentStatus = booking.paymentStatus.toString().toUpperCase();
      text += `
    Payment Status: ${sanitizeTelegramHTML(paymentStatus)}
    `;
    }
    text += `
    Guests: ${sanitizeTelegramHTML(guests)}
    Stay: ${sanitizeTelegramHTML(stay)}
    Rate Total: ${sanitizeTelegramHTML(rateTotal)}
    Advance: ${sanitizeTelegramHTML(advance)}

    `;
  }

  text += `
    <b>Summary</b>
    ${summary}

    ${recordingLink}
  `.trim();

  return text;
}
