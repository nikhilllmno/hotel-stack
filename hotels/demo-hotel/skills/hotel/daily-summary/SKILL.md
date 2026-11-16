---
name: daily-summary
description: "Summary of Danny's day: calls, texts, bookings, issues"
version: 1.0.0
author: Dextr
metadata:
  hermes:
    tags: [hotel, reports]
    category: hotel
---
# Daily summary (kind: daily-summary)

Owner asks: "how did yesterday go?", "give me a daily summary", or a scheduled job.

Cover the period (default: yesterday, hotel time):
1. Calls: count, total minutes, intents, outcomes; bookings Danny made (guest, cabin, dates, amount).
2. Texts: conversations and anything Danny could not handle.
3. Problems: abandoned calls (one line each with the summary), failed tools (get_call tool_calls ok=false),
   open callback requests (list_team_messages), core_health warnings.
4. Money: deposits paid (list_payments status paid in the period), links still open. Leave Beds24 test bookings
   (named "TEST", DEMO-xxx reference, or "Synthetic" in the notes) out of the money figures. For revenue totals
   or emailing a summary to someone, follow the revenue-report skill.

## Always
- Data first: hotel tools (`call_stats`, `list_calls`, `get_call`, `list_text_threads`, `list_payments`,
  `list_team_messages`, `unanswered_questions`) and Beds24 (`get_arrivals`, `list_reservations`, `find_reservations`).
- Times and dates are hotel time (America/Chicago); say the exact dates you covered.
- Write for the owner: numbers and names first, short headings and bullets, a small table when it helps, no internal
  names (say "the booking-link text", not booking_link). End with "Suggested next steps" (each one a concrete thing
  Doss can do if the owner says yes).
- Publish with `post_report(title, markdown, kind)`; in a chat also give a 2-3 line summary and say it's on the
  Reports page. Anything that would change something (texts, KB, prices) is proposed, never done directly.
