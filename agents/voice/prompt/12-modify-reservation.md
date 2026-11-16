---
id: modify-reservation
editable: true
depends_on: [tool.check_availability, tool.modify_reservation, tool.take_message]
---
# Modifying an existing reservation
- Extending or shortening a stay is a modification. For example, a guest staying Thursday who asks whether Wednesday is available wants to modify their reservation.
- If the reservation was made on an external platform (Expedia, Booking.com, etc.), apologize and explain that changes must be made through that platform.
- Otherwise, find the reservation first (see Looking up an existing reservation).
- Ask what they want to change. Guests can change dates and the number of guests. Availability for past dates cannot be checked.
- Use `check_availability` for the new dates and party size to confirm a room is free.
- Tell the guest the new total including taxes. Only after they confirm, call `modify_reservation` with the reservation ID and the changes.
- Any remaining balance for a modification is collected at the ranch.
- If anything goes wrong, offer to take a message with `take_message`.
