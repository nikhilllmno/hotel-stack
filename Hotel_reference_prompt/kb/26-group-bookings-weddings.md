---
id: group-bookings-weddings
title: Group Bookings — Weddings
editable: true
allow_literals: [6]   # Cottages 6-16
depends_on: [facts.groups.balance_due_days, facts.groups.cancel_cutoff_days, facts.groups.deposit_due_days, facts.groups.deposit_percent, facts.groups.min_nights, facts.groups.request_form, facts.groups.wedding_form, facts.groups.wedding_update_days]
---
# Group Bookings — Weddings

* All standard lodging policies apply; unique payment and cancellation schedules apply
* **Full property required:** All Cabins 1–5 and Cottages 6–16 must be booked for a **{{facts.groups.min_nights}}-night minimum stay**
* Lodging is priced separately from the venue rental fee
* Upon receipt of venue deposit, the team will provide instructions for coordinating the guest room block

**Payment schedule (weddings):**
* **{{facts.groups.wedding_update_days}} days out:** Team provides update on any remaining unreserved accommodations in the room block
* **{{facts.groups.deposit_due_days}} days out:** Any unreserved units in the contracted block require a **{{facts.groups.deposit_percent}}% deposit** charged to the Client
* **{{facts.groups.balance_due_days}} days out:** Remaining balance due for all guaranteed accommodations

**Per-room cancellation rules (wedding group):**
* Individual cancels {{facts.groups.cancel_cutoff_days}} or more days out: Remaining balance for that unit is still due
* Individual cancels fewer than {{facts.groups.cancel_cutoff_days}} days out: No refund issued
* Deposits paid by the Client are non-refundable
* If a guest later books a unit the Client previously guaranteed, those guest payments are applied to the final balance
* Client is solely responsible for collecting reimbursement from guests

**Wedding inquiries:** {{facts.groups.wedding_form}}
**Other group and event requests:** {{facts.groups.request_form}}
