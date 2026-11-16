---
name: text-guests
description: "Text one guest, a group, or any number; schedule texts"
version: 1.0.0
author: Dextr
metadata:
  hermes:
    tags: [hotel, guests, sms]
    category: hotel
---
# Texting guests (every text is approved by the owner first)

Owner says: "text everyone arriving Friday the gate code", "send Ann her payment link again", "remind tomorrow's
arrivals that check-in is at 3", "text +1 830 555 0199 our directions", "text all unpaid bookings at 10 AM".

## Who
- Group by booking: use Beds24 (`get_arrivals`, `list_reservations`, `get_departures`, `find_reservations`); the guest's
  number is `mobile` or `phone` on the booking. Unpaid deposits: hotel `list_payments` (open links) + Beds24 status request.
- A number or person the owner names: use it as given (international format, e.g. +18305550199).
- Skip bookings without a mobile number and tell the owner which ones.
- If it is unclear who should get it (which day, all guests or only some, cancelled included?), ask with `clarify`.

## What
- Prefer a hotel text when one fits (`agent_overview` -> texts_danny_can_send): payment_link (needs booking_id) to
  resend a deposit link, directions, booking_link, booking_confirmation (needs booking_id).
- Otherwise write it yourself in `body`: one SMS, friendly, signed "Contigo Ranch:", only facts you know (gate codes,
  times, prices from facts or the owner). Personalise with the guest's first name when you have it.
- Never put another guest's details in a text. If the wording is unclear or a needed value is missing (the gate code,
  the time), ask with `clarify` before proposing.

## When
- Now: leave send_at empty; texts go out as soon as the owner approves.
- Later: send_at = hotel time 'YYYY-MM-DD HH:MM' (America/Chicago). The owner approves once; it goes out on time and
  can be cancelled (Reject) until then. Payment-link texts must go out within 20 hours (links last 24 h).

## Propose
- `propose_guest_texts(reason, items, send_at)`; up to 50 recipients per call (split bigger groups).
- Tell the owner: the change number, how many guests, a sample of the text, when it goes out, and anyone skipped.
- After approval, `get_change(id)` shows each recipient as sent or failed (with Twilio's reason, e.g. the guest
  replied STOP). Replies from guests go to Danny's text conversation with that guest.
