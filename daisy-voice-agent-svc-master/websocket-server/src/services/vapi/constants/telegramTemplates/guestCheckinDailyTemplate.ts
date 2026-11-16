import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { ReservationStatus } from '../../../../dtos/enum/ReservationStatus';
import { Discount } from '../../../../models/Discount';
import { DiscountType } from '../../../../types/discount';
import { CheckInMessageAction } from '../../../../types/enums';
import { formatDateToWords } from '../../../../utils/helper';
import { sanitizeTelegramHTML } from '../../../../utils/sanitizeTelegramHTML';

dayjs.extend(utc);
dayjs.extend(timezone);

export interface DailyGuestCheckinMessage {
  date: dayjs.Dayjs;
  reservations: GuestReservation[];
}

export interface RoomInfo {
  roomType: string;
  nights: number;
}

export interface GuestReservation {
  guestFirstName?: string;
  guestLastName?: string;
  roomType?: string;
  rooms?: RoomInfo[]; // Multiple rooms for grouped reservations
  nights?: number;
  phone?: string;
  totalAmount?: number;
  advanceAmount?: number;
  status?: string;
  checkIn?: Date;
  checkOut?: Date;
  updatedAt?: Date;
  currency?: string;
  discount: Discount | null;
  numAdults?: number;
  numChildren?: number;
  numPets?: number;
}

function formatCurrency(amount: number | undefined): string {
  if (typeof amount !== 'number' || isNaN(amount)) return '0';
  return `${amount.toLocaleString('en-US')}`;
}

export function guestCheckinDailyTemplate(
  message: DailyGuestCheckinMessage,
  action: CheckInMessageAction,
): string {
  const { date, reservations } = message;
  const formattedDate = formatDateToWords(date);

  let totalPending = 0;
  let text: string;
  if (action === CheckInMessageAction.API_TRIGGER) {
    text = `<b>Today's Check-ins – ${sanitizeTelegramHTML(formattedDate)}</b>\n\n`;
    text += `– – – – – – – – – – – – – – – – – – – – – – – – \n\n`;
  } else {
    text = `<b>Today's Check-ins – ${sanitizeTelegramHTML(formattedDate)} {{UPDATED}}</b>\n\n`;
    text += `– – – – – – – – – – – – – – – – – – – – – – – – \n\n`;
  }

  reservations.forEach((res, index) => {
    const serial = index + 1;
    const discount = res.discount;
    const guestName = sanitizeTelegramHTML(
      `${res.guestFirstName || ''} ${res.guestLastName || ''}`.trim(),
    );
    const room = sanitizeTelegramHTML(res.roomType || '-');
    const checkIn = new Date(res.checkIn || '');
    const checkOut = new Date(res.checkOut || '');
    const nights =
      checkIn &&
      checkOut &&
      !isNaN(checkIn.getTime()) &&
      !isNaN(checkOut.getTime())
        ? Math.max(
            Math.round(
              (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24),
            ),
            1,
          )
        : 1;
    const total = typeof res.totalAmount === 'number' ? res.totalAmount : 0;
    const advance =
      typeof res.advanceAmount === 'number' ? res.advanceAmount : 0;
    const pending = total - advance;
    totalPending += pending;

    // Check if this is a grouped reservation with multiple rooms
    if (res.rooms && res.rooms.length > 0) {
      text += ` ${serial}. <b>${guestName}</b>\n`;
      text += `     Rooms:\n`;
      res.rooms.forEach((roomInfo) => {
        const sanitizedRoomType = sanitizeTelegramHTML(
          roomInfo.roomType || '-',
        );
        text += `          * ${sanitizedRoomType} | ${roomInfo.nights}N\n`;
      });
    } else {
      text += ` ${serial}. <b>${guestName}</b> | ${room} | ${nights}N\n`;
    }
    if (res.status !== ReservationStatus.CANCELLED) {
      text += `     STATUS: ${sanitizeTelegramHTML(res.status || 'Unknown')}\n`;
    } else {
      text += `     STATUS: Cancelled\n`;
    }
    text += `     Phone: ${sanitizeTelegramHTML(res.phone || 'N/A')}\n`;

    const adults = res.numAdults || 0;
    const children = res.numChildren || 0;
    const pets = res.numPets || 0;

    text += `     Guests: ${adults} Adults, ${children} Children, ${pets} Pets\n`;
    text += `     Total: ${res.currency}${sanitizeTelegramHTML(formatCurrency(total))}\n`;

    if (discount) {
      if (discount.type === DiscountType.PERCENTAGE) {
        text += `     Discount applied: ${sanitizeTelegramHTML(discount.value.toString())} percent\n`;
      } else {
        text += `     Discount applied: ${res.currency}${sanitizeTelegramHTML(formatCurrency(discount.value))}\n`;
      }
    }
  });

  text += `– – – – – – – – – – – – – – – – – – – – – – – – \n\n`;

  return text.trim();
}
