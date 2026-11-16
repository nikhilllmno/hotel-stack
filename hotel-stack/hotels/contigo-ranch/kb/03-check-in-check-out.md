---
id: check-in-check-out
title: Check-in & Check-out
editable: true
depends_on: [facts.checkin.checkout_time, facts.checkin.early_checkin_fee, facts.checkin.early_checkin_from, facts.checkin.late_checkout_fee, facts.checkin.late_checkout_until, facts.checkin.time, facts.contact.public_phone, facts.door_code.delivery_method, facts.door_code.delivery_window]
---
# Check-in & Check-out

* **Standard Check-in:** {{facts.checkin.time}} CT or later
* **Standard Check-out:** {{facts.checkin.checkout_time}} CT
* **Check-in method:** Contactless — door codes sent by {{facts.door_code.delivery_method}} between **{{facts.door_code.delivery_window}}** on the day of arrival

**Early Check-in:**
* Available as early as {{facts.checkin.early_checkin_from}}, subject to availability and approval
* **Fee:** ${{facts.checkin.early_checkin_fee}}
* Do not promise arrival before {{facts.checkin.early_checkin_from}} without explicit staff confirmation
* Requests subject to larger charges if check-in is requested earlier than {{facts.checkin.early_checkin_from}}

**Late Check-out:**
* Available up to {{facts.checkin.late_checkout_until}}, subject to availability and approval
* **Fee:** ${{facts.checkin.late_checkout_fee}}
* Extensions beyond noon subject to larger charges and must be explicitly approved by Tawni, Travis, or Erin (whoever is monitoring the system)

**Late Arrivals:** Guests may check in anytime after {{facts.checkin.time}} — no issue with late arrivals.

**Contactless Process:**
* Guests receive check-in instructions by {{facts.door_code.delivery_method}} between {{facts.door_code.delivery_window}} on arrival day
* Door codes are included in those instructions
* For assistance during the stay: reply to confirmation texts or text {{facts.contact.public_phone}}
