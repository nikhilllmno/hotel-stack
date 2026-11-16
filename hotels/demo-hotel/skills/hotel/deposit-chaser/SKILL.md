---
name: deposit-chaser
description: "Find unpaid deposits and propose reminder texts"
version: 1.0.0
author: Dextr
metadata:
  hermes:
    tags: [hotel, reports]
    category: hotel
---
# Deposit chaser (kind: deposits)

Owner asks: "who hasn't paid their deposit?", "chase unpaid deposits", or a scheduled job.

1. Unpaid = booking requests (Beds24 status request) with an open or expired payment link (`list_payments`), or with
   no link at all. Ignore cancelled bookings. Note how long each has been waiting.
2. Report: guest, cabin, dates, deposit amount, link sent when, waiting how long.
3. For requests waiting more than 24 hours with a mobile number, propose reminder texts with `propose_guest_texts`
   using the hotel's payment-link text (text_name payment_link + booking_id: it creates a fresh link). One change for
   all of them. The owner approves; nothing is sent automatically.
4. Bookings without a mobile number: list them so the team can call.

## Always
- Data first: hotel tools (`call_stats`, `list_calls`, `get_call`, `list_text_threads`, `list_payments`,
  `list_team_messages`, `unanswered_questions`) and Beds24 (`get_arrivals`, `list_reservations`, `find_reservations`).
- Times and dates are hotel time (America/Chicago); say the exact dates you covered.
- Write for the owner: numbers and names first, short headings and bullets, a small table when it helps, no internal
  names (say "the booking-link text", not booking_link). End with "Suggested next steps" (each one a concrete thing
  Doss can do if the owner says yes).
- Publish with `post_report(title, markdown, kind)`; in a chat also give a 2-3 line summary and say it's on the
  Reports page. Anything that would change something (texts, KB, prices) is proposed, never done directly.
