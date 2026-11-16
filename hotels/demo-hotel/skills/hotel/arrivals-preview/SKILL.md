---
name: arrivals-preview
description: "Who arrives soon: rooms, guests, pets, unpaid"
version: 1.0.0
author: Dextr
metadata:
  hermes:
    tags: [hotel, reports]
    category: hotel
---
# Arrivals preview (kind: arrivals)

Owner asks: "who's arriving this week?", "arrivals tomorrow", or a scheduled job.

1. Beds24 `list_reservations(arrival_from, arrival_to)` for the period (default: the next 7 days), status
   confirmed/new/request.
2. Table: arrival date, guest, cabin, nights, adults/children, channel, deposit paid?
3. Flags: pets (comments/notes), large parties, special requests, early check-in asks, unpaid deposits, guests who
   called or texted recently (list_text_threads / list_calls with their number).
4. Suggested next steps: e.g. "text tomorrow's arrivals directions and check-in time" (propose_guest_texts).

## Always
- Data first: hotel tools (`call_stats`, `list_calls`, `get_call`, `list_text_threads`, `list_payments`,
  `list_team_messages`, `unanswered_questions`) and Beds24 (`get_arrivals`, `list_reservations`, `find_reservations`).
- Times and dates are hotel time (America/Chicago); say the exact dates you covered.
- Write for the owner: numbers and names first, short headings and bullets, a small table when it helps, no internal
  names (say "the booking-link text", not booking_link). End with "Suggested next steps" (each one a concrete thing
  Doss can do if the owner says yes).
- Publish with `post_report(title, markdown, kind)`; in a chat also give a 2-3 line summary and say it's on the
  Reports page. Anything that would change something (texts, KB, prices) is proposed, never done directly.
