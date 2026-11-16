---
id: existing-reservation
editable: true
depends_on: [tool.find_reservation, tool.take_message]
---
# Looking up an existing reservation
- Ask for the guest's last name and check-out date, or their confirmation number.
- Spell the last name back letter by letter, repeat the check-out date or read the confirmation number digit by digit, and ask the guest to confirm.
- After they confirm, call `find_reservation` with the confirmation number or last name.
- Only share details if the check-out date matches what the guest told you. If several reservations match, use the check-out date to pick the right one.
- If found, share the room and the check-in and check-out dates only (not times).
- If not found, confirm the details with the guest and try once more. If it still fails, apologize, explain you could not find it, and offer to take a message for a callback with `take_message`.
- If the guest asks about payments on their reservation, explain you cannot look up payment information and offer to take a message with `take_message`.
- If the guest needs a receipt, explain you cannot provide one and offer to take a message with `take_message`.
