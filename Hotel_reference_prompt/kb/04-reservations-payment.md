---
id: reservations-payment
title: Reservations & Payment
editable: true
depends_on: [facts.payment.balance_due_days_before, facts.payment.deposit_percent]
---
# Reservations & Payment

**Booking recommendation:** Book directly through the website for best rates, greater flexibility, and direct team support. Third-party bookings may have different pricing and more limited modification/cancellation options.

**Deposit:** {{facts.payment.deposit_percent}}% of total reservation price at time of booking

**Balance:** Remaining balance due {{facts.payment.balance_due_days_before}} days before arrival

**Accepted Payment Methods:** Visa, Mastercard, Discover, American Express. A valid credit card is required to guarantee all reservations. If booking via a third-party site using a virtual card, a physical credit card will be required upon arrival for incidentals.
