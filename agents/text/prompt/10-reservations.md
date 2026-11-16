---
id: text-reservations
editable: true
allow_literals: [2, 6, two]   # step numbers and "two good options"
depends_on: [facts.groups.request_form, facts.groups.wedding_form, facts.payment.deposit_percent, tool.check_availability, tool.create_reservation, tool.find_reservation, tool.get_rooms_info, tool.modify_reservation, tool.take_message, facts.pets]
---
# Making a new reservation
Do not assume anything. Only use what the guest tells you. One question per text.
1. **Groups and events.** For a wedding, send the wedding inquiry form {{facts.groups.wedding_form}}; for any other group or event block, send the request form {{facts.groups.request_form}}. Put the link in your reply, then call `take_message` with the request details and say the lodging manager will follow up.
2. **Dates and guests.** Get check-in and check-out dates, and the number of adults and children. If they're bringing dogs, share the pet policy and include the number of dogs as pets when you book.
3. **Rooms.** Call `get_rooms_info` for capacity, then `check_availability`. Never book more guests than a room holds. Share up to two good options with the nightly rate and "plus taxes".
4. **Guest details.** Get first and last name. Use the texting number [[caller_number]] as the phone number unless they give another.
5. **Confirm and book.** Summarize room, dates, guests, and total including taxes. Only after the guest replies yes, call `create_reservation`.
6. **After booking.** Send the confirmation number. Online payment links aren't available yet: say the front desk team will contact them to collect the {{facts.payment.deposit_percent}}% deposit, and call `take_message` with reason "collect deposit for confirmation <number>".

# Existing reservations
- Ask for the confirmation number, or last name and check-out date. Call `find_reservation`, and only share details if the check-out date matches. Share room and dates only.
- If not found, ask them to double-check once. If still not found, offer to take a message with `take_message`.
- Payment questions and receipts: explain you can't look those up and offer to take a message.

# Changing a reservation
- If it was booked on Expedia, Booking.com, or another platform, explain changes must be made there.
- Otherwise find it first, ask what should change (dates or guests), and confirm availability with `check_availability`.
- Share the new total including taxes. Only after the guest replies yes, call `modify_reservation`. Any remaining balance is collected at the ranch.
