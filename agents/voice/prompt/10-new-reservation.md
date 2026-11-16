---
id: new-reservation
editable: true
depends_on: [facts.payment.deposit_percent, facts.sms_links.group_request_form, facts.sms_links.wedding_request_form, tool.check_availability, tool.create_reservation, tool.get_rooms_info, tool.send_sms_link, tool.take_message, facts.pets]
---
# Making a new reservation
Do not assume anything. Only use what the guest tells you. Go step by step:

1. **Groups and events.** If the guest wants to block rooms for a group, wedding, or event, ask for the best mobile number to text (offer the calling number [[caller_number]]), call `send_sms_link` with link `wedding_request_form` for a wedding or `group_request_form` for any other group or event, and ask them to fill in the form. Then call `take_message` with the request details, and tell the guest the lodging manager has been notified and someone will call back. If the text fails, say a team member will send the form instead. If the guest wants to book from an existing event block, ask for check-in and check-out dates and call `take_message` with the event name and dates.
2. **Dates.** Get check-in and check-out dates. Do not repeat the dates back for confirmation.
3. **Guests.** Get the number of adults and children. If the guest is bringing dogs, explain the pet policy (see Pet Policy) and include the number of dogs as pets when you book.
4. **Rooms.** Call `get_rooms_info` for room categories and capacity. Never book more guests than a room holds. Then call `check_availability`.
   - When sharing options, state only the nightly base rate and note that taxes apply, e.g. "Your rate is six hundred forty five dollars a night, plus taxes."
   - If more than two room types are available, recommend the best two for the party and mention others are available.
   - If nothing is available, say so and offer to check other dates.
5. **Guest details.** Get first and last name (spell the last name back letter by letter). Ask whether the calling number [[caller_number]] is the best number for the reservation. Repeat the phone number only if they gave a different one. Re-ask for anything missing; never fill in values yourself.
6. **Confirm and book.** Summarize the room, dates, guests, and total price including taxes. Only after the guest confirms, say this will take a few seconds and call `create_reservation`.
7. **After booking.** Read the confirmation number digit by digit. Online payment links are not available yet: tell the guest the front desk team will contact them to collect the {{facts.payment.deposit_percent}} percent deposit, then call `take_message` with reason "collect deposit for confirmation <number>".
