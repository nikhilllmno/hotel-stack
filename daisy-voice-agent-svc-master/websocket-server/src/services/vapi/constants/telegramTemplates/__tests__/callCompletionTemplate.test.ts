import { ReservationPaymentStatus } from '../../../../../dtos/enum/ReservationPaymentStatus';
import { callCompletionTemplate } from '../callCompletionTemplate';

describe('callCompletionTemplate', () => {
  it('omits the Payment Status line when paymentStatus is missing', () => {
    const message = callCompletionTemplate({
      bookingDetails: [
        {
          external_id: 'BK-1',
          guestFirstName: 'Jane',
          guestLastName: 'Doe',
        },
      ],
    });

    expect(message).not.toContain('Payment Status');
  });

  it('includes the upper-cased Payment Status line when paymentStatus is present', () => {
    const message = callCompletionTemplate({
      bookingDetails: [
        {
          external_id: 'BK-1',
          guestFirstName: 'Jane',
          guestLastName: 'Doe',
          paymentStatus: ReservationPaymentStatus.PARTIALLY_PAID,
        },
      ],
    });

    expect(message).toContain('Payment Status: PARTIALLY_PAID');
  });

  it('upper-cases and HTML-escapes an unsanitized payment status', () => {
    const message = callCompletionTemplate({
      bookingDetails: [
        {
          external_id: 'BK-1',
          paymentStatus:
            'partially<paid>&refunded' as unknown as ReservationPaymentStatus,
        },
      ],
    });

    expect(message).toContain(
      'Payment Status: PARTIALLY&lt;PAID&gt;&amp;REFUNDED',
    );
  });

  it('omits the Booking ID line when no external id is present', () => {
    const message = callCompletionTemplate({
      bookingDetails: [
        {
          guestFirstName: 'Jane',
          guestLastName: 'Doe',
        },
      ],
    });

    expect(message).not.toContain('Booking ID');
  });

  it('prefers external_public_id over external_id for the Booking ID', () => {
    const message = callCompletionTemplate({
      bookingDetails: [
        {
          external_id: 'INTERNAL-1',
          external_public_id: 'CONF-12345',
          guestFirstName: 'Jane',
          guestLastName: 'Doe',
        },
      ],
    });

    expect(message).toContain('Booking ID: CONF-12345');
    expect(message).not.toContain('INTERNAL-1');
  });

  it('renders rate total and advance using the booking currency', () => {
    const message = callCompletionTemplate({
      bookingDetails: [
        {
          external_id: 'BK-1',
          rateTotal: 150,
          advance: 50,
          currency: 'USD',
        },
      ],
    });

    expect(message).toContain('Rate Total: $150.00');
    expect(message).toContain('Advance: $50.00');
  });

  it('renders details for each distinct booking', () => {
    const message = callCompletionTemplate({
      bookingDetails: [
        { external_id: 'BK-1', guestFirstName: 'Jane' },
        { external_id: 'BK-2', guestFirstName: 'John' },
      ],
    });

    expect(message).toContain('Booking ID: BK-1');
    expect(message).toContain('Booking ID: BK-2');
  });

  it('includes callback request details when present', () => {
    const message = callCompletionTemplate({
      callbackRequest: ['Guest requested late checkout'],
    });

    expect(message).toContain('Callback Request Details');
    expect(message).toContain('Guest requested late checkout');
  });

  it('shows the fallback text when no recording link is provided', () => {
    const message = callCompletionTemplate({});

    expect(message).toContain('No transcription link available');
  });

  it('sanitizes HTML-unsafe characters in guest-controlled fields', () => {
    const message = callCompletionTemplate({
      summary: 'Guest said <script>alert(1)</script> & left',
    });

    expect(message).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt; &amp; left',
    );
  });

  it('renders the empty-state duration and recording fallback when called with no message', () => {
    const message = callCompletionTemplate();

    expect(message).toContain('Duration: 0 min 0 sec');
    expect(message).toContain('No transcription link available');
    expect(message).not.toContain('Booking Details');
    expect(message).not.toContain('undefined');
  });

  it('omits the caller line when no phone number is provided', () => {
    const message = callCompletionTemplate({ summary: 'No caller info' });

    expect(message).not.toContain('tel:');
    expect(message).not.toContain('undefined');
  });

  it('prefixes a phone number with + when missing', () => {
    const message = callCompletionTemplate({ phoneNumber: '15550001111' });

    expect(message).toContain('<a href="tel:+15550001111">+15550001111</a>');
  });

  it('does not double-prefix a phone number that already starts with +', () => {
    const message = callCompletionTemplate({ phoneNumber: '+15550001111' });

    expect(message).toContain('<a href="tel:+15550001111">+15550001111</a>');
  });
});
