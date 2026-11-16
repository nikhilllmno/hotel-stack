---
name: change-a-text-message
description: "Change the wording of a text Danny sends, or add one"
version: 1.0.0
author: Dextr
metadata:
  hermes:
    tags: [hotel, danny, change]
    category: hotel
---
# Texts Danny sends to guests (SMS templates)

Owner says: "change the booking confirmation text", "add a text with the wifi details", "the directions text should mention the gate".

1. `agent_overview` -> `texts_danny_can_send` shows each text, when it is used, and a real example.
2. All live in `hotels/contigo-ranch/sms_templates.yaml`:
   ```
   <name>:
     description: when Danny should send it (Danny reads this to choose)
     needs_booking: true|false   # true = core fills {booking_id} {room} {arrival} {departure} {guests} {total} {deposit} {pay_link}
     internal: true              # only for texts core sends itself (payment_receipt)
     text: >-
       {{facts.property.name}}: ...
   ```
3. Wording change: edit `text`. Keep it short (one SMS), keep `{{facts.x}}` placeholders and the `{...}` booking fields valid.
4. New text: add an entry with a clear `description`; Danny is offered it automatically (no other file needed).
   Then consider a test scenario (add-test-scenario) and an instruction telling Danny when to offer it (change-danny-behaviour).

## Always
- The owner speaks plainly. Never ask them for file, tool or template names; find them with `agent_overview` and by reading /repo.
- If the request is ambiguous or missing a value (which cabin? which date? exact wording? calls, texts or both?), ask with the `clarify` tool (choices where obvious, recommended first; free text for values) before proposing.
- Read the current file in /repo before editing. With `propose_change`, `old_text` must be copied exactly from the file (it must appear once).
- Title the change in the owner's words ("Check-in moves to 4 PM"), give the reason, then tell the owner: the change number, what it does in one sentence, and that it waits for their approval on Pending changes. Never say it is live until get_change shows status applied.
- If checks fail, read get_change, fix, and propose again.
