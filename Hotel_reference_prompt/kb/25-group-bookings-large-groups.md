---
id: group-bookings-large-groups
title: Group Bookings — Large Groups
editable: true
depends_on: [facts.groups.balance_due_days, facts.groups.block_deposit_fee, facts.groups.cancel_cutoff_days, facts.groups.deposit_due_days, facts.groups.deposit_percent, facts.groups.min_nights, facts.groups.min_units, facts.groups.short_notice_days]
---
# Group Bookings — Large Groups

* Standard lodging policies apply, with unique payment and cancellation schedules
* **Minimum block:** {{facts.groups.min_units}} units, {{facts.groups.min_nights}}-night minimum stay, financially guaranteed
* Additional units may be added and must also be guaranteed for the {{facts.groups.min_nights}}-night minimum
* A contract will be sent to the Point of Contact who is responsible for the financial guarantee

**Payment schedule (large group):**
* At booking: **${{facts.groups.block_deposit_fee}} non-refundable deposit** to secure the block (applied toward room of choice)
  * *If booking less than {{facts.groups.short_notice_days}} days out: {{facts.groups.deposit_percent}}% non-refundable deposit due at booking instead*
* **{{facts.groups.deposit_due_days}} days out:** {{facts.groups.deposit_percent}}% deposit due for all units in the block
* **{{facts.groups.balance_due_days}} days out:** Final balance due for all units

**Per-room cancellation rules (large group):**
* Individual cancels {{facts.groups.cancel_cutoff_days}} or more days out: Remaining balance for that unit is still due
* Individual cancels fewer than {{facts.groups.cancel_cutoff_days}} days out: No refund issued
* Deposits paid by the Client are non-refundable. Client is responsible for collecting reimbursement directly from guests.
