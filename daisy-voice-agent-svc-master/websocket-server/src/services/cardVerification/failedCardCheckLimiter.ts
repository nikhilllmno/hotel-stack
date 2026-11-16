const MAX_FAILED_RESERVATIONS_PER_PHONE = 10;
const MAX_FAILED_ATTEMPTS_PER_RESERVATION = 5;
const FAILED_CARD_CHECK_WINDOW_MS = 24 * 60 * 60 * 1000;

enum LimiterOwner {
  DECLINES_BY_PHONE = 'DECLINES_BY_PHONE',
  DECLINES_BY_REVIEW = 'DECLINES_BY_REVIEW',
}

interface CardSubmission {
  hotelId: string;
  phoneNumber: string;
  reviewId: string;
}

function phoneKey(hotelId: string, phoneNumber: string): string {
  return `${hotelId}:${phoneNumber.replace(/\D/g, '')}`;
}

class FailedCardCheckLimiter {
  private entries = new Map<string, Map<string, number>>();
  private attemptSeq = 0;

  recordDecline({ hotelId, phoneNumber, reviewId }: CardSubmission): void {
    this.saveEntry(
      LimiterOwner.DECLINES_BY_PHONE,
      phoneKey(hotelId, phoneNumber),
      reviewId,
    );
    this.saveEntry(
      LimiterOwner.DECLINES_BY_REVIEW,
      reviewId,
      String(this.attemptSeq++),
    );
  }

  isPhoneBlocked(hotelId: string, phoneNumber: string): boolean {
    return (
      this.countEntriesInWindow(
        LimiterOwner.DECLINES_BY_PHONE,
        phoneKey(hotelId, phoneNumber),
      ) >= MAX_FAILED_RESERVATIONS_PER_PHONE
    );
  }

  isCardSubmissionBlocked({
    hotelId,
    phoneNumber,
    reviewId,
  }: CardSubmission): boolean {
    return (
      this.isPhoneBlocked(hotelId, phoneNumber) ||
      this.countEntriesInWindow(LimiterOwner.DECLINES_BY_REVIEW, reviewId) >=
        MAX_FAILED_ATTEMPTS_PER_RESERVATION
    );
  }

  reset(): void {
    this.entries.clear();
  }

  private saveEntry(owner: LimiterOwner, key: string, subKey: string): void {
    const id = `${owner}:${key}`;
    const entries = this.entries.get(id) ?? new Map<string, number>();
    entries.set(subKey, Date.now());
    this.entries.set(id, entries);
  }

  private countEntriesInWindow(owner: LimiterOwner, key: string): number {
    this.deleteEntries(owner, key, Date.now() - FAILED_CARD_CHECK_WINDOW_MS);
    return this.entries.get(`${owner}:${key}`)?.size ?? 0;
  }

  private deleteEntries(
    owner: LimiterOwner,
    key: string,
    olderThanUts: number,
  ): void {
    const id = `${owner}:${key}`;
    const entries = this.entries.get(id);
    if (!entries) return;
    for (const [subKey, updatedUts] of entries) {
      if (updatedUts <= olderThanUts) entries.delete(subKey);
    }
    if (entries.size === 0) this.entries.delete(id);
  }
}

export default new FailedCardCheckLimiter();

export const __for_testing = {
  FAILED_CARD_CHECK_WINDOW_MS,
  FailedCardCheckLimiter,
  MAX_FAILED_ATTEMPTS_PER_RESERVATION,
  MAX_FAILED_RESERVATIONS_PER_PHONE,
};
