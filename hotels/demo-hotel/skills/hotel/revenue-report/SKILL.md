---
name: revenue-report
description: "Use when asked for booking revenue. Total it, email/post."
version: 1.0.0
author: Doss
metadata:
  hermes:
    tags: [hotel, reports, revenue, email]
    category: hotel
---
# Booking revenue report

The owner asks for things like "total revenue from bookings", "how much did we book this month", or "email the
revenue summary to X". The report goes on the Reports page, to an email address, or both.

## Procedure
1. Scope. If no period is given, ask with ONE `clarify` call: the period (this month / year to date / last month /
   upcoming), and whether to leave out cancelled bookings or list them separately. The owner has chosen "this
   month, with cancelled bookings listed separately" before, so put that option first.
2. Pull the data from Beds24, in parallel:
   - `list_reservations(arrival_from, arrival_to)` with no status. This leaves out cancelled bookings, so it gives
     the confirmed and live ones.
   - `list_reservations(..., status="cancelled")`. This is a separate call because the default leaves cancelled out.
   - Only call `get_hotel` if you need room names. `list_reservations` already returns roomName.
3. Work out, per booking: room name, stay dates, nights, `price` (the total for the stay), `deposit` (paid) and the
   balance (price minus deposit). For the totals, give revenue, nights, the average nightly rate, deposits collected
   and the balance still owed. Use code if there are more than a handful of bookings.
4. Look for test data. Beds24 bookings named "TEST ...", with a DEMO-xxx reference, or with notes saying
   "Synthetic" are not real revenue. Label them as test bookings and keep them out of the real totals, even when they
   are cancelled, because otherwise they inflate the numbers badly.
5. Deliver:
   - Email: send with `GMAIL_SEND_EMAIL` with is_html=true. Use a short intro, a table of confirmed bookings with a
     totals row, a table of cancelled bookings, and a one-line bottom line. The subject should be "Contigo Ranch –
     Booking revenue summary, <Month YYYY>".
   - Report: `post_report` with the same content in markdown.
6. Tell the owner in chat: the headline numbers (revenue, deposits paid, still owed, cancelled split into real and
   test), and that the email was sent (give the recipient and sender account) or that the report is posted.

## Always
- Every email Doss sends must say near the end that Doss, the Contigo Ranch operations copilot, prepared and
  sent it directly. The owner asked for this.
- Emails go outside the hotel team, so leave out guest names, phones and emails. Use rooms, dates and amounts only.
  Tell the owner you did this.
- Say which date range you used and that it is based on arrival dates (the stays that arrive in the period).
- If Gmail has no active connection, the send fails. Call `COMPOSIO_MANAGE_CONNECTIONS(toolkits=["gmail"])`, give
  the owner the sign-in link as a plain URL (it expires in about 10 minutes), and keep the email ready. When the
  owner says done, check the connection is active with the same call, then send. Don't send before the connection
  is confirmed.
