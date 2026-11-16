---
name: mini-apps
description: "Build or change a mini app: owner dashboards or public guest pages"
version: 1.0.0
author: Dextr
metadata:
  hermes:
    tags: [hotel, apps, html]
    category: hotel
---
# Mini apps

Owner says: "build me a board of this week's arrivals", "a page showing unpaid deposits with a button to resend the
link", "a public page where guests can check which cabins are free", "change the arrivals board to show pets".

## Two kinds
- Owner app (`for_guests: false`): only the owner sees it, inside the dashboard (Apps). May use ALL data below.
- Public page (`for_guests: true`): anyone with the link (`<public url>/p/<slug>`). Only availability and hotel info.
  Never put guest names, phones, bookings or internal facts on a public page.

## Rules for the HTML
- One self-contained document: inline `<style>` and `<script>`, no external scripts (they are refused; public pages
  may use Google Fonts). Mobile-friendly. Plain, clean look: system font or Geist, neutral greys, one accent colour,
  rounded cards, generous spacing, like the dashboard. Show a loading state and readable errors.
- Data comes ONLY through the bridge (the page has no network of its own):
  - Owner app: `await window.hotel.get(source, params)` with source:
    - `reservations` {arrival_from, arrival_to, status?} -> [{id, guest, phone, mobile, email, room, arrival, departure, adults, children, status, channel, total, deposit, comments}]
    - `availability` {arrival, departure, adults, children} -> {nights, available: [{room_id, name, max_guests, beds, total_price, nightly_average}]}
    - `bookings_made` {days} (by booking date), `payments` {days, status}, `call_stats` {days}, `calls` {days, intent, q},
      `call` {id}, `text_threads` {days}, `text_thread` {phone}, `team_messages` {status}, `unanswered` {days},
      `reports` {limit, kind}, `evals`, `overview`, `changes` {status}
    - Try a source with your own hotel/Beds24 tools first to see real field values.
  - Owner buttons: `await window.hotel.act(type, payload)`:
    - `propose_texts` {reason, items: [{to, name, text_name | body, booking_id?}], send_at?} -> a proposal the owner
      approves on Pending changes (show "Proposed #N, approve it on Pending changes"). Nothing is sent directly.
    - `mark_message_done` {id}
    - `ask_doss` {prompt}: opens the Doss chat with the prompt filled in.
  - Public page: `await window.hotel.get("availability", {arrival, departure, adults, children})` ->
    {available: [{name, max_guests, beds, total_price, nightly_average}], nights, book_url} and
    `await window.hotel.get("info")` -> {facts: {"property.name", "property.address", "contact.public_phone",
    "contact.email", "checkin.time", ...}, kb: [{title, content}]}. Link bookings to `book_url`.
- Dates in hotel time (America/Chicago). Money in USD with the $ sign.

## Propose
- New or changed app: `propose_mini_app(slug, title, description, html, for_guests)`. To change one, start from
  `get_mini_app(slug)` and keep what works. The owner sees the HTML diff and approves; undo restores the previous version.
- Ask with `clarify` when the request is vague (which dates? which columns? public or just for you?).
- Tell the owner the change number and where it will appear (Apps page, or the public link).
