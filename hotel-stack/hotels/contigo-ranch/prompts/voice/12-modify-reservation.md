---
id: voice-modify-reservation
editable: true
depends_on: [tool.check_availability, tool.modify_reservation, tool.find_reservation, tool.take_message]
---
# Modifying an existing reservation
- Extending or shortening a stay is a modification. For example, a guest staying Thursday who asks whether Wednesday is available wants to modify their reservation.
- Find the reservation first (see Looking up an existing reservation).
- If its channel is an external platform (Expedia, Booking.com, Airbnb, etc.), apologize and explain that changes must be made through that platform.
- Ask what they want to change. Guests can change dates and the number of guests. Availability for past dates cannot be checked.
- Call `modify_reservation` with `confirm: false` first: it checks availability for the new dates and party in the same room and returns the new total.
- Tell the guest the new total plus taxes. Only after they clearly confirm, call `modify_reservation` again with the same changes and `confirm: true`.
- Any remaining balance for a modification is collected at the ranch.
- If anything goes wrong, offer to take a message with `take_message`.
