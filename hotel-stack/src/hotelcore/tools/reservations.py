"""find_reservation: by booking number or guest last name, matched here (Beds24's searchString misses bookings)."""

from datetime import timedelta

from hotelcore.tools.context import ToolContext, ToolError
from hotelcore.tools.rooms import room_types

ALL_STATUSES = ["confirmed", "new", "request", "cancelled", "black", "inquiry"]
DAYS_BACK, DAYS_AHEAD, MAX_MATCHES = 60, 540, 5


def guest_view(booking: dict, rooms: dict) -> dict:
    """Booking details a caller may hear. No email or phone: the caller is not verified."""
    return {
        "booking_id": booking["id"],
        "status": booking.get("status"),
        "channel": booking.get("channel") or "direct",
        "first_name": booking.get("firstName"),
        "last_name": booking.get("lastName"),
        "arrival": booking.get("arrival"),
        "departure": booking.get("departure"),
        "room": rooms.get(booking.get("roomId"), {}).get("name"),
        "adults": booking.get("numAdult"),
        "children": booking.get("numChild"),
        "total_price": booking.get("price"),
        "deposit_paid": booking.get("deposit") or 0,  # set by the /pay page (or staff); with status confirmed = paid
    }


def find_reservation(ctx: ToolContext, query: str) -> dict:
    query = query.strip()
    if not query:
        raise ToolError("I need a last name or a booking number to look that up.")
    if query.isdigit():
        found = ctx.pms.get_all("/bookings", propertyId=ctx.pms.property_id, id=int(query), status=ALL_STATUSES)
    else:
        today = ctx.now().date()
        window = ctx.pms.get_all(
            "/bookings", propertyId=ctx.pms.property_id, status=ALL_STATUSES,
            arrivalFrom=(today - timedelta(days=DAYS_BACK)).isoformat(),
            arrivalTo=(today + timedelta(days=DAYS_AHEAD)).isoformat(),
        )
        found = [b for b in window if (b.get("lastName") or "").strip().lower() == query.lower()]
    rooms = room_types(ctx)
    matches = [guest_view(b, rooms) for b in sorted(found, key=lambda b: b.get("arrival") or "")][:MAX_MATCHES]
    return {"matches": matches, **({} if matches else {"message": f"I couldn't find a reservation for {query}."})}
